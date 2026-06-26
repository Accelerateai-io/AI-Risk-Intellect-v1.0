import "../bootstrap.js";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, pool } from "../database/db.js";
import { users } from "../schema/users/users.js";

const SALT_ROUNDS = 12;
const PASSWORD = "12345678";

const KEEP_USERS = [
  {
    email: "admin@work.com",
    username: "Admin",
    fullName: "Administrator",
  },
  {
    email: "asad@accelerateai.io",
    username: "Asad",
    fullName: "Asad",
  },
] as const;

/** Reference tables preserved during reset (e.g. catalog loaded via pg_restore). */
const PRESERVED_TABLES = ["risk_mappings"] as const;

async function truncateAllTables() {
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

async function seedUsers() {
  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  for (const user of KEEP_USERS) {
    await db.insert(users).values({
      email: user.email.toLowerCase(),
      username: user.username,
      passwordHash,
      fullName: user.fullName,
      accountStatus: "completed",
      isActive: true,
    });
  }
}

async function main() {
  console.log(
    `Truncating all tables (preserving: ${PRESERVED_TABLES.join(", ")})...`,
  );
  await truncateAllTables();

  console.log("Seeding users...");
  await seedUsers();

  for (const user of KEEP_USERS) {
    console.log(`  ${user.email} / username: ${user.username} / password: ${PASSWORD}`);
  }

  console.log("Database reset complete.");
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
