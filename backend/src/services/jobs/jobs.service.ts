import { and, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { batchRunItems } from "../../schema/batchRuns/batchRunItems.js";
import { batchRuns } from "../../schema/batchRuns/batchRuns.js";
import { risks } from "../../schema/risks/risks.js";
import { llmObservability } from "../../schema/observability/llmObservability.js";
import { urlExecutionBlocks } from "../../schema/jobs/urlExecutionBlocks.js";
import { HttpError } from "../../utils/httpError.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";
import type { ListJobsQuery } from "../../validators/jobs.validators.js";
import { getDoNotExecuteBlocks } from "./urlExecutionBlocks.service.js";
import { skipStaleRunningJobs } from "./jobTimeout.service.js";

export type JobListItem = {
  id: number;
  articleId: number;
  url: string;
  status: string;
  jobType: string;
  source: string;
  tries: number;
  errorMessage: string | null;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  riskFetchedAt: Date | null;
  llmDurationMs: number | null;
  wordCount: number | null;
  doNotExecute: boolean;
  assignedModelName: string | null;
  assignedModelLabel: string | null;
  batchRunId: number | null;
  batchName: string | null;
  modelName: string | null;
  modelLabel: string | null;
};

export type JobListPagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

export type JobListMetrics = {
  total: number;
  successRate: number;
  pending: number;
  failed: number;
  running: number;
  completed24h: number;
  avgProcessingSeconds: number;
  skipped: number;
};

function batchDisplayName(batchRunId: number): string {
  return `Batch #${batchRunId}`;
}

function batchStatusPriority(status: string): number {
  const value = status.toLowerCase();
  if (value === "running") return 0;
  if (value === "pending") return 1;
  return 2;
}

async function resolveBatchNamesForJobs(
  rows: Array<{
    id: number;
    url: string;
    ingestLinkItemId: number | null;
    batchRunId: number | null;
  }>,
): Promise<Map<number, { batchRunId: number; batchName: string }>> {
  const names = new Map<number, { batchRunId: number; batchName: string }>();
  for (const row of rows) {
    if (row.batchRunId == null) continue;
    names.set(row.id, {
      batchRunId: row.batchRunId,
      batchName: batchDisplayName(row.batchRunId),
    });
  }

  const missing = rows.filter((row) => row.batchRunId == null);
  if (missing.length === 0) return names;

  const urls = [...new Set(missing.map((row) => row.url).filter(Boolean))];
  const ingestIds = [
    ...new Set(
      missing
        .map((row) => row.ingestLinkItemId)
        .filter((id): id is number => id != null),
    ),
  ];

  const filters = [];
  if (urls.length > 0) filters.push(inArray(batchRunItems.url, urls));
  if (ingestIds.length > 0) {
    filters.push(inArray(batchRunItems.ingestLinkItemId, ingestIds));
  }
  if (filters.length === 0) return names;

  const itemRows = await db
    .select({
      id: batchRunItems.id,
      batchRunId: batchRunItems.batchRunId,
      url: batchRunItems.url,
      ingestLinkItemId: batchRunItems.ingestLinkItemId,
      batchStatus: batchRuns.status,
    })
    .from(batchRunItems)
    .innerJoin(batchRuns, eq(batchRuns.id, batchRunItems.batchRunId))
    .where(or(...filters))
    .orderBy(desc(batchRunItems.id));

  type Candidate = { batchRunId: number; priority: number; itemId: number };
  const byIngest = new Map<number, Candidate>();
  const byUrl = new Map<string, Candidate>();

  function keepBest<K>(map: Map<K, Candidate>, key: K, next: Candidate) {
    const prev = map.get(key);
    if (
      !prev ||
      next.priority < prev.priority ||
      (next.priority === prev.priority && next.itemId > prev.itemId)
    ) {
      map.set(key, next);
    }
  }

  for (const item of itemRows) {
    const candidate: Candidate = {
      batchRunId: item.batchRunId,
      priority: batchStatusPriority(item.batchStatus),
      itemId: item.id,
    };
    if (item.ingestLinkItemId != null) {
      keepBest(byIngest, item.ingestLinkItemId, candidate);
    }
    const keys = new Set<string>([item.url, item.url.trim()]);
    try {
      keys.add(normalizeUrl(item.url));
    } catch {
      // keep raw URL keys
    }
    for (const key of keys) {
      if (key) keepBest(byUrl, key, candidate);
    }
  }

  for (const row of missing) {
    const candidate =
      (row.ingestLinkItemId != null ? byIngest.get(row.ingestLinkItemId) : undefined) ??
      byUrl.get(row.url);
    if (!candidate) continue;
    names.set(row.id, {
      batchRunId: candidate.batchRunId,
      batchName: batchDisplayName(candidate.batchRunId),
    });
  }

  return names;
}

function isMissingJobsListSchemaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /does not exist/i.test(message) &&
    /batch_runs|batch_run_items|batch_run_id|model_name|model_label|url_execution_blocks|llm_observability/i.test(
      message,
    )
  );
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildJobFilters(
  query: ListJobsQuery,
  options?: { includeExtendedSearch?: boolean },
): SQL | undefined {
  const includeExtended = options?.includeExtendedSearch !== false;
  const parts: SQL[] = [];

  if (query.status !== "all") {
    if (query.status === "done") {
      parts.push(inArray(jobs.status, ["done", "completed"]));
    } else if (query.status === "error") {
      parts.push(inArray(jobs.status, ["error", "failed"]));
    } else {
      parts.push(eq(jobs.status, query.status));
    }
  }

  if (query.type !== "all") {
    parts.push(eq(jobs.jobType, query.type));
  }

  if (query.source !== "all") {
    if (query.source === "etl_reports") {
      parts.push(inArray(jobs.source, ["etl_reports", "api"]));
    } else {
      parts.push(eq(jobs.source, query.source));
    }
  }

  if (includeExtended && query.execution === "do_not_execute") {
    parts.push(
      exists(
        db
          .select({ id: urlExecutionBlocks.id })
          .from(urlExecutionBlocks)
          .where(eq(urlExecutionBlocks.url, jobs.url)),
      ),
    );
  }

  const search = query.search.trim();
  if (search) {
    const pattern = `%${escapeIlikePattern(search)}%`;
    const searchParts: SQL[] = [
      ilike(jobs.url, pattern),
      sql`(${jobs.id})::text ilike ${pattern}`,
      sql`(${jobs.status})::text ilike ${pattern}`,
      sql`(${jobs.jobType})::text ilike ${pattern}`,
      sql`(${jobs.source})::text ilike ${pattern}`,
      ilike(jobs.errorMessage, pattern),
    ];
    if (includeExtended) {
      searchParts.push(
        ilike(jobs.modelName, pattern),
        ilike(jobs.modelLabel, pattern),
        sql`('Batch #' || COALESCE(${jobs.batchRunId}::text, '')) ilike ${pattern}`,
      );
    }
    const textMatch = or(...searchParts);
    if (textMatch) parts.push(textMatch);
  }

  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : and(...parts);
}

