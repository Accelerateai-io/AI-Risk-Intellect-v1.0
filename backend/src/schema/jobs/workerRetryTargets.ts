import { integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * URLs handed to the worker by a selected Retry.
 * While any row is active, the worker claims only these jobs.
 */
export const workerRetryTargets = pgTable("worker_retry_targets", {
  jobId: integer("job_id").primaryKey(),
  url: varchar("url", { length: 2048 }).notNull(),
  modelName: varchar("model_name", { length: 128 }),
  modelLabel: text("model_label"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
