import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { etlReportUploads } from "../../schema/aiid/reportUploads.js";
import { HttpError } from "../../utils/httpError.js";
import { getReportUploadDisplayName } from "./etlReportFileStorage.js";
import { listReportUploadItems } from "./etlReportUploads.service.js";

function safeFilenamePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 80) || "upload";
}

export async function buildReportUploadItemsExcel(uploadId: number): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const [upload] = await db
    .select()
    .from(etlReportUploads)
    .where(eq(etlReportUploads.id, uploadId));

  if (!upload || upload.archived) {
    throw HttpError.notFound("Report upload not found.");
  }

  const items = await listReportUploadItems(uploadId);
  const urls = items
    .map((item) => item.url)
    .filter((url) => url.trim().length > 0);

  if (urls.length === 0) {
    throw HttpError.badRequest(
      "No report URLs stored for this upload. Run Extract first.",
    );
  }

  const sheetRows: Array<[number, string]> = urls.map((url, index) => [
    index + 1,
    url,
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet([
    ["#", "Report URL"],
    ...sheetRows,
  ]);
  worksheet["!cols"] = [{ wch: 6 }, { wch: 96 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report URLs");
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const label =
    upload.suggestedName?.trim() ||
    getReportUploadDisplayName(upload.reportFilePath);
  const fileName = `report-urls-${uploadId}-${safeFilenamePart(label)}.xlsx`;

  return { buffer, fileName };
}
