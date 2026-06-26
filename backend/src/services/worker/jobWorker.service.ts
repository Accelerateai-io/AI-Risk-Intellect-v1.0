import { asc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { createLogger } from "../../logger/index.js";

const jobLog = createLogger("job");
import { articles } from "../../schema/articles/articles.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { extractRiskForArticle } from "./extractRisk.service.js";
import { processUrlToDb } from "./processUrl.service.js";

export type ClaimedJob = {
  id: number;
  articleId: number;
  url: string;
  source: "manual" | "rss" | "api" | "etl_reports";
  tries: number;
};

/** Claim one pending job: pending → running (increments tries). */
export async function claimNextJob(): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({
        id: jobs.id,
        articleId: jobs.articleId,
        url: jobs.url,
        source: jobs.source,
        tries: jobs.tries,
      })
      .from(jobs)
      .where(eq(jobs.status, "pending"))
      .orderBy(asc(jobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!pending) {
      return null;
    }

    const runStartedAt = new Date();
    const [claimed] = await tx
      .update(jobs)
      .set({
        status: "running",
        tries: sql`${jobs.tries} + 1`,
        startedAt: runStartedAt,
        updatedAt: runStartedAt,
      })
      .where(eq(jobs.id, pending.id))
      .returning({
        id: jobs.id,
        articleId: jobs.articleId,
        url: jobs.url,
        source: jobs.source,
        tries: jobs.tries,
      });

    return claimed ?? null;
  });
}

async function finishJob(
  jobId: number,
  status: "done" | "skipped" | "error",
  errorMessage: string | null,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status,
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

/**
 * Process one claimed job through the status machine:
 * running → done | skipped | error
 */
export async function processClaimedJob(job: ClaimedJob): Promise<void> {
  const log = (msg: string, extra?: Record<string, unknown>) => {
    jobLog.info(msg, { jobId: job.id, ...extra });
  };

  try {
    const [articleRow] = await db
      .select({ title: articles.title })
      .from(articles)
      .where(eq(articles.id, job.articleId))
      .limit(1);

    log("ingest start", { url: job.url, jobSource: job.source });
    const ingest = await processUrlToDb(job.url, job.articleId, {
      title: articleRow?.title ?? undefined,
    });

    if (ingest.outcome === "skipped") {
      log("ingest skipped", { reason: ingest.reason });
      await finishJob(job.id, "skipped", ingest.reason);
      return;
    }

    log("ingest done", { articleId: ingest.articleId });
    log("risk extract start", { articleId: job.articleId });
    const extract = await extractRiskForArticle(job.articleId);
    if (extract.outcome === "skipped") {
      log("risk extract skipped", { reason: extract.reason });
      await finishJob(job.id, "skipped", extract.reason);
      return;
    }

    log(
      extract.created ? "done" : "done (risk already exists for this model)",
      { riskId: extract.riskId, created: extract.created },
    );
    await finishJob(job.id, "done", null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobLog.error("Job failed", { jobId: job.id, message, err });
    await finishJob(job.id, "error", message);
  }
}

/** Claim and process a single job, if any are pending. */
export async function runOneJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) {
    return false;
  }
  await processClaimedJob(job);
  return true;
}

/** True when at least one ingest job is waiting to run. */
export async function hasPendingJobs(): Promise<boolean> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.status, "pending"))
    .limit(1);

  return row != null;
}
