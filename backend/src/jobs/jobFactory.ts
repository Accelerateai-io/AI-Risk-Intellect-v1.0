import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { articles } from "../schema/articles/articles.js";
import {
  jobs,
  type Job,
  type jobSourceEnum,
  type jobTypeEnum,
} from "../schema/jobs/jobs.js";
import { normalizeUrl } from "../utils/fetchUtils.js";
import {
  DO_NOT_EXECUTE_REASON,
  isUrlDoNotExecute,
} from "../services/jobs/urlExecutionBlocks.service.js";

/** Status values that mean the job is already in flight (port of Python ACTIVE_STATUSES). */
export const ACTIVE_JOB_STATUSES = ["pending", "running"] as const;

type JobSource = (typeof jobSourceEnum.enumValues)[number];
type JobType = (typeof jobTypeEnum.enumValues)[number];

type DbLike = Pick<typeof db, "select" | "insert" | "update">;

export type CreateJobInput = {
  url: string;
  articleId: number;
  jobType?: JobType;
  source?: JobSource;
  allowDuplicates?: boolean;
  ingestLinkId?: number | null;
  ingestLinkItemId?: number | null;
  batchRunId?: number | null;
  modelName?: string | null;
  modelLabel?: string | null;
};

export type CreateJobResult = {
  job: Job;
  created: boolean;
};

export type CreateArticleShellInput = {
  url: string;
  title?: string | null;
};

/** Re-export for callers that centralize on the job factory. */
export { normalizeUrl };

/** Stamp a batch onto an existing job so the Jobs BATCH column can show it. */
async function attachBatchToJob(
  conn: DbLike,
  job: Job,
  input: Pick<CreateJobInput, "batchRunId" | "modelName" | "modelLabel">,
): Promise<Job> {
  if (input.batchRunId == null) return job;
  if (job.batchRunId === input.batchRunId) return job;

  const patch: Partial<Job> = { batchRunId: input.batchRunId };
  const modelName = input.modelName?.trim();
  const modelLabel = input.modelLabel?.trim();
  if (modelName && !job.modelName?.trim()) patch.modelName = modelName;
  if (modelLabel && !job.modelLabel?.trim()) patch.modelLabel = modelLabel;

  const [updated] = await conn
    .update(jobs)
    .set(patch)
    .where(eq(jobs.id, job.id))
    .returning();
  return updated ?? { ...job, ...patch };
}

/**
 * Find an existing active job (pending or running) for the same URL and job type.
 * Port of `_find_existing_job` + `_apply_url_dedupe_filter` for non-AIID jobs.
 */
export async function findExistingActiveJob(
  conn: DbLike,
  options: { url: string; jobType?: JobType },
): Promise<Job | null> {
  const normalized = normalizeUrl(options.url);
  const jobType = options.jobType ?? "ingest";

  const [row] = await conn
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.url, normalized),
        eq(jobs.jobType, jobType),
        inArray(jobs.status, [...ACTIVE_JOB_STATUSES]),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Centralized job creation with URL normalization and active-job deduplication.
 * Port of `app.job_factory.create_job` (AIID context / batch omitted — not in schema yet).
 *
 * When a matching pending/running job exists, returns that job (`created: false`)
 * instead of inserting a duplicate — same as Python `create_job` returning `existing`.
 */
