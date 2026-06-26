/**
 * Recreate articles + jobs tables after manual DROP (enums must already exist).
 * Run: npx tsx src/scripts/recreateArticlesJobs.ts
 */
import { pool } from "../database/db.js";

const sql = `
CREATE TABLE IF NOT EXISTS "articles" (
  "id" serial PRIMARY KEY NOT NULL,
  "url" varchar(2048) NOT NULL,
  "title" text,
  "raw_text" text,
  "html" text,
  "sha256" varchar(64),
  "risk_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "articles_url_unique" UNIQUE("url")
);

CREATE TABLE IF NOT EXISTS "jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "article_id" integer NOT NULL,
  "url" varchar(2048) NOT NULL,
  "status" "job_status" DEFAULT 'pending' NOT NULL,
  "job_type" "job_type" DEFAULT 'ingest' NOT NULL,
  "source" "job_source" DEFAULT 'manual' NOT NULL,
  "tries" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "jobs" ADD CONSTRAINT "jobs_article_id_articles_id_fk"
    FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "articles_url_idx" ON "articles" ("url");
CREATE INDEX IF NOT EXISTS "articles_sha256_idx" ON "articles" ("sha256");
CREATE UNIQUE INDEX IF NOT EXISTS "articles_sha256_unique" ON "articles" ("sha256") WHERE "sha256" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "articles_created_at_idx" ON "articles" ("created_at");

CREATE INDEX IF NOT EXISTS "jobs_article_id_idx" ON "jobs" ("article_id");
CREATE INDEX IF NOT EXISTS "jobs_url_idx" ON "jobs" ("url");
CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" ("status");
CREATE INDEX IF NOT EXISTS "jobs_created_at_idx" ON "jobs" ("created_at");
`;

async function main() {
  console.log("Recreating articles and jobs tables...");
  await pool.query(sql);
  console.log("Done — articles and jobs tables are ready.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
