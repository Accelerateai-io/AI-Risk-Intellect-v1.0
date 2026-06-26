import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getDashboardHandler } from "../controllers/dashboard/dashboard.controller.js";

export const dashboardRouter: Router = Router();

dashboardRouter.get("/", requireAuth, asyncHandler(getDashboardHandler));
