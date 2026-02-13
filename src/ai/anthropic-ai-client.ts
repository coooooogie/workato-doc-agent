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

// ---------------------------------------------------------------------------
// System & user prompts for non-technical data-mapping documentation
// ---------------------------------------------------------------------------

const DOC_GEN_SYSTEM = `You are a technical documentation specialist who excels at translating complex integration workflows into clear, concise documentation for non-technical business users. Your goal is to make technical concepts accessible without oversimplifying or losing important details.`;

const STYLE_GUIDELINES = `
### Style Guidelines:

- **Avoid:** Technical field names like \`dates.terminated\` or API endpoints
- **Use:** Friendly names like "Termination Date" or "the HR system"
- **Avoid:** Code blocks, formulas, or pseudo-code
- **Use:** Plain language descriptions with examples
- **Avoid:** Long paragraphs
- **Use:** Short sentences, bullet points, and tables
- **Avoid:** Passive voice and technical hedge words
- **Use:** Active voice and direct statements`;

const REQUIRED_SECTIONS = `
### Required Sections:

1. **Overview** (2-3 sentences)
   - What does this integration do?
   - What systems are connected?

2. **Field Mapping Table**
   - Simple table showing: Target Field | Source Field | Notes
   - Use friendly field names, not technical field paths
   - Include brief, helpful notes in plain language

3. **Data Transformations** (if applicable)
   - How is data reformatted or combined?
   - Use examples like "Smith, Johnny" not pseudocode
   - Explain the logic in everyday language

4. **Sync Rules & Conditions**
   - When does data sync vs. not sync?
   - Use checkmark and X emojis for visual clarity
   - Focus on business logic, not technical conditions

5. **Common Scenarios**
   - What happens when X occurs?
   - Write as "Scenario 1: [Description]" followed by "Action: [What the system does]"
   - Cover 3-5 most common cases

6. **Special Rules & Exceptions**
   - Any important business rules to know
   - Edge cases that affect users
   - Keep it brief and relevant

7. **When It Runs**
   - Trigger description in plain language
   - Frequency or timing information

8. **Important Notes**
   - Key things users should know
   - Limitations or one-way sync warnings
   - 3-5 bullet points maximum`;

const DOC_GEN_USER = (recipe: WorkatoRecipe) => `
I need you to create a data mapping document for an integration workflow. The document should be:

1. **Concise and readable** - avoid technical jargon, use plain language
2. **Business-focused** - explain "what" and "why" rather than "how"
3. **Well-organized** - use clear sections with tables and bullet points
4. **Practical** - include real-world examples and scenarios

Please analyze the following integration configuration and create a data mapping guide.

${REQUIRED_SECTIONS}

${STYLE_GUIDELINES}

### Integration Configuration to Analyze:

Recipe name: ${sanitizeForPrompt(recipe.name)}
Description: ${sanitizeForPrompt(recipe.description ?? "(none)")}
Trigger application: ${recipe.trigger_application ?? "unknown"}
Action applications: ${(recipe.action_applications ?? []).join(", ")}
Applications used: ${(recipe.applications ?? []).join(", ")}

Recipe code (JSON structure of trigger and actions):
${typeof recipe.code === "string" ? recipe.code : JSON.stringify(recipe.code)}

Connections (config):
${JSON.stringify(recipe.config ?? [], null, 2)}

Please generate the documentation following this structure and style.
Output valid JSON with a single "markdown" key: {"markdown": "..."}
`;

const PROJECT_DOC_GEN_SYSTEM = DOC_GEN_SYSTEM;

const PROJECT_DOC_GEN_USER = (
  projectName: string,
  projectDescription: string | undefined,
  recipes: WorkatoRecipe[]
) => `
I need you to create a data mapping document for an integration project that contains multiple connected workflows. The document should be:

1. **Concise and readable** - avoid technical jargon, use plain language
2. **Business-focused** - explain "what" and "why" rather than "how"
3. **Well-organized** - use clear sections with tables and bullet points
4. **Practical** - include real-world examples and scenarios

Please analyze the following integration project and create a comprehensive data mapping guide. Include all required sections for the integration as a whole, then for each recipe/workflow within the project.

${REQUIRED_SECTIONS}

${STYLE_GUIDELINES}

### Integration Project to Analyze:

Integration/Project: ${sanitizeForPrompt(projectName)}
Description: ${sanitizeForPrompt(projectDescription ?? "(none)")}

Recipes in this integration (${recipes.length} total):
${recipes
  .map(
    (r, i) => `
--- Workflow ${i + 1}: ${sanitizeForPrompt(r.name)} ---
Description: ${sanitizeForPrompt(r.description ?? "(none)")}
Trigger: ${r.trigger_application ?? "unknown"}
Actions: ${(r.action_applications ?? []).join(", ")}
Configuration (JSON):
${typeof r.code === "string" ? r.code : JSON.stringify(r.code)}
Connections: ${JSON.stringify(r.config ?? [])}
`
  )
  .join("\n")}

Structure the document:
1. Start with an overall integration overview covering all workflows
2. Provide one combined field mapping table if fields are shared, or per-workflow tables if distinct
3. Then cover each workflow with its own Common Scenarios and Sync Rules sections
4. End with a unified Important Notes section

Please generate the documentation following this structure and style.
Output valid JSON with a single "markdown" key: {"markdown": "..."}
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
  const docModel = config.docModel ?? "claude-3-5-haiku-20241022";
  const qualityModel = config.qualityModel ?? "claude-3-5-sonnet-20241022";

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

    async generateDocumentation(recipe): Promise<DocumentationResult> {
      return withRetry(async () => {
        const response = await client.messages.create({
          model: docModel,
          max_tokens: 8192,
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
      recipes
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
                recipes
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