export async function createJob(
  conn: DbLike,
  input: CreateJobInput,
): Promise<CreateJobResult> {
  const url = normalizeUrl(input.url);
  if (!url) {
    throw new Error("Cannot create Job: missing URL.");
  }

  const jobType = input.jobType ?? "ingest";
  const source = input.source ?? "manual";

  if (await isUrlDoNotExecute(url)) {
    const [blockedExisting] = await conn
      .select()
      .from(jobs)
      .where(and(eq(jobs.url, url), eq(jobs.jobType, jobType)))
      .limit(1);
    if (blockedExisting) {
      return {
        job: await attachBatchToJob(conn, blockedExisting, input),
        created: false,
      };
    }

    const [skippedJob] = await conn
      .insert(jobs)
      .values({
        articleId: input.articleId,
        url,
        status: "skipped",
        errorMessage: DO_NOT_EXECUTE_REASON,
        jobType,
        source,
        ...(input.ingestLinkId != null
          ? { ingestLinkId: input.ingestLinkId }
          : {}),
        ...(input.ingestLinkItemId != null
          ? { ingestLinkItemId: input.ingestLinkItemId }
          : {}),
        ...(input.batchRunId != null ? { batchRunId: input.batchRunId } : {}),
        ...(input.modelName?.trim()
          ? { modelName: input.modelName.trim() }
          : {}),
        ...(input.modelLabel?.trim()
          ? { modelLabel: input.modelLabel.trim() }
          : {}),
      })
      .returning();

    if (!skippedJob) {
      throw new Error("Failed to create job.");
    }
    return { job: skippedJob, created: true };
  }

  if (!input.allowDuplicates) {
    if (input.ingestLinkItemId != null) {
      const [existingByItem] = await conn
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.ingestLinkItemId, input.ingestLinkItemId),
            eq(jobs.jobType, jobType),
          ),
        )
        .limit(1);
      if (existingByItem) {
        return {
          job: await attachBatchToJob(conn, existingByItem, input),
          created: false,
        };
      }
    }

    const existing = await findExistingActiveJob(conn, { url, jobType });
    if (existing) {
      return {
        job: await attachBatchToJob(conn, existing, input),
        created: false,
      };
    }
  }

  const [job] = await conn
    .insert(jobs)
    .values({
      articleId: input.articleId,
      url,
      status: "pending",
      jobType,
      source,
      ...(input.ingestLinkId != null
        ? { ingestLinkId: input.ingestLinkId }
        : {}),
      ...(input.ingestLinkItemId != null
        ? { ingestLinkItemId: input.ingestLinkItemId }
        : {}),
      ...(input.batchRunId != null ? { batchRunId: input.batchRunId } : {}),
      ...(input.modelName?.trim()
        ? { modelName: input.modelName.trim() }
        : {}),
      ...(input.modelLabel?.trim()
        ? { modelLabel: input.modelLabel.trim() }
        : {}),
    })
    .returning();

  if (!job) {
    throw new Error("Failed to create job.");
  }

  return { job, created: true };
}

/** Minimal article row for enqueue flows. */
export async function findOrCreateArticleShell(
  conn: DbLike,
  input: CreateArticleShellInput,
): Promise<{
  id: number;
  url: string;
  createdAt: Date;
  created: boolean;
}> {
  const url = normalizeUrl(input.url);
  const title = input.title?.trim() || null;

  const [existing] = await conn
    .select({
      id: articles.id,
      url: articles.url,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .where(eq(articles.url, url))
    .limit(1);

  if (existing) {
    return { ...existing, created: false };
  }

  const [article] = await conn
    .insert(articles)
    .values({
      url,
      title,
      rawText: null,
      html: null,
    })
    .returning({
      id: articles.id,
      url: articles.url,
      createdAt: articles.createdAt,
    });

  if (!article) {
    throw new Error("Failed to create article shell.");
  }

  return { ...article, created: true };
}

/**
 * Article shell + pending ingest job (discovery / admin queue).
 * Dedupes only active jobs, not completed or skipped history.
 */
export async function createArticleWithIngestJob(
  conn: DbLike,
  input: {
    url: string;
    source: JobSource;
    title?: string | null;
    allowDuplicates?: boolean;
    ingestLinkId?: number | null;
    ingestLinkItemId?: number | null;
    batchRunId?: number | null;
    modelName?: string | null;
    modelLabel?: string | null;
  },
): Promise<{
  article: { id: number; url: string; createdAt: Date };
  job: Job;
  articleCreated: boolean;
  jobCreated: boolean;
}> {
  const article = await findOrCreateArticleShell(conn, {
    url: input.url,
    title: input.title,
  });

  const { job, created: jobCreated } = await createJob(conn, {
    url: article.url,
    articleId: article.id,
    jobType: "ingest",
    source: input.source,
    allowDuplicates: input.allowDuplicates,
    ingestLinkId: input.ingestLinkId,
    ingestLinkItemId: input.ingestLinkItemId,
    batchRunId: input.batchRunId,
    modelName: input.modelName,
    modelLabel: input.modelLabel,
  });

  return {
    article: {
      id: article.id,
      url: article.url,
      createdAt: article.createdAt,
    },
    job,
    articleCreated: article.created,
    jobCreated,
  };
}
