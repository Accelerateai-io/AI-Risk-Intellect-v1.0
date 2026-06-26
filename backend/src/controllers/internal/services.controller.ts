import type { Request, Response } from "express";
import { getServicesStatus } from "../../services/admin/discoveryManager.service.js";
import { ensureWorkerProcessRunning } from "../../services/admin/workerManager.service.js";

export async function ensureWorkerHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const { pid, started } = ensureWorkerProcessRunning();
  res.status(200).json({
    ok: true,
    started,
    pid,
    services: getServicesStatus(),
  });
}
