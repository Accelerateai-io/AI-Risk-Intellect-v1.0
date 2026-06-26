import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";

export const articles = pgTable(
  "articles",
  {
    id: serial("id").primaryKey(),
    url: varchar("url", { length: 2048 }).notNull().unique(),
    title: text("title"),
    rawText: text("raw_text"),
    html: text("html"),
    /** SHA-256 of `raw_text` for content deduplication. */
    sha256: varchar("sha256", { length: 64 }),
    riskCount: integer("risk_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("articles_url_idx").on(table.url),
    index("articles_sha256_idx").on(table.sha256),
    index("articles_created_at_idx").on(table.createdAt),
  ],
);

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
