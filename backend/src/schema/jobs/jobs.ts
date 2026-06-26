import {
  pgEnum,
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { articles } from "../articles/articles.js";
import { ingestLinkItems } from "../ingestLinks/ingestLinkItems.js";
import { ingestLinks } from "../ingestLinks/ingestLinks.js";

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "done",
  "skipped",
  "error",
  /** @deprecated Use `done` */
  "completed",
  /** @deprecated Use `error` */
  "failed",
]);

export const jobTypeEnum = pgEnum("job_type", [
  "crawler",
  "indexer",
  "ingest",
]);

export const jobSourceEnum = pgEnum("job_source", [
  "rss",
  "api",
  "manual",
  "etl_reports",
]);

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    url: varchar("url", { length: 2048 }).notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    jobType: jobTypeEnum("job_type").notNull().default("ingest"),
    source: jobSourceEnum("source").notNull().default("manual"),
    ingestLinkId: integer("ingest_link_id").references(() => ingestLinks.id, {
      onDelete: "set null",
    }),
    ingestLinkItemId: integer("ingest_link_item_id").references(
      () => ingestLinkItems.id,
      { onDelete: "set null" },
    ),
    tries: integer("tries").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("jobs_article_id_idx").on(table.articleId),
    index("jobs_url_idx").on(table.url),
    index("jobs_status_idx").on(table.status),
    index("jobs_created_at_idx").on(table.createdAt),
    index("jobs_ingest_link_id_idx").on(table.ingestLinkId),
    index("jobs_ingest_link_item_id_idx").on(table.ingestLinkItemId),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
