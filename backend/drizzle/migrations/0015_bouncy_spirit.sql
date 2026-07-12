DO $$ BEGIN
 CREATE TYPE "public"."supplier_payment_type" AS ENUM('payment', 'credit_note');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."supplier_return_outcome" AS ENUM('pending', 'replacement', 'credit_note');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."supplier_return_reason" AS ENUM('expiry', 'damage', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reason" "supplier_return_reason" DEFAULT 'expiry' NOT NULL,
	"outcome" "supplier_return_outcome" DEFAULT 'pending' NOT NULL,
	"credit_note_amount" numeric(12, 2),
	"supplier_payment_id" uuid,
	"replacement_batch_id" uuid,
	"notes" text,
	"recorded_by" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_payments" ALTER COLUMN "method" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "type" "supplier_payment_type" DEFAULT 'payment' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_batch_id_inventory_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."inventory_batches"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_payment_id_supplier_payments_id_fk" FOREIGN KEY ("supplier_payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_replacement_batch_id_inventory_batches_id_fk" FOREIGN KEY ("replacement_batch_id") REFERENCES "public"."inventory_batches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
