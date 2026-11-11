import type { Request, Response } from "express";
import {
  approveReviewRisk,
  classifyReviewRisk,
  rejectReviewRisk,
  remapReviewDomain,
  resolveReviewer,
  updateReviewFeedback,
} from "../../services/risks/riskReview.service.js";
import { listReviewFeedbackSamples } from "../../services/risks/reviewFeedback.service.js";
import {
  getRiskById,
  getTaxonomyDomains,
  countPendingReviewRisks,
  iterateVisibleRiskDtos,
  listReviewQueueRisks,
  listRisks,
} from "../../services/risks/risks.service.js";
import {
  isFullListRequest,
  normalizeRiskListParams,
} from "../../services/risks/riskListQuery.js";
import { HttpError } from "../../utils/httpError.js";

/**
 * Service seam for the list handler. Defaults to the real service functions; the
 * request-level controller test injects fakes so the routing decision (full list
 * vs paginated) can be exercised without a database.
 */
export type ListRisksDeps = {
  listRisks: typeof listRisks;
  iterateVisibleRiskDtos: typeof iterateVisibleRiskDtos;
};

/**
 * AI-Q compatibility (B-7): stream the FULL visible list in the legacy
 * `{ risks, metrics }` shape for API-key callers that send no offset/page.
 * Rows are written to the response as they are produced, so the whole table is
 * never buffered in memory even though every row is returned.
 */
async function streamFullVisibleRisks(
  res: Response,
  iterate: ListRisksDeps["iterateVisibleRiskDtos"],
): Promise<void> {
  res.status(200);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.write('{"risks":[');
  let first = true;
  let total = 0;
  let technical = 0;
  let operational = 0;
  let business = 0;
  for await (const dto of iterate()) {
    res.write((first ? "" : ",") + JSON.stringify(dto));
    first = false;
    total += 1;
    if (dto.primaryKey === "operational") operational += 1;
    else if (dto.primaryKey === "business") business += 1;
    else technical += 1;
  }
  const metrics = { total, technical, operational, business };
  res.write(`],"metrics":${JSON.stringify(metrics)}}`);
  res.end();
}

/** Core list handler, parameterised over its service dependencies (testable). */
export async function runListRisksHandler(
  req: Request,
  res: Response,
  deps: ListRisksDeps,
): Promise<void> {
  const query = req.query as Record<string, unknown>;
  const isApiKey = (req as Request & { apiKey?: unknown }).apiKey != null;

  // External AI-Q integrations (API key, no offset/page) keep today's behaviour
  // exactly: the full visible list in the legacy shape. The UI (JWT) and any
  // caller that pages via offset/page get a paginated response.
  if (isFullListRequest(query, isApiKey)) {
    await streamFullVisibleRisks(res, deps.iterateVisibleRiskDtos);
    return;
  }

  const params = normalizeRiskListParams(query);
  const result = await deps.listRisks(params);
  res.status(200).json({
    risks: result.risks,
    // Only advertise metrics when the caller asked for them (the page loads
    // that skip metrics get { technical/operational/business: 0 } placeholders).
    ...(result.metricsIncluded ? { metrics: result.metrics } : {}),
    metricsIncluded: result.metricsIncluded,
    total: result.total,
    hasMore: result.hasMore,
  });
}

export async function listRisksHandler(
  req: Request,
  res: Response,
): Promise<void> {
  await runListRisksHandler(req, res, { listRisks, iterateVisibleRiskDtos });
}

export async function listReviewQueueHandler(
  req: Request,
  res: Response,
): Promise<void> {
  // Ownership filter: ?assignee=<userId> | "unassigned" | "me"
  const assigneeParam =
    typeof req.query.assignee === "string" ? req.query.assignee.trim() : "";
  let assignedTo: string | "unassigned" | undefined;
  if (assigneeParam === "unassigned") {
    assignedTo = "unassigned";
  } else if (assigneeParam === "me") {
    assignedTo = req.user?.sub;
  } else if (assigneeParam) {
    assignedTo = assigneeParam;
  }
  // Optional server-side paging. Absent => legacy behaviour (every matching row).
  const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
  const rawOffset = Number.parseInt(String(req.query.offset ?? ""), 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 200)
      : undefined;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : undefined;

  const result = await listReviewQueueRisks({
    ...(assignedTo ? { assignedTo } : {}),
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
  });
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

export async function remapReviewDomainHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw HttpError.unauthorized("Authentication required.");
  }

  const riskId = String(req.params.id ?? "").trim();
  const body = (req.body ?? {}) as { domain?: string };
  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  if (!domain) {
    throw HttpError.unprocessable("Select one of the 7 available taxonomy domains.");
  }
  const reviewer = await resolveReviewer(userId);
  const result = await remapReviewDomain(riskId, { domain, reviewer });
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