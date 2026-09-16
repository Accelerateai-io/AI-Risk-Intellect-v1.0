-- Growing content columns: varchar(255+) → text so saves are not truncated.
ALTER TABLE "risks" ALTER COLUMN "primary_risk" TYPE text;
--> statement-breakpoint
ALTER TABLE "risks" ALTER COLUMN "secondary_risk" TYPE text;
--> statement-breakpoint
ALTER TABLE "risks" ALTER COLUMN "sector" TYPE text;
--> statement-breakpoint
ALTER TABLE "risks" ALTER COLUMN "industry" TYPE text;
--> statement-breakpoint
ALTER TABLE "risks" ALTER COLUMN "intent" TYPE text;
--> statement-breakpoint
ALTER TABLE "risks" ALTER COLUMN "ai_product_name" TYPE text;
--> statement-breakpoint
ALTER TABLE "risks" ALTER COLUMN "ai_product_vendor" TYPE text;
--> statement-breakpoint
ALTER TABLE "risk_mappings" ALTER COLUMN "risk_title" TYPE text;
--> statement-breakpoint
ALTER TABLE "risk_mappings" ALTER COLUMN "domains" TYPE text;
--> statement-breakpoint
ALTER TABLE "risk_mappings" ALTER COLUMN "attack_vector" TYPE text;
--> statement-breakpoint
ALTER TABLE "risk_mappings" ALTER COLUMN "intent" TYPE text;
--> statement-breakpoint
ALTER TABLE "risk_mappings" ALTER COLUMN "timing" TYPE text;
--> statement-breakpoint
ALTER TABLE "risk_mappings" ALTER COLUMN "risk_type_detected" TYPE text;
--> statement-breakpoint
ALTER TABLE "risk_mappings" ALTER COLUMN "primary_risk" TYPE text;
--> statement-breakpoint
ALTER TABLE "risk_mappings" ALTER COLUMN "secondary_risks" TYPE text;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "user_agent" TYPE text;
--> statement-breakpoint
ALTER TABLE "aiid_reports" ALTER COLUMN "source_domain" TYPE text;
--> statement-breakpoint
ALTER TABLE "etl_report_uploads" ALTER COLUMN "suggested_name" TYPE text;
--> statement-breakpoint
ALTER TABLE "etl_report_uploads" ALTER COLUMN "report_file_path" TYPE text;
--> statement-breakpoint
ALTER TABLE "ingest_links" ALTER COLUMN "suggested_name" TYPE text;
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "model_label" TYPE text;
--> statement-breakpoint
ALTER TABLE "url_execution_blocks" ALTER COLUMN "model_label" TYPE text;
--> statement-breakpoint
ALTER TABLE "batch_runs" ALTER COLUMN "model_label" TYPE text;
--> statement-breakpoint
ALTER TABLE "batch_run_items" ALTER COLUMN "feed_name" TYPE text;
