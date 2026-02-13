import { createHash } from "crypto";
import type { WorkatoRecipe } from "../api/workato-client.js";

export function computeRecipeHash(recipe: WorkatoRecipe): string {
  const payload = JSON.stringify(
    {
      code: recipe.code,
      name: recipe.name,
      description: recipe.description ?? "",
      config: recipe.config ?? [],
    },
    Object.keys({ code: 1, name: 1, description: 1, config: 1 }).sort()
  );
  return createHash("sha256").update(payload).digest("hex");
}

export interface ChangedRecipe {
  recipeId: number;
  managedUserId: string;
  isNew: boolean;
}

export function getChangedRecipes(
  currentRecipes: Array<{ recipe: WorkatoRecipe; managedUserId: string }>,
  getLatestHash: (recipeId: number) => string | null
): ChangedRecipe[] {
  const changed: ChangedRecipe[] = [];

  for (const { recipe, managedUserId } of currentRecipes) {
    const currentHash = computeRecipeHash(recipe);
    const previousHash = getLatestHash(recipe.id);
    if (previousHash === null) {
      changed.push({ recipeId: recipe.id, managedUserId, isNew: true });
    } else if (previousHash !== currentHash) {
      changed.push({ recipeId: recipe.id, managedUserId, isNew: false });
    }
  }

  return changed;
}
