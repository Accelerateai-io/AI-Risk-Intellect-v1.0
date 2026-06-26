import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { listJobsHandler } from "../controllers/jobs/jobs.controller.js";
import { retryJobHandler } from "../controllers/jobs/retryJob.controller.js";

export const jobsRouter: Router = Router();

jobsRouter.get("/", requireAuth, asyncHandler(listJobsHandler));
jobsRouter.post("/:id/retry", requireAuth, asyncHandler(retryJobHandler));
