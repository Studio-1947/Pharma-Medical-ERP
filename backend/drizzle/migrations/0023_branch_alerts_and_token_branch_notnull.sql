-- Closes the two branch-scoping gaps left open by 0021.
--
-- 1. clinic_tokens.branch_id becomes NOT NULL with a real foreign key. It was
--    nullable only so the column could be introduced without destroying rows
--    that predated branch scoping. Those have been backfilled, so the "a null
--    branch is visible to super_admin alone" special case can go — every read
--    path had to carry that exception around.
--
-- 2. system_alerts gains branch_id. Expiry and reorder alerts are only
--    actionable by the branch holding the stock; without a branch they could
--    not be addressed to anyone, which is part of why nothing ever wrote one.

-- ── 1. clinic_tokens ─────────────────────────────────────────────────────────

-- Backfill from the doctor the token was issued against, matching migration
-- 0018. Re-run here because 0018 only covered rows existing at that time.
UPDATE "clinic_tokens" ct
SET "branch_id" = u."branch_id"
FROM "users" u
WHERE u."id" = ct."doctor_id"
  AND ct."branch_id" IS NULL
  AND u."branch_id" IS NOT NULL;--> statement-breakpoint

-- Anything still unresolved (a token whose doctor is themselves unassigned)
-- falls back to the head office, else the oldest branch. A token stranded
-- without a branch would vanish from every queue once NOT NULL is enforced.
UPDATE "clinic_tokens"
SET "branch_id" = COALESCE(
  (SELECT "id" FROM "branches" WHERE "is_head_office" = true ORDER BY "created_at" LIMIT 1),
  (SELECT "id" FROM "branches" ORDER BY "created_at" LIMIT 1)
)
WHERE "branch_id" IS NULL;--> statement-breakpoint

ALTER TABLE "clinic_tokens" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "clinic_tokens"
  ADD CONSTRAINT "clinic_tokens_branch_id_branches_id_fk"
  FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict;--> statement-breakpoint

-- ── 2. system_alerts ─────────────────────────────────────────────────────────

-- Nullable: a 'SYSTEM' alert genuinely belongs to no branch and should reach
-- everyone. Stock alerts always carry one.
ALTER TABLE "system_alerts" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint

ALTER TABLE "system_alerts"
  ADD CONSTRAINT "system_alerts_branch_id_branches_id_fk"
  FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "system_alerts_branch_unread_idx"
  ON "system_alerts" USING btree ("branch_id", "is_read");--> statement-breakpoint

-- Stops a nightly scan re-raising the same alert every night: while an alert is
-- unread the insert is a no-op, and once dismissed the next scan may raise it
-- again. Partial so 'SYSTEM' alerts with no reference are never deduplicated.
CREATE UNIQUE INDEX IF NOT EXISTS "system_alerts_open_uniq"
  ON "system_alerts" USING btree ("type", "reference_id", "branch_id")
  WHERE "is_read" = false AND "reference_id" IS NOT NULL;
