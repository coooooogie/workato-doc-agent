import Anthropic from "@anthropic-ai/sdk";
import { marked } from "marked";
import type { WorkatoRecipe } from "../api/workato-client.js";
import type {
  AIClient,
  DocumentationResult,
  QualityResult,
  RunSummaryInput,
  SemanticChangeResult,
} from "./ai-client.js";

const DOC_GEN_SYSTEM = `You are a technical documentation writer for Workato recipes. Generate clear, professional documentation in Markdown format.`;

const DOC_GEN_USER = (recipe: WorkatoRecipe) => `
Document the following Workato recipe. Output valid JSON with a single "markdown" key containing the documentation.

Recipe name: ${recipe.name}
Description: ${recipe.description ?? "(none)"}
Trigger application: ${recipe.trigger_application ?? "unknown"}
Action applications: ${(recipe.action_applications ?? []).join(", ")}
Applications used: ${(recipe.applications ?? []).join(", ")}

Recipe code (JSON structure of trigger and actions):
${typeof recipe.code === "string" ? recipe.code : JSON.stringify(recipe.code)}

Connections (config):
${JSON.stringify(recipe.config ?? [], null, 2)}

Include in the documentation:
1. Overview - what the recipe does
2. Trigger - what starts the recipe and how
3. Actions - step-by-step what happens
4. Connections - which apps/systems are used
5. Data mapping - field mappings between steps (which output fields map to which input fields)
6. Logic and filtering - conditional logic, filters, loops, or branching in the recipe
7. Any lookup tables or data structures referenced (if apparent from the code)

Use clear headings (##, ###). Be concise but complete. Write in present tense.
Output only valid JSON: {"markdown": "..."}
`;

const PROJECT_DOC_GEN_SYSTEM = `You are a technical documentation writer for Workato integrations. Generate clear, professional documentation in Markdown format. An integration (project) contains multiple recipes that work together. Document the integration as a whole, with each recipe as a section.`;

const PROJECT_DOC_GEN_USER = (
  projectName: string,
  projectDescription: string | undefined,
  recipes: WorkatoRecipe[]
) => `
Document the following Workato integration (project) with all its recipes. Output valid JSON with a single "markdown" key containing the documentation.

Integration/Project: ${projectName}
Description: ${projectDescription ?? "(none)"}

Recipes in this integration (${recipes.length} total):
${recipes
  .map(
    (r, i) => `
--- Recipe ${i + 1}: ${r.name} ---
Description: ${r.description ?? "(none)"}
Trigger: ${r.trigger_application ?? "unknown"}
Actions: ${(r.action_applications ?? []).join(", ")}
Code (abbreviated): ${typeof r.code === "string" ? r.code.slice(0, 1500) : JSON.stringify(r.code).slice(0, 1500)}
Config: ${JSON.stringify(r.config ?? []).slice(0, 500)}
`
  )
  .join("\n")}

Structure the document:
1. Integration overview - what the integration does as a whole
2. For each recipe: section with ## Recipe Name, covering overview, trigger, actions, data mapping, logic/filtering, connections

Use clear headings (##, ###). Be concise but complete. Write in present tense.
Output only valid JSON: {"markdown": "..."}
`;

const SEMANTIC_SYSTEM = `You analyze changes between two versions of a Workato recipe. Determine if the change is semantically meaningful (affects behavior or documentation).`;

const SEMANTIC_USER = (oldRecipe: WorkatoRecipe, newRecipe: WorkatoRecipe) => `
Compare these two recipe versions. Output valid JSON:
{"hasMeaningfulChange": boolean, "changeSummary": string, "changeType": "logic" | "config" | "metadata" | null}

Old recipe: ${JSON.stringify({ name: oldRecipe.name, description: oldRecipe.description, code: oldRecipe.code?.slice(0, 2000) })}
New recipe: ${JSON.stringify({ name: newRecipe.name, description: newRecipe.description, code: newRecipe.code?.slice(0, 2000) })}
`;

const QUALITY_SYSTEM = `You assess documentation quality for Workato recipes. Score 1-5 (5=excellent).`;

