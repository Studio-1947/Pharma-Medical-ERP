ALTER TABLE "grn_items" ADD COLUMN "free_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "scheme_free_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL;