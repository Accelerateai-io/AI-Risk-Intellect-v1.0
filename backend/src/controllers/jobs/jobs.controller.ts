import type { Request, Response } from "express";
import { listJobs } from "../../services/jobs/jobs.service.js";

export async function listJobsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = await listJobs();
  res.status(200).json(result);
}
