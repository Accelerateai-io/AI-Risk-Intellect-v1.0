import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  databaseUrlFromParts,
  DB_DEFAULTS,
} from "../config/databaseDefaults.js";
import { createLogger } from "../logger/index.js";
import { ensureJobsRelatedSchema } from "../schema/ensureJobsRelatedSchema.js";
import { ensureEvidenceSchema } from "../schema/ensureEvidenceSchema.js";

const dbLog = createLogger("db");

const DATABASE_URI =
  process.env.DATABASE_URL?.trim() || databaseUrlFromParts();

/**
 * Per-statement timeout (ms) applied to the web API server's connection pool so
 * a runaway request query (e.g. an unbounded risks scan) cannot hold a
 * connection open forever. Defaults to 30s; override with PG_STATEMENT_TIMEOUT_MS
 * (0 disables it).
 */
const STATEMENT_TIMEOUT_MS = (() => {
  const raw = process.env.PG_STATEMENT_TIMEOUT_MS?.trim();
  if (raw === undefined || raw === "") return 30_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000;
})();

/**
 * The timeout must apply ONLY to the web request pool — one-off scripts,
 * migrations and the job worker run legitimately long queries and must not be
 * killed at 30s. We detect the web server by its entrypoint (`server.ts` in dev,
 * `server.js` in prod) rather than a flag, so no import-order coordination is
 * needed. A zero/negative timeout disables the guard everywhere.
 */
export function shouldApplyWebStatementTimeout(
  entry: string | undefined,
  timeoutMs: number,
): boolean {
  if (!(timeoutMs > 0)) return false;
  return /(^|[\\/])server\.(ts|js|mts|cts)$/.test(entry ?? "");
}

const APPLY_STATEMENT_TIMEOUT = shouldApplyWebStatementTimeout(
  process.argv[1],
  STATEMENT_TIMEOUT_MS,
);

const pool = new Pool({
  connectionString: DATABASE_URI,
  // pg sends `statement_timeout` as a startup parameter on each connection, so
  // it applies before the first query. Only the web server process sets it;
  // scripts/migrations/worker (and tests) leave it unset.
  ...(APPLY_STATEMENT_TIMEOUT
    ? { statement_timeout: STATEMENT_TIMEOUT_MS }
    : {}),
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
    await ensureEvidenceSchema(pool);
  } catch (err) {
    dbLog.error("Database connection failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
