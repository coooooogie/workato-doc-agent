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

export interface AIClient {
  analyzeSemanticChange(
    oldRecipe: WorkatoRecipe,
    newRecipe: WorkatoRecipe
  ): Promise<SemanticChangeResult>;

  generateDocumentation(recipe: WorkatoRecipe): Promise<DocumentationResult>;

  generateProjectDocumentation(
    projectName: string,
    projectDescription: string | undefined,
    recipes: WorkatoRecipe[]
  ): Promise<DocumentationResult>;

  assessQuality(
    doc: DocumentationResult,
    recipe: WorkatoRecipe
  ): Promise<QualityResult>;

  generateRunSummary(input: RunSummaryInput): Promise<string>;
}
