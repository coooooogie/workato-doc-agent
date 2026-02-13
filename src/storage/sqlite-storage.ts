import Database, { Statement } from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";
import type {
  Customer,
  Project,
  Recipe,
  RecipeSnapshot,
  Documentation,
  SyncRun,
} from "./schema.js";
import type { Storage } from "./storage.js";

export interface SqliteStorageConfig {
  path?: string;
}

export function createSqliteStorage(config: SqliteStorageConfig = {}): Storage {
  const db = new Database(config.path ?? "workato-doc-agent.db");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  // Cache prepared statements for performance
  const stmts = {
    upsertCustomer: db.prepare(
      `INSERT INTO customers (id, managed_user_id, external_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         external_id = excluded.external_id,
         name = excluded.name,
         updated_at = excluded.updated_at`
    ),
    upsertProject: db.prepare(
      `INSERT INTO projects (id, folder_id, managed_user_id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         folder_id = excluded.folder_id,
         name = excluded.name,
         description = excluded.description,
         updated_at = excluded.updated_at`
    ),
    upsertRecipe: db.prepare(
      `INSERT INTO recipes (id, managed_user_id, project_id, folder_id, name, description, raw_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         folder_id = excluded.folder_id,
         name = excluded.name,
         description = excluded.description,
         raw_json = excluded.raw_json,
         updated_at = excluded.updated_at`
    ),
    getProject: db.prepare(
      `SELECT id, folder_id, managed_user_id, name, description, created_at, updated_at
       FROM projects WHERE id = ? AND managed_user_id = ?`
    ),
    getRecipe: db.prepare(
      `SELECT id, managed_user_id, project_id, folder_id, name, description, raw_json, created_at, updated_at
       FROM recipes WHERE id = ? AND managed_user_id = ?`
    ),
    getRecipesByCustomer: db.prepare(
      `SELECT id, managed_user_id, project_id, folder_id, name, description, raw_json, created_at, updated_at
       FROM recipes WHERE managed_user_id = ?`
    ),
    getAllRecipes: db.prepare(
      `SELECT id, managed_user_id, project_id, folder_id, name, description, raw_json, created_at, updated_at
       FROM recipes`
    ),
    getLatestSnapshot: db.prepare(
      `SELECT id, recipe_id, managed_user_id, content_hash, raw_json, created_at
       FROM recipe_snapshots WHERE recipe_id = ? ORDER BY created_at DESC LIMIT 1`
    ),
    upsertSnapshot: db.prepare(
      `INSERT INTO recipe_snapshots (recipe_id, managed_user_id, content_hash, raw_json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(recipe_id) DO UPDATE SET
         content_hash = excluded.content_hash,
         raw_json = excluded.raw_json,
         created_at = excluded.created_at`
    ),
    upsertDocumentation: db.prepare(
      `INSERT INTO documentation (recipe_id, managed_user_id, content_md, content_html, quality_score, generated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(recipe_id) DO UPDATE SET
         content_md = excluded.content_md,
         content_html = excluded.content_html,
         quality_score = excluded.quality_score,
         generated_at = excluded.generated_at`
    ),
    getDocumentation: db.prepare(
      `SELECT id, recipe_id, managed_user_id, content_md, content_html, quality_score, generated_at
       FROM documentation WHERE recipe_id = ?`
    ),
    getLastSuccessfulRun: db.prepare(
      `SELECT id, started_at, finished_at, customers_processed, recipes_fetched, recipes_changed, recipes_documented, errors, summary
       FROM sync_runs
       WHERE finished_at IS NOT NULL AND (errors IS NULL OR errors = '')
       ORDER BY finished_at DESC LIMIT 1`
    ),
    createSyncRun: db.prepare(
      `INSERT INTO sync_runs (started_at, customers_processed, recipes_fetched, recipes_changed, recipes_documented)
       VALUES (datetime('now'), 0, 0, 0, 0)`
    ),
    finishSyncRun: db.prepare(
      `UPDATE sync_runs SET
         finished_at = datetime('now'),
         customers_processed = ?,
         recipes_fetched = ?,
         recipes_changed = ?,
         recipes_documented = ?,
         errors = ?,
         summary = ?
       WHERE id = ?`
    ),
  };

  return {
    init() {
      db.exec(SCHEMA_SQL);
    },

    close() {
      db.close();
    },

    upsertCustomer(customer) {
      stmts.upsertCustomer.run(
        customer.id,
        String(customer.managed_user_id),
        customer.external_id ?? null,
        customer.name,
        customer.created_at,
        customer.updated_at
      );
    },

    upsertProject(project) {
      stmts.upsertProject.run(
        project.id,
        project.folder_id,
        project.managed_user_id,
        project.name,
        project.description ?? null,
        project.created_at,
        project.updated_at
      );
    },

    upsertRecipe(recipe) {
      stmts.upsertRecipe.run(
        recipe.id,
        recipe.managed_user_id,
        recipe.project_id ?? null,
        recipe.folder_id ?? null,
        recipe.name,
        recipe.description ?? null,
        recipe.raw_json,
        recipe.created_at,
        recipe.updated_at
      );
    },

    getProject(projectId, managedUserId) {
      const row = stmts.getProject.get(projectId, managedUserId) as
        | Project
        | undefined;
      return row ?? null;
    },

    getRecipe(recipeId, managedUserId) {
      const row = stmts.getRecipe.get(recipeId, managedUserId) as
        | Recipe
        | undefined;
      return row ?? null;
    },

    getRecipesByCustomer(managedUserId) {
      return stmts.getRecipesByCustomer.all(managedUserId) as Recipe[];
    },

    getAllRecipes() {
      return stmts.getAllRecipes.all() as Recipe[];
    },

    getLatestSnapshot(recipeId) {
      const row = stmts.getLatestSnapshot.get(recipeId) as
        | RecipeSnapshot
        | undefined;
      return row ?? null;
    },

    upsertSnapshot(snapshot) {
      stmts.upsertSnapshot.run(
        snapshot.recipe_id,
        snapshot.managed_user_id,
        snapshot.content_hash,
        snapshot.raw_json,
        snapshot.created_at
      );
    },

    upsertDocumentation(doc) {
      stmts.upsertDocumentation.run(
        doc.recipe_id,
        doc.managed_user_id,
        doc.content_md,
        doc.content_html,
        doc.quality_score ?? null,
        doc.generated_at
      );
    },

    getDocumentation(recipeId) {
      const row = stmts.getDocumentation.get(recipeId) as
        | Documentation
        | undefined;
      return row ?? null;
    },

    getLastSuccessfulRun() {
      const row = stmts.getLastSuccessfulRun.get() as SyncRun | undefined;
      return row ?? null;
    },

    createSyncRun() {
      const result = stmts.createSyncRun.run();
      return result.lastInsertRowid as number;
    },

    finishSyncRun(runId, stats) {
      stmts.finishSyncRun.run(
        stats.customersProcessed,
        stats.recipesFetched,
        stats.recipesChanged,
        stats.recipesDocumented,
        stats.errors ?? null,
        stats.summary ?? null,
        runId
      );
    },
  };
}
