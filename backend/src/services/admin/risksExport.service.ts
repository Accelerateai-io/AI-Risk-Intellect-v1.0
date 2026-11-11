import type { Writable } from "node:stream";
import ExcelJS from "exceljs";
import type { Worksheet } from "exceljs";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { risks } from "../../schema/risks/risks.js";
import { mapRiskRowToDto } from "../risks/riskDto.js";
import { fetchGlobalRiskDisplayIdMap } from "../risks/riskSequence.js";
import { decodeDisplayTitle } from "../../utils/decodeHtmlEntities.js";

/** Rows pulled from the DB per batch so the whole table is never in memory. */
const EXPORT_BATCH = 500;

function formatExportDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Join non-empty parts with newlines for a single spreadsheet cell. */
function joinLines(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean)
    .join("\n");
}

/** Serialize the score metrics (Scores tab) into one readable cell. */
function serializeScoreMetrics(
  metrics: { label: string; value: number; max: number; reasoning?: string }[],
): string {
  return metrics
    .map(
      (m) =>
        `${m.label}: ${m.value}/${m.max}${m.reasoning ? ` — ${m.reasoning}` : ""}`,
    )
    .join("\n");
}

/** Serialize the top catalog matches (Analysis tab) into one cell. */
function serializeCatalogMatches(
  matches: { riskId: string; title: string; accuracyPercent: number }[],
): string {
  return matches
    .map((m) => `${m.riskId} · ${m.title} (${m.accuracyPercent}%)`)
    .join("\n");
}

function exportDateStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthName = now.toLocaleString("en-US", { month: "short" }); // "Jul"
  return `${now.getFullYear()}-${monthName}-${pad(now.getDate())}`;
}

/** Download filename for the risks export. */
export function riskExportFileName(): string {
  return `risks-export-${exportDateStamp()}.xlsx`;
}

/**
 * Yield every row of a table one batch at a time. `fetchPage` is the only DB
 * touch-point, which keeps this generator unit-testable without a database.
 */
export async function* iterateInBatches<T>(
  fetchPage: (limit: number, offset: number) => Promise<T[]>,
  batchSize = EXPORT_BATCH,
): AsyncGenerator<T> {
  let offset = 0;
  for (;;) {
    const rows = await fetchPage(batchSize, offset);
    if (rows.length === 0) break;
    for (const row of rows) yield row;
    offset += rows.length;
    if (rows.length < batchSize) break;
  }
}

const riskExportColumns = {
  id: risks.id,
  articleId: risks.articleId,
  riskTitle: risks.riskTitle,
  domains: risks.domains,
  primaryRisk: risks.primaryRisk,
  secondaryRisk: risks.secondaryRisk,
  sector: risks.sector,
  industry: risks.industry,
  intent: risks.intent,
  qualityScore: risks.qualityScore,
  likelihood: risks.likelihood,
  impact: risks.impact,
  severityScore: risks.severityScore,
  severityBand: risks.severityBand,
  aiProductName: risks.aiProductName,
  aiProductVendor: risks.aiProductVendor,
  extractionJson: risks.extractionJson,
  modelName: risks.modelName,
  createdAt: risks.createdAt,
  articleTitle: articles.title,
  articleUrl: articles.url,
} as const;

function fetchRiskPage(limit: number, offset: number) {
  return db
    .select(riskExportColumns)
    .from(risks)
    .innerJoin(articles, eq(risks.articleId, articles.id))
    // `risks.id` is the stable tiebreaker: without it rows sharing a
    // `created_at` can reshuffle between LIMIT/OFFSET pages, which would
    // duplicate or silently skip rows across the batched export.
    .orderBy(desc(risks.createdAt), desc(risks.id))
    .limit(limit)
    .offset(offset);
}

function fetchArticlePage(limit: number, offset: number) {
  return db
    .select()
    .from(articles)
    .orderBy(asc(articles.id))
    .limit(limit)
    .offset(offset);
}

function setWidths(ws: Worksheet, widths: number[]): void {
  ws.columns = widths.map((w) => ({ width: w }));
}

