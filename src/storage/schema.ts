export interface Customer {
  id: number;
  managed_user_id: string;
  external_id?: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  folder_id: number;
  managed_user_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Recipe {
  id: number;
  managed_user_id: string;
  project_id?: number | null;
  folder_id?: number | null;
  name: string;
  description?: string | null;
  raw_json: string;
  created_at: string;
  updated_at: string;
}

export interface RecipeSnapshot {
  id: number;
  recipe_id: number;
  managed_user_id: string;
  content_hash: string;
  raw_json: string;
  created_at: string;
}

export interface Documentation {
  id: number;
  recipe_id: number;
  managed_user_id: string;
  content_md: string;
  content_html: string;
  quality_score?: number | null;
  generated_at: string;
}

export interface SyncRun {
  id: number;
  started_at: string;
  finished_at?: string | null;
  customers_processed: number;
  recipes_fetched: number;
  recipes_changed: number;
  recipes_documented: number;
  errors?: string | null;
  summary?: string | null;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  managed_user_id TEXT NOT NULL,
  external_id TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  folder_id INTEGER NOT NULL,
  managed_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  managed_user_id TEXT NOT NULL,
  project_id INTEGER,
  folder_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recipes_managed_user ON recipes(managed_user_id);

CREATE TABLE IF NOT EXISTS recipe_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  managed_user_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(recipe_id),
  FOREIGN KEY (recipe_id) REFERENCES recipes(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_recipe ON recipe_snapshots(recipe_id);

CREATE TABLE IF NOT EXISTS documentation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  managed_user_id TEXT NOT NULL,
  content_md TEXT NOT NULL,
  content_html TEXT NOT NULL,
  quality_score REAL,
  generated_at TEXT NOT NULL,
  UNIQUE(recipe_id),
  FOREIGN KEY (recipe_id) REFERENCES recipes(id)
);

CREATE INDEX IF NOT EXISTS idx_docs_recipe ON documentation(recipe_id);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  customers_processed INTEGER NOT NULL DEFAULT 0,
  recipes_fetched INTEGER NOT NULL DEFAULT 0,
  recipes_changed INTEGER NOT NULL DEFAULT 0,
  recipes_documented INTEGER NOT NULL DEFAULT 0,
  errors TEXT,
  summary TEXT
);
`;
