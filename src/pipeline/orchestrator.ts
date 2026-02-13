import "dotenv/config";
import { WorkatoClient } from "../api/workato-client.js";
import { createSqliteStorage } from "../storage/sqlite-storage.js";
import { fetchAndStoreRecipes } from "../rules/fetcher.js";
import { computeRecipeHash, getChangedRecipes } from "../rules/hash-compare.js";
import { createRunTracker } from "../rules/run-tracker.js";
import { createAnthropicClient } from "../ai/anthropic-ai-client.js";
import { createFileSystemPublisher } from "../publishers/filesystem-publisher.js";
import type { Publisher } from "../publishers/publisher.js";
import { createCorrelationLogger } from "../logger.js";
import type { Logger } from "pino";

const WORKATO_TOKEN = process.env.WORKATO_API_TOKEN ?? "";
const WORKATO_BASE_URL = process.env.WORKATO_BASE_URL;
const WORKATO_DATACENTER = process.env.WORKATO_DATACENTER ?? "us";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const WORKATO_CUSTOMERS = process.env.WORKATO_CUSTOMERS
  ? process.env.WORKATO_CUSTOMERS.split(",").map((s) => s.trim()).filter(Boolean)
  : undefined;
const WORKATO_TEST_ACCOUNT_ID = process.env.WORKATO_TEST_ACCOUNT_ID?.trim();
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "output";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "uncategorized";
}

