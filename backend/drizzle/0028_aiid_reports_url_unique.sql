DROP INDEX IF EXISTS "aiid_reports_url_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "aiid_reports_url_unique_idx" ON "aiid_reports" USING btree ("url");
