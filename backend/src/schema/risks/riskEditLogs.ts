import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "../users/users.js";
import { risks } from "./risks.js";

/**
 * Each row is one human edit of a risk's reviewable fields, with field-level
 * before/after in `changes`. This is the provenance trail that distinguishes a
 * human-corrected value from the model's original extraction.
 *
 * Modeled on `user_profile_update_logs` (the established audit pattern in this repo).
 */
export const riskEditLogs = pgTable(
  "risk_edit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    riskId: uuid("risk_id")
      .notNull()
      .references(() => risks.id, { onDelete: "cascade" }),
    editedByUserId: uuid("edited_by_user_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason"),
    changes: jsonb("changes")
      .notNull()
      .$type<Record<string, { from: unknown; to: unknown }>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("risk_edit_logs_risk_id_idx").on(table.riskId),
    index("risk_edit_logs_created_at_idx").on(table.createdAt),
  ],
);

export type RiskEditLog = typeof riskEditLogs.$inferSelect;
export type NewRiskEditLog = typeof riskEditLogs.$inferInsert;
