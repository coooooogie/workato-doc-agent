import Anthropic from "@anthropic-ai/sdk";
import { marked } from "marked";
import type { WorkatoRecipe } from "../api/workato-client.js";
import type {
  AIClient,
  DocumentationResult,
  LookupTableContext,
  QualityResult,
  RunSummaryInput,
  SemanticChangeResult,
} from "./ai-client.js";

// ---------------------------------------------------------------------------
// Static instruction blocks – live in the system prompt so they benefit from
// Anthropic prompt caching across calls.  Every detail is preserved; the
// Avoid/Use pairs are merged into single lines and the per-section bullets
// are condensed into one-liners without removing any guidance.
// ---------------------------------------------------------------------------

const REQUIRED_SECTIONS = `
Required sections:
1. **Overview** (2-3 sentences): What the integration does and which systems are connected.
2. **Field Mapping Table** (Target Field | Source Field | Notes): Use friendly field names, not technical paths. Include brief plain-language notes.
3. **Data Transformations** (if applicable): How data is reformatted or combined — use examples like "Smith, Johnny", not pseudocode.
4. **Sync Rules & Conditions**: When data syncs vs. not. Use ✓/✗ emojis. Focus on business logic, not technical conditions.
5. **Common Scenarios** (3-5): "Scenario: [Description]" → "Action: [What the system does]".
6. **Special Rules & Exceptions**: Important business rules and edge cases — keep brief.
7. **When It Runs**: Trigger description and frequency in plain language.
8. **Important Notes** (3-5 bullets): Key things users should know, limitations, one-way sync warnings.`;

const STYLE_GUIDELINES = `
Style guidelines:
- Avoid technical field names (e.g. \`dates.terminated\`); use friendly names ("Termination Date", "the HR system").
- Avoid code blocks, formulas, or pseudo-code; use plain language with examples.
- Use short sentences, bullet points, and tables — no long paragraphs.
- Use active voice and direct statements — no passive voice or hedge words.`;

const DOC_GEN_SYSTEM = `You are a technical documentation specialist who translates complex integration workflows into clear, concise documentation for non-technical business users.
${REQUIRED_SECTIONS}
${STYLE_GUIDELINES}`;

const PROJECT_DOC_GEN_SYSTEM = DOC_GEN_SYSTEM;

// ---------------------------------------------------------------------------
// Helpers – strip noise from recipe JSON, deduplicate apps, format lookups
// ---------------------------------------------------------------------------

/**
 * Workato recipe-code keys that are UI / framework metadata and carry no
 * information relevant to documentation (field mappings, logic, providers).
 */
const RECIPE_CODE_STRIP_KEYS = new Set([
  "uuid",                           // internal step identifier
  "number",                         // step sequence (implicit from order)
  "as",                             // internal variable binding name
  "description",                    // auto-generated HTML step label – redundant with provider+name+input
  "visible_config_fields",          // UI visibility metadata
  "visible_config_fields_for_action",
  "toggleCfg",                      // UI toggle state
]);

/**
 * Strip noise fields from Workato recipe code and return compact JSON.
 * Preserves all documentation-relevant data: providers, action names, inputs,
 * outputs, conditionals (if/elsif/else), dynamic pick-list selections, and
 * nested blocks.
 */
function compactRecipeCode(code: string | object | undefined): string {
  if (!code) return "{}";

  let parsed: unknown;
  try {
    parsed = typeof code === "string" ? JSON.parse(code) : code;
  } catch {
    return typeof code === "string" ? code : JSON.stringify(code);
  }

  function strip(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(strip);
    if (obj !== null && typeof obj === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (RECIPE_CODE_STRIP_KEYS.has(k)) continue;
        if (v === null || v === undefined) continue;
        out[k] = strip(v);
      }
      return out;
    }
    return obj;
  }

  return JSON.stringify(strip(parsed));
}

/**
 * Merge trigger_application, action_applications and applications into a
 * single de-duplicated string with the trigger marked.
 *
 *   "workday (trigger), salesforce, slack"
 */
