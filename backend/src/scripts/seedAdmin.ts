import bcrypt from "bcryptjs";
import { eq, or } from "drizzle-orm";
import { db, pool } from "../database/db.js";
import { users } from "../schema/users/users.js";

const EMAIL = "admin@work.com";
const USERNAME = "Admin";
const PASSWORD = "12345678";
const SALT_ROUNDS = 12;

async function main() {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, EMAIL.toLowerCase()), eq(users.username, USERNAME)))
    .limit(1);

  if (existing) {
    console.log("Admin user already exists (email or username in use). Skipping.");
    await pool.end();
    process.exit(0);
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  await db.insert(users).values({
    email: EMAIL.toLowerCase(),
    username: USERNAME,
    passwordHash,
    fullName: "Administrator",
    accountStatus: "completed",
  });

  console.log(`Seeded user: ${EMAIL} / username: ${USERNAME}`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
