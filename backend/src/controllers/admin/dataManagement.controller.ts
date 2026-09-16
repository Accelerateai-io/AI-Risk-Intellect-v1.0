import type { Request, Response } from "express";
import { buildArticlesExportExcel } from "../../services/admin/articlesExport.service.js";
import { buildReviewExportExcel } from "../../services/admin/reviewExport.service.js";
import { buildRisksExportExcel } from "../../services/admin/risksExport.service.js";

function sendExcelDownload(
  res: Response,
  buffer: Buffer,
  fileName: string,
): void {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.send(buffer);
}

export async function exportRisksHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const { buffer, fileName } = await buildRisksExportExcel();
  sendExcelDownload(res, buffer, fileName);
}

export async function exportArticlesHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const { buffer, fileName } = await buildArticlesExportExcel();
  sendExcelDownload(res, buffer, fileName);
}

export async function exportReviewHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const { buffer, fileName } = await buildReviewExportExcel();
  sendExcelDownload(res, buffer, fileName);
}
