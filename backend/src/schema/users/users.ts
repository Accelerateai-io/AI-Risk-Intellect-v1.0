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

/** Application role. `admin` may edit reviewable risk fields. */
export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);
export type UserRole = (typeof userRoleEnum.enumValues)[number];

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
    role: userRoleEnum("role").notNull().default("user"),
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
    index("users_role_idx").on(table.role),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
