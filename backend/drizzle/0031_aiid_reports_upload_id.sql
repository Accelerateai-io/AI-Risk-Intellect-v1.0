ALTER TABLE "aiid_reports" ADD COLUMN IF NOT EXISTS "upload_id" integer;
--> statement-breakpoint
ALTER TABLE "aiid_reports"
  ADD CONSTRAINT "aiid_reports_upload_id_etl_report_uploads_id_fk"
  FOREIGN KEY ("upload_id") REFERENCES "etl_report_uploads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aiid_reports_upload_id_idx" ON "aiid_reports" USING btree ("upload_id");
--> statement-breakpoint
DROP TABLE IF EXISTS "etl_report_upload_items";
