import type { Request, Response } from "express";
import { listApplicationLogs } from "../../services/admin/applicationLogs.service.js";

export async function listApplicationLogsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const limitRaw = req.query.limit;
  const limit =
    typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : undefined;

  const level = typeof req.query.level === "string" ? req.query.level : undefined;
  const label = typeof req.query.label === "string" ? req.query.label : undefined;
  const source =
    req.query.source === "error" || req.query.source === "application"
      ? req.query.source
      : undefined;

  const data = await listApplicationLogs({
    limit: Number.isFinite(limit) ? limit : undefined,
    level,
    label,
    source,
  });

  res.status(200).json({ ok: true, ...data });
}
