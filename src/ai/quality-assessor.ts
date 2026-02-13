import type { WorkatoRecipe } from "../api/workato-client.js";
import type { AIClient, DocumentationResult, QualityResult } from "./ai-client.js";

export async function assessQuality(
  client: AIClient,
  doc: DocumentationResult,
  recipe: WorkatoRecipe
): Promise<QualityResult> {
  return client.assessQuality(doc, recipe);
}
