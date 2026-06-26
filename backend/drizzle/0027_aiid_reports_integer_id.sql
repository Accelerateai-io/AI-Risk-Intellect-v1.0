CREATE TABLE "aiid_reports_new" (
  "id" serial PRIMARY KEY NOT NULL,
  "object_id" varchar(24) NOT NULL,
  "date_published" timestamp with time zone,
  "report_number" varchar(128),
  "source_domain" varchar(512),
  "description" text,
  "title" text NOT NULL,
  "url" varchar(2048) NOT NULL,
  "tags" text[],
  "created_date" timestamp with time zone,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "aiid_reports_new" (
  "object_id",
  "date_published",
  "report_number",
  "source_domain",
  "description",
  "title",
  "url",
  "tags",
  "created_date",
  "imported_at"
)
SELECT
  "id",
  "date_published",
  "report_number",
  "source_domain",
  "description",
  "title",
  "url",
  "tags",
  "created_date",
  "imported_at"
FROM "aiid_reports";
--> statement-breakpoint
DROP TABLE "aiid_reports";
--> statement-breakpoint
ALTER TABLE "aiid_reports_new" RENAME TO "aiid_reports";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "aiid_reports_object_id_idx" ON "aiid_reports" USING btree ("object_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "aiid_reports_url_unique_idx" ON "aiid_reports" USING btree ("url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aiid_reports_report_number_idx" ON "aiid_reports" USING btree ("report_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aiid_reports_date_published_idx" ON "aiid_reports" USING btree ("date_published");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aiid_reports_imported_at_idx" ON "aiid_reports" USING btree ("imported_at");
