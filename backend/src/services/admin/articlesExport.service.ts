import * as XLSX from "xlsx";
import { asc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import {
  exportDateStamp,
  formatExportDateTime,
  writeWorkbookToBuffer,
} from "../../utils/excelExport.util.js";

export async function buildArticlesExportExcel(): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const articleRows = await db
    .select()
    .from(articles)
    .orderBy(asc(articles.id));

  const exportedAt = formatExportDateTime(new Date());

  const articlesSheet = XLSX.utils.aoa_to_sheet([
    ["Exported At", exportedAt],
    [],
    // ["ID", "URL", "Title", "Risk Count", "SHA-256", "Created At", "Updated At"],
    ["ID", "URL", "Title", "Risk Count", "Created At", "Updated At"],
    ...articleRows.map((article) => [
      article.id,
      article.url,
      article.title ?? "",
      article.riskCount,
      // article.sha256 ?? "",
      formatExportDateTime(article.createdAt),
      formatExportDateTime(article.updatedAt),
    ]),
  ]);
  articlesSheet["!cols"] = [
    { wch: 8 },
    { wch: 72 },
    { wch: 48 },
    { wch: 12 },
    { wch: 24 },
    { wch: 24 },
    { wch: 24 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, articlesSheet, "Articles");

  return {
    buffer: writeWorkbookToBuffer(workbook),
    fileName: `articles-export-${exportDateStamp()}.xlsx`,
  };
}
