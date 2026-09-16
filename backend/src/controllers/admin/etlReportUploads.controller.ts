import type { Request, Response } from "express";
import { buildReportUploadItemsExcel } from "../../services/admin/etlReportUploadExport.service.js";
import {
  archiveReportUpload,
  listReportUploadItems,
  listReportUploads,
  restoreReportUpload,
} from "../../services/admin/etlReportUploads.service.js";
import type { ListReportUploadItemsQuery } from "../../validators/admin.validators.js";

export async function listReportUploadsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const uploads = await listReportUploads();
  res.json({ uploads });
}

export async function listReportUploadItemsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const query = req.query as unknown as ListReportUploadItemsQuery;
  const afterId = Number(query.afterId);
  const result = await listReportUploadItems(id, {
    limit: Number(query.limit) || 50,
    offset: Number(query.offset) || 0,
    afterId: Number.isFinite(afterId) && afterId > 0 ? afterId : undefined,
  });
  res.json(result);
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

export async function restoreReportUploadHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const upload = await restoreReportUpload(id);

  res.json({
    ok: true,
    message: "Report upload restored.",
    upload,
  });
}
