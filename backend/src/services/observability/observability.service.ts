import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { llmObservability } from "../../schema/observability/llmObservability.js";
import { risks } from "../../schema/risks/risks.js";
import { withUsModelPrefix } from "../../utils/bedrockModelId.js";

function displayModelName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed ? withUsModelPrefix(trimmed) : "unknown";
}

export type ObservabilityHourlyPoint = {
  hour: number;
  label: string;
  extractions: number;
  words: number;
  tokensGenerated: number;
};

export type ObservabilityTableRow = {
  id: number;
  modelName: string;
  url: string;
  wordCount: number;
  tokensGenerated: number;
  wordsPerSecond: number;
  wordsPerMinute: number;
  durationMs: number;
  createdAt: string;
};

export type ObservabilityDayStats = {
  date: string;
  dataSource: "metrics" | "risks";
  summary: {
    totalExtractions: number;
    totalWords: number;
    totalTokens: number;
    avgWordsPerSecond: number;
    avgWordsPerMinute: number;
  };
  charts: {
    hourly: ObservabilityHourlyPoint[];
  };
  rows: ObservabilityTableRow[];
};

function startOfDayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function parseDayParam(day?: string): Date {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return startOfDayUtc(new Date());
  }
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function formatHourLabel(hour: number): string {
  const h = hour % 24;
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${suffix}`;
}

function wordsPerSecond(wordCount: number, durationMs: number): number {
  const seconds = Math.max(durationMs, 1) / 1000;
  return Math.round((wordCount / seconds) * 100) / 100;
}

function wordsPerMinute(wordCount: number, durationMs: number): number {
  return Math.round(wordsPerSecond(wordCount, durationMs) * 60 * 100) / 100;
}

function countWords(text: string | null | undefined): number {
  if (!text?.trim()) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimateTokensFromJson(value: unknown): number {
  try {
    const encoded = JSON.stringify(value ?? {});
    return Math.max(1, Math.floor(encoded.length / 4));
  } catch {
    return 1;
  }
}

function riskIdToDisplayId(riskId: string): number {
  let hash = 0;
  for (let i = 0; i < riskId.length; i++) {
    hash = (hash * 31 + riskId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

function buildHourlyBuckets(
  rows: ObservabilityTableRow[],
): ObservabilityHourlyPoint[] {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: formatHourLabel(hour),
    extractions: 0,
    words: 0,
    tokensGenerated: 0,
  }));

  for (const row of rows) {
    const hour = new Date(row.createdAt).getUTCHours();
    const bucket = hourly[hour];
    if (!bucket) continue;
    bucket.extractions += 1;
    bucket.words += row.wordCount;
    bucket.tokensGenerated += row.tokensGenerated;
  }

  return hourly;
}

function buildSummary(rows: ObservabilityTableRow[]) {
  let totalWords = 0;
  let totalTokens = 0;
  let totalDurationMs = 0;

  for (const row of rows) {
    totalWords += row.wordCount;
    totalTokens += row.tokensGenerated;
    totalDurationMs += row.durationMs;
  }

  const avgWordsPerSecond =
    totalDurationMs > 0
      ? Math.round((totalWords / (totalDurationMs / 1000)) * 100) / 100
      : 0;

  return {
    totalExtractions: rows.length,
    totalWords,
    totalTokens,
    avgWordsPerSecond,
    avgWordsPerMinute: Math.round(avgWordsPerSecond * 60 * 100) / 100,
  };
}

async function fetchMetricsRows(
  dayStart: Date,
  dayEnd: Date,
): Promise<ObservabilityTableRow[]> {
  const rows = await db
    .select({
      id: llmObservability.id,
      modelName: llmObservability.modelName,
      url: llmObservability.url,
      wordCount: llmObservability.wordCount,
      tokensGenerated: llmObservability.tokensGenerated,
      durationMs: llmObservability.durationMs,
      createdAt: llmObservability.createdAt,
    })
    .from(llmObservability)
    .where(
      and(
        gte(llmObservability.createdAt, dayStart),
        lt(llmObservability.createdAt, dayEnd),
      ),
    )
    .orderBy(desc(llmObservability.createdAt));

  return rows.map((row) => ({
    id: row.id,
    modelName: displayModelName(row.modelName),
    url: row.url,
    wordCount: row.wordCount,
    tokensGenerated: row.tokensGenerated,
    wordsPerSecond: wordsPerSecond(row.wordCount, row.durationMs),
    wordsPerMinute: wordsPerMinute(row.wordCount, row.durationMs),
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function fetchRiskFallbackRows(
  dayStart: Date,
  dayEnd: Date,
): Promise<ObservabilityTableRow[]> {
  const riskRows = await db
    .select({
      riskId: risks.id,
      modelName: risks.modelName,
      url: articles.url,
      rawText: articles.rawText,
      extractionJson: risks.extractionJson,
      articleId: risks.articleId,
      createdAt: risks.createdAt,
    })
    .from(risks)
    .innerJoin(articles, eq(risks.articleId, articles.id))
    .where(
      and(gte(risks.createdAt, dayStart), lt(risks.createdAt, dayEnd)),
    )
    .orderBy(desc(risks.createdAt));

  if (riskRows.length === 0) {
    return [];
  }

  const articleIds = [...new Set(riskRows.map((r) => r.articleId))];
  const jobRows = await db
    .select({
      articleId: jobs.articleId,
      durationMs: sql<number>`greatest(1, (extract(epoch from (${jobs.updatedAt} - ${jobs.createdAt})) * 1000)::int)`,
    })
    .from(jobs)
    .where(
      and(
        inArray(jobs.articleId, articleIds),
        sql`${jobs.status} in ('done', 'completed')`,
      ),
    )
    .orderBy(desc(jobs.updatedAt));

  const durationByArticle = new Map<number, number>();
  for (const job of jobRows) {
    if (!durationByArticle.has(job.articleId)) {
      durationByArticle.set(job.articleId, job.durationMs);
    }
  }

  return riskRows.map((row) => {
    const wordCount = countWords(row.rawText);
    const durationMs = durationByArticle.get(row.articleId) ?? 60_000;
    const tokensGenerated = estimateTokensFromJson(row.extractionJson);

    return {
      id: riskIdToDisplayId(row.riskId),
      modelName: displayModelName(row.modelName),
      url: row.url,
      wordCount,
      tokensGenerated,
      wordsPerSecond: wordsPerSecond(wordCount, durationMs),
      wordsPerMinute: wordsPerMinute(wordCount, durationMs),
      durationMs,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function getObservabilityDayStats(
  dayParam?: string,
): Promise<ObservabilityDayStats> {
  const dayStart = parseDayParam(dayParam);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const dateLabel = dayStart.toISOString().slice(0, 10);

  let tableRows: ObservabilityTableRow[] = [];
  let dataSource: ObservabilityDayStats["dataSource"] = "metrics";

  try {
    tableRows = await fetchMetricsRows(dayStart, dayEnd);
  } catch (err) {
    console.warn(
      "[observability] llm_observability query failed, using risks fallback:",
      err instanceof Error ? err.message : err,
    );
    tableRows = [];
  }

  if (tableRows.length === 0) {
    tableRows = await fetchRiskFallbackRows(dayStart, dayEnd);
    dataSource = "risks";
  }

  return {
    date: dateLabel,
    dataSource,
    summary: buildSummary(tableRows),
    charts: { hourly: buildHourlyBuckets(tableRows) },
    rows: tableRows,
  };
}

export type RecordObservabilityInput = {
  modelName: string;
  url: string;
  wordCount: number;
  tokensGenerated: number;
  durationMs: number;
};

export async function recordObservabilityMetrics(
  input: RecordObservabilityInput,
): Promise<void> {
  try {
    await db.insert(llmObservability).values({
      modelName: input.modelName || "unknown",
      url: input.url.slice(0, 2048),
      wordCount: Math.max(0, Math.round(input.wordCount)),
      tokensGenerated: Math.max(0, Math.round(input.tokensGenerated)),
      durationMs: Math.max(1, Math.round(input.durationMs)),
    });
  } catch (err) {
    console.error(
      "[observability] failed to record metrics:",
      err instanceof Error ? err.message : err,
    );
  }
}
