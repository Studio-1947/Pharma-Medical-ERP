-- The GIN trigram index below cannot be created until the pg_trgm extension
-- exists. pg_trgm is a trusted contrib extension: the database owner can
-- enable it without superuser. CREATE EXTENSION IF NOT EXISTS is idempotent,
-- so this is safe on every environment (local docker, Neon, Cloud SQL).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
DROP INDEX IF EXISTS "medicines_search_trgm_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medicines_search_trgm_idx" ON "medicines" USING gin ("name" gin_trgm_ops, "brand_name" gin_trgm_ops, "generic_name" gin_trgm_ops, "composition" gin_trgm_ops, "manufacturer" gin_trgm_ops, "sku" gin_trgm_ops, "barcode" gin_trgm_ops);
