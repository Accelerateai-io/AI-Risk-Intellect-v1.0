import { desc, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { risks } from "../../schema/risks/risks.js";
import {
  persistEnglishArticleTitle,
  resolveEnglishArticleTitle,
} from "./articleTitleLocalization.js";

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

function readEnglishArticleTitleFromExtraction(extractionJson: unknown): string | null {
  const ext = (extractionJson ?? {}) as {
    english_article_title?: string;
  };
  const title = ext.english_article_title?.trim();
  return title || null;
}

async function loadLatestRiskExtractionByArticleId(): Promise<
  Map<number, unknown>
> {
  const riskRows = await db
    .select({
      articleId: risks.articleId,
      extractionJson: risks.extractionJson,
      createdAt: risks.createdAt,
    })
    .from(risks)
    .orderBy(desc(risks.createdAt));

  const latestByArticle = new Map<number, unknown>();
  for (const row of riskRows) {
    if (!latestByArticle.has(row.articleId)) {
      latestByArticle.set(row.articleId, row.extractionJson);
    }
  }
  return latestByArticle;
}

export async function listArticles(): Promise<{
  articles: ArticleListItem[];
  metrics: ArticleListMetrics;
}> {
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      rawText: articles.rawText,
      url: articles.url,
      riskCount: articles.riskCount,
      createdAt: articles.createdAt,
      updatedAt: articles.updatedAt,
    })
    .from(articles)
    .orderBy(desc(articles.createdAt));

  const latestRiskExtractionByArticleId =
    await loadLatestRiskExtractionByArticleId();
  const localizedRows: ArticleListItem[] = [];

  for (const row of rows) {
    const cachedEnglishTitle = readEnglishArticleTitleFromExtraction(
      latestRiskExtractionByArticleId.get(row.id),
    );
    const resolved = await resolveEnglishArticleTitle({
      title: row.title,
      rawText: row.rawText,
      cachedEnglishTitle,
    });

    const displayTitle =
      resolved.title ?? cachedEnglishTitle ?? row.title;

    if (displayTitle && displayTitle !== (row.title?.trim() ?? "")) {
      await persistEnglishArticleTitle(row.id, displayTitle);
    }

    localizedRows.push({
      id: row.id,
      title: displayTitle,
      url: row.url,
      riskCount: row.riskCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      risksExtracted: sql<number>`coalesce(sum(${articles.riskCount}), 0)::int`,
    })
    .from(articles);

  const total = agg?.total ?? 0;
  const risksExtracted = agg?.risksExtracted ?? 0;

  return {
    articles: localizedRows,
    metrics: {
      total,
      risksExtracted,
      avgRisksPerArticle: total > 0 ? risksExtracted / total : 0,
    },
  };
}
