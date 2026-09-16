import { Router } from "express";
import { requireAuthOrApiKey } from "../middleware/requireAuthOrApiKey.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getDashboardHandler } from "../controllers/dashboard/dashboard.controller.js";

export const dashboardRouter: Router = Router();

dashboardRouter.get("/", requireAuthOrApiKey, asyncHandler(getDashboardHandler));
