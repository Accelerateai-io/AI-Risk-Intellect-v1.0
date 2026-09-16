import { Router } from "express";
import { requireAuthOrApiKey } from "../middleware/requireAuthOrApiKey.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getObservabilityHandler } from "../controllers/observability/observability.controller.js";

export const observabilityRouter: Router = Router();

observabilityRouter.get(
  "/",
  requireAuthOrApiKey,
  asyncHandler(getObservabilityHandler),
);