function formatApps(recipe: WorkatoRecipe): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  if (recipe.trigger_application) {
    parts.push(`${recipe.trigger_application} (trigger)`);
    seen.add(recipe.trigger_application.toLowerCase());
  }

  for (const a of recipe.action_applications ?? []) {
    const key = a.toLowerCase();
    if (!seen.has(key)) {
      parts.push(a);
      seen.add(key);
    }
  }

  for (const a of recipe.applications ?? []) {
    const key = a.toLowerCase();
    if (!seen.has(key)) {
      parts.push(a);
      seen.add(key);
    }
  }

  return parts.join(", ") || "unknown";
}

/**
 * Format lookup-table context for inclusion in an LLM prompt.
 * Uses compact JSON (no indentation) for sample rows.
 * Returns an empty string when no tables are provided.
 */
function formatLookupTablesForPrompt(
  tables: LookupTableContext[] | undefined
): string {
  if (!tables || tables.length === 0) return "";

  const sections = tables.map((t) => {
    const lines = [`"${sanitizeForPrompt(t.name)}" (ID:${t.id})`];
    if (t.columns.length > 0) lines.push(`Columns: ${t.columns.join(", ")}`);
    if (t.sampleRows.length > 0) {
      lines.push(`Sample rows: ${JSON.stringify(t.sampleRows)}`);
    }
    return lines.join("\n");
  });

  return `\nLookup tables:\n${sections.join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// User prompts – kept lean; static instructions live in the system prompt.
// ---------------------------------------------------------------------------

const DOC_GEN_USER = (
  recipe: WorkatoRecipe,
  lookupTables?: LookupTableContext[]
) => {
  const lines: string[] = [
    "Create a data mapping document for this integration workflow. Be concise, business-focused, well-organized (tables/bullets), and include practical examples.",
    "",
    `Name: ${sanitizeForPrompt(recipe.name)}`,
  ];

  if (recipe.description) {
    lines.push(`Description: ${sanitizeForPrompt(recipe.description)}`);
  }

  lines.push(`Apps: ${formatApps(recipe)}`);
  lines.push("", `Recipe code:`, compactRecipeCode(recipe.code));

  if (recipe.config?.length) {
    lines.push("", `Connections: ${JSON.stringify(recipe.config)}`);
  }

  const lut = formatLookupTablesForPrompt(lookupTables);
  if (lut) lines.push(lut);

  lines.push("", 'Output valid JSON: {"markdown": "..."}');
  return lines.join("\n");
};

const PROJECT_DOC_GEN_USER = (
  projectName: string,
  projectDescription: string | undefined,
  recipes: WorkatoRecipe[],
  lookupTables?: LookupTableContext[]
) => {
  const lines: string[] = [
    `Create a data mapping document for this integration project (${recipes.length} workflows). Be concise, business-focused, well-organized (tables/bullets), and include practical examples.`,
    "",
    `Project: ${sanitizeForPrompt(projectName)}`,
  ];

  if (projectDescription) {
    lines.push(`Description: ${sanitizeForPrompt(projectDescription)}`);
  }

  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    lines.push("", `--- Workflow ${i + 1}: ${sanitizeForPrompt(r.name)} ---`);
    if (r.description) {
      lines.push(`Description: ${sanitizeForPrompt(r.description)}`);
    }
    lines.push(`Apps: ${formatApps(r)}`);
    lines.push(`Code: ${compactRecipeCode(r.code)}`);
    if (r.config?.length) {
      lines.push(`Connections: ${JSON.stringify(r.config)}`);
    }
  }

  const lut = formatLookupTablesForPrompt(lookupTables);
  if (lut) lines.push(lut);

  lines.push(
    "",
    "Structure: overview of all workflows → combined or per-workflow field mappings → per-workflow scenarios and sync rules → unified important notes.",
    "",
    'Output valid JSON: {"markdown": "..."}'
  );

  return lines.join("\n");
};

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

/**
 * Sanitize user-controlled text before embedding in LLM prompts.
 * Prevents injection by escaping control sequences that could mimic prompt structure.
 */
function sanitizeForPrompt(s: string): string {
  if (!s) return s;
  // Replace sequences that look like JSON instruction overrides
  return s
    .replace(/Output only valid JSON/gi, "[filtered]")
    .replace(/\{"\s*markdown\s*"\s*:/gi, "[filtered]");
}

function getTextFromResponse(content: Anthropic.Message["content"]): string {
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

/**
 * Strip markdown code fences and extract JSON from LLM output.
 */
function extractJson(raw: string): string {
  let text = raw.trim();
  // Strip ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  return text;
}

/**
 * Safely parse JSON from LLM output with fence stripping and error context.
 */
function safeJsonParse<T>(raw: string, context: string): T {
  const cleaned = extractJson(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(
      `Failed to parse ${context} response as JSON. Raw output: ${cleaned.slice(0, 500)}`
    );
  }
}

/**
 * Retry wrapper for Anthropic API calls with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; context?: string } = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const isRetryable =
        lastErr.message.includes("429") ||
        lastErr.message.includes("500") ||
        lastErr.message.includes("529") ||
        lastErr.message.includes("overloaded") ||
        lastErr.message.includes("ECONNRESET") ||
        lastErr.message.includes("ETIMEDOUT") ||
        lastErr.message.includes("rate_limit");

      if (!isRetryable || attempt >= maxRetries) {
        throw lastErr;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt), 15000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr ?? new Error(`${opts.context ?? "API call"} failed`);
}

export function createAnthropicClient(config: AnthropicClientConfig): AIClient {
  if (!config.apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required. Set it in your .env file or environment."
    );
  }

  const client = new Anthropic({ apiKey: config.apiKey });
  const docModel = config.docModel ?? "claude-haiku-4-5-20251001";
  const qualityModel = config.qualityModel ?? "claude-sonnet-4-5-20250929";

  return {
    async analyzeSemanticChange(oldRecipe, newRecipe) {
      return withRetry(async () => {
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
        const parsed = safeJsonParse<SemanticChangeResult>(
          text,
          "semantic analysis"
        );
        return {
          hasMeaningfulChange: parsed.hasMeaningfulChange ?? true,
          changeSummary: parsed.changeSummary ?? "Change detected",
          changeType: parsed.changeType ?? undefined,
        };
      }, { context: "analyzeSemanticChange" });
    },

    async generateDocumentation(recipe, lookupTables): Promise<DocumentationResult> {
      return withRetry(async () => {
        const response = await client.messages.create({
          model: docModel,
          max_tokens: 8192,
          system: DOC_GEN_SYSTEM,
          messages: [
            {
              role: "user",
              content: DOC_GEN_USER(recipe, lookupTables),
            },
          ],
          temperature: 0.3,
        });
        const text = getTextFromResponse(response.content);
        if (!text) throw new Error("Empty doc gen response");
        const parsed = safeJsonParse<{ markdown?: string }>(
          text,
          "documentation"
        );
        if (!parsed.markdown || typeof parsed.markdown !== "string") {
          throw new Error(
            "LLM response missing 'markdown' key. Keys found: " +
              Object.keys(parsed).join(", ")
          );
        }
        const html = marked.parse(parsed.markdown, { async: false }) as string;
        return { markdown: parsed.markdown, html };
      }, { context: "generateDocumentation" });
    },

    async generateProjectDocumentation(
      projectName,
      projectDescription,
      recipes,
      lookupTables
    ): Promise<DocumentationResult> {
      return withRetry(async () => {
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
                recipes,
                lookupTables
              ),
            },
          ],
          temperature: 0.3,
        });
        const text = getTextFromResponse(response.content);
        if (!text) throw new Error("Empty project doc gen response");
        const parsed = safeJsonParse<{ markdown?: string }>(
          text,
          "project documentation"
        );
        if (!parsed.markdown || typeof parsed.markdown !== "string") {
          throw new Error(
            "LLM response missing 'markdown' key. Keys found: " +
              Object.keys(parsed).join(", ")
          );
        }
        const html = marked.parse(parsed.markdown, { async: false }) as string;
        return { markdown: parsed.markdown, html };
      }, { context: "generateProjectDocumentation" });
    },

    async assessQuality(doc, recipe): Promise<QualityResult> {
      return withRetry(async () => {
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
        const parsed = safeJsonParse<QualityResult>(text, "quality assessment");
        return {
          score: parsed.score ?? 3,
          issues: parsed.issues ?? [],
          suggestedImprovements: parsed.suggestedImprovements,
        };
      }, { context: "assessQuality" });
    },

    async generateRunSummary(input): Promise<string> {
      return withRetry(async () => {
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
        return text || "Sync completed.";
      }, { context: "generateRunSummary" });
    },
  };
}
