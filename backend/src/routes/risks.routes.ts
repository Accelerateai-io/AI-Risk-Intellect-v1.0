import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  approveReviewRiskHandler,
  classifyReviewRiskHandler,
  getRiskByIdHandler,
  listReviewQueueHandler,
  listRisksHandler,
  listReviewFeedbackHandler,
  listTaxonomyDomainsHandler,
  pendingReviewCountHandler,
  rejectReviewRiskHandler,
  updateReviewFeedbackHandler,
} from "../controllers/risks/risks.controller.js";

export const risksRouter: Router = Router();

risksRouter.get("/", requireAuth, asyncHandler(listRisksHandler));
risksRouter.get(
  "/review-queue",
  requireAuth,
  asyncHandler(listReviewQueueHandler),
);
risksRouter.get(
  "/review-queue/pending-count",
  requireAuth,
  asyncHandler(pendingReviewCountHandler),
);
risksRouter.get(
  "/review-feedback",
  requireAuth,
  asyncHandler(listReviewFeedbackHandler),
);
risksRouter.get(
  "/taxonomy-domains",
  requireAuth,
  asyncHandler(listTaxonomyDomainsHandler),
);
risksRouter.post(
  "/:id/review/approve",
  requireAuth,
  asyncHandler(approveReviewRiskHandler),
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
risksRouter.get("/:id", requireAuth, asyncHandler(getRiskByIdHandler));
