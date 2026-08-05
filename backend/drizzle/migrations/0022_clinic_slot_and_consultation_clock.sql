-- Clinic: one patient per slot, and a real consultation clock.
--
-- Nothing stopped two patients being booked into the same doctor's 03:00PM
-- slot, so reception could hand out any number of tokens for one time and only
-- find out when they were all in the waiting room together.
--
-- Consultation start/end were also not recorded anywhere. `updated_at` is
-- rewritten by any later edit (linking a prescription, adding a note) so it
-- could never stand in for when care actually happened.

ALTER TABLE "clinic_tokens" ADD COLUMN IF NOT EXISTS "called_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinic_tokens" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;--> statement-breakpoint

-- Backfill so existing history is not left blank: a token already seen was
-- called at some point, and updated_at is the closest evidence available.
-- Approximate by construction, which is why it is only applied to rows that
-- have already reached a post-pending state.
UPDATE "clinic_tokens"
SET "called_at" = "updated_at"
WHERE "called_at" IS NULL
  AND "status" IN ('called', 'completed');--> statement-breakpoint

UPDATE "clinic_tokens"
SET "completed_at" = "updated_at"
WHERE "completed_at" IS NULL
  AND "status" = 'completed';--> statement-breakpoint

-- Free up slots on any rows that already collide, keeping the lowest token
-- number in each clashing group. Without this the unique index below cannot be
-- created on a database that already contains double-booked slots.
UPDATE "clinic_tokens" ct
SET "time_slot" = NULL
WHERE ct."time_slot" IS NOT NULL
  AND ct."status" <> 'cancelled'
  AND EXISTS (
    SELECT 1 FROM "clinic_tokens" other
    WHERE other."doctor_id" = ct."doctor_id"
      AND other."date" = ct."date"
      AND other."time_slot" = ct."time_slot"
      AND other."status" <> 'cancelled'
      AND other."token_no" < ct."token_no"
  );--> statement-breakpoint

-- Partial: an optional slot (walk-ins have none) and a cancelled token both
-- have to leave the slot bookable.
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_tokens_doctor_date_slot_uniq"
  ON "clinic_tokens" USING btree ("doctor_id", "date", "time_slot")
  WHERE "time_slot" IS NOT NULL AND "status" <> 'cancelled';
