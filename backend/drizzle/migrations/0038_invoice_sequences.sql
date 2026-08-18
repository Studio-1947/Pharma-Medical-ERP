CREATE TABLE IF NOT EXISTS "invoice_sequences" (
	"branch_id" uuid NOT NULL,
	"seq_date" date NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_sequences_branch_id_seq_date_pk" PRIMARY KEY("branch_id","seq_date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
