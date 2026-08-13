ALTER TABLE "clinic_tokens" ADD COLUMN IF NOT EXISTS "visit_type" varchar(20) DEFAULT 'new' NOT NULL;
