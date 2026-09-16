import type { Request, Response } from "express";
import {
  getBatchRunById,
  listBatchRuns,
  startBatchRun,
  disableBatchRun,
  enableBatchRun,
} from "../../services/admin/batchRuns.service.js";
import type { StartBatchRunInput } from "../../validators/admin.validators.js";

export async function startBatchRunHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.body as StartBatchRunInput;
  const result = await startBatchRun(input);
  res.status(200).json({
    ok: true,
    message: result.message,
    batch: result.batch,
    services: result.services,
  });
}

export async function listBatchRunsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 25;
  const batches = await listBatchRuns(limit);
  res.status(200).json({ batches });
}

export async function getBatchRunHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const batch = await getBatchRunById(id);
  res.status(200).json({ batch });
}

export async function disableBatchRunHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const batch = await disableBatchRun(id);
  res.status(200).json({
    ok: true,
    message: "Batch disabled. Enable it later from the Disabled tab to run it.",
    batch,
  });
}

export async function enableBatchRunHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  const batch = await enableBatchRun(id);
  res.status(200).json({
    ok: true,
    message: "Batch enabled. It will run when no other batch is processing.",
    batch,
  });
}
