ALTER TABLE "etl_report_uploads" ADD COLUMN IF NOT EXISTS "file_sha256" varchar(64);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "etl_report_uploads_file_sha256_idx" ON "etl_report_uploads" USING btree ("file_sha256");
