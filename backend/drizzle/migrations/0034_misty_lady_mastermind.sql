CREATE TABLE IF NOT EXISTS "doctor_medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"medicine_id" uuid NOT NULL,
	"default_dosage" varchar(100),
	"default_frequency" varchar(100),
	"default_duration" varchar(100),
	"default_quantity" integer,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doctor_medicines" ADD CONSTRAINT "doctor_medicines_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doctor_medicines" ADD CONSTRAINT "doctor_medicines_medicine_id_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doctor_medicines" ADD CONSTRAINT "doctor_medicines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doctor_medicines_doctor_medicine_uniq" ON "doctor_medicines" USING btree ("doctor_id","medicine_id") WHERE "doctor_medicines"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_medicines_doctor_sort_idx" ON "doctor_medicines" USING btree ("doctor_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_medicines_medicine_idx" ON "doctor_medicines" USING btree ("medicine_id");