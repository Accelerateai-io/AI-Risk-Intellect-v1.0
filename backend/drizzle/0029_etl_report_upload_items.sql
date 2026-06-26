CREATE TABLE IF NOT EXISTS "etl_report_upload_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "upload_id" integer NOT NULL,
  "row_order" integer NOT NULL,
  "object_id" varchar(24),
  "url" varchar(2048) NOT NULL,
  "title" text
);
--> statement-breakpoint
ALTER TABLE "etl_report_upload_items"
  ADD CONSTRAINT "etl_report_upload_items_upload_id_etl_report_uploads_id_fk"
  FOREIGN KEY ("upload_id") REFERENCES "etl_report_uploads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "etl_report_upload_items_upload_id_idx" ON "etl_report_upload_items" USING btree ("upload_id");
