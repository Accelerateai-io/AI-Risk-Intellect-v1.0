import type { Request, Response } from "express";
import { HttpError } from "../../utils/httpError.js";
import { assertAdminUser } from "../../utils/isAdminUser.js";
import {
  EXPORT_PAGE_MAX,
  getCurrentIds,
  getExportPage,
  getLatestCheckpoint,
  runEvidenceExport,
} from "../../services/evidence/evidenceExport.service.js";

/** Non-negative integer query param, or the fallback when absent. */
export function parseCheckpointParam(
  value: unknown,
  name: string,
  fallback?: number,
): number | undefined {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw HttpError.badRequest(`${name} must be a non-negative integer`);
  }
  return n;
}

export async function getEvidenceCheckpointHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ latest_checkpoint: await getLatestCheckpoint() });
}

export async function getEvidenceExportHandler(req: Request, res: Response): Promise<void> {
  const after = parseCheckpointParam(req.query.after_checkpoint, "after_checkpoint", 0)!;
  const to = parseCheckpointParam(req.query.to_checkpoint, "to_checkpoint");
  const limit = parseCheckpointParam(req.query.limit, "limit", EXPORT_PAGE_MAX)!;
  if (limit < 1 || limit > EXPORT_PAGE_MAX) {
    throw HttpError.badRequest(`limit must be between 1 and ${EXPORT_PAGE_MAX}`);
  }
  if (to !== undefined && to < after) {
    throw HttpError.badRequest("to_checkpoint must be >= after_checkpoint");
  }
  res.status(200).json(await getExportPage({ after, to, limit }));
}

export async function getEvidenceCurrentIdsHandler(_req: Request, res: Response): Promise<void> {
  const records = await getCurrentIds();
  res.status(200).json({ count: records.length, records });
}

/** Admin "run now" for testing; the scheduler runs it on its own otherwise. */
export async function runEvidenceExportHandler(req: Request, res: Response): Promise<void> {
  assertAdminUser(req.user, "Only Admin users can run the evidence export.");
  res.status(200).json(await runEvidenceExport());
}
