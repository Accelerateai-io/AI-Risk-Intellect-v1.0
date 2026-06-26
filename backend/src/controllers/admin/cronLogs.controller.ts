import type { Request, Response } from "express";
import { listCronJobLogs } from "../../services/admin/cronLogs.service.js";

export async function listCronJobLogsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const data = await listCronJobLogs();
  res.status(200).json({ ok: true, ...data });
}
