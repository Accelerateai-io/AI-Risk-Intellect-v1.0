import {
  boolean,
  index,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const ingestLinks = pgTable(
  "ingest_links",
  {
    id: serial("id").primaryKey(),
    url: varchar("url", { length: 2048 }).notNull().unique(),
    suggestedName: varchar("suggested_name", { length: 256 }),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ingest_links_archived_idx").on(table.archived),
    index("ingest_links_created_at_idx").on(table.createdAt),
  ],
);

export type IngestLink = typeof ingestLinks.$inferSelect;
export type NewIngestLink = typeof ingestLinks.$inferInsert;
