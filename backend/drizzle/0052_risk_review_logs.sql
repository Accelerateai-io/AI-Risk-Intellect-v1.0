CREATE TABLE IF NOT EXISTS "risk_review_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"risk_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"classification" varchar(16),
	"feedback" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "risk_review_logs" ADD CONSTRAINT "risk_review_logs_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "risk_review_logs" ADD CONSTRAINT "risk_review_logs_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_review_logs_risk_id_idx" ON "risk_review_logs" USING btree ("risk_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_review_logs_created_at_idx" ON "risk_review_logs" USING btree ("created_at");
