DO $$ BEGIN
 CREATE TYPE "public"."token_status" AS ENUM('pending', 'called', 'completed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "user_role" ADD VALUE 'doctor';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clinic_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_no" integer NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"time_slot" varchar(50),
	"status" "token_status" DEFAULT 'pending' NOT NULL,
	"prescription_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinic_tokens" ADD CONSTRAINT "clinic_tokens_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinic_tokens" ADD CONSTRAINT "clinic_tokens_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinic_tokens" ADD CONSTRAINT "clinic_tokens_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_tokens_doctor_date_token_idx" ON "clinic_tokens" USING btree ("doctor_id","date","token_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinic_tokens_doctor_date_idx" ON "clinic_tokens" USING btree ("doctor_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinic_tokens_patient_idx" ON "clinic_tokens" USING btree ("patient_id");