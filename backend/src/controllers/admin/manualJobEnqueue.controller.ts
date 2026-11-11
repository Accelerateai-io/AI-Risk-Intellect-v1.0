import type { Request, Response } from "express";
import {
  enqueueManualJobUrl,
  enqueueManualJobUrls,
} from "../../services/admin/manualJobEnqueue.service.js";
import { ensureWorkerProcessRunning } from "../../services/admin/workerManager.service.js";
import type {
  EnqueueJobUrlInput,
  EnqueueJobUrlsBulkInput,
} from "../../validators/admin.validators.js";
import { assertAdminUser } from "../../utils/isAdminUser.js";

// Force-reprocess inserts a NEW superseding risk row and re-runs an article from
// scratch, so it is restricted to Admin users (B-3 review). Plain enqueue stays
// available to any authenticated user.
const FORCE_REPROCESS_ADMIN_MESSAGE =
  "Only Admin users can force-reprocess an article.";

export async function enqueueJobUrlHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { url, forceReprocess } = req.body as EnqueueJobUrlInput;
  if (forceReprocess) {
    assertAdminUser(req.user, FORCE_REPROCESS_ADMIN_MESSAGE);
  }
  const result = await enqueueManualJobUrl(url, { forceReprocess });
  const { pid } = ensureWorkerProcessRunning();

  res.status(201).json({
    ok: true,
    message: forceReprocess
      ? "URL enqueued for re-processing (a new risk row will supersede the old one)."
      : "URL enqueued for ingestion. Worker service started to process it.",
    job: result.job,
    created: result.created,
    pid,
  });
}

export async function enqueueJobUrlsBulkHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { urls, forceReprocess } = req.body as EnqueueJobUrlsBulkInput;
  if (forceReprocess) {
    assertAdminUser(req.user, FORCE_REPROCESS_ADMIN_MESSAGE);
  }
  const result = await enqueueManualJobUrls(urls, { forceReprocess });
  const { pid } = ensureWorkerProcessRunning();

  res.status(201).json({
    ok: true,
    message: `Enqueued ${result.enqueued} of ${result.total} URL(s)${
      forceReprocess ? " for re-processing" : ""
    }.`,
    ...result,
    pid,
  });
}
