CREATE TABLE IF NOT EXISTS "etl_report_uploads" (
  "id" serial PRIMARY KEY NOT NULL,
  "suggested_name" varchar(256),
  "file_name" varchar(512) NOT NULL,
  "status" varchar(32) DEFAULT 'processing' NOT NULL,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "imported_rows" integer DEFAULT 0 NOT NULL,
  "skipped_rows" integer DEFAULT 0 NOT NULL,
  "failed_rows" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "archived" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "etl_report_uploads_archived_idx" ON "etl_report_uploads" USING btree ("archived");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "etl_report_uploads_created_at_idx" ON "etl_report_uploads" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "etl_report_uploads_status_idx" ON "etl_report_uploads" USING btree ("status");