export async function runDocumentationPipeline(
  customerId?: string,
  forceRegenerate?: boolean,
  parentLogger?: Logger
): Promise<void> {
  const log = parentLogger ?? createCorrelationLogger();

  if (!WORKATO_TOKEN) {
    throw new Error(
      "WORKATO_API_TOKEN is required. Set it in your .env file or environment."
    );
  }
  if (!ANTHROPIC_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required. Set it in your .env file or environment."
    );
  }

  log.info({ customerId, forceRegenerate }, "Starting documentation pipeline");

  const storage = createSqliteStorage();
  const runTracker = createRunTracker(storage);

  const client = new WorkatoClient({
    apiToken: WORKATO_TOKEN,
    baseUrl: WORKATO_BASE_URL,
    datacenter: WORKATO_DATACENTER,
  });

  const aiClient = createAnthropicClient({
    apiKey: ANTHROPIC_KEY,
    docModel: process.env.ANTHROPIC_DOC_MODEL,
    qualityModel: process.env.ANTHROPIC_QUALITY_MODEL,
  });
  const publishers: Publisher[] = [
    createFileSystemPublisher({ outputDir: OUTPUT_DIR }),
  ];

  const customerIds = customerId
    ? [customerId]
    : WORKATO_TEST_ACCOUNT_ID
      ? [WORKATO_TEST_ACCOUNT_ID]
      : WORKATO_CUSTOMERS;
  const lastRun = runTracker.getLastSuccessfulRunFinishedAt();

  const runId = runTracker.startRun();

  let customersProcessed = 0;
  let recipesFetched = 0;
  let recipesChanged = 0;
  let projectsDocumented = 0;
  const errors: string[] = [];

  try {
    const fetchResult = await fetchAndStoreRecipes(client, storage, {
      customerIds,
      updatedAfter: forceRegenerate ? undefined : lastRun ?? undefined,
    });

    customersProcessed = fetchResult.customersProcessed;
    recipesFetched = fetchResult.recipesFetched;
    if (fetchResult.customerErrors.length > 0) {
      errors.push(...fetchResult.customerErrors);
    }

    log.info(
      {
        customersProcessed,
        recipesFetched,
        customerErrors: fetchResult.customerErrors.length,
      },
      "Fetch complete"
    );

    // Index recipes by key for O(1) lookup instead of O(n) find()
    const recipeIndex = new Map<string, { recipe: typeof fetchResult.recipes[0]["recipe"]; managedUserId: string }>();
    for (const entry of fetchResult.recipes) {
      recipeIndex.set(`${entry.managedUserId}:${entry.recipe.id}`, entry);
    }

    const changed = forceRegenerate
      ? fetchResult.recipes.map((r) => ({
          recipeId: r.recipe.id,
          managedUserId: r.managedUserId,
          isNew: false,
        }))
      : getChangedRecipes(
          fetchResult.recipes,
          (recipeId) => storage.getLatestSnapshot(recipeId)?.content_hash ?? null
        );
    recipesChanged = changed.length;
    log.info({ recipesChanged }, "Change detection complete");

    const changedByProject = new Map<
      string,
      { managedUserId: string; projectId: number; recipeIds: Set<number> }
    >();
    for (const { recipeId, managedUserId } of changed) {
      const recipeData = recipeIndex.get(`${managedUserId}:${recipeId}`);
      if (!recipeData?.recipe.project_id) continue;
      const key = `${managedUserId}:${recipeData.recipe.project_id}`;
      if (!changedByProject.has(key)) {
        changedByProject.set(key, {
          managedUserId,
          projectId: recipeData.recipe.project_id,
          recipeIds: new Set(),
        });
      }
      changedByProject.get(key)!.recipeIds.add(recipeId);
    }

    for (const { managedUserId, projectId, recipeIds } of changedByProject
      .values()) {
      try {
        const project = storage.getProject(projectId, managedUserId);
        if (!project) {
          errors.push(`Project ${projectId} not found`);
          continue;
        }

        const projectRecipes = fetchResult.recipes.filter(
          (r) =>
            r.managedUserId === managedUserId &&
            r.recipe.project_id === projectId
        );
        if (projectRecipes.length === 0) continue;

        const hasNewOrForce = forceRegenerate || Array.from(recipeIds).some(
          (id) => {
            const r = recipeIndex.get(`${managedUserId}:${id}`);
            return !r || !storage.getLatestSnapshot(id);
          }
        );
        if (!hasNewOrForce) {
          let anyMeaningful = false;
          for (const id of recipeIds) {
            const r = recipeIndex.get(`${managedUserId}:${id}`);
            if (!r) continue;
            const prev = storage.getLatestSnapshot(id);
            if (!prev) {
              anyMeaningful = true;
              break;
            }
            let oldRecipe: typeof r.recipe;
            try {
              oldRecipe = JSON.parse(prev.raw_json) as typeof r.recipe;
            } catch {
              anyMeaningful = true;
              break;
            }
            const semantic = await aiClient.analyzeSemanticChange(
              oldRecipe,
              r.recipe
            );
            if (semantic.hasMeaningfulChange) {
              anyMeaningful = true;
              break;
            }
          }
          if (!anyMeaningful) continue;
        }

        const docResult = await aiClient.generateProjectDocumentation(
          project.name,
          project.description ?? undefined,
          projectRecipes.map((r) => r.recipe)
        );

        // Publish first — if this fails, we don't save snapshots,
        // so the next run will re-detect the changes and retry.
        const projectSlug = slugify(project.name);
        for (const pub of publishers) {
          await pub.publish(
            {
              managedUserId,
              contentMd: docResult.markdown,
              contentHtml: docResult.html ?? docResult.markdown,
            },
            {
              projectName: project.name,
              projectSlug,
              isProjectDoc: true,
            }
          );
        }

        // Only save snapshots after successful publish.
        for (const { recipe } of projectRecipes) {
          const hash = computeRecipeHash(recipe);
          storage.upsertSnapshot({
            recipe_id: recipe.id,
            managed_user_id: managedUserId,
            content_hash: hash,
            raw_json: JSON.stringify(recipe),
            created_at: new Date().toISOString(),
          });
        }

        projectsDocumented++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Project ${projectId}: ${msg}`);
      }
    }

    const summary = await aiClient.generateRunSummary({
      customersProcessed,
      recipesFetched,
      recipesChanged,
      recipesDocumented: projectsDocumented,
      errors,
    });

    runTracker.finishRun(runId, {
      customersProcessed,
      recipesFetched,
      recipesChanged,
      recipesDocumented: projectsDocumented,
      errors: errors.length ? errors.join("; ") : undefined,
      summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    runTracker.finishRun(runId, {
      customersProcessed,
      recipesFetched,
      recipesChanged,
      recipesDocumented: projectsDocumented,
      errors: errors.join("; "),
    });
    throw err;
  } finally {
    storage.close();
  }
}

