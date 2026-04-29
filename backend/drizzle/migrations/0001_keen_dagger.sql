ALTER TABLE "inventory_batches" ADD COLUMN "reserved_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD COLUMN "cgst_amt" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD COLUMN "sgst_amt" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD COLUMN "igst_amt" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "customer_gstin" varchar(15);