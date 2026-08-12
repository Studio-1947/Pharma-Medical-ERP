ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "prescriptions_branch_id_idx" ON "prescriptions" ("branch_id");
