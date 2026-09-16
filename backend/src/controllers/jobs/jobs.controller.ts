import type { Request, Response } from "express";
import { ZodError } from "zod";
import { deleteJob, listJobs } from "../../services/jobs/jobs.service.js";
import { executeJobById } from "../../services/jobs/retryJob.service.js";
import { markJobUrlDoNotExecute } from "../../services/jobs/urlExecutionBlocks.service.js";
import { ensureWorkerProcessRunning } from "../../services/admin/workerManager.service.js";
import {
  executeJobUrlSchema,
  listJobsQuerySchema,
} from "../../validators/jobs.validators.js";

function executeErrorPayload(err: unknown): { status: number; message: string } {
  if (err instanceof ZodError) {
    return { status: 400, message: "Invalid model selection." };
  }
  const record = err as { status?: unknown; message?: unknown; name?: unknown };
  const status =
    typeof record?.status === "number" &&
    record.status >= 400 &&
    record.status < 600
      ? record.status
      : 500;
  const raw =
    err instanceof Error
      ? err.message
      : typeof record?.message === "string"
        ? record.message
        : String(err);
  const message = raw.trim() || "Could not execute this URL.";
  return {
    status: status === 500 && /do not execute/i.test(message) ? 409 : status,
    message: status === 500 && message === "Internal server error" ? "Could not execute this URL." : message,
  };
}

export async function listJobsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const query = listJobsQuerySchema.parse(req.query);
  const result = await listJobs(query);
  res.status(200).json(result);
}

export async function deleteJobHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const jobId = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(jobId) || jobId < 1) {
    res.status(400).json({ error: { message: "Invalid job id." } });
    return;
  }

  const result = await deleteJob(jobId);
  res.status(200).json({
    ok: true,
    message: "Job deleted.",
    job: result,
  });
}

export async function markJobDoNotExecuteHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const jobId = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(jobId) || jobId < 1) {
    res.status(400).json({ error: { message: "Invalid job id." } });
    return;
  }

  const result = await markJobUrlDoNotExecute(jobId);
  res.status(200).json({
    ok: true,
    message: "This URL is marked do not execute. The LLM will not run for it.",
    job: result,
  });
}

export async function executeJobHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const jobId = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(jobId) || jobId < 1) {
    res.status(400).json({ error: { message: "Invalid job id." } });
    return;
  }

  try {
    const body = executeJobUrlSchema.parse(req.body ?? {});
    const job = await executeJobById(jobId, {
      modelName: body.modelName,
      modelLabel: body.modelLabel,
    });
    let pid: number | null = null;
    try {
      pid = ensureWorkerProcessRunning().pid;
    } catch {
      pid = null;
    }

    res.status(200).json({
      ok: true,
      message: "URL unblocked and requeued. Worker service started to process it.",
      job,
      pid,
    });
  } catch (err) {
    const { status, message } = executeErrorPayload(err);
    res.status(status).json({
      ok: false,
      error: { message },
    });
  }
}
