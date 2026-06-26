import { desc, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { risks } from "../../schema/risks/risks.js";

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

export async function listJobs(): Promise<{
  jobs: JobListItem[];
  metrics: JobListMetrics;
}> {
  const rows = await db
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
    })
    .from(jobs)
    .orderBy(desc(jobs.createdAt));

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

  const rowsWithRiskFetchedAt: JobListItem[] = rows.map((row) => ({
    ...row,
    riskFetchedAt: riskFetchedAtByArticleId.get(row.articleId) ?? null,
  }));

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
  };
}
