import "../src/bootstrap.js";
import { pool } from "../src/database/db.js";

async function tableExists(name: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    [name],
  );
  return result.rows[0]?.exists === true;
}

async function constraintExists(name: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = $1
    ) AS exists`,
    [name],
  );
  return result.rows[0]?.exists === true;
}

async function indexExists(name: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'i' AND c.relname = $1 AND n.nspname = 'public'
    ) AS exists`,
    [name],
  );
  return result.rows[0]?.exists === true;
}

async function main() {
  const dbName =
    process.env.DATABASE_URL?.match(/\/([^/?]+)(?:\?|$)/)?.[1] ?? "unknown";
  console.log(`Repairing jobs table on database: ${dbName}`);

  if (!(await tableExists("articles"))) {
    throw new Error('Required table "articles" is missing. Run npm run db:migrate first.');
  }

  if (await tableExists("jobs")) {
    console.log("jobs table already exists — nothing to repair.");
    await pool.end();
    return;
  }

  await pool.query(`
    CREATE TABLE "jobs" (
      "id" serial PRIMARY KEY NOT NULL,
      "article_id" integer NOT NULL,
      "url" varchar(2048) NOT NULL,
      "status" "job_status" DEFAULT 'pending' NOT NULL,
      "job_type" "job_type" DEFAULT 'ingest' NOT NULL,
      "source" "job_source" DEFAULT 'manual' NOT NULL,
      "ingest_link_id" integer,
      "ingest_link_item_id" integer,
      "tries" integer DEFAULT 0 NOT NULL,
      "error_message" text,
      "started_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  console.log("Created jobs table.");

  if (!(await constraintExists("jobs_article_id_articles_id_fk"))) {
    await pool.query(`
      ALTER TABLE "jobs"
      ADD CONSTRAINT "jobs_article_id_articles_id_fk"
      FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id")
      ON DELETE cascade ON UPDATE no action
    `);
  }

  if (
    (await tableExists("ingest_links")) &&
    !(await constraintExists("jobs_ingest_link_id_ingest_links_id_fk"))
  ) {
    await pool.query(`
      ALTER TABLE "jobs"
      ADD CONSTRAINT "jobs_ingest_link_id_ingest_links_id_fk"
      FOREIGN KEY ("ingest_link_id") REFERENCES "public"."ingest_links"("id")
      ON DELETE set null ON UPDATE no action
    `);
  }

  if (
    (await tableExists("ingest_link_items")) &&
    !(await constraintExists("jobs_ingest_link_item_id_ingest_link_items_id_fk"))
  ) {
    await pool.query(`
      ALTER TABLE "jobs"
      ADD CONSTRAINT "jobs_ingest_link_item_id_ingest_link_items_id_fk"
      FOREIGN KEY ("ingest_link_item_id") REFERENCES "public"."ingest_link_items"("id")
      ON DELETE set null ON UPDATE no action
    `);
  }

  const indexes = [
    ["jobs_article_id_idx", `CREATE INDEX "jobs_article_id_idx" ON "jobs" ("article_id")`],
    ["jobs_url_idx", `CREATE INDEX "jobs_url_idx" ON "jobs" ("url")`],
    ["jobs_status_idx", `CREATE INDEX "jobs_status_idx" ON "jobs" ("status")`],
    ["jobs_created_at_idx", `CREATE INDEX "jobs_created_at_idx" ON "jobs" ("created_at")`],
    ["jobs_ingest_link_id_idx", `CREATE INDEX "jobs_ingest_link_id_idx" ON "jobs" ("ingest_link_id")`],
    ["jobs_ingest_link_item_id_idx", `CREATE INDEX "jobs_ingest_link_item_id_idx" ON "jobs" ("ingest_link_item_id")`],
  ] as const;

  for (const [name, sql] of indexes) {
    if (!(await indexExists(name))) {
      await pool.query(sql);
    }
  }

  console.log("jobs table repair completed successfully.");
  await pool.end();
}

main().catch(async (err) => {
  console.error("jobs table repair failed:", err);
  await pool.end();
  process.exit(1);
});
