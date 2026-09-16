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
  listReviewQueueRisks,
  listRisks,
} from "../../services/risks/risks.service.js";
import { CATALOG_DOMAINS } from "../../config/aiqRiskTaxonomy.js";
import { normalizeLabelToCatalogDomain } from "../../services/risks/riskDomainResolver.service.js";
import { HttpError } from "../../utils/httpError.js";
import { assertAdminUser } from "../../utils/isAdminUser.js";

const MAX_LIST_LIMIT = 200;

function queryString(value: unknown): string | undefined {
  if (Array.isArray(value)) return queryString(value[0]);
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function queryNumber(value: unknown): number | undefined {
  const raw = queryString(value);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Comma-separated or repeated `domains`, narrowed to canonical taxonomy values. */
function queryDomains(value: unknown): string[] | undefined {
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (parts.length === 0) return undefined;
  const canonical = parts
    .map((entry) => normalizeLabelToCatalogDomain(entry))
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);
  const unique = [...new Set<string>(canonical)];
  if (unique.length === 0) {
    throw HttpError.unprocessable(
      `No recognised value in "domains". Expected any of: ${CATALOG_DOMAINS.join(", ")}.`,
    );
  }
  return unique;
}

function queryUpdatedSince(value: unknown): string | undefined {
  const raw = queryString(value);
  if (raw === undefined) return undefined;
  if (Number.isNaN(new Date(raw).getTime())) {
    throw HttpError.unprocessable("`updated_since` must be an ISO-8601 timestamp.");
  }
  return raw;
}

function queryFlag(value: unknown, defaultValue: boolean): boolean {
  const raw = queryString(value);
  if (raw === undefined) return defaultValue;
  const lower = raw.toLowerCase();
  if (lower === "0" || lower === "false" || lower === "no") return false;
  if (lower === "1" || lower === "true" || lower === "yes") return true;
  return defaultValue;
}

export async function listRisksHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.query ?? {};
  const limit = queryNumber(query.limit);
  const primaryKeyRaw = queryString(query.primaryKey ?? query.primary_risk);
  const primaryKey =
    primaryKeyRaw === "technical" ||
    primaryKeyRaw === "operational" ||
    primaryKeyRaw === "business"
      ? primaryKeyRaw
      : undefined;
  const orderRaw = queryString(query.order);
  const order =
    orderRaw === "oldest" ||
    orderRaw === "score" ||
    orderRaw === "severity" ||
    orderRaw === "newest"
      ? orderRaw
      : undefined;
  const result = await listRisks({
    sector: queryString(query.sector),
    domains: queryDomains(query.domains),
    minQuality: queryNumber(query.minQuality ?? query.min_quality),
    updatedSince: queryUpdatedSince(query.updated_since ?? query.updatedSince),
    search: queryString(query.search),
    primaryKey,
    tagKey: queryString(query.tag ?? query.tagKey),
    order,
    limit:
      limit === undefined
        ? 50
        : Math.min(MAX_LIST_LIMIT, Math.max(0, limit)),
    offset: queryNumber(query.offset) ?? 0,
    includeMetrics: queryFlag(query.includeMetrics ?? query.metrics, true),
  });
  res.status(200).json(result);
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
  const result = await listReviewQueueRisks(
    assignedTo ? { assignedTo } : {},
  );
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
  const skipRaw = queryString(req.query.skipCatalogMatches);
  const ensureRaw = queryString(req.query.ensureCatalogMatches);
  const computeCatalogMatches =
    ensureRaw === "1" || ensureRaw === "true"
      ? true
      : skipRaw === "1" || skipRaw === "true"
        ? false
        : true;
  const risk = await getRiskById(riskId, { computeCatalogMatches });
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
  assertAdminUser(req.user, "Only Admin users can edit risks in Review.");

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