const RISKS_HEADER = [
  "Display ID",
  "Title",
  "Domain",
  "Primary Risk",
  "Secondary Risk",
  "Sector",
  "Industry",
  "Intent",
  "Likelihood",
  "Impact",
  "Severity Score",
  "Severity Band",
  "AI Product",
  "AI Vendor",
  "Quality Score",
  "Confidence",
  "Description",
  "Attack Vector",
  "Article ID",
  "Article Title",
  "Article URL",
  "Model Name",
  "Review Status",
  "Reviewed By",
  "Reviewed At",
  "Ingested At",
  "Observable Indicators",
  "Timing",
  "Risk Identified",
  "Article Context",
  "Alignment Reasoning",
  "Catalog Matches",
  "Model Decision Rationale",
  "Overall Score",
  "Score Metrics",
  "Score Justification",
  "Evidence Snippet",
  "Evidence Sources",
  "Data Used to Identify Risk",
  "Evidence Breakdown",
];

/**
 * Stream the risks export workbook directly to `output` (the HTTP response).
 * Rows are read from the DB in batches and committed to the stream as they are
 * produced, so neither the full result set nor the whole workbook is ever held
 * in memory. The 4 sheets are written sequentially; the risk-derived sheets
 * (Risks, Tags, Evidence Breakdown) each take their own batched pass so an
 * uncommitted worksheet never buffers the entire table.
 */
/** Error raised when the HTTP client disconnects mid-export. */
export class ExportClientAbortedError extends Error {
  readonly code = "ERR_CLIENT_ABORTED";
  constructor() {
    super("Export aborted: client closed the connection");
    this.name = "ExportClientAbortedError";
  }
}

