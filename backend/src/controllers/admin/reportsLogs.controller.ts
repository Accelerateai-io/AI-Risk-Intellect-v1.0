import type { Request, Response } from "express";
import { listReportsLogs } from "../../services/admin/reportsLogs.service.js";

export async function listReportsLogsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const logs = await listReportsLogs();
  res.status(200).json({ ok: true, logs });
}
