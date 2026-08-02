ALTER TABLE "clinic_tokens" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
-- Backfill from the doctor the token was issued against. Tokens predate branch
-- scoping, and a null branch is visible to super_admin alone, so without this
-- an existing queue would vanish from its own branch's screens.
UPDATE "clinic_tokens" ct
SET "branch_id" = u."branch_id"
FROM "users" u
WHERE u."id" = ct."doctor_id"
  AND ct."branch_id" IS NULL
  AND u."branch_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinic_tokens_branch_date_idx" ON "clinic_tokens" USING btree ("branch_id","date");
