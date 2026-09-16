import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireServiceKey } from "../middleware/requireServiceKey.middleware.js";
import { requireAuthOrApiKey } from "../middleware/requireAuthOrApiKey.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { exportRisksForServiceHandler } from "../controllers/risks/risksServiceExport.controller.js";
import {
  approveReviewRiskHandler,
  classifyReviewRiskHandler,
  remapReviewDomainHandler,
  getRiskByIdHandler,
  listReviewQueueHandler,
  listRisksHandler,
  listReviewFeedbackHandler,
  listTaxonomyDomainsHandler,
  pendingReviewCountHandler,
  rejectReviewRiskHandler,
  updateReviewFeedbackHandler,
} from "../controllers/risks/risks.controller.js";
import {
  editRiskFieldsHandler,
  bulkAssignReviewsHandler,
} from "../controllers/risks/reviewOps.controller.js";

export const risksRouter: Router = Router();

// Service-to-service JSON export for AI-Q. Must precede the "/:id" route so
// "export" is not captured as an id. Auth is the service key, not user JWT.
risksRouter.get(
  "/export",
  requireServiceKey,
  asyncHandler(exportRisksForServiceHandler),
);

/** Read endpoints: JWT (UI) or API key (external AI-Q). */
risksRouter.get("/", requireAuthOrApiKey, asyncHandler(listRisksHandler));
risksRouter.get(
  "/review-queue",
  requireAuthOrApiKey,
  asyncHandler(listReviewQueueHandler),
);
risksRouter.get(
  "/review-queue/pending-count",
  requireAuthOrApiKey,
  asyncHandler(pendingReviewCountHandler),
);
risksRouter.get(
  "/review-feedback",
  requireAuthOrApiKey,
  asyncHandler(listReviewFeedbackHandler),
);
risksRouter.get(
  "/taxonomy-domains",
  requireAuthOrApiKey,
  asyncHandler(listTaxonomyDomainsHandler),
);
risksRouter.get("/:id", requireAuthOrApiKey, asyncHandler(getRiskByIdHandler));

/** Review mutations stay JWT-only (interactive UI). */
risksRouter.post(
  "/:id/review/approve",
  requireAuth,
  asyncHandler(approveReviewRiskHandler),
);
risksRouter.patch(
  "/:id/review/domain",
  requireAuth,
  asyncHandler(remapReviewDomainHandler),
);
risksRouter.post(
  "/:id/review/reject",
  requireAuth,
  asyncHandler(rejectReviewRiskHandler),
);
risksRouter.post(
  "/:id/review/classify",
  requireAuth,
  asyncHandler(classifyReviewRiskHandler),
);
risksRouter.patch(
  "/:id/review/feedback",
  requireAuth,
  asyncHandler(updateReviewFeedbackHandler),
);

/** Human Review operations (Asad's requirement): editable fields + bulk assignment. JWT-only. */
risksRouter.post(
  "/bulk/assign",
  requireAuth,
  asyncHandler(bulkAssignReviewsHandler),
);
risksRouter.patch(
  "/:id/fields",
  requireAuth,
  asyncHandler(editRiskFieldsHandler),
);