type JobListQueryRow = {
  id: number;
  articleId: number;
  url: string;
  status: string;
  jobType: string;
  source: string;
  tries: number;
  errorMessage: string | null;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ingestLinkItemId: number | null;
  batchRunId: number | null;
  jobModelName: string | null;
  jobModelLabel: string | null;
  batchModelName: string | null;
  batchModelLabel: string | null;
};

async function loadJobListRows(query: ListJobsQuery): Promise<{
  rows: JobListQueryRow[];
  filteredTotal: number;
}> {
  const filters = buildJobFilters(query);
  const offset = query.page * query.pageSize;

  try {
    const [rows, [filtered]] = await Promise.all([
      db
        .select({
          id: jobs.id,
          articleId: jobs.articleId,
          url: jobs.url,
          status: jobs.status,
          jobType: jobs.jobType,
          source: jobs.source,
          tries: jobs.tries,
          errorMessage: jobs.errorMessage,
          startedAt: jobs.startedAt,
          createdAt: jobs.createdAt,
          updatedAt: jobs.updatedAt,
          ingestLinkItemId: jobs.ingestLinkItemId,
          batchRunId: jobs.batchRunId,
          jobModelName: jobs.modelName,
          jobModelLabel: jobs.modelLabel,
          batchModelName: batchRuns.modelName,
          batchModelLabel: batchRuns.modelLabel,
        })
        .from(jobs)
        .leftJoin(batchRuns, eq(jobs.batchRunId, batchRuns.id))
        .where(filters)
        .orderBy(desc(jobs.createdAt))
        .limit(query.pageSize)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(jobs)
        .where(filters),
    ]);

    return { rows, filteredTotal: filtered?.total ?? 0 };
  } catch (err) {
    if (!isMissingJobsListSchemaError(err)) throw err;

    const fallbackFilters = buildJobFilters(query, {
      includeExtendedSearch: false,
    });
    const [rows, [filtered]] = await Promise.all([
      db
        .select({
          id: jobs.id,
          articleId: jobs.articleId,
          url: jobs.url,
          status: jobs.status,
          jobType: jobs.jobType,
          source: jobs.source,
          tries: jobs.tries,
          errorMessage: jobs.errorMessage,
          startedAt: jobs.startedAt,
          createdAt: jobs.createdAt,
          updatedAt: jobs.updatedAt,
          ingestLinkItemId: jobs.ingestLinkItemId,
        })
        .from(jobs)
        .where(fallbackFilters)
        .orderBy(desc(jobs.createdAt))
        .limit(query.pageSize)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(jobs)
        .where(fallbackFilters),
    ]);

    return {
      rows: rows.map((row) => ({
        ...row,
        batchRunId: null,
        jobModelName: null,
        jobModelLabel: null,
        batchModelName: null,
        batchModelLabel: null,
      })),
      filteredTotal: filtered?.total ?? 0,
    };
  }
}


