import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const batchRunStatusEnum = pgEnum("batch_run_status", [
  "pending",
  "running",
  "completed",
  "partial",
  "failed",
]);

export const batchRuns = pgTable(
  "batch_runs",
  {
    id: serial("id").primaryKey(),
    modelName: varchar("model_name", { length: 128 }).notNull(),
    modelLabel: text("model_label"),
    status: batchRunStatusEnum("status").notNull().default("pending"),
    rssItemCount: integer("rss_item_count").notNull().default(0),
    etlItemCount: integer("etl_item_count").notNull().default(0),
    errorMessage: text("error_message"),
    disabled: boolean("disabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("batch_runs_status_idx").on(table.status),
    index("batch_runs_created_at_idx").on(table.createdAt),
    index("batch_runs_model_name_idx").on(table.modelName),
  ],
);

export type BatchRun = typeof batchRuns.$inferSelect;
export type NewBatchRun = typeof batchRuns.$inferInsert;
