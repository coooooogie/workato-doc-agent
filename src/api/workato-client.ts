import axios, { AxiosInstance, AxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";

export interface WorkatoCustomer {
  id: number;
  external_id?: string;
  name: string;
  team_name?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkatoProject {
  id: number;
  folder_id: number;
  name: string;
  description?: string;
}

export interface WorkatoRecipe {
  id: number;
  user_id: number;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  trigger_application?: string;
  action_applications?: string[];
  applications?: string[];
  project_id?: number;
  folder_id?: number;
  parameters_schema?: unknown[];
  parameters?: Record<string, unknown>;
  webhook_url?: string | null;
  running: boolean;
  job_succeeded_count?: number;
  job_failed_count?: number;
  lifetime_task_count?: number;
  last_run_at?: string | null;
  stopped_at?: string | null;
  version_no?: number;
  stop_cause?: string | null;
  config?: Array<{ name: string; provider: string; account_id?: number }>;
  trigger_closure?: unknown;
  code: string;
  author_name?: string;
  version_author_name?: string;
  version_author_email?: string;
  version_comment?: string | null;
  tags?: string[];
}

export interface WorkatoLookupTable {
  id: number;
  name: string;
  schema: string;
  created_at: string;
  updated_at: string;
  project_id?: number;
}

export interface WorkatoLookupTableRow {
  id: number;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  result: T[];
  count: number;
  page: number;
  per_page: number;
}

const DATACENTER_URLS: Record<string, string> = {
  us: "https://www.workato.com/api",
  eu: "https://app.eu.workato.com/api",
  jp: "https://app.jp.workato.com/api",
  sg: "https://app.sg.workato.com/api",
  au: "https://app.au.workato.com/api",
  il: "https://app.il.workato.com/api",
};

export interface WorkatoClientConfig {
  apiToken: string;
  baseUrl?: string;
  datacenter?: string;
}

export class WorkatoClient {
  private readonly client: AxiosInstance;

  constructor(config: WorkatoClientConfig) {
    if (!config.apiToken) {
      throw new Error(
        "WORKATO_API_TOKEN is required. Set it in your .env file or environment."
      );
    }

    const baseURL =
      config.baseUrl ??
      (config.datacenter
        ? DATACENTER_URLS[config.datacenter.toLowerCase()] ?? DATACENTER_URLS.us
        : DATACENTER_URLS.us);

    this.client = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      timeout: 40000,
    });

    this.client.interceptors.request.use((req) => {
      req.headers["x-correlation-id"] =
        (req.headers["x-correlation-id"] as string) ?? uuidv4();
      return req;
    });
  }

  private formatManagedUserId(managedUserId: string | number): string {
    const raw =
      typeof managedUserId === "number"
        ? String(managedUserId)
        : managedUserId;
    return encodeURIComponent(raw);
  }

  async listCustomers(params?: {
    page?: number;
    per_page?: number;
  }): Promise<PaginatedResponse<WorkatoCustomer>> {
    const response = await this.request<PaginatedResponse<WorkatoCustomer>>(
      "GET",
      "/managed_users",
      { params }
    );
    return response;
  }

  async listAllCustomers(): Promise<WorkatoCustomer[]> {
    const all: WorkatoCustomer[] = [];
    let page = 1;
    const perPage = 100;
    const maxPages = 200;

    while (page <= maxPages) {
      const { result, count } = await this.listCustomers({ page, per_page: perPage });
      if (result.length === 0) break;
      all.push(...result);
      if (all.length >= count) break;
      page++;
    }
    return all;
  }

  async listProjects(
    managedUserId: string | number,
    params?: {
      page?: number;
      per_page?: number;
      updated_after?: string;
    }
  ): Promise<PaginatedResponse<WorkatoProject>> {
    const id = this.formatManagedUserId(managedUserId);
    const response = await this.request<PaginatedResponse<WorkatoProject>>(
      "GET",
      `/managed_users/${id}/projects`,
      { params }
    );
    return response;
  }

  async listAllProjects(
    managedUserId: string | number,
    updatedAfter?: string
  ): Promise<WorkatoProject[]> {
    const all: WorkatoProject[] = [];
    let page = 1;
    const perPage = 100;
    const maxPages = 200;

    while (page <= maxPages) {
      const { result, count } = await this.listProjects(managedUserId, {
        page,
        per_page: perPage,
        updated_after: updatedAfter,
      });
      if (result.length === 0) break;
      all.push(...result);
      if (all.length >= count) break;
      page++;
    }
    return all;
  }

  async listRecipes(
    managedUserId: string | number,
    params?: {
      page?: number;
      per_page?: number;
      folder_id?: string;
      with_subfolders?: boolean;
      updated_after?: string;
    }
  ): Promise<PaginatedResponse<WorkatoRecipe>> {
    const id = this.formatManagedUserId(managedUserId);
    const response = await this.request<PaginatedResponse<WorkatoRecipe>>(
      "GET",
      `/managed_users/${id}/recipes`,
      { params }
    );
    return response;
  }

  async listAllRecipes(
    managedUserId: string | number,
    options?: {
      updatedAfter?: string;
      folderId?: string;
      withSubfolders?: boolean;
    }
  ): Promise<WorkatoRecipe[]> {
    const all: WorkatoRecipe[] = [];
    let page = 1;
    const perPage = 100;
    const maxPages = 500;

    while (page <= maxPages) {
      const { result, count } = await this.listRecipes(managedUserId, {
        page,
        per_page: perPage,
        updated_after: options?.updatedAfter,
        folder_id: options?.folderId,
        with_subfolders: options?.withSubfolders,
      });
      if (result.length === 0) break;
      all.push(...result);
      if (all.length >= count) break;
      page++;
    }
    return all;
  }

  async getRecipe(
    managedUserId: string | number,
    recipeId: number
  ): Promise<WorkatoRecipe> {
    const id = this.formatManagedUserId(managedUserId);
    const response = await this.request<{ result: WorkatoRecipe[] }>(
      "GET",
      `/managed_users/${id}/recipes/${recipeId}`
    );
    const recipe = response.result?.[0];
    if (!recipe) {
      throw new Error(`Recipe ${recipeId} not found`);
    }
    return recipe;
  }

  async listLookupTables(
    managedUserId: string | number,
    params?: { page?: number; per_page?: number }
  ): Promise<{ result: WorkatoLookupTable[] }> {
    const id = this.formatManagedUserId(managedUserId);
    return this.request<{ result: WorkatoLookupTable[] }>(
      "GET",
      `/managed_users/${id}/lookup_tables`,
      { params }
    );
  }

  async listLookupTableRows(
    managedUserId: string | number,
    lookupTableId: number,
    params?: { page?: number; per_page?: number }
  ): Promise<{ result: WorkatoLookupTableRow[] }> {
    const id = this.formatManagedUserId(managedUserId);
    return this.request<{ result: WorkatoLookupTableRow[] }>(
      "GET",
      `/managed_users/${id}/lookup_tables/${lookupTableId}/rows`,
      { params }
    );
  }

  private async request<T>(
    method: string,
    url: string,
    options?: { params?: Record<string, unknown> }
  ): Promise<T> {
    const maxRetries = 3;
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.request<T>({
          method,
          url,
          params: options?.params,
        });
        return response.data;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (!axios.isAxiosError(err)) throw lastErr;

        const axiosErr = err as AxiosError<{
          errors?: Array<{ code: number; title: string }>;
        }>;
        const status = axiosErr.response?.status;
        const isNetworkError = !axiosErr.response; // ECONNRESET, ETIMEDOUT, DNS, etc.
        const isRetryable =
          isNetworkError ||
          (status != null && status >= 500) ||
          status === 429;

        if (!isRetryable || attempt >= maxRetries) {
          const errors = axiosErr.response?.data?.errors ?? [];
          const message =
            errors.map((e) => e.title).join("; ") || axiosErr.message;
          const wrapped = new Error(
            `Workato API error (${status ?? "network"}): ${message}`
          );
          wrapped.cause = err;
          throw wrapped;
        }

        // Respect Retry-After header on 429
        let delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        if (status === 429) {
          const retryAfter = axiosErr.response?.headers?.["retry-after"];
          if (retryAfter) {
            const parsed = Number(retryAfter);
            if (!Number.isNaN(parsed) && parsed > 0) {
              delay = Math.min(parsed * 1000, 60000);
            }
          }
        }

        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr ?? new Error("Request failed");
  }
}