const DEFAULT_LIST_JOBS_QUERY: ListJobsQuery = {
  page: 0,
  pageSize: 100,
  search: "",
  status: "all",
  type: "all",
  source: "all",
  execution: "all",
};

export async function listJobs(query: ListJobsQuery = DEFAULT_LIST_JOBS_QUERY): Promise<{
  jobs: JobListItem[];
  metrics: JobListMetrics;
  pagination: JobListPagination;
}> {
  try {
    await skipStaleRunningJobs();
  } catch {
    // Listing jobs should still succeed if the timeout skip cannot run.
  }

  const { rows, filteredTotal } = await loadJobListRows(query);

  const articleIds = [...new Set(rows.map((row) => row.articleId).filter((id) => id > 0))];
  let riskFetchedAtByArticleId = new Map<number, Date>();
  if (articleIds.length > 0) {
    const riskRows = await db
      .select({
        articleId: risks.articleId,
        riskFetchedAt: sql<Date>`max(${risks.createdAt})`,
      })
      .from(risks)
      .where(inArray(risks.articleId, articleIds))
      .groupBy(risks.articleId);

    riskFetchedAtByArticleId = new Map(
      riskRows
        .filter((row) => row.riskFetchedAt)
        .map((row) => [row.articleId, row.riskFetchedAt]),
    );
  }

  const urls = [...new Set(rows.map((row) => row.url).filter(Boolean))];
  let blockedByUrl = new Map<
    string,
    { modelName: string | null; modelLabel: string | null }
  >();
  try {
    blockedByUrl = await getDoNotExecuteBlocks(urls);
  } catch {
    blockedByUrl = new Map();
  }
  const llmByUrl = new Map<string, { durationMs: number; wordCount: number }>();
  if (urls.length > 0) {
    try {
      const obsRows = await db
        .select({
          url: llmObservability.url,
          durationMs: llmObservability.durationMs,
          wordCount: llmObservability.wordCount,
          createdAt: llmObservability.createdAt,
        })
        .from(llmObservability)
        .where(inArray(llmObservability.url, urls))
        .orderBy(desc(llmObservability.createdAt));

      for (const row of obsRows) {
        if (llmByUrl.has(row.url)) continue;
        llmByUrl.set(row.url, {
          durationMs: row.durationMs,
          wordCount: row.wordCount,
        });
      }
    } catch {
      // Observability is optional for the Jobs list.
    }
  }

  let batchNames = new Map<number, { batchRunId: number; batchName: string }>();
  try {
    batchNames = await resolveBatchNamesForJobs(rows);
  } catch {
    batchNames = new Map();
  }

  const rowsWithRiskFetchedAt: JobListItem[] = rows.map((row) => {
    const llm = llmByUrl.get(row.url);
    const resolvedBatch = batchNames.get(row.id);
    const batchRunId = row.batchRunId ?? resolvedBatch?.batchRunId ?? null;
    const modelName = row.jobModelName?.trim() || row.batchModelName?.trim() || null;
    const modelLabel = row.jobModelLabel?.trim() || row.batchModelLabel?.trim() || modelName;
    const blocked = blockedByUrl.get(row.url);
    const assignedModelName = blocked?.modelName || modelName;
    const assignedModelLabel = blocked?.modelLabel || modelLabel || assignedModelName;
    return {
      id: row.id,
      articleId: row.articleId,
      url: row.url,
      status: row.status,
      jobType: row.jobType,
      source: row.source,
      tries: row.tries,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      riskFetchedAt: riskFetchedAtByArticleId.get(row.articleId) ?? null,
      llmDurationMs: llm?.durationMs ?? null,
      wordCount: llm?.wordCount ?? null,
      doNotExecute: blocked != null,
      assignedModelName,
      assignedModelLabel,
      batchRunId,
      batchName: resolvedBatch?.batchName ?? (batchRunId != null ? batchDisplayName(batchRunId) : null),
      modelName,
      modelLabel,
    };
  });

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${jobs.status} = 'pending')::int`,
      running: sql<number>`count(*) filter (where ${jobs.status} = 'running')::int`,
      done: sql<number>`count(*) filter (where ${jobs.status} in ('done', 'completed'))::int`,
      error: sql<number>`count(*) filter (where ${jobs.status} in ('error', 'failed'))::int`,
      skipped: sql<number>`count(*) filter (where ${jobs.status} = 'skipped')::int`,
      done24h: sql<number>`count(*) filter (where ${jobs.status} in ('done', 'completed') and ${jobs.updatedAt} >= ${since24h})::int`,
    })
    .from(jobs);

  const total = counts?.total ?? 0;
  const done = counts?.done ?? 0;

  return {
    jobs: rowsWithRiskFetchedAt,
    metrics: {
      total,
      successRate: total > 0 ? Math.round((done / total) * 100) : 0,
      pending: counts?.pending ?? 0,
      failed: counts?.error ?? 0,
      running: counts?.running ?? 0,
      completed24h: counts?.done24h ?? 0,
      avgProcessingSeconds: 0,
      skipped: counts?.skipped ?? 0,
    },
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: filteredTotal,
      pageCount: Math.max(1, Math.ceil(filteredTotal / query.pageSize)),
    },
  };
}

export async function deleteJob(jobId: number): Promise<{ id: number }> {
  const [job] = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job) {
    throw HttpError.notFound("Job not found.");
  }

  if (job.status === "running") {
    throw HttpError.conflict(
      "This job is still running. Wait for it to finish, then delete it.",
    );
  }

  await db.delete(jobs).where(eq(jobs.id, jobId));
  return { id: job.id };
}
