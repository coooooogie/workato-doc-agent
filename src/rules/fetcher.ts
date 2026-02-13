import type {
  WorkatoClient,
  WorkatoRecipe,
  WorkatoCustomer,
} from "../api/workato-client.js";
import type { Storage } from "../storage/storage.js";
import type { Recipe } from "../storage/schema.js";

export interface FetchResult {
  customersProcessed: number;
  projectsFetched: number;
  recipesFetched: number;
  recipes: Array<{ recipe: WorkatoRecipe; managedUserId: string }>;
}

export async function fetchAndStoreRecipes(
  client: WorkatoClient,
  storage: Storage,
  options: {
    customerIds?: string[];
    updatedAfter?: string;
  } = {}
): Promise<FetchResult> {
  const customerIds = options.customerIds;
  let customers: WorkatoCustomer[];

  if (customerIds?.length) {
    const all = await client.listAllCustomers();
    customers = all.filter(
      (c) =>
        customerIds.includes(String(c.id)) ||
        (c.external_id && customerIds.includes(c.external_id))
    );
  } else {
    customers = await client.listAllCustomers();
  }

  const recipes: Array<{ recipe: WorkatoRecipe; managedUserId: string }> = [];
  let totalRecipes = 0;
  let totalProjects = 0;

  for (const customer of customers) {
    const managedUserId = String(customer.id);
    storage.upsertCustomer({
      id: customer.id,
      managed_user_id: managedUserId,
      external_id: customer.external_id ?? null,
      name: customer.name,
      created_at: customer.created_at,
      updated_at: customer.updated_at,
    });

    const projects = await client.listAllProjects(customer.id);
    const now = new Date().toISOString();
    for (const p of projects) {
      storage.upsertProject({
        id: p.id,
        folder_id: p.folder_id,
        managed_user_id: managedUserId,
        name: p.name,
        description: p.description ?? null,
        created_at: now,
        updated_at: now,
      });
      totalProjects++;
    }

    const seenRecipeIds = new Set<number>();
    for (const p of projects) {
      const projectRecipes = await client.listAllRecipes(customer.id, {
        updatedAfter: options.updatedAfter,
        folderId: String(p.folder_id),
        withSubfolders: false,
      });
      for (const r of projectRecipes) {
        if (!r.name.startsWith("[active]")) continue;
        if (seenRecipeIds.has(r.id)) continue;
        seenRecipeIds.add(r.id);

        const recipeRecord: Recipe = {
          id: r.id,
          managed_user_id: managedUserId,
          project_id: r.project_id ?? p.id,
          folder_id: r.folder_id ?? null,
          name: r.name,
          description: r.description ?? null,
          raw_json: JSON.stringify(r),
          created_at: r.created_at,
          updated_at: r.updated_at,
        };
        storage.upsertRecipe(recipeRecord);

        recipes.push({ recipe: r, managedUserId });
        totalRecipes++;
      }
    }
  }

  return {
    customersProcessed: customers.length,
    projectsFetched: totalProjects,
    recipesFetched: totalRecipes,
    recipes,
  };
}
