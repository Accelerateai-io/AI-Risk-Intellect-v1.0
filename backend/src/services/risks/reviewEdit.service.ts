import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { risks } from "../../schema/risks/risks.js";
import { riskEditLogs } from "../../schema/risks/riskEditLogs.js";
import { HttpError } from "../../utils/httpError.js";
import { normalizeToCatalogDomain } from "./riskCatalogMatch.service.js";
import { mapRiskRowToDto, type RiskDto } from "./riskDto.js";
import type { ReviewerInfo } from "./riskReview.service.js";
import { resolveRiskUuid } from "./riskResolve.js";
import { fetchGlobalRiskDisplayIdMap } from "./riskSequence.js";
import {
  buildRiskFieldEdit,
  RiskFieldValidationError,
} from "./reviewEditableFields.js";

export type EditRiskFieldsInput = {
  patch: Record<string, unknown>;
  reason?: string;
  reviewer: ReviewerInfo;
};

/** Re-read the row through the same DTO path downstream consumers use. */
async function loadRiskDto(uuid: string): Promise<RiskDto> {
  const [row] = await db
    .select({
      id: risks.id,
      articleId: risks.articleId,
      riskTitle: risks.riskTitle,
      domains: risks.domains,
      primaryRisk: risks.primaryRisk,
      secondaryRisk: risks.secondaryRisk,
      sector: risks.sector,
      industry: risks.industry,
      intent: risks.intent,
      qualityScore: risks.qualityScore,
      likelihood: risks.likelihood,
      impact: risks.impact,
      severityScore: risks.severityScore,
      severityBand: risks.severityBand,
      aiProductName: risks.aiProductName,
      aiProductVendor: risks.aiProductVendor,
      extractionJson: risks.extractionJson,
      modelName: risks.modelName,
      sourceFlag: risks.sourceFlag,
      createdAt: risks.createdAt,
      articleTitle: articles.title,
      articleUrl: articles.url,
    })
    .from(risks)
    .innerJoin(articles, eq(risks.articleId, articles.id))
    .where(eq(risks.id, uuid))
    .limit(1);

  if (!row) throw HttpError.notFound("Risk not found.");
  const displayId = (await fetchGlobalRiskDisplayIdMap()).get(row.id) ?? "R-?";
  return mapRiskRowToDto(row, displayId);
}

/**
 * Apply a human correction to a risk's reviewable fields.
 *
 * Transaction-safe: the field update AND its provenance log commit together, or
 * not at all. Only the tested server-side allow-list is honored; severity is
 * recomputed; the model's original extraction is preserved (column-first DTO);
 * every change is recorded in `risk_edit_logs` with old/new + the acting user.
 * Returns the authoritative corrected risk (same DTO path as GET /api/v1/risks).
 */
export async function editRiskFields(
  riskIdOrDisplayId: string,
  input: EditRiskFieldsInput,
): Promise<RiskDto> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) {
    throw HttpError.unprocessable("A reason for the change is required.");
  }

  const uuid = await resolveRiskUuid(riskIdOrDisplayId);
  if (!uuid) throw HttpError.notFound("Risk not found.");

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: risks.id,
        articleId: risks.articleId,
        riskTitle: risks.riskTitle,
        domains: risks.domains,
        primaryRisk: risks.primaryRisk,
        secondaryRisk: risks.secondaryRisk,
        sector: risks.sector,
        industry: risks.industry,
        intent: risks.intent,
        qualityScore: risks.qualityScore,
        likelihood: risks.likelihood,
        impact: risks.impact,
        aiProductName: risks.aiProductName,
        aiProductVendor: risks.aiProductVendor,
        extractionJson: risks.extractionJson,
      })
      .from(risks)
      .where(eq(risks.id, uuid))
      .for("update") // row lock: concurrent edits serialize
      .limit(1);

    if (!row) throw HttpError.notFound("Risk not found.");

    const [article] = await tx
      .select({ title: articles.title })
      .from(articles)
      .where(eq(articles.id, row.articleId))
      .limit(1);

    let result;
    try {
      result = buildRiskFieldEdit(
        {
          riskTitle: row.riskTitle,
          articleTitle: article?.title ?? null,
          domains: row.domains,
          primaryRisk: row.primaryRisk,
          secondaryRisk: row.secondaryRisk,
          sector: row.sector,
          industry: row.industry,
          intent: row.intent,
          qualityScore: row.qualityScore,
          likelihood: row.likelihood,
          impact: row.impact,
          aiProductName: row.aiProductName,
          aiProductVendor: row.aiProductVendor,
          extractionJson: (row.extractionJson ?? {}) as Record<string, unknown>,
        },
        input.patch,
        { normalizeDomain: normalizeToCatalogDomain },
      );
    } catch (err) {
      if (err instanceof RiskFieldValidationError) {
        throw HttpError.unprocessable(err.message, { field: err.field });
      }
      throw err;
    }

    if (result.changedFields.length === 0) {
      return; // no-op: nothing to persist, no audit row
    }

    // Stamp edit provenance in extraction_json WITHOUT touching review_status or
    // reviewed_by (editing content is not a review-lifecycle transition).
    const ext = result.extractionJson;
    ext.last_edited_at = new Date().toISOString();
    ext.last_edited_by = {
      user_id: input.reviewer.userId,
      username: input.reviewer.username,
      email: input.reviewer.email,
      display_name: input.reviewer.displayName,
    };

    if (result.articleUpdates.title != null) {
      await tx
        .update(articles)
        .set({
          title: result.articleUpdates.title,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, row.articleId));
    }

    await tx
      .update(risks)
      .set({
        ...result.columnUpdates,
        extractionJson: ext,
        updatedAt: new Date(),
      })
      .where(eq(risks.id, uuid));

    await tx.insert(riskEditLogs).values({
      riskId: uuid,
      editedByUserId: input.reviewer.userId,
      reason,
      changes: {
        ...result.changes,
        _editor: {
          from: null,
          to: {
            username: input.reviewer.username,
            email: input.reviewer.email,
            userId: input.reviewer.userId,
          },
        },
      },
    });
  });

  return loadRiskDto(uuid);
}
