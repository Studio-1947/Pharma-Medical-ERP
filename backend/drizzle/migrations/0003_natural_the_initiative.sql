ALTER TABLE "patients" ADD COLUMN "state" varchar(100);--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "is_return" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "original_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "overridden_by" uuid;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "state" varchar(100);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_original_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
