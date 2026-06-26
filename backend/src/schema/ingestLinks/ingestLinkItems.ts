import {
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { ingestLinks } from "./ingestLinks.js";

export const ingestLinkItems = pgTable(
  "ingest_link_items",
  {
    id: serial("id").primaryKey(),
    ingestLinkId: integer("ingest_link_id")
      .notNull()
      .references(() => ingestLinks.id, { onDelete: "cascade" }),
    url: varchar("url", { length: 2048 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ingest_link_items_feed_url_uidx").on(
      table.ingestLinkId,
      table.url,
    ),
    index("ingest_link_items_ingest_link_id_idx").on(table.ingestLinkId),
  ],
);

export type IngestLinkItem = typeof ingestLinkItems.$inferSelect;
export type NewIngestLinkItem = typeof ingestLinkItems.$inferInsert;
