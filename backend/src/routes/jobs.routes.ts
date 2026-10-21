import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireAuthOrApiKey } from "../middleware/requireAuthOrApiKey.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  listJobsHandler,
  deleteJobHandler,
  markJobDoNotExecuteHandler,
  markSkippedJobsDoNotExecuteHandler,
  executeJobHandler,
  retrySkippedJobsHandler,
} from "../controllers/jobs/jobs.controller.js";
import { retryJobHandler } from "../controllers/jobs/retryJob.controller.js";
import { getJobExecutionTimeHandler } from "../controllers/jobs/jobRuntimeSettings.controller.js";

export const jobsRouter: Router = Router({ mergeParams: true });

jobsRouter.get(
  "/execution-time",
  requireAuth,
  asyncHandler(getJobExecutionTimeHandler),
);
jobsRouter.post(
  "/bulk/retry-skipped",
  requireAuth,
  asyncHandler(retrySkippedJobsHandler),
);
jobsRouter.post(
  "/bulk/do-not-execute-skipped",
  requireAuth,
  asyncHandler(markSkippedJobsDoNotExecuteHandler),
);
jobsRouter.post(
  "/:id/do-not-execute",
  requireAuthOrApiKey,
  asyncHandler(markJobDoNotExecuteHandler),
);
jobsRouter.post(
  "/:id/execute",
  requireAuth,
  asyncHandler(executeJobHandler),
);
jobsRouter.get("/", requireAuthOrApiKey, asyncHandler(listJobsHandler));
jobsRouter.post("/:id/retry", requireAuth, asyncHandler(retryJobHandler));
jobsRouter.delete("/:id", requireAuth, asyncHandler(deleteJobHandler));