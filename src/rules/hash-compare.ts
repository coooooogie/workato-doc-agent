import { createHash } from "crypto";
import type { WorkatoRecipe } from "../api/workato-client.js";

const HASH_VERSION = "v2";

export function computeRecipeHash(recipe: WorkatoRecipe): string {
  // Keys are in alphabetical order for deterministic serialization.
  // Do NOT use a JSON.stringify replacer array — it filters nested object keys too.
  const payload = JSON.stringify({
    code: recipe.code,
    config: recipe.config ?? [],
    description: recipe.description ?? "",
    name: recipe.name,
  });
  const hash = createHash("sha256").update(payload).digest("hex");
  return `${HASH_VERSION}:${hash}`;
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
