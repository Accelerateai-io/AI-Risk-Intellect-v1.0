import { index, integer, pgTable, serial, uniqueIndex } from "drizzle-orm/pg-core";
import { aiidRecordColumns } from "./recordColumns.js";
import { etlReportUploads } from "./reportUploads.js";

export const aiidReports = pgTable(
  "aiid_reports",
  {
    id: serial("id").primaryKey(),
    uploadId: integer("upload_id").references(() => etlReportUploads.id, {
      onDelete: "set null",
    }),
    ...aiidRecordColumns,
  },
  (table) => [
    index("aiid_reports_upload_id_idx").on(table.uploadId),
    uniqueIndex("aiid_reports_object_id_idx").on(table.objectId),
    uniqueIndex("aiid_reports_url_unique_idx").on(table.url),
    index("aiid_reports_report_number_idx").on(table.reportNumber),
    index("aiid_reports_date_published_idx").on(table.datePublished),
    index("aiid_reports_imported_at_idx").on(table.importedAt),
  ],
);

export type AiidReport = typeof aiidReports.$inferSelect;
export type NewAiidReport = typeof aiidReports.$inferInsert;
