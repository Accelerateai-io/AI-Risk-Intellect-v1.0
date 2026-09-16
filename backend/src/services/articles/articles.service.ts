import { and, asc, desc, eq, gt, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { decodeDisplayTitle } from "../../utils/decodeHtmlEntities.js";
import type { ListArticlesQuery } from "../../validators/articles.validators.js";

export type ArticleListItem = {
  id: number;
  title: string | null;
  url: string;
  riskCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ArticleListMetrics = {
  total: number;
  risksExtracted: number;
  avgRisksPerArticle: number;
};

export type ArticleListPagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

function buildArticleFilters(query: ListArticlesQuery): SQL | undefined {
  const parts: SQL[] = [];
  const search = query.search.trim();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const textMatch = or(
      ilike(articles.title, pattern),
      ilike(articles.url, pattern),
      sql`(${articles.id})::text ilike ${pattern}`,
    );
    if (textMatch) parts.push(textMatch);
  }
  if (query.risks === "with") parts.push(gt(articles.riskCount, 0));
  if (query.risks === "none") parts.push(eq(articles.riskCount, 0));
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : and(...parts);
}

const ARTICLE_METRICS_TTL_MS = 15_000;
const EMPTY_ARTICLE_METRICS: ArticleListMetrics = {
  total: 0,
  risksExtracted: 0,
  avgRisksPerArticle: 0,
};
let articleMetricsCache: { at: number; value: ArticleListMetrics } | null =
  null;

async function unfilteredArticleMetrics(): Promise<ArticleListMetrics> {
  const now = Date.now();
  if (
    articleMetricsCache &&
    now - articleMetricsCache.at < ARTICLE_METRICS_TTL_MS
  ) {
    return articleMetricsCache.value;
  }
  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      risksExtracted: sql<number>`coalesce(sum(${articles.riskCount}), 0)::int`,
    })
    .from(articles);
  const total = agg?.total ?? 0;
  const risksExtracted = agg?.risksExtracted ?? 0;
  const value: ArticleListMetrics = {
    total,
    risksExtracted,
    avgRisksPerArticle: total > 0 ? risksExtracted / total : 0,
  };
  articleMetricsCache = { at: now, value };
  return value;
}

export async function listArticles(query: ListArticlesQuery): Promise<{
  articles: ArticleListItem[];
  metrics: ArticleListMetrics;
  pagination: ArticleListPagination;
}> {
  const filters = buildArticleFilters(query);
  const orderBy =
    query.order === "oldest"
      ? asc(articles.createdAt)
      : desc(articles.createdAt);
  const offset = query.page * query.pageSize;
  const skipTotals = query.page > 0;

  const pageQuery = db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      riskCount: articles.riskCount,
      createdAt: articles.createdAt,
      updatedAt: articles.updatedAt,
    })
    .from(articles)
    .where(filters)
    .orderBy(orderBy)
    .limit(query.pageSize)
    .offset(offset);

  let rows;
  let filteredTotal: number;
  let metrics: ArticleListMetrics;

  if (skipTotals) {
    rows = await pageQuery;
    filteredTotal = 0;
    metrics = EMPTY_ARTICLE_METRICS;
  } else {
    const metricsPromise = unfilteredArticleMetrics();
    [rows, filteredTotal, metrics] = await Promise.all([
      pageQuery,
      filters
        ? db
            .select({ total: sql<number>`count(*)::int` })
            .from(articles)
            .where(filters)
            .then((countRows) => countRows[0]?.total ?? 0)
        : metricsPromise.then((m) => m.total),
      metricsPromise,
    ]);
  }

  const pageCount = Math.max(1, Math.ceil(filteredTotal / query.pageSize));

  return {
    articles: rows.map((row) => ({
      ...row,
      title: row.title ? decodeDisplayTitle(row.title) : null,
    })),
    metrics,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: filteredTotal,
      pageCount,
    },
  };
}
