/**
 * Hard-delete catalogue rows that a bulk import created but left unusable, so a
 * corrected CSV can be re-imported cleanly.
 *
 * Why hard delete and not the usual soft delete: medicines_sku_idx is a plain
 * uniqueIndex, NOT scoped to deleted_at IS NULL the way medicines_barcode_unique
 * is. A soft-deleted row keeps its SKU in that index, while bulkImport's
 * findSkuSet filters on deleted_at IS NULL and would report the SKU as free.
 * The re-import would then pass the row through and hit 23505 on insert, which
 * rolls back the whole import transaction. Only a real DELETE frees the SKU.
 *
 * Safety model: every FK that carries transactional history is ON DELETE
 * RESTRICT (inventory_batches, stock_movements, sales_invoice_items,
 * stock_transfer_items, purchase_order_items). Rather than let Postgres raise
 * and abort the batch, this script excludes those rows up front with NOT EXISTS
 * guards and reports them, so a medicine that has picked up stock or been sold
 * is never a candidate. Two FKs act silently and are reported as side effects:
 * prescription_items.medicine_id is SET NULL (the row keeps its medicine_name
 * text) and doctor_medicines cascades.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *   node backend/scripts/purge-inactive-medicines.js
 *   node backend/scripts/purge-inactive-medicines.js --created-after=2026-08-20
 *   node backend/scripts/purge-inactive-medicines.js --created-after=2026-08-20 --apply
 *
 * Target: DATABASE_URL, or DATABASE_URL_PROD when DB_TARGET=prod, or --url=...
 * Note CLAUDE.md's warning that DATABASE_URL_PROD in backend/.env currently
 * points at a leftover Neon instance, not at production. Pass --url explicitly
 * when running against Cloud SQL through the proxy.
 */
try {
  require("dotenv/config");
} catch {
  // Environment variables are injected directly in Cloud Run
}
const { Client } = require("pg");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const APPLY = has("--apply");
const YES = has("--yes");
// Widen the scope to inactive rows that DO carry a price. Off by default: an
// admin deactivating a priced medicine by hand is a deliberate act, and this
// script must not mistake it for import debris.
const INCLUDE_PRICED = has("--include-priced");
const CREATED_AFTER = val("created-after");
const LIMIT_GUARD = Number(val("max") ?? 40000);

const connectionString =
  val("url") ??
  (process.env.DB_TARGET === "prod"
    ? process.env.DATABASE_URL_PROD
    : process.env.DATABASE_URL);

