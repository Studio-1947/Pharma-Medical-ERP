CREATE INDEX IF NOT EXISTS "prescriptions_status_idx" ON "prescriptions" ("status");
CREATE INDEX IF NOT EXISTS "prescriptions_expiry_date_idx" ON "prescriptions" ("expiry_date");
CREATE INDEX IF NOT EXISTS "prescriptions_patient_id_idx" ON "prescriptions" ("patient_id");
CREATE INDEX IF NOT EXISTS "invoices_branch_created_at_idx" ON "sales_invoices" ("branch_id", "created_at");
CREATE INDEX IF NOT EXISTS "batch_fefo_allocation_idx" ON "inventory_batches" ("medicine_id", "branch_id", "expiry_date", "quantity");
