import {
  pgEnum,
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { articles } from "../articles/articles.js";
import { batchRuns } from "../batchRuns/batchRuns.js";
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
    batchRunId: integer("batch_run_id").references(() => batchRuns.id, {
      onDelete: "set null",
    }),
    /** LLM model assigned when the job was queued (not the live Controls model). */
    modelName: varchar("model_name", { length: 128 }),
    modelLabel: text("model_label"),
    tries: integer("tries").notNull().default(0),
    // Force-reprocess (B-3): when true the worker bypasses dedup and inserts a
    // NEW risk row (linked via risks.supersedes_id) instead of returning the
    // existing one. Default false keeps normal ingest behaviour.
    forceReprocess: boolean("force_reprocess").notNull().default(false),
    errorMessage: text("error_message"),
    /**
     * Machine-readable outcome for a skipped job (B-4): e.g. FETCH_FAIL (the page
     * could not be fetched as real content) or NOT_AI (fetched fine but no
     * AI-relevant risk). Null for non-skip terminal states. Lets ops aggregate
     * why jobs produced no risk row without parsing `error_message`.
     */
    skipReasonCode: varchar("skip_reason_code", { length: 32 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Set once when this job reaches a terminal status. Later risks must not move it. */
    finishedAt: timestamp("finished_at", { withTimezone: true }),
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
    index("jobs_batch_run_id_idx").on(table.batchRunId),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
