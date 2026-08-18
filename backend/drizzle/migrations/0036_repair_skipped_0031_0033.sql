-- REPAIR MIGRATION — replays 0031, 0032 and 0033.
--
-- Why this exists
-- ---------------
-- Drizzle's migrator does not track which migrations ran. It reads the single
-- most recent row of __drizzle_migrations and applies every journal entry whose
-- `when` is strictly greater than that row's created_at:
--
--     if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
--
-- Commit 0120fc7 (PR #48) shipped a journal in which 0030_user_roles_shrink
-- carried when = 1786800100000, and that value was written into
-- __drizzle_migrations on every database deployed from it — production
-- included. Commit 71e7093 (PR #49) then hand-edited the journal, lowering
-- 0028/0029/0030 and appending 0031/0032/0033 with `when` values of
-- 1786697030000 / 1786697040000 / 1786697050000 — all BELOW the 1786800100000
-- high-water mark already recorded in those databases.
--
-- The comparison above therefore evaluates false for all three, on every boot,
-- for ever. 0034 and 0035 carry later timestamps and did apply, which is why
-- the drift was invisible: the schema looked current apart from a hole where
-- 0031-0033 should have been. The symptom was PUT /api/v1/settings/billing-flow
-- failing with Postgres 42P01 (undefined_table) on "app_settings", surfaced by
-- GlobalExceptionFilter as "Database schema mismatch - a pending migration may
-- not be applied".
--
-- Re-deploying cannot fix that; the comparison is identical every time. The
-- skipped statements have to be re-offered under a timestamp that clears the
-- high-water mark, which is what this migration is.
--
-- Every statement below is copied verbatim from the migration it replays and
-- every one of them is idempotent (IF NOT EXISTS / duplicate_object guard /
-- ON CONFLICT DO NOTHING). On a database that did apply 0031-0033 — local dev,
-- CI, any environment created after PR #49 — this migration is a no-op.

-- ---------------------------------------------------------------- from 0031
CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------- from 0032
INSERT INTO "app_settings" ("key", "value", "updated_at")
VALUES ('billing_flow', '{"flow":"new"}', now())
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------- from 0033
-- 0033 prefixed this with DROP INDEX IF EXISTS to displace any hand-made
-- index of the same name. That DROP is deliberately not repeated here: the
-- name appears in no other migration, so on a database that already ran 0033
-- the only thing it could drop is the correct index, forcing a needless GIN
-- rebuild under a write lock. Verify with \di medicines_search_trgm_idx if an
-- index of that name is ever created outside migrations.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medicines_search_trgm_idx" ON "medicines" USING gin ("name" gin_trgm_ops, "brand_name" gin_trgm_ops, "generic_name" gin_trgm_ops, "composition" gin_trgm_ops, "manufacturer" gin_trgm_ops, "sku" gin_trgm_ops, "barcode" gin_trgm_ops);
