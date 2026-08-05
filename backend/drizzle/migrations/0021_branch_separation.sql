-- Branch separation: stock, procurement and billing become per-branch.
--
-- The medicine catalogue stays shared (one master list across all branches).
-- What becomes branch-scoped is everything transactional: batches, the stock
-- ledger, purchase orders, goods inward, supplier dealings and invoices.
--
-- The `warehouses` table is removed. It sat between branch and shelf and had no
-- counterpart in the business — there are branches, and there are racks inside
-- them. Its only real job was carrying branch_id, which now lives directly on
-- the rows that need it.
--
-- Ordering matters throughout: every branch_id is added nullable, backfilled
-- through the warehouse chain WHILE IT STILL EXISTS, and only then made NOT
-- NULL. `warehouses` is dropped last.

-- ── 1. Add branch_id columns (nullable for now) ──────────────────────────────

ALTER TABLE "inventory_batches" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_received_notes" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint

-- ── 2. Backfill through the warehouse chain, before it is dropped ────────────

-- Shelves belong to whichever branch owned their warehouse.
UPDATE "storage_locations" sl
SET "branch_id" = w."branch_id"
FROM "warehouses" w
WHERE sl."warehouse_id" = w."id"
  AND sl."branch_id" IS NULL;--> statement-breakpoint

-- Batches: branch was previously reachable only as
-- batch -> storage_location -> warehouse -> branch.
UPDATE "inventory_batches" ib
SET "branch_id" = sl."branch_id"
FROM "storage_locations" sl
WHERE ib."location_id" = sl."id"
  AND ib."branch_id" IS NULL;--> statement-breakpoint

-- Any batch with no shelf assigned had no branch at all under the old model.
-- Fall back to the head office, else the oldest branch, so nothing is stranded.
UPDATE "inventory_batches"
SET "branch_id" = COALESCE(
  (SELECT "id" FROM "branches" WHERE "is_head_office" = true ORDER BY "created_at" LIMIT 1),
  (SELECT "id" FROM "branches" ORDER BY "created_at" LIMIT 1)
)
WHERE "branch_id" IS NULL;--> statement-breakpoint

-- The ledger inherits its batch's branch.
UPDATE "stock_movements" sm
SET "branch_id" = ib."branch_id"
FROM "inventory_batches" ib
WHERE sm."batch_id" = ib."id"
  AND sm."branch_id" IS NULL;--> statement-breakpoint

UPDATE "purchase_orders" po
SET "branch_id" = w."branch_id"
FROM "warehouses" w
WHERE po."warehouse_id" = w."id"
  AND po."branch_id" IS NULL;--> statement-breakpoint

UPDATE "goods_received_notes" grn
SET "branch_id" = po."branch_id"
FROM "purchase_orders" po
WHERE grn."po_id" = po."id"
  AND grn."branch_id" IS NULL;--> statement-breakpoint

UPDATE "supplier_payments" sp
SET "branch_id" = grn."branch_id"
FROM "goods_received_notes" grn
WHERE sp."grn_id" = grn."id"
  AND sp."branch_id" IS NULL;--> statement-breakpoint

UPDATE "supplier_returns" sr
SET "branch_id" = ib."branch_id"
FROM "inventory_batches" ib
WHERE sr."batch_id" = ib."id"
  AND sr."branch_id" IS NULL;--> statement-breakpoint

-- On-account supplier payments have no GRN to inherit from.
UPDATE "supplier_payments"
SET "branch_id" = COALESCE(
  (SELECT "id" FROM "branches" WHERE "is_head_office" = true ORDER BY "created_at" LIMIT 1),
  (SELECT "id" FROM "branches" ORDER BY "created_at" LIMIT 1)
)
WHERE "branch_id" IS NULL;--> statement-breakpoint

-- Invoices already had a nullable branch_id; it becomes mandatory below.
UPDATE "sales_invoices"
SET "branch_id" = COALESCE(
  (SELECT "id" FROM "branches" WHERE "is_head_office" = true ORDER BY "created_at" LIMIT 1),
  (SELECT "id" FROM "branches" ORDER BY "created_at" LIMIT 1)
)
WHERE "branch_id" IS NULL;--> statement-breakpoint

