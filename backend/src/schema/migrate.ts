import "../bootstrap.js";
import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../database/db.js";
import { createLogger } from "../logger/index.js";

const migrateLog = createLogger("migrate");

/** Resolves to `<backend>/drizzle` when `npm run db:migrate` is run from the backend package. */
const migrationsFolder = path.resolve(process.cwd(), "drizzle");

async function main() {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    migrateLog.error(
      `Missing migrations journal at ${journalPath}. Run "npm run db:generate" from the backend package first.`,
    );
    process.exit(1);
  }
  migrateLog.info("Running database migrations...");
  await migrate(db, { migrationsFolder });
  migrateLog.info("Migrations completed.");
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  migrateLog.error("Migration failed", { err });
  await pool.end();
  process.exit(1);
});
