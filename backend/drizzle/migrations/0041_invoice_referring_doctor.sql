ALTER TABLE "sales_invoices" ADD COLUMN "referred_by_doctor_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_referred_by_doctor_id_users_id_fk" FOREIGN KEY ("referred_by_doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_referred_by_doctor_idx" ON "sales_invoices" USING btree ("referred_by_doctor_id","created_at");