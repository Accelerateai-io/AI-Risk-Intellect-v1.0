import {
  pgEnum,
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";

/** Invite / registration lifecycle; set to completed when the user sets a password. */
export const userAccountStatusEnum = pgEnum("user_account_status", [
  "pending",
  "completed",
  "expired",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    username: varchar("username", { length: 64 }).notNull().unique(),
    /** null until the invited user completes registration */
    passwordHash: text("password_hash"),
    fullName: varchar("full_name", { length: 255 }),
    accountStatus: userAccountStatusEnum("account_status")
      .notNull()
      .default("pending"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("users_email_idx").on(table.email),
    index("users_username_idx").on(table.username),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
