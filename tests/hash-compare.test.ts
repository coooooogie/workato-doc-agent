import { describe, it, expect } from "vitest";
import { computeRecipeHash, getChangedRecipes } from "../src/rules/hash-compare.js";
import type { WorkatoRecipe } from "../src/api/workato-client.js";

function makeRecipe(overrides: Partial<WorkatoRecipe> = {}): WorkatoRecipe {
  return {
    id: 1,
    user_id: 1,
    name: "Test Recipe",
    description: "A test",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    running: false,
    code: '{"block":[]}',
    ...overrides,
  };
}

describe("computeRecipeHash", () => {
  it("returns consistent hash for same recipe", () => {
    const recipe = makeRecipe();
    expect(computeRecipeHash(recipe)).toBe(computeRecipeHash(recipe));
  });

  it("returns different hash when code changes", () => {
    const a = makeRecipe({ code: '{"block":[]}' });
    const b = makeRecipe({ code: '{"block":[1]}' });
    expect(computeRecipeHash(a)).not.toBe(computeRecipeHash(b));
  });

  it("returns different hash when name changes", () => {
    const a = makeRecipe({ name: "A" });
    const b = makeRecipe({ name: "B" });
    expect(computeRecipeHash(a)).not.toBe(computeRecipeHash(b));
  });
});

describe("getChangedRecipes", () => {
  it("marks new recipes as changed", () => {
    const recipes = [{ recipe: makeRecipe({ id: 99 }), managedUserId: "1" }];
    const changed = getChangedRecipes(recipes, () => null);
    expect(changed).toHaveLength(1);
    expect(changed[0].isNew).toBe(true);
  });

  it("marks hash-changed recipes as changed", () => {
    const recipe = makeRecipe({ id: 1 });
    const recipes = [{ recipe, managedUserId: "1" }];
    const oldHash = "different-hash";
    const changed = getChangedRecipes(recipes, (id) =>
      id === 1 ? oldHash : null
    );
    expect(changed).toHaveLength(1);
    expect(changed[0].isNew).toBe(false);
  });

  it("skips unchanged recipes", () => {
    const recipe = makeRecipe({ id: 1 });
    const hash = computeRecipeHash(recipe);
    const recipes = [{ recipe, managedUserId: "1" }];
    const changed = getChangedRecipes(recipes, (id) =>
      id === 1 ? hash : null
    );
    expect(changed).toHaveLength(0);
  });
});
