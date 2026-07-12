DO $$ BEGIN
 CREATE TYPE "public"."supplier_payment_method" AS ENUM('cash', 'bank_transfer', 'cheque', 'upi', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"grn_id" uuid,
	"amount" numeric(12, 2) NOT NULL,
	"method" "supplier_payment_method" NOT NULL,
	"reference_no" varchar(100),
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_by" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_grn_id_goods_received_notes_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_received_notes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
