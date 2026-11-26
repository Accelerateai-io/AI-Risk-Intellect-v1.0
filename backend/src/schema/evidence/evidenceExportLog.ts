import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Evidence Bridge export log (outbox), spec v1.3 section 5: one row per exported
 * version of an Evidence Record v1. The export always serves the stored payload,
 * so re-reading a page never changes a hash. Rows are never updated or deleted.
 *
 * `checkpoint` is the export order. Only one writer runs at a time (Postgres
 * advisory lock), and it numbers rows from the committed maximum, so checkpoints
 * follow commit order and a reader can never skip a row that committed late.
 */
export const evidenceExportLog = pgTable(
  "evidence_export_log",
  {
    checkpoint: bigint("checkpoint", { mode: "number" }).primaryKey(),
    recordId: uuid("record_id").notNull(),
    version: integer("version").notNull(),
    airiRowId: uuid("airi_row_id").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    contentHash: varchar("content_hash", { length: 80 }).notNull(),
    /** The Evidence Record v1 as exported, without `checkpoint` (added on read). */
    payload: jsonb("payload").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("evidence_export_log_record_version_uq").on(table.recordId, table.version),
    index("evidence_export_log_record_id_idx").on(table.recordId),
  ],
);

export type EvidenceExportLogRow = typeof evidenceExportLog.$inferSelect;
