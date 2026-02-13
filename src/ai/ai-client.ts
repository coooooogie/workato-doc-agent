import type { WorkatoRecipe } from "../api/workato-client.js";

export interface SemanticChangeResult {
  hasMeaningfulChange: boolean;
  changeSummary: string;
  changeType?: "logic" | "config" | "metadata";
}

export interface DocumentationResult {
  markdown: string;
  html?: string;
}

export interface QualityResult {
  score: number;
  issues: string[];
  suggestedImprovements?: string[];
}

export interface RunSummaryInput {
  customersProcessed: number;
  recipesFetched: number;
  recipesChanged: number;
  recipesDocumented: number; // projects documented when using project-level docs
  errors: string[];
}

/** Schema and sample data for a lookup table referenced by recipe code. */
export interface LookupTableContext {
  id: number;
  name: string;
  columns: string[];
  sampleRows: Array<Record<string, unknown>>;
}

export interface AIClient {
  analyzeSemanticChange(
    oldRecipe: WorkatoRecipe,
    newRecipe: WorkatoRecipe
  ): Promise<SemanticChangeResult>;

  generateDocumentation(
    recipe: WorkatoRecipe,
    lookupTables?: LookupTableContext[]
  ): Promise<DocumentationResult>;

  generateProjectDocumentation(
    projectName: string,
    projectDescription: string | undefined,
    recipes: WorkatoRecipe[],
    lookupTables?: LookupTableContext[]
  ): Promise<DocumentationResult>;

  assessQuality(
    doc: DocumentationResult,
    recipe: WorkatoRecipe
  ): Promise<QualityResult>;

  generateRunSummary(input: RunSummaryInput): Promise<string>;
}
