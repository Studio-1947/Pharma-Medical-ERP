-- Collapse the operational staff roles into a single shop_manager role.
--
-- The role matrix is now exactly four: super_admin, admin, shop_manager,
-- doctor. pharmacist, cashier, inventory_manager, distribution_staff,
-- hr_manager and reports_analyst are removed. Every user holding one of those
-- roles is migrated to shop_manager, which carries the branch operations
-- bundle (billing, inventory, patients, stock/batches, procurement, suppliers
-- and daily sales) within its own branch.
--
-- Postgres cannot drop enum values in place, and ALTER TYPE ... ADD VALUE
-- cannot be *used* in the same transaction that adds it, so the whole thing
-- runs as one atomic step:
--   1. widen the column to text (no enum validation on writes)
--   2. migrate rows off the removed values
--   3. build the new 4-value type and switch the column onto it
--   4. drop the old type, rename the new one, restore the default

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "role" TYPE text;--> statement-breakpoint

UPDATE "users" SET "role" = 'shop_manager'
WHERE "role" IN ('pharmacist', 'cashier', 'inventory_manager', 'distribution_staff', 'hr_manager', 'reports_analyst');--> statement-breakpoint

CREATE TYPE "public"."user_role_new" AS ENUM('super_admin', 'admin', 'shop_manager', 'doctor');--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role_new" USING "role"::"public"."user_role_new";--> statement-breakpoint

DROP TYPE "public"."user_role";--> statement-breakpoint

ALTER TYPE "public"."user_role_new" RENAME TO "user_role";--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'shop_manager';
