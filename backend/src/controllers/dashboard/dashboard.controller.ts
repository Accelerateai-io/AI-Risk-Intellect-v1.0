import type { Request, Response } from "express";
import { getDashboardStats } from "../../services/dashboard/dashboard.service.js";

export async function getDashboardHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const stats = await getDashboardStats();
  res.status(200).json(stats);
}
