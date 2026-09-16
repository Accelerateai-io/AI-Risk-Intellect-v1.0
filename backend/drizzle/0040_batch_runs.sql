DO $$ BEGIN
  CREATE TYPE "public"."batch_run_status" AS ENUM('pending', 'running', 'completed', 'partial', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."batch_run_item_source" AS ENUM('rss', 'etl');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."batch_run_item_status" AS ENUM('pending', 'started', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "batch_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_name" varchar(128) NOT NULL,
	"model_label" varchar(256),
	"status" "batch_run_status" DEFAULT 'pending' NOT NULL,
	"rss_item_count" integer DEFAULT 0 NOT NULL,
	"etl_item_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "batch_run_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_run_id" integer NOT NULL,
	"source_type" "batch_run_item_source" NOT NULL,
	"ingest_link_id" integer,
	"ingest_link_item_id" integer,
	"feed_name" varchar(512),
	"upload_id" integer,
	"report_id" integer,
	"url" varchar(2048) NOT NULL,
	"title" text,
	"status" "batch_run_item_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "batch_run_items"
    ADD CONSTRAINT "batch_run_items_batch_run_id_batch_runs_id_fk"
    FOREIGN KEY ("batch_run_id") REFERENCES "batch_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "batch_run_items"
    ADD CONSTRAINT "batch_run_items_ingest_link_id_ingest_links_id_fk"
    FOREIGN KEY ("ingest_link_id") REFERENCES "ingest_links"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "batch_run_items"
    ADD CONSTRAINT "batch_run_items_ingest_link_item_id_ingest_link_items_id_fk"
    FOREIGN KEY ("ingest_link_item_id") REFERENCES "ingest_link_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "batch_run_items"
    ADD CONSTRAINT "batch_run_items_upload_id_etl_report_uploads_id_fk"
    FOREIGN KEY ("upload_id") REFERENCES "etl_report_uploads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "batch_run_items"
    ADD CONSTRAINT "batch_run_items_report_id_aiid_reports_id_fk"
    FOREIGN KEY ("report_id") REFERENCES "aiid_reports"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_runs_status_idx" ON "batch_runs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_runs_created_at_idx" ON "batch_runs" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_runs_model_name_idx" ON "batch_runs" USING btree ("model_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_run_items_batch_run_id_idx" ON "batch_run_items" USING btree ("batch_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_run_items_source_type_idx" ON "batch_run_items" USING btree ("source_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_run_items_ingest_link_id_idx" ON "batch_run_items" USING btree ("ingest_link_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_run_items_upload_id_idx" ON "batch_run_items" USING btree ("upload_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_run_items_report_id_idx" ON "batch_run_items" USING btree ("report_id");
