import type { Request, Response } from "express";
import { retryJob } from "../../services/jobs/retryJob.service.js";
import { ensureWorkerProcessRunning } from "../../services/admin/workerManager.service.js";

export async function retryJobHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const jobId = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(jobId) || jobId < 1) {
    res.status(400).json({ error: { message: "Invalid job id." } });
    return;
  }

  const job = await retryJob(jobId);
  const { pid } = ensureWorkerProcessRunning();

  res.status(200).json({
    ok: true,
    message: "Job requeued. Worker service started to process it.",
    job,
    pid,
  });
}
