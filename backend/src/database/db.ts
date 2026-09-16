import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  databaseUrlFromParts,
  DB_DEFAULTS,
} from "../config/databaseDefaults.js";
import { createLogger } from "../logger/index.js";
import { ensureJobsRelatedSchema } from "../schema/ensureJobsRelatedSchema.js";

const dbLog = createLogger("db");

const DATABASE_URI =
  process.env.DATABASE_URL?.trim() || databaseUrlFromParts();

const pool = new Pool({
  connectionString: DATABASE_URI,
});

pool.on("error", (err) => {
  dbLog.error("Unexpected error on idle Postgres client", { err });
});

export const db = drizzle(pool);
export { pool };
/** Default DB name when `DATABASE_NAME` / `DATABASE_URL` are unset (see `config/databaseDefaults.ts`). */
export const DEFAULT_DATABASE_NAME = DB_DEFAULTS.name;

export async function initDB() {
  try {
    await db.execute(sql`SELECT 1 AS connected`);
    dbLog.info("Database connected successfully", {
      database:
        process.env.DATABASE_NAME?.trim() ||
        process.env.DATABASE_URL?.trim() ||
        DB_DEFAULTS.name,
    });
    await ensureJobsRelatedSchema(pool);
  } catch (err) {
    dbLog.error("Database connection failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