const QUALITY_USER = (
  doc: DocumentationResult,
  recipe: WorkatoRecipe
) => `
Recipe: ${recipe.name}
Documentation:
${doc.markdown.slice(0, 3000)}

Output valid JSON: {"score": number, "issues": string[], "suggestedImprovements": string[]}
`;

export interface AnthropicClientConfig {
  apiKey: string;
  docModel?: string;
  qualityModel?: string;
}

function getTextFromResponse(content: Anthropic.Message["content"]): string {
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

export function createAnthropicClient(config: AnthropicClientConfig): AIClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const docModel = config.docModel ?? "claude-3-5-haiku-20241022";
  const qualityModel = config.qualityModel ?? "claude-3-5-sonnet-20241022";

  return {
    async analyzeSemanticChange(oldRecipe, newRecipe) {
      const response = await client.messages.create({
        model: docModel,
        max_tokens: 1024,
        system: SEMANTIC_SYSTEM,
        messages: [
          {
            role: "user",
            content: SEMANTIC_USER(oldRecipe, newRecipe),
          },
        ],
        temperature: 0.2,
      });
      const text = getTextFromResponse(response.content);
      if (!text) throw new Error("Empty semantic analysis response");
      const parsed = JSON.parse(text) as SemanticChangeResult;
      return {
        hasMeaningfulChange: parsed.hasMeaningfulChange ?? true,
        changeSummary: parsed.changeSummary ?? "Change detected",
        changeType: parsed.changeType ?? undefined,
      };
    },

    async generateDocumentation(recipe): Promise<DocumentationResult> {
      const response = await client.messages.create({
        model: docModel,
        max_tokens: 4096,
        system: DOC_GEN_SYSTEM,
        messages: [
          {
            role: "user",
            content: DOC_GEN_USER(recipe),
          },
        ],
        temperature: 0.3,
      });
      const text = getTextFromResponse(response.content);
      if (!text) throw new Error("Empty doc gen response");
      const parsed = JSON.parse(text) as { markdown?: string };
      const markdown = parsed.markdown ?? String(parsed);
      const html = marked.parse(markdown, { async: false }) as string;
      return { markdown, html };
    },

    async generateProjectDocumentation(
      projectName,
      projectDescription,
      recipes
    ): Promise<DocumentationResult> {
      const response = await client.messages.create({
        model: docModel,
        max_tokens: 8192,
        system: PROJECT_DOC_GEN_SYSTEM,
        messages: [
          {
            role: "user",
            content: PROJECT_DOC_GEN_USER(
              projectName,
              projectDescription,
              recipes
            ),
          },
        ],
        temperature: 0.3,
      });
      const text = getTextFromResponse(response.content);
      if (!text) throw new Error("Empty project doc gen response");
      const parsed = JSON.parse(text) as { markdown?: string };
      const markdown = parsed.markdown ?? String(parsed);
      const html = marked.parse(markdown, { async: false }) as string;
      return { markdown, html };
    },

    async assessQuality(doc, recipe): Promise<QualityResult> {
      const response = await client.messages.create({
        model: qualityModel,
        max_tokens: 1024,
        system: QUALITY_SYSTEM,
        messages: [
          {
            role: "user",
            content: QUALITY_USER(doc, recipe),
          },
        ],
        temperature: 0.2,
      });
      const text = getTextFromResponse(response.content);
      if (!text) throw new Error("Empty quality response");
      const parsed = JSON.parse(text) as QualityResult;
      return {
        score: parsed.score ?? 3,
        issues: parsed.issues ?? [],
        suggestedImprovements: parsed.suggestedImprovements,
      };
    },

    async generateRunSummary(input): Promise<string> {
      const response = await client.messages.create({
        model: docModel,
        max_tokens: 512,
        system:
          "Generate a brief, human-readable run summary for a Workato recipe documentation sync. 2-4 sentences.",
        messages: [
          {
            role: "user",
            content: `Sync stats: ${input.customersProcessed} customers, ${input.recipesFetched} recipes fetched, ${input.recipesChanged} changed, ${input.recipesDocumented} documented. Errors: ${input.errors.length}`,
          },
        ],
        temperature: 0.2,
      });
      const text = getTextFromResponse(response.content);
      return text ?? "Sync completed.";
    },
  };
}
