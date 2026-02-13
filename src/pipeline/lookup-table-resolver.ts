import type {
  WorkatoClient,
  WorkatoLookupTable,
  WorkatoRecipe,
} from "../api/workato-client.js";
import type { LookupTableContext } from "../ai/ai-client.js";

/** Maximum number of sample rows to include per lookup table in the prompt. */
const MAX_SAMPLE_ROWS = 5;

/**
 * Parsed references to lookup tables found inside Workato recipe code.
 */
export interface LookupTableRefs {
  names: Set<string>;
  ids: Set<number>;
}

// ---------------------------------------------------------------------------
// Extraction – walk recipe code JSON to find lookup-table references
// ---------------------------------------------------------------------------

/**
 * Recursively extract lookup-table names and IDs referenced in a recipe's
 * `code` field.  Handles both parsed objects and raw JSON strings.
 */
export function extractLookupTableReferences(
  recipeCode: string | object | undefined
): LookupTableRefs {
  const names = new Set<string>();
  const ids = new Set<number>();

  if (!recipeCode) return { names, ids };

  function walk(obj: unknown): void {
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    if (obj !== null && typeof obj === "object") {
      const record = obj as Record<string, unknown>;

      // Workato recipe code uses various field names for lookup table refs
      for (const key of [
        "table_name",
        "lookup_table_name",
      ] as const) {
        if (typeof record[key] === "string" && record[key]) {
          names.add(record[key] as string);
        }
      }

      for (const key of [
        "table_id",
        "lookup_table_id",
      ] as const) {
        if (record[key] != null) {
          const id = Number(record[key]);
          if (!Number.isNaN(id) && id > 0) ids.add(id);
        }
      }

      // Also detect lookup_tables provider to confirm this recipe uses them
      // (helps avoid false positives from other fields named "table_name")
      for (const val of Object.values(record)) {
        walk(val);
      }
    }
  }

  try {
    const parsed =
      typeof recipeCode === "string" ? JSON.parse(recipeCode) : recipeCode;
    walk(parsed);
  } catch {
    // JSON parse failed – fall back to simple regex extraction
    const codeStr =
      typeof recipeCode === "string" ? recipeCode : JSON.stringify(recipeCode);

    // Match "table_name": "Some Name" or similar patterns
    const nameRe =
      /["'](?:table_name|lookup_table_name)["']\s*:\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(codeStr)) !== null) {
      names.add(m[1]);
    }

    // Match numeric IDs
    const idRe =
      /["'](?:table_id|lookup_table_id)["']\s*:\s*["']?(\d+)["']?/gi;
    while ((m = idRe.exec(codeStr)) !== null) {
      const id = Number(m[1]);
      if (!Number.isNaN(id) && id > 0) ids.add(id);
    }
  }

  return { names, ids };
}

/**
 * Collect all lookup-table references across multiple recipes.
 */
export function extractLookupTableReferencesFromRecipes(
  recipes: WorkatoRecipe[]
): LookupTableRefs {
  const combined: LookupTableRefs = { names: new Set(), ids: new Set() };
  for (const recipe of recipes) {
    const refs = extractLookupTableReferences(recipe.code);
    for (const n of refs.names) combined.names.add(n);
    for (const id of refs.ids) combined.ids.add(id);
  }
  return combined;
}

// ---------------------------------------------------------------------------
// Resolution – fetch lookup-table metadata & sample rows from Workato API
// ---------------------------------------------------------------------------

/**
 * Parse the `schema` field of a WorkatoLookupTable into column names.
 * The schema is typically a JSON-encoded array of strings, e.g. '["Col1","Col2"]'.
 */
function parseSchemaColumns(schema: string): string[] {
  if (!schema) return [];
  try {
    const parsed = JSON.parse(schema);
    if (Array.isArray(parsed)) {
      return parsed
        .map((c) => (typeof c === "string" ? c : String(c)))
        .filter(Boolean);
    }
  } catch {
    // Not JSON – treat as comma-separated or return as-is
    return schema
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Given a set of lookup-table references extracted from recipe code, fetch the
 * matching table metadata and sample rows from the Workato API.
 *
 * Returns `LookupTableContext[]` ready to be included in the AI prompt.
 */
export async function resolveLookupTables(
  client: WorkatoClient,
  managedUserId: string | number,
  refs: LookupTableRefs
): Promise<LookupTableContext[]> {
  if (refs.names.size === 0 && refs.ids.size === 0) return [];

  // Fetch all lookup tables for this managed user
  const { result: allTables } = await client.listLookupTables(managedUserId, {
    per_page: 100,
  });

  // Match by ID or name (case-insensitive)
  const lowerNames = new Set(
    [...refs.names].map((n) => n.toLowerCase())
  );

  const matched: WorkatoLookupTable[] = allTables.filter(
    (t) => refs.ids.has(t.id) || lowerNames.has(t.name.toLowerCase())
  );

  if (matched.length === 0) return [];

  // Fetch sample rows for each matched table (in parallel, bounded)
  const contexts: LookupTableContext[] = await Promise.all(
    matched.map(async (table) => {
      const columns = parseSchemaColumns(table.schema);
      let sampleRows: Array<Record<string, unknown>> = [];

      try {
        const { result: rows } = await client.listLookupTableRows(
          managedUserId,
          table.id,
          { per_page: MAX_SAMPLE_ROWS }
        );
        sampleRows = rows.map((r) => r.data);
      } catch {
        // Non-critical – we can still document without sample data
      }

      return {
        id: table.id,
        name: table.name,
        columns,
        sampleRows,
      };
    })
  );

  return contexts;
}
