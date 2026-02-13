import type { WorkatoRecipe } from "../api/workato-client.js";
import type { AIClient, SemanticChangeResult } from "./ai-client.js";

export async function analyzeSemanticChange(
  client: AIClient,
  oldRecipe: WorkatoRecipe,
  newRecipe: WorkatoRecipe
): Promise<SemanticChangeResult> {
  return client.analyzeSemanticChange(oldRecipe, newRecipe);
}
