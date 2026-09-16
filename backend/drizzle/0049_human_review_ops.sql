-- Human Review operations: reviewer assignment on risks, a human quality-override
-- flag, and a risk edit-provenance log. All additive and idempotent (safe to re-run).

-- Assignment: who SHOULD review (distinct from extraction_json.reviewed_by, i.e. who did).
ALTER TABLE "risks" ADD COLUMN IF NOT EXISTS "quality_manual" boolean DEFAULT false NOT NULL;
ALTER TABLE "risks" ADD COLUMN IF NOT EXISTS "assigned_to" uuid;
ALTER TABLE "risks" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp with time zone;
ALTER TABLE "risks" ADD COLUMN IF NOT EXISTS "assigned_by" uuid;

DO $$ BEGIN
  ALTER TABLE "risks" ADD CONSTRAINT "risks_assigned_to_users_id_fk"
    FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "risks" ADD CONSTRAINT "risks_assigned_by_users_id_fk"
    FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Edit-provenance log (modeled on user_profile_update_logs): field-level before/after
-- for every human correction of a risk, so a human edit is distinguishable from the model.
CREATE TABLE IF NOT EXISTS "risk_edit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"risk_id" uuid NOT NULL,
	"edited_by_user_id" uuid NOT NULL,
	"reason" text,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "risk_edit_logs" ADD CONSTRAINT "risk_edit_logs_risk_id_risks_id_fk"
    FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "risk_edit_logs" ADD CONSTRAINT "risk_edit_logs_edited_by_user_id_users_id_fk"
    FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "risks_assigned_to_idx" ON "risks" USING btree ("assigned_to");
CREATE INDEX IF NOT EXISTS "risk_edit_logs_risk_id_idx" ON "risk_edit_logs" USING btree ("risk_id");
CREATE INDEX IF NOT EXISTS "risk_edit_logs_created_at_idx" ON "risk_edit_logs" USING btree ("created_at");
