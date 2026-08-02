ALTER TABLE "medicines" ALTER COLUMN "generic_name" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD COLUMN "manufacture_date" date;--> statement-breakpoint
ALTER TABLE "medicines" ADD COLUMN "brand_name" varchar(255);--> statement-breakpoint
ALTER TABLE "medicines" ADD COLUMN "composition" text;--> statement-breakpoint
ALTER TABLE "medicines" ADD COLUMN "strength" text;--> statement-breakpoint
ALTER TABLE "medicines" ADD COLUMN "dosage_form" varchar(50);--> statement-breakpoint
ALTER TABLE "medicines" ADD COLUMN "pack_size" varchar(50);--> statement-breakpoint
ALTER TABLE "medicines" ADD COLUMN "therapeutic_class" varchar(100);--> statement-breakpoint
ALTER TABLE "medicines" ADD COLUMN "purchase_rate" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "medicines" ADD COLUMN "drawer_mapping" varchar(50);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medicines_brand_name_idx" ON "medicines" USING btree ("brand_name");