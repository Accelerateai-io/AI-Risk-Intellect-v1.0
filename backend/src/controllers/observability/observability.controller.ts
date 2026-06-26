import type { Request, Response } from "express";
import { getObservabilityDayStats } from "../../services/observability/observability.service.js";

export async function getObservabilityHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const day =
    typeof req.query.date === "string" ? req.query.date : undefined;
  const stats = await getObservabilityDayStats(day);
  res.status(200).json(stats);
}
