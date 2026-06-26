import type { Request, Response } from "express";
import {
  getReportRefsByUploadIds,
  resolveActiveReportUploadsByIds,
  resolveReportRefsByIds,
} from "../../services/admin/etlReportUploads.service.js";
import { enqueueReportRefs } from "../../services/admin/reportsEnqueue.service.js";
import { getServicesStatus } from "../../services/admin/discoveryManager.service.js";
import { startWorkerProcess } from "../../services/admin/workerManager.service.js";
import type { StartReportsRunInput } from "../../validators/admin.validators.js";

export async function startReportsRunHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const {
    uploadIds: requestedUploadIds = [],
    reportIds: requestedReportIds = [],
  } = req.body as StartReportsRunInput;

  let refs =
    requestedReportIds.length > 0
      ? await resolveReportRefsByIds(requestedReportIds)
      : [];

  const resolvedUploadIds =
    requestedUploadIds.length > 0
      ? (await resolveActiveReportUploadsByIds(requestedUploadIds)).map(
          (upload) => upload.id,
        )
      : [...new Set(refs.map((ref) => ref.uploadId))];

  if (refs.length === 0 && resolvedUploadIds.length > 0) {
    refs = await getReportRefsByUploadIds(resolvedUploadIds);
  }

  if (refs.length === 0) {
    res.status(400).json({
      ok: false,
      error: {
        message:
          "No report URLs found for the selected uploads. Upload and import a CSV first.",
      },
    });
    return;
  }

  const enqueued = await enqueueReportRefs(refs);
  const { pid } = startWorkerProcess();

  res.status(200).json({
    ok: true,
    message:
      enqueued > 0
        ? `Enqueued ${enqueued} report URL${enqueued === 1 ? "" : "s"} and started the worker service.`
        : `All selected report URLs already have active jobs. Worker service started.`,
    pid,
    enqueued,
    selectedReportCount: refs.length,
    uploadCount: resolvedUploadIds.length,
    services: getServicesStatus(),
  });
}