if (!connectionString) {
  console.error("No connection string. Set DATABASE_URL, or pass --url=postgresql://...");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Candidate predicate — the single definition both the report and the delete
// read from, so they can never drift apart.
// ---------------------------------------------------------------------------
const params = [];
const where = ["m.deleted_at IS NULL", "m.is_active = false"];
if (!INCLUDE_PRICED) where.push("m.price_mrp = 0");
if (CREATED_AFTER) {
  params.push(CREATED_AFTER);
  where.push(`m.created_at >= $${params.length}`);
}
const CANDIDATE = where.join("\n     AND ");

// Rows a RESTRICT foreign key protects. Deleting these would abort the
// statement, so they are excluded and reported instead.
const BLOCKERS = [
  ["inventory_batches", "stock batches"],
  ["stock_movements", "stock ledger entries"],
  ["sales_invoice_items", "invoice lines"],
  ["stock_transfer_items", "transfer lines"],
  ["purchase_order_items", "purchase order lines"],
];
const UNBLOCKED = BLOCKERS.map(
  ([t]) => `NOT EXISTS (SELECT 1 FROM ${t} x WHERE x.medicine_id = m.id)`,
).join("\n     AND ");

const fmt = (n) => Number(n).toLocaleString("en-IN");

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  const host = connectionString.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@");
  console.log("=".repeat(70));
  console.log("  PURGE INACTIVE MEDICINES");
  console.log("=".repeat(70));
  console.log(`  target        ${host}`);
  console.log(`  scope         is_active = false${INCLUDE_PRICED ? "" : " AND price_mrp = 0"}`);
  console.log(`  created after ${CREATED_AFTER ?? "(no window — ALL inactive rows)"}`);
  console.log(`  mode          ${APPLY ? "APPLY — rows will be deleted" : "DRY RUN — nothing is written"}`);
  console.log("");

  try {
    // --- how the catalogue looks right now --------------------------------
    const { rows: overall } = await client.query(
      `SELECT is_active, count(*)::int AS n
         FROM medicines WHERE deleted_at IS NULL GROUP BY is_active ORDER BY is_active`,
    );
    console.log("Catalogue today:");
    for (const r of overall) {
      console.log(`  is_active=${String(r.is_active).padEnd(5)} ${fmt(r.n).padStart(9)}`);
    }
    console.log("");

    // --- candidates, split into deletable vs blocked ----------------------
    const {
      rows: [counts],
    } = await client.query(
      `SELECT count(*)::int AS candidates,
              count(*) FILTER (WHERE ${UNBLOCKED})::int AS deletable
         FROM medicines m
        WHERE ${CANDIDATE}`,
      params,
    );
    const blocked = counts.candidates - counts.deletable;

    console.log("Candidates:");
    console.log(`  matching scope        ${fmt(counts.candidates).padStart(9)}`);
    console.log(`  deletable             ${fmt(counts.deletable).padStart(9)}`);
    console.log(`  held back (in use)    ${fmt(blocked).padStart(9)}`);
    console.log("");

    if (blocked > 0) {
      console.log("Held back because a RESTRICT foreign key still references them:");
      for (const [table, label] of BLOCKERS) {
        const {
          rows: [r],
        } = await client.query(
          `SELECT count(DISTINCT m.id)::int AS n
             FROM medicines m JOIN ${table} x ON x.medicine_id = m.id
            WHERE ${CANDIDATE}`,
          params,
        );
        if (r.n > 0) console.log(`  ${label.padEnd(24)} ${fmt(r.n).padStart(9)}`);
      }
      console.log("  These keep their rows. Price them by hand instead of re-importing.");
      console.log("");
    }

    // --- silent side effects of the delete --------------------------------
    for (const [table, verb] of [
      ["prescription_items", "will have medicine_id set to NULL (medicine_name text is kept)"],
      ["doctor_medicines", "will be deleted by cascade"],
    ]) {
      const {
        rows: [r],
      } = await client.query(
        `SELECT count(*)::int AS n
           FROM ${table} x JOIN medicines m ON m.id = x.medicine_id
          WHERE ${CANDIDATE} AND ${UNBLOCKED}`,
        params,
      );
      if (r.n > 0) console.log(`Side effect: ${fmt(r.n)} ${table} rows ${verb}.`);
    }

    if (counts.deletable === 0) {
      console.log("\nNothing to delete. Exiting.");
      return;
    }

    // --- eyeball the scope before trusting it -----------------------------
    const { rows: sample } = await client.query(
      `SELECT m.sku, m.name, m.manufacturer, m.price_mrp, m.created_at
         FROM medicines m
        WHERE ${CANDIDATE} AND ${UNBLOCKED}
        ORDER BY m.created_at DESC LIMIT 10`,
      params,
    );
    console.log("\nSample of what would be deleted (10 most recent):");
    for (const r of sample) {
      const when = r.created_at.toISOString().slice(0, 10);
      console.log(`  ${String(r.sku).padEnd(12)} ${when}  ${String(r.name).slice(0, 46)}`);
    }

    // A mis-scoped run is the real hazard here, not the delete itself.
    if (counts.deletable > LIMIT_GUARD && !YES) {
      console.log(
        `\nRefusing: ${fmt(counts.deletable)} rows exceeds the --max guard of ${fmt(LIMIT_GUARD)}.` +
          `\nNarrow the scope with --created-after, or pass --yes if this is intended.`,
      );
      process.exitCode = 1;
      return;
    }

    if (!APPLY) {
      console.log("\nDRY RUN — nothing was written. Re-run with --apply to delete.");
      console.log("Take a backup first: ./scripts/backup-db.sh");
      return;
    }

    // --- delete ------------------------------------------------------------
    console.log("\nDeleting...");
    await client.query("BEGIN");
    const res = await client.query(
      `DELETE FROM medicines AS m WHERE ${CANDIDATE} AND ${UNBLOCKED}`,
      params,
    );
    await client.query("COMMIT");
    console.log(`Deleted ${fmt(res.rowCount)} medicines.`);

    const { rows: after } = await client.query(
      `SELECT is_active, count(*)::int AS n
         FROM medicines WHERE deleted_at IS NULL GROUP BY is_active ORDER BY is_active`,
    );
    console.log("\nCatalogue now:");
    for (const r of after) {
      console.log(`  is_active=${String(r.is_active).padEnd(5)} ${fmt(r.n).padStart(9)}`);
    }
    console.log("\nSKUs are freed. The corrected CSV can be re-imported.");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("\nFailed:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
