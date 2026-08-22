import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../../database/schema";
import { InventoryRepository } from "../inventory.repository";

/**
 * The counter search is the one box staff use for everything, so it has to
 * match the way they actually type: a brand, a salt, a manufacturer, a pack
 * size, a barcode, or a name with the form tacked on — "cetirizine syrup",
 * "pan 40 tablet".
 *
 * Tokens are ANDed, which makes an unsearched field actively harmful rather
 * than merely unhelpful: one word that matches nothing throws the whole query
 * away and the desk reports "nothing found" for a medicine that is on the
 * shelf. That is why this asserts on columns and not just on results.
 *
 * Those columns now live in the generated `medicines.search_text` rather than
 * in thirteen ILIKEs, so coverage is asserted against the column's definition
 * and speed is asserted against the query plan the repository can produce.
 */

const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "drizzle", "migrations");

/** The migration that defines search_text and its trigram index. */
function searchMigrationSql() {
  const file = readdirSync(MIGRATIONS).find((f) => f.includes("medicine_search_text"));
  if (!file) throw new Error("medicine_search_text migration is missing");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

/** Columns the search must reach. */
const SEARCHABLE = [
  "name",
  "brand_name",
  "generic_name",
  "composition",
  "manufacturer",
  "sku",
  "barcode",
  "strength",
  "dosage_form",
  "therapeutic_class",
  "pack_size",
  "hsn_code",
  "drawer_mapping",
];

const captured: string[] = [];

function repoWithCapturedSql() {
  captured.length = 0;
  (Pool.prototype as any).query = (cfg: any) => {
    captured.push(typeof cfg === "string" ? cfg : cfg.text);
    return Promise.reject(new Error("intercepted — no query is sent"));
  };
  (Pool.prototype as any).connect = () =>
    Promise.reject(new Error("intercepted — no connection is opened"));

  const db = drizzle(new Pool({ connectionString: "postgres://x:x@127.0.0.1:1/x" }), {
    schema,
  });
  return new InventoryRepository({ db } as any);
}

async function sqlFor(params: Record<string, unknown>) {
  const repo = repoWithCapturedSql();
  await repo.findMedicinesPaginated(params as any).catch(() => {});
  return captured[0] ?? "";
}

describe("medicine search — what the one counter box can find", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("folds every searchable column into search_text", async () => {
    const sql = searchMigrationSql();
    for (const col of SEARCHABLE) {
      expect(sql, `search_text is missing ${col}`).toContain(`coalesce("${col}",'')`);
    }
  });

  it("stores a punctuation-stripped copy, so pan-40 and pan40 are one query", async () => {
    expect(searchMigrationSql()).toContain("regexp_replace(lower(");
    expect(searchMigrationSql()).toContain("'[^a-z0-9]', '', 'g'");
  });

  it("keeps the trigram index that makes a leading-wildcard LIKE indexable", async () => {
    // Without gin_trgm_ops the same query silently reverts to a sequential
    // scan: 140ms against 6,795 rows, and it grows with the catalogue.
    const sql = searchMigrationSql();
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(sql).toMatch(/USING gin \("search_text" gin_trgm_ops\)/);
  });

  it("searches the indexed column, not the raw ones", async () => {
    const sql = await sqlFor({ search: "cetirizine", page: 1, limit: 10 });
    expect(sql).toContain('"medicines"."search_text" LIKE');
    // A per-column ILIKE creeping back in would not be wrong, only slow, and
    // slow is exactly the failure nobody notices until the catalogue grows.
    for (const col of SEARCHABLE) {
      expect(sql, `${col} is being matched directly again`).not.toContain(
        `"medicines"."${col}" ilike`,
      );
    }
  });

  it("lets each word of a multi-word search land anywhere in the row", async () => {
    // "cetirizine syrup": the salt is in generic_name, the form in
    // dosage_form. Neither column alone matches the phrase, so this only works
    // if every token is matched against the whole folded blob.
    const sql = await sqlFor({ search: "cetirizine syrup", page: 1, limit: 10 });
    const passes = sql.split('"medicines"."search_text" LIKE').length - 1;
    // Whole phrase + normalized + one per token.
    expect(passes).toBeGreaterThan(2);
  });

  it("still ranks an exact SKU or barcode above a loose name match", async () => {
    const sql = await sqlFor({ search: "MED26001", page: 1, limit: 10 });
    expect(sql).toContain(`WHEN LOWER("medicines"."sku") = LOWER(`);
    expect(sql).toContain(`WHEN LOWER("medicines"."barcode") = LOWER(`);
  });

  it("keeps the active-only default, and drops it only for isActive=all", async () => {
    const plain = await sqlFor({ search: "cetirizine", page: 1, limit: 10 });
    expect(plain).toContain(`"medicines"."is_active" =`);

    const all = await sqlFor({ search: "cetirizine", isActive: "all", page: 1, limit: 10 });
    expect(all).not.toContain(`"medicines"."is_active" =`);
  });
});
