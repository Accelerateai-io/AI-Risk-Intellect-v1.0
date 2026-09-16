import * as XLSX from "xlsx";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { risks } from "../../schema/risks/risks.js";
import { mapRiskRowToDto } from "../risks/riskDto.js";
import { isRiskInReviewQueue } from "../risks/risks.service.js";
import { fetchGlobalRiskDisplayIdMap } from "../risks/riskSequence.js";
import {
  exportDateStamp,
  formatExportDateTime,
  writeWorkbookToBuffer,
} from "../../utils/excelExport.util.js";

export async function buildReviewExportExcel(): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const rows = await db
    .select({
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
    })
    .from(risks)
    .innerJoin(articles, eq(risks.articleId, articles.id))
    .orderBy(desc(risks.createdAt));

  const reviewRows = rows.filter((row) =>
    isRiskInReviewQueue({
      domains: row.domains,
      qualityScore: row.qualityScore,
      extractionJson: row.extractionJson,
    }),
  );

  const displayIdByRiskId = await fetchGlobalRiskDisplayIdMap();
  const mapped = reviewRows.map((row) => ({
    row,
    risk: mapRiskRowToDto(row, displayIdByRiskId.get(row.id) ?? "R-?"),
  }));

  const exportedAt = formatExportDateTime(new Date());

  const reviewSheet = XLSX.utils.aoa_to_sheet([
    ["Exported At", exportedAt],
    [],
    [
      "Display ID",
      "Risk ID",
      "Title",
      "Domain",
      "Primary Risk",
      "Secondary Risk",
      "Likelihood",
      "Impact",
      "Severity Score",
      "Severity Band",
      "AI Product",
      "AI Vendor",
      "Quality Score",
      "Confidence",
      "Why",
      "Review Reason",
      "Review Status",
      "Classification",
      "Reviewed By",
      "Review Feedback",
      "Article ID",
      "Article Title",
      "Article URL",
      "Model Name",
      "Ingested At",
    ],
    ...mapped.map(({ risk }) => [
      risk.displayId,
      risk.id,
      risk.title,
      risk.domain,
      risk.primaryRisk,
      risk.secondaryRisk,
      risk.riskScoring.likelihood ?? "",
      risk.riskScoring.impact ?? "",
      risk.riskScoring.severityScore ?? "",
      risk.riskScoring.severityBand !== "—" ? risk.riskScoring.severityBand : "",
      risk.product.name ?? "",
      risk.product.vendor ?? "",
      risk.qualityScore,
      risk.confidence,
      risk.reviewWhy,
      risk.reviewReason,
      risk.humanReview.status ?? "",
      risk.humanReview.classification ?? "",
      risk.humanReview.reviewedBy ?? "",
      risk.humanReview.feedback ?? "",
      risk.articleId,
      risk.articleTitle,
      risk.articleUrl,
      risk.modelName ?? "",
      formatExportDateTime(risk.ingestedAt),
    ]),
  ]);
  reviewSheet["!cols"] = [
    { wch: 10 },
    { wch: 38 },
    { wch: 48 },
    { wch: 36 },
    { wch: 28 },
    { wch: 28 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 56 },
    { wch: 14 },
    { wch: 14 },
    { wch: 24 },
    { wch: 40 },
    { wch: 10 },
    { wch: 40 },
    { wch: 56 },
    { wch: 28 },
    { wch: 24 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, reviewSheet, "Review Queue");

  return {
    buffer: writeWorkbookToBuffer(workbook),
    fileName: `review-export-${exportDateStamp()}.xlsx`,
  };
}
