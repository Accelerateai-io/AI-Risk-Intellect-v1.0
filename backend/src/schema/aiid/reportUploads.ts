import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const etlReportUploadStatuses = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;

export type EtlReportUploadStatus = (typeof etlReportUploadStatuses)[number];

export const etlReportUploads = pgTable(
  "etl_report_uploads",
  {
    id: serial("id").primaryKey(),
    suggestedName: varchar("suggested_name", { length: 256 }),
    reportFilePath: varchar("report_file_path", { length: 1024 }).notNull(),
    fileSha256: varchar("file_sha256", { length: 64 }),
    status: varchar("status", { length: 32 })
      .notNull()
      .default("processing")
      .$type<EtlReportUploadStatus>(),
    totalRows: integer("total_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),
    skippedRows: integer("skipped_rows").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
    errorMessage: text("error_message"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("etl_report_uploads_archived_idx").on(table.archived),
    index("etl_report_uploads_created_at_idx").on(table.createdAt),
    index("etl_report_uploads_status_idx").on(table.status),
    index("etl_report_uploads_file_sha256_idx").on(table.fileSha256),
  ],
);

export type EtlReportUpload = typeof etlReportUploads.$inferSelect;
export type NewEtlReportUpload = typeof etlReportUploads.$inferInsert;
