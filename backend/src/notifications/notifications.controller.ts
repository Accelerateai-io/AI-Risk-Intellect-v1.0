import type { Request, Response } from "express";
import { listNotifications } from "./notifications.service.js";

export async function listNotificationsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const sinceRaw = typeof req.query.since === "string" ? req.query.since : "";
  const since = sinceRaw ? new Date(sinceRaw) : undefined;

  const notifications = await listNotifications({
    since:
      since && !Number.isNaN(since.getTime()) ? since : undefined,
  });

  res.status(200).json({ ok: true, notifications });
}
