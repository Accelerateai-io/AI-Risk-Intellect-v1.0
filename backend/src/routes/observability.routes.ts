import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getObservabilityHandler } from "../controllers/observability/observability.controller.js";

export const observabilityRouter: Router = Router();

observabilityRouter.get(
  "/",
  requireAuth,
  asyncHandler(getObservabilityHandler),
);
