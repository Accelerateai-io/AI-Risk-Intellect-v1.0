/**
 * Truncate all public tables except preserved reference data.
 * Keeps: users, risk_mappings
 *
 * Run from CMD: backend\truncate-db.bat
 */
import "../bootstrap.js";
import { sql } from "drizzle-orm";
import { db, pool } from "../database/db.js";

const PRESERVED_TABLES = ["users", "risk_mappings"] as const;

async function listPublicTables() {
  const result = await pool.query<{ tablename: string }>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);

  return result.rows.map((row) => row.tablename);
}

async function truncateExceptPreserved() {
  const preservedTablesList = PRESERVED_TABLES.map((table) => `'${table}'`).join(", ");

  await db.execute(sql.raw(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN (${preservedTablesList})
      ) LOOP
        EXECUTE format(
          'TRUNCATE TABLE %I RESTART IDENTITY CASCADE',
          r.tablename
        );
      END LOOP;
    END $$;
  `));
}

async function main() {
  const allTables = await listPublicTables();
  const preserved = allTables.filter((table) =>
    PRESERVED_TABLES.includes(table as (typeof PRESERVED_TABLES)[number]),
  );
  const truncated = allTables.filter(
    (table) => !PRESERVED_TABLES.includes(table as (typeof PRESERVED_TABLES)[number]),
  );

  console.log("Preserved tables:", preserved.join(", ") || "(none found)");
  console.log("Truncating tables:", truncated.join(", ") || "(none)");

  if (truncated.length === 0) {
    console.log("Nothing to truncate.");
    await pool.end();
    process.exit(0);
    return;
  }

  await truncateExceptPreserved();

  console.log("Database cleanup complete.");
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
