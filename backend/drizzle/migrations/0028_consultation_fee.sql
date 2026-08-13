ALTER TABLE "sales_invoice_items" ADD COLUMN IF NOT EXISTS "item_type" varchar(20) DEFAULT 'medicine' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD COLUMN IF NOT EXISTS "item_name" varchar(255);--> statement-breakpoint
-- Consultation fee lines carry neither a medicine nor a batch, so the two
-- stock FKs become nullable. Existing rows are unaffected.
ALTER TABLE "sales_invoice_items" ALTER COLUMN "medicine_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ALTER COLUMN "batch_id" DROP NOT NULL;
