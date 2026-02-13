import type {
  Customer,
  Project,
  Recipe,
  RecipeSnapshot,
  Documentation,
  SyncRun,
} from "./schema.js";

export interface Storage {
  init(): void;
  close(): void;

  upsertCustomer(customer: Customer): void;
  upsertProject(project: Project): void;
  upsertRecipe(recipe: Recipe): void;

  getRecipe(recipeId: number, managedUserId: string): Recipe | null;
  getProject(projectId: number, managedUserId: string): Project | null;
  getRecipesByCustomer(managedUserId: string): Recipe[];
  getAllRecipes(): Recipe[];

  getLatestSnapshot(recipeId: number): RecipeSnapshot | null;
  upsertSnapshot(snapshot: Omit<RecipeSnapshot, "id">): void;

  upsertDocumentation(doc: Omit<Documentation, "id">): void;
  getDocumentation(recipeId: number): Documentation | null;

  getLastSuccessfulRun(): SyncRun | null;
  createSyncRun(): number;
  finishSyncRun(
    runId: number,
    stats: {
      customersProcessed: number;
      recipesFetched: number;
      recipesChanged: number;
      recipesDocumented: number;
      errors?: string;
      summary?: string;
    }
  ): void;
}