export async function streamRisksExportExcel(output: Writable): Promise<void> {
  // Stop scanning the DB the moment the client goes away. `close` fires on the
  // response for both a normal finish and an abort, so only treat it as an abort
  // when the response did not finish writing.
  let clientGone = false;
  const onClose = () => {
    if (!output.writableFinished) clientGone = true;
  };
  output.on("close", onClose);

  const throwIfAborted = () => {
    if (clientGone || output.destroyed) throw new ExportClientAbortedError();
  };

  // Respect backpressure: if the socket's buffer is full, wait for it to drain
  // (or for the client to leave) before queuing more rows, so a slow client
  // cannot make us buffer the whole workbook in memory.
  const settle = async () => {
    if (output.writableNeedDrain) {
      await new Promise<void>((resolve) => {
        const done = () => {
          output.off("drain", done);
          output.off("close", done);
          resolve();
        };
        output.once("drain", done);
        output.once("close", done);
      });
    }
  };

  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: output,
      useStyles: false,
      useSharedStrings: false,
    });

    // Lightweight (uuid + display string) map; reused across the risk passes.
    const displayIdByRiskId = await fetchGlobalRiskDisplayIdMap();
    const displayId = (id: string) => displayIdByRiskId.get(id) ?? "R-?";

    // ---- Sheet 1: Risks ----
  const risksSheet = workbook.addWorksheet("Risks");
  setWidths(risksSheet, [
    10, 38, 48, 36, 28, 28, 18, 22, 18, 14, 12, 64, 36, 10, 40, 56, 28, 14, 24,
    24, 24,
  ]);
  risksSheet.addRow(["Exported At", formatExportDateTime(new Date())]).commit();
  risksSheet.addRow([]).commit();
  risksSheet.addRow(RISKS_HEADER).commit();
  for await (const row of iterateInBatches(fetchRiskPage)) {
    throwIfAborted();
    const risk = mapRiskRowToDto(row, displayId(row.id));
    risksSheet
      .addRow([
        risk.displayId,
        risk.title,
        risk.domain,
        risk.primaryRisk,
        risk.secondaryRisk,
        risk.sector,
        risk.industry,
        risk.intent,
        risk.riskScoring.likelihood ?? "",
        risk.riskScoring.impact ?? "",
        risk.riskScoring.severityScore ?? "",
        risk.riskScoring.severityBand !== "—" ? risk.riskScoring.severityBand : "",
        risk.product.name ?? "",
        risk.product.vendor ?? "",
        risk.qualityScore,
        risk.confidence,
        risk.description,
        risk.attackVector,
        risk.articleId,
        risk.articleTitle,
        risk.articleUrl,
        risk.modelName ?? "",
        risk.humanReview.status ?? "",
        risk.humanReview.reviewedBy ?? "",
        formatExportDateTime(risk.humanReview.reviewedAt),
        formatExportDateTime(risk.ingestedAt),
        risk.observableIndicators,
        risk.timing,
        risk.riskAnalysis.risk_identified,
        risk.riskAnalysis.article_context,
        risk.riskAnalysis.alignment_reasoning,
        serializeCatalogMatches(risk.riskAnalysis.catalogMatches),
        risk.modelSelfEvaluation.decision_rationale,
        `${risk.scores.overall.value}/${risk.scores.overall.max}`,
        serializeScoreMetrics(risk.scores.metrics),
        joinLines(
          risk.scores.justification.decision_rationale,
          risk.scores.justification.context_clarity_reasoning,
          risk.scores.justification.keyword_reasoning,
          risk.scores.justification.tagging_reasoning,
          risk.scores.justification.evidence_reasoning,
        ),
        risk.evidence.snippet,
        risk.evidence.sources,
        risk.evidence.dataToIdentifyRisk,
        risk.evidence.breakdown
          .map((b) =>
            joinLines(
              `${b.field} [${b.strength}]`,
              b.specificity ? `specificity: ${b.specificity}` : "",
              b.taxonomyAlignment ? `taxonomy: ${b.taxonomyAlignment}` : "",
              b.sourceText,
            ),
          )
          .join("\n\n"),
      ])
      .commit();
    await settle();
  }
  risksSheet.commit();

  // ---- Sheet 2: Articles ----
  const articlesSheet = workbook.addWorksheet("Articles");
  setWidths(articlesSheet, [8, 72, 48, 12, 24, 24]);
  articlesSheet
    .addRow(["ID", "URL", "Title", "Risk Count", "Created At", "Updated At"])
    .commit();
  for await (const article of iterateInBatches(fetchArticlePage)) {
    throwIfAborted();
    articlesSheet
      .addRow([
        article.id,
        article.url,
        decodeDisplayTitle(article.title, ""),
        article.riskCount,
        formatExportDateTime(article.createdAt),
        formatExportDateTime(article.updatedAt),
      ])
      .commit();
    await settle();
  }
  articlesSheet.commit();

  // ---- Sheet 3: Tags ----
  const tagsSheet = workbook.addWorksheet("Tags");
  setWidths(tagsSheet, [10, 38, 36, 28, 28, 18, 22, 18, 14, 12, 12]);
  tagsSheet
    .addRow([
      "Display ID",
      "Risk ID",
      "Domain",
      "Primary Risk",
      "Secondary Risk",
      "Sector",
      "Industry",
      "Intent",
      "Primary Key",
      "Tag Key",
      "Confidence",
    ])
    .commit();
  for await (const row of iterateInBatches(fetchRiskPage)) {
    throwIfAborted();
    const risk = mapRiskRowToDto(row, displayId(row.id));
    tagsSheet
      .addRow([
        risk.displayId,
        risk.id,
        risk.domain,
        risk.primaryRisk,
        risk.secondaryRisk,
        risk.sector,
        risk.industry,
        risk.intent,
        risk.primaryKey,
        risk.tagKey,
        risk.confidence,
      ])
      .commit();
    await settle();
  }
  tagsSheet.commit();

  // ---- Sheet 4: Evidence Breakdown (1 row per evidence item) ----
  const evidenceSheet = workbook.addWorksheet("Evidence Breakdown");
  setWidths(evidenceSheet, [10, 48, 22, 14, 18, 22, 80]);
  evidenceSheet
    .addRow([
      "Display ID",
      "Title",
      "Field",
      "Strength",
      "Specificity",
      "Taxonomy Alignment",
      "Source Text",
    ])
    .commit();
  for await (const row of iterateInBatches(fetchRiskPage)) {
    throwIfAborted();
    const risk = mapRiskRowToDto(row, displayId(row.id));
    for (const item of risk.evidence.breakdown) {
      evidenceSheet
        .addRow([
          risk.displayId,
          risk.title,
          item.field,
          item.strength,
          item.specificity ?? "",
          item.taxonomyAlignment ?? "",
          item.sourceText,
        ])
        .commit();
    }
    await settle();
  }
  evidenceSheet.commit();

    await workbook.commit();
  } catch (err) {
    // A client abort is expected cancellation, not a failure: tear the socket
    // down so no half-written workbook is flushed, then rethrow for the caller.
    if (err instanceof ExportClientAbortedError) {
      if (!output.destroyed) output.destroy();
    } else if (!output.destroyed && !output.writableFinished) {
      // Genuine failure mid-stream: headers are already sent, so there is no
      // clean status to send — destroy the response so the client sees a broken
      // download instead of a silently truncated, "successful" file.
      output.destroy(err instanceof Error ? err : new Error(String(err)));
    }
    throw err;
  } finally {
    output.off("close", onClose);
  }
}