import {
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { aiidReports } from "../aiid/reports.js";
import { etlReportUploads } from "../aiid/reportUploads.js";
import { ingestLinkItems } from "../ingestLinks/ingestLinkItems.js";
import { ingestLinks } from "../ingestLinks/ingestLinks.js";
import { batchRuns } from "./batchRuns.js";

export const batchRunItemSourceEnum = pgEnum("batch_run_item_source", [
  "rss",
  "etl",
]);

export const batchRunItemStatusEnum = pgEnum("batch_run_item_status", [
  "pending",
  "started",
  "failed",
]);

export const batchRunItems = pgTable(
  "batch_run_items",
  {
    id: serial("id").primaryKey(),
    batchRunId: integer("batch_run_id")
      .notNull()
      .references(() => batchRuns.id, { onDelete: "cascade" }),
    sourceType: batchRunItemSourceEnum("source_type").notNull(),
    ingestLinkId: integer("ingest_link_id").references(() => ingestLinks.id, {
      onDelete: "set null",
    }),
    ingestLinkItemId: integer("ingest_link_item_id").references(
      () => ingestLinkItems.id,
      { onDelete: "set null" },
    ),
    feedName: text("feed_name"),
    uploadId: integer("upload_id").references(() => etlReportUploads.id, {
      onDelete: "set null",
    }),
    reportId: integer("report_id").references(() => aiidReports.id, {
      onDelete: "set null",
    }),
    url: varchar("url", { length: 2048 }).notNull(),
    title: text("title"),
    status: batchRunItemStatusEnum("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("batch_run_items_batch_run_id_idx").on(table.batchRunId),
    index("batch_run_items_source_type_idx").on(table.sourceType),
    index("batch_run_items_ingest_link_id_idx").on(table.ingestLinkId),
    index("batch_run_items_upload_id_idx").on(table.uploadId),
    index("batch_run_items_report_id_idx").on(table.reportId),
  ],
);

export type BatchRunItem = typeof batchRunItems.$inferSelect;
export type NewBatchRunItem = typeof batchRunItems.$inferInsert;
