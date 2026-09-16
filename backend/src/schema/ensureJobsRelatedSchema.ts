import type { Pool } from "pg";
import { createLogger } from "../logger/index.js";

const schemaLog = createLogger("schema");

/**
 * Idempotent tables/columns the Jobs page needs after deploy.
 * Drizzle journal can skip these when 0040 was renamed, so we apply them on boot.
 */
const STATEMENTS = [
  `DO $$ BEGIN
  CREATE TYPE "public"."batch_run_status" AS ENUM('pending', 'running', 'completed', 'partial', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$`,
  `DO $$ BEGIN
  CREATE TYPE "public"."batch_run_item_source" AS ENUM('rss', 'etl');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$`,
  `DO $$ BEGIN
  CREATE TYPE "public"."batch_run_item_status" AS ENUM('pending', 'started', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$`,
  `CREATE TABLE IF NOT EXISTS "batch_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_name" varchar(128) NOT NULL,
	"model_label" text,
	"status" "batch_run_status" DEFAULT 'pending' NOT NULL,
	"rss_item_count" integer DEFAULT 0 NOT NULL,
	"etl_item_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "batch_run_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_run_id" integer NOT NULL,
	"source_type" "batch_run_item_source" NOT NULL,
	"ingest_link_id" integer,
	"ingest_link_item_id" integer,
	"feed_name" text,
	"upload_id" integer,
	"report_id" integer,
	"url" varchar(2048) NOT NULL,
	"title" text,
	"status" "batch_run_item_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
)`,
  `ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "batch_run_id" integer`,
  `ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "model_name" varchar(128)`,
  `ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "model_label" text`,
  `CREATE TABLE IF NOT EXISTS "url_execution_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" varchar(2048) NOT NULL,
	"model_name" varchar(128),
	"model_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "url_execution_blocks_url_unique" UNIQUE("url")
)`,
  `ALTER TABLE "url_execution_blocks" ADD COLUMN IF NOT EXISTS "model_name" varchar(128)`,
  `ALTER TABLE "url_execution_blocks" ADD COLUMN IF NOT EXISTS "model_label" text`,
  `ALTER TABLE "batch_runs" ADD COLUMN IF NOT EXISTS "disabled" boolean DEFAULT false NOT NULL`,
  `DO $$ BEGIN
  ALTER TABLE "jobs"
    ADD CONSTRAINT "jobs_batch_run_id_batch_runs_id_fk"
    FOREIGN KEY ("batch_run_id")
    REFERENCES "public"."batch_runs"("id")
    ON DELETE set null
    ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$`,
  `CREATE INDEX IF NOT EXISTS "jobs_batch_run_id_idx" ON "jobs" USING btree ("batch_run_id")`,
  `CREATE INDEX IF NOT EXISTS "batch_runs_status_idx" ON "batch_runs" USING btree ("status")`,
  `CREATE INDEX IF NOT EXISTS "batch_run_items_batch_run_id_idx" ON "batch_run_items" USING btree ("batch_run_id")`,
];

export async function ensureJobsRelatedSchema(pool: Pool): Promise<void> {
  for (const statement of STATEMENTS) {
    try {
      await pool.query(statement);
    } catch (err) {
      schemaLog.warn("Jobs-related schema statement skipped", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  schemaLog.info("Jobs-related schema ensured");
}
