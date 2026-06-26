import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users/users.js";

/** Each row is one profile edit (self-service or admin), with field-level before/after in `changes`. */
export const userProfileUpdateLogs = pgTable(
  "user_profile_update_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    updatedByUserId: uuid("updated_by_user_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    changes: jsonb("changes")
      .notNull()
      .$type<Record<string, { from: unknown; to: unknown }>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("user_profile_update_logs_target_user_id_idx").on(table.targetUserId),
    index("user_profile_update_logs_created_at_idx").on(table.createdAt),
  ],
);

export type UserProfileUpdateLog = typeof userProfileUpdateLogs.$inferSelect;
export type NewUserProfileUpdateLog = typeof userProfileUpdateLogs.$inferInsert;
