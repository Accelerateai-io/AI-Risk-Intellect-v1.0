import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireAuthOrApiKey } from "../middleware/requireAuthOrApiKey.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getEvidenceCheckpointHandler,
  getEvidenceCurrentIdsHandler,
  getEvidenceExportHandler,
  runEvidenceExportHandler,
} from "../controllers/evidence/evidence.controller.js";

/**
 * Evidence Bridge export for AI-Q (spec v1.3, section 5). Read endpoints accept
 * the existing `ari_` API key in X-API-Key (or a UI session); run-now is admin only.
 */
export const evidenceRouter: Router = Router();

evidenceRouter.get("/checkpoint", requireAuthOrApiKey, asyncHandler(getEvidenceCheckpointHandler));
evidenceRouter.get("/export", requireAuthOrApiKey, asyncHandler(getEvidenceExportHandler));
evidenceRouter.get("/current-ids", requireAuthOrApiKey, asyncHandler(getEvidenceCurrentIdsHandler));
evidenceRouter.post("/export/run", requireAuth, asyncHandler(runEvidenceExportHandler));
