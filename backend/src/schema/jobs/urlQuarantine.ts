import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/** URLs held back from LLM risk extraction until a human reprocesses them. */
export const urlQuarantine = pgTable("url_quarantine", {
  id: serial("id").primaryKey(),
  url: varchar("url", { length: 2048 }).notNull().unique(),
  title: text("title"),
  extractedText: text("extracted_text"),
  qualityScore: integer("quality_score"),
  validation: jsonb("validation"),
  reason: text("reason").notNull(),
  httpStatus: integer("http_status"),
  responseMeta: jsonb("response_meta"),
  sourceType: varchar("source_type", { length: 16 }),
  /** fetch_quarantine or extraction_quarantine; released after a later success. */
  status: varchar("status", { length: 32 }).notNull(),
  quarantinedAt: timestamp("quarantined_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
