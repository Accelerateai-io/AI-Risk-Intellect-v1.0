CREATE TABLE IF NOT EXISTS "aiid_incidents" (
  "id" varchar(24) PRIMARY KEY NOT NULL,
  "date_published" timestamp with time zone,
  "report_number" varchar(128),
  "source_domain" varchar(512),
  "text" text,
  "title" text NOT NULL,
  "url" varchar(2048) NOT NULL,
  "tags" text[],
  "created_date" timestamp with time zone,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aiid_incidents_url_idx" ON "aiid_incidents" USING btree ("url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aiid_incidents_date_published_idx" ON "aiid_incidents" USING btree ("date_published");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aiid_incidents_imported_at_idx" ON "aiid_incidents" USING btree ("imported_at");