-- ── 3. Stock transfers move branch to branch, not warehouse to warehouse ─────

ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "from_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "to_branch_id" uuid;--> statement-breakpoint

UPDATE "stock_transfers" st
SET "from_branch_id" = wf."branch_id",
    "to_branch_id"   = wt."branch_id"
FROM "warehouses" wf, "warehouses" wt
WHERE st."from_warehouse_id" = wf."id"
  AND st."to_warehouse_id"   = wt."id"
  AND st."from_branch_id" IS NULL;--> statement-breakpoint

ALTER TABLE "stock_transfers" DROP COLUMN IF EXISTS "from_warehouse_id";--> statement-breakpoint
ALTER TABLE "stock_transfers" DROP COLUMN IF EXISTS "to_warehouse_id";--> statement-breakpoint

-- ── 4. Enforce NOT NULL now that every row carries a branch ──────────────────

ALTER TABLE "inventory_batches"    ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements"      ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_locations"    ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders"      ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_received_notes" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments"    ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_returns"     ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices"       ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers"      ALTER COLUMN "from_branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers"      ALTER COLUMN "to_branch_id" SET NOT NULL;--> statement-breakpoint

-- ── 5. Foreign keys. Every branch_id was previously a bare uuid with no FK ───

ALTER TABLE "inventory_batches"    ADD CONSTRAINT "inventory_batches_branch_id_branches_id_fk"    FOREIGN KEY ("branch_id")      REFERENCES "public"."branches"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "stock_movements"      ADD CONSTRAINT "stock_movements_branch_id_branches_id_fk"      FOREIGN KEY ("branch_id")      REFERENCES "public"."branches"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "storage_locations"    ADD CONSTRAINT "storage_locations_branch_id_branches_id_fk"    FOREIGN KEY ("branch_id")      REFERENCES "public"."branches"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "purchase_orders"      ADD CONSTRAINT "purchase_orders_branch_id_branches_id_fk"      FOREIGN KEY ("branch_id")      REFERENCES "public"."branches"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id")      REFERENCES "public"."branches"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "supplier_payments"    ADD CONSTRAINT "supplier_payments_branch_id_branches_id_fk"    FOREIGN KEY ("branch_id")      REFERENCES "public"."branches"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "supplier_returns"     ADD CONSTRAINT "supplier_returns_branch_id_branches_id_fk"     FOREIGN KEY ("branch_id")      REFERENCES "public"."branches"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "sales_invoices"       ADD CONSTRAINT "sales_invoices_branch_id_branches_id_fk"       FOREIGN KEY ("branch_id")      REFERENCES "public"."branches"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "stock_transfers"      ADD CONSTRAINT "stock_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "stock_transfers"      ADD CONSTRAINT "stock_transfers_to_branch_id_branches_id_fk"   FOREIGN KEY ("to_branch_id")   REFERENCES "public"."branches"("id") ON DELETE restrict;--> statement-breakpoint

-- ── 6. The index that made branch separation impossible ──────────────────────
--
-- batch_medicine_batchno_uniq was UNIQUE (medicine_id, batch_no) globally. Two
-- branches buying the same drug from the same distributor receive the identical
-- manufacturer batch number, so the second branch's goods-inward failed on a
-- duplicate key. Scoped by branch, both can hold it.

DROP INDEX IF EXISTS "batch_medicine_batchno_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "batch_medicine_batchno_branch_uniq" ON "inventory_batches" USING btree ("medicine_id","batch_no","branch_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "batch_branch_medicine_idx" ON "inventory_batches" USING btree ("branch_id","medicine_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_branch_expiry_idx" ON "inventory_batches" USING btree ("branch_id","expiry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movement_branch_created_at_idx" ON "stock_movements" USING btree ("branch_id","created_at");--> statement-breakpoint

-- ── 7. Retire the warehouse layer ────────────────────────────────────────────

ALTER TABLE "storage_locations" DROP COLUMN IF EXISTS "warehouse_id";--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP COLUMN IF EXISTS "warehouse_id";--> statement-breakpoint
DROP TABLE IF EXISTS "warehouses";
