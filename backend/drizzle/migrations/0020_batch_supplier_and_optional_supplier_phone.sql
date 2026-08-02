ALTER TABLE "suppliers" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD COLUMN "supplier_id" uuid;