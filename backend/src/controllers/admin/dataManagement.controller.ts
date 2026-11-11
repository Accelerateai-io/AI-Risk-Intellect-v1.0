import type { Request, Response } from "express";
import { buildArticlesExportExcel } from "../../services/admin/articlesExport.service.js";
import { buildReviewExportExcel } from "../../services/admin/reviewExport.service.js";
import {
  ExportClientAbortedError,
  riskExportFileName,
  streamRisksExportExcel,
} from "../../services/admin/risksExport.service.js";
import { createLogger } from "../../logger/index.js";

const dataMgmtLog = createLogger("admin.dataManagement");

function setExcelDownloadHeaders(res: Response, fileName: string): void {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
}

function sendExcelDownload(
  res: Response,
  buffer: Buffer,
  fileName: string,
): void {
  setExcelDownloadHeaders(res, fileName);
  res.send(buffer);
}

export async function exportRisksHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  // Streamed, batched export (B-7): rows are written to the response as they
  // are read from the DB, so the whole table is never buffered in memory.
  setExcelDownloadHeaders(res, riskExportFileName());
  try {
    await streamRisksExportExcel(res);
  } catch (err) {
    if (err instanceof ExportClientAbortedError) {
      // The client hung up; nothing to send. The service already tore the
      // socket down — just stop here.
      return;
    }
    dataMgmtLog.error("Risks export stream failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      // Failure before the first byte: a clean error response is still possible.
      res.status(500).json({
        error: { code: "INTERNAL", message: "Risks export failed." },
      });
      return;
    }
    // Headers/rows already flushed: there is no clean status left to send. The
    // service destroyed the response so the client sees a broken download rather
    // than a silently truncated file. Do NOT rethrow — the error middleware
    // would try to write JSON after headers were sent and crash the process.
    if (!res.destroyed) res.destroy(err instanceof Error ? err : undefined);
  }
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
