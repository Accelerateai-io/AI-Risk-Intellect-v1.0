import type { Request, Response } from "express";
import { buildReportUploadItemsExcel } from "../../services/admin/etlReportUploadExport.service.js";
import {
  archiveReportUpload,
  listActiveReportUploads,
  listReportUploadItems,
} from "../../services/admin/etlReportUploads.service.js";

export async function listReportUploadsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const uploads = await listActiveReportUploads();
  res.json({ uploads });
}

export async function listReportUploadItemsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const items = await listReportUploadItems(id);
  res.json({ items });
}

export async function exportReportUploadItemsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const { buffer, fileName } = await buildReportUploadItemsExcel(id);
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

export async function archiveReportUploadHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const upload = await archiveReportUpload(id);

  res.json({
    ok: true,
    message: "Report upload archived.",
    upload,
  });
}
