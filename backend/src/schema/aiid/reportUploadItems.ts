import {
  index,
  integer,
  pgTable,
  serial,
  text,
  varchar,
} from "drizzle-orm/pg-core";
import { etlReportUploads } from "./reportUploads.js";

export const etlReportUploadItemStatuses = [
  "imported",
  "skipped_existing",
  "skipped_duplicate_in_file",
  "skipped_invalid",
  "failed",
] as const;

export type EtlReportUploadItemStatus =
  (typeof etlReportUploadItemStatuses)[number];

export const etlReportUploadItems = pgTable(
  "etl_report_upload_items",
  {
    id: serial("id").primaryKey(),
    uploadId: integer("upload_id")
      .notNull()
      .references(() => etlReportUploads.id, { onDelete: "cascade" }),
    rowOrder: integer("row_order").notNull(),
    objectId: varchar("object_id", { length: 24 }),
    url: varchar("url", { length: 2048 }).notNull(),
    title: text("title"),
    extractionStatus: varchar("extraction_status", { length: 32 })
      .notNull()
      .$type<EtlReportUploadItemStatus>(),
    skipReason: text("skip_reason"),
  },
  (table) => [
    index("etl_report_upload_items_upload_id_idx").on(table.uploadId),
    index("etl_report_upload_items_upload_row_idx").on(
      table.uploadId,
      table.rowOrder,
    ),
  ],
);

export type EtlReportUploadItem = typeof etlReportUploadItems.$inferSelect;
export type NewEtlReportUploadItem = typeof etlReportUploadItems.$inferInsert;
