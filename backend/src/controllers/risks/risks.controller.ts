import type { Request, Response } from "express";
import {
  approveReviewRisk,
  classifyReviewRisk,
  rejectReviewRisk,
  resolveReviewer,
  updateReviewFeedback,
} from "../../services/risks/riskReview.service.js";
import { listReviewFeedbackSamples } from "../../services/risks/reviewFeedback.service.js";
import {
  getRiskById,
  getTaxonomyDomains,
  countPendingReviewRisks,
  listReviewQueueRisks,
  listRisks,
} from "../../services/risks/risks.service.js";
import { HttpError } from "../../utils/httpError.js";

export async function listRisksHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = await listRisks();
  res.status(200).json(result);
}

export async function listReviewQueueHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = await listReviewQueueRisks();
  res.status(200).json(result);
}

export async function pendingReviewCountHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = await countPendingReviewRisks();
  res.status(200).json(result);
}

export async function listReviewFeedbackHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = await listReviewFeedbackSamples();
  res.status(200).json(result);
}

export async function listTaxonomyDomainsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const result = getTaxonomyDomains();
  res.status(200).json(result);
}

export async function getRiskByIdHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const riskId = String(req.params.id ?? "").trim();
  const risk = await getRiskById(riskId);
  res.status(200).json({ risk });
}

export async function approveReviewRiskHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw HttpError.unauthorized("Authentication required.");
  }

  const riskId = String(req.params.id ?? "").trim();
  const body = (req.body ?? {}) as {
    domain?: string;
    classification?: string;
    feedback?: string;
  };
  const domain =
    typeof body.domain === "string" ? body.domain.trim() : undefined;
  const classificationRaw =
    typeof body.classification === "string"
      ? body.classification.trim().toLowerCase()
      : undefined;
  const classification =
    classificationRaw === "raw" || classificationRaw === "structured"
      ? classificationRaw
      : undefined;
  const feedback =
    typeof body.feedback === "string" ? body.feedback.trim() : undefined;
  const reviewer = await resolveReviewer(userId);
  const result = await approveReviewRisk(riskId, {
    domain,
    classification,
    feedback,
    reviewer,
  });
  res.status(200).json(result);
}

export async function rejectReviewRiskHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw HttpError.unauthorized("Authentication required.");
  }

  const riskId = String(req.params.id ?? "").trim();
  const body = (req.body ?? {}) as { feedback?: string; classification?: string };
  const feedback =
    typeof body.feedback === "string" ? body.feedback.trim() : "";
  const classificationRaw =
    typeof body.classification === "string"
      ? body.classification.trim().toLowerCase()
      : undefined;
  const classification =
    classificationRaw === "raw" || classificationRaw === "structured"
      ? classificationRaw
      : undefined;
  const reviewer = await resolveReviewer(userId);
  await rejectReviewRisk(riskId, { feedback, classification, reviewer });
  res.status(200).json({ ok: true });
}

export async function classifyReviewRiskHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw HttpError.unauthorized("Authentication required.");
  }

  const riskId = String(req.params.id ?? "").trim();
  const body = (req.body ?? {}) as { feedback?: string };
  const feedback =
    typeof body.feedback === "string" ? body.feedback.trim() : "";
  const reviewer = await resolveReviewer(userId);
  await classifyReviewRisk(riskId, { feedback, reviewer });
  res.status(200).json({ ok: true });
}

export async function updateReviewFeedbackHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw HttpError.unauthorized("Authentication required.");
  }

  const riskId = String(req.params.id ?? "").trim();
  const body = (req.body ?? {}) as { feedback?: string };
  const feedback =
    typeof body.feedback === "string" ? body.feedback.trim() : "";
  const reviewer = await resolveReviewer(userId);
  await updateReviewFeedback(riskId, { feedback, reviewer });
  res.status(200).json({ ok: true });
}
