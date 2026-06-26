import type { Request, Response } from "express";
import { listDiscoveryLogs } from "../../services/admin/discoveryLogs.service.js";

export async function listDiscoveryLogsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const logs = await listDiscoveryLogs();
  res.status(200).json({ ok: true, logs });
}
