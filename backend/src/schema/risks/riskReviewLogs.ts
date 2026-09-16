import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  index,
} from "drizzle-orm/pg-core";
import { users } from "../users/users.js";
import { risks } from "./risks.js";

/**
 * One row per human review feedback submission (raw / structured / move / update).
 * Complements `extraction_json.review_feedback` with a durable audit trail.
 */
export const riskReviewLogs = pgTable(
  "risk_review_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    riskId: uuid("risk_id")
      .notNull()
      .references(() => risks.id, { onDelete: "cascade" }),
    submittedByUserId: uuid("submitted_by_user_id")
      .notNull()
      .references(() => users.id),
    action: varchar("action", { length: 32 }).notNull(),
    classification: varchar("classification", { length: 16 }),
    feedback: text("feedback").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("risk_review_logs_risk_id_idx").on(table.riskId),
    index("risk_review_logs_created_at_idx").on(table.createdAt),
  ],
);

export type RiskReviewLog = typeof riskReviewLogs.$inferSelect;
export type NewRiskReviewLog = typeof riskReviewLogs.$inferInsert;
