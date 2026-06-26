import "../src/bootstrap.js";
import { pool } from "../src/database/db.js";

const dbUrl = process.env.DATABASE_URL ?? "(not set)";
const dbName = dbUrl.match(/\/([^/?]+)(?:\?|$)/)?.[1] ?? "unknown";

async function main() {
  console.log("Database:", dbName);

  const tables = await pool.query<{ tablename: string }>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);

  console.log("Tables:", tables.rows.map((r) => r.tablename).join(", ") || "(none)");

  const jobs = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'jobs'
    ) AS exists
  `);
  console.log("jobs table exists:", jobs.rows[0]?.exists);

  const articles = await pool.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'articles'
    ORDER BY ordinal_position
  `);
  console.log(
    "articles columns:",
    articles.rows.map((r) => r.column_name).join(", ") || "(none)",
  );

  const enums = await pool.query<{ typname: string }>(`
    SELECT typname
    FROM pg_type
    WHERE typname IN ('job_status', 'job_type', 'job_source')
    ORDER BY typname
  `);
  console.log("job enums:", enums.rows.map((r) => r.typname).join(", ") || "(none)");

  const migrations = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    ) AS exists
  `);
  if (migrations.rows[0]?.exists) {
    const applied = await pool.query<{ id: number; hash: string; created_at: string }>(`
      SELECT id, hash, created_at::text
      FROM drizzle.__drizzle_migrations
      ORDER BY id
    `);
    console.log("Applied migrations:", applied.rows.length);
  } else {
    console.log("No drizzle migration history in this database.");
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
