import type { Request, Response } from "express";
import {
  getJobExecutionMinutes,
  JOB_EXECUTION_MINUTE_OPTIONS,
  setJobExecutionMinutes,
} from "../../services/jobs/jobRuntimeSettings.service.js";
import type { SetJobExecutionTimeInput } from "../../validators/jobs.validators.js";

export async function getJobExecutionTimeHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const minutes = await getJobExecutionMinutes();
  res.status(200).json({
    minutes,
    options: JOB_EXECUTION_MINUTE_OPTIONS,
  });
}

export async function setJobExecutionTimeHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { minutes } = req.body as SetJobExecutionTimeInput;
  const saved = await setJobExecutionMinutes(minutes);
  res.status(200).json({
    ok: true,
    minutes: saved,
    message: `Execution time set to ${saved} minutes.`,
  });
}
