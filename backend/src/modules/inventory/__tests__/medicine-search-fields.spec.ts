import { describe, it, expect, beforeEach } from "vitest";
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
 * away and the desk reports "nothing found" for a medicine that is sitting on
 * the shelf. That is why this asserts on columns and not just on results.
 *
 * Assertions run against the SQL the repository really emits, captured at the
 * pg driver, because the three passes (whole phrase, punctuation-stripped,
 * per-token) are built separately and had already drifted apart once —
 * manufacturer and barcode were in the token pass and missing from the others.
 */

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

/** Columns the search must reach, in every pass. */
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

describe("medicine search — what the one counter box can find", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("matches the typed phrase against every searchable column", async () => {
    const sql = await sqlFor({ search: "cetirizine", page: 1, limit: 10 });
    for (const col of SEARCHABLE) {
      expect(sql, `whole-phrase pass is missing ${col}`).toContain(
        `"medicines"."${col}" ilike`,
      );
    }
  });

  it("matches punctuation-blind against every searchable column", async () => {
    // "pan-40", "pan 40" and "pan40" have to be one query.
    const sql = await sqlFor({ search: "pan-40", page: 1, limit: 10 });
    for (const col of SEARCHABLE) {
      expect(sql, `normalized pass is missing ${col}`).toContain(
        `REGEXP_REPLACE("medicines"."${col}", '[^a-zA-Z0-9]', '', 'g')`,
      );
    }
  });

  it("lets each word of a multi-word search land in a different column", async () => {
    // "cetirizine syrup": the salt is in generic_name, the form in
    // dosage_form. Neither column alone matches the phrase, so this only
    // works if every token is matched against the full column list.
    const sql = await sqlFor({ search: "cetirizine syrup", page: 1, limit: 10 });
    const perColumn = sql.split(`"medicines"."dosage_form" ilike`).length - 1;
    // Whole phrase + normalized is one each; the rest are the token passes.
    expect(perColumn).toBeGreaterThan(2);
  });

  it("still ranks an exact SKU or barcode above a loose name match", async () => {
    // Broadening the WHERE must not cost the scan its precedence: a scanned
    // code has to come back first, not fourth.
    const sql = await sqlFor({ search: "MED26001", page: 1, limit: 10 });
    expect(sql).toContain(`WHEN LOWER("medicines"."sku") = LOWER(`);
    expect(sql).toContain(`WHEN LOWER("medicines"."barcode") = LOWER(`);
  });

  it("keeps the active-only default, and drops it only for isActive=all", async () => {
    // The broadened search must not become a back door onto inactive rows for
    // the callers that never asked for them.
    const plain = await sqlFor({ search: "cetirizine", page: 1, limit: 10 });
    expect(plain).toContain(`"medicines"."is_active" =`);

    const all = await sqlFor({ search: "cetirizine", isActive: "all", page: 1, limit: 10 });
    expect(all).not.toContain(`"medicines"."is_active" =`);
  });
});
