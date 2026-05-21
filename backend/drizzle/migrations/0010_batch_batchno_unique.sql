ALTER TABLE "medicines" ADD COLUMN "strip_size" integer DEFAULT 1 NOT NULL;--> statement-breakpoint

-- Remove duplicate (medicine_id, batch_no) rows before adding the unique index.
-- For each duplicate group, keep the row with the highest quantity.
-- If quantities are equal, keep the most recently created one.
DELETE FROM "inventory_batches"
WHERE id NOT IN (
  SELECT DISTINCT ON (medicine_id, batch_no) id
  FROM "inventory_batches"
  ORDER BY medicine_id, batch_no, quantity DESC, created_at DESC
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "batch_medicine_batchno_uniq" ON "inventory_batches" USING btree ("medicine_id","batch_no");
