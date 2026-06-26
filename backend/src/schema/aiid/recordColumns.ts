import { varchar, text, timestamp } from "drizzle-orm/pg-core";

/** Shared AIID report data columns (excluding surrogate integer `id`). */
export const aiidRecordColumns = {
  /** MongoDB ObjectId string from the source export. */
  objectId: varchar("object_id", { length: 24 }).notNull(),
  datePublished: timestamp("date_published", { withTimezone: true }),
  reportNumber: varchar("report_number", { length: 128 }),
  sourceDomain: varchar("source_domain", { length: 512 }),
  description: text("description"),
  title: text("title").notNull(),
  url: varchar("url", { length: 2048 }).notNull(),
  tags: text("tags").array(),
  createdDate: timestamp("created_date", { withTimezone: true }),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};
