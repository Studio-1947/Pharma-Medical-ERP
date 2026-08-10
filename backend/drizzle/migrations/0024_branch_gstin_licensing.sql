ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "state" varchar(100);
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "gstin" varchar(15);
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "drug_license_20b" varchar(100);
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "drug_license_21b" varchar(100);
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "licensee_name" varchar(255);
ALTER TABLE "medicines" ADD COLUMN IF NOT EXISTS "drawer_mapping" varchar(50);
