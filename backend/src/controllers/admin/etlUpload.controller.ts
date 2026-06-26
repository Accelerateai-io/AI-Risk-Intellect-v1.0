import type { Request, Response } from "express";
import {
  extractReportUpload,
  reuploadReportsFile,
  saveReportsFile,
} from "../../services/admin/etlImport.service.js";

export async function uploadReportsEtlHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const suggestedName =
    typeof req.body?.suggestedName === "string" ? req.body.suggestedName : undefined;

  const result = await saveReportsFile(req.file as Express.Multer.File, {
    suggestedName,
  });

  res.status(201).json({
    ok: true,
    message: "Report file saved. Use Extract to import report URLs.",
    uploadId: result.uploadId,
  });
}

export async function extractReportUploadHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const summary = await extractReportUpload(id);

  res.status(201).json({
    ok: true,
    message: `Imported ${summary.importedRows} of ${summary.totalRows} rows (${summary.skippedRows} skipped, ${summary.failedRows} failed).`,
    ...summary,
  });
}

export async function reuploadReportUploadHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const suggestedName =
    typeof req.body?.suggestedName === "string" ? req.body.suggestedName : undefined;

  const result = await reuploadReportsFile(id, req.file as Express.Multer.File, {
    suggestedName,
  });

  res.status(200).json({
    ok: true,
    message: "Report file replaced. Use Extract to import report URLs.",
    uploadId: result.uploadId,
  });
}
