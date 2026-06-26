import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { risks } from "../../schema/risks/risks.js";
import {
  pythonExtractRisk,
  StubExtractionError,
  type RiskExtractionObject,
} from "../../extraction/pythonBridge.js";
import {
  findCatalogRiskMatches,
  isDomainInTaxonomy,
  mergeCatalogMatchesIntoExtraction,
  resolveCatalogDomain,
} from "../risks/riskCatalogMatch.service.js";
import { recordObservabilityMetrics } from "../observability/observability.service.js";
import {
  NON_ENGLISH_REVIEW_REASON,
  resolveQualityScore100,
} from "../risks/riskQuality.js";
import {
  detectTextLanguage,
  isEnglishLanguageCode,
} from "../../utils/languageDetect.js";
import { translateTextToEnglish } from "../../utils/translateTextToEnglish.js";
import {
  localizeArticleTitleForStorage,
  persistEnglishArticleTitle,
  resolveEnglishArticleTitle,
} from "../../services/articles/articleTitleLocalization.js";
import { withUsModelPrefix } from "../../utils/bedrockModelId.js";

export type ExtractRiskResult =
  | { outcome: "done"; riskId: string; created: boolean }
  | { outcome: "skipped"; reason: string };

const UNKNOWN_MODEL_KEY = "__unknown__";

/** Normalize model id for comparison (case-insensitive, trimmed, with `us.` prefix). */
export function normalizeModelKey(modelName: string | null | undefined): string {
  const key = withUsModelPrefix(modelName ?? "").toLowerCase();
  return key || UNKNOWN_MODEL_KEY;
}

function displayModelName(modelName: string): string {
  return withUsModelPrefix(modelName);
}

async function findExistingRiskForArticleModel(
  articleId: number,
  modelKey: string,
): Promise<{ id: string; modelName: string | null; qualityScore: number | null } | null> {
  const rows = await db
    .select({
      id: risks.id,
      modelName: risks.modelName,
      qualityScore: risks.qualityScore,
    })
    .from(risks)
    .where(eq(risks.articleId, articleId));

  for (const row of rows) {
    if (normalizeModelKey(row.modelName) === modelKey) {
      return row;
    }
  }
  return null;
}

async function applyEnglishLocalizedFields(input: {
  riskTitle: string;
  articleTitle: string | null;
  articleText: string;
  extractionJson: Record<string, unknown>;
  resolvedModel: string;
}): Promise<{ riskTitle: string; articleTitle: string | null }> {
  let { riskTitle, articleTitle } = input;
  const originalRiskTitle = riskTitle.trim() || "Untitled risk";
  const translatedRiskTitle = await translateTextToEnglish(
    originalRiskTitle,
    input.resolvedModel,
  );
  if (translatedRiskTitle && translatedRiskTitle !== originalRiskTitle) {
    input.extractionJson.original_risk_title = originalRiskTitle;
    input.extractionJson.english_risk_title = translatedRiskTitle;
    riskTitle = translatedRiskTitle;
    const risk = input.extractionJson.risk;
    if (risk && typeof risk === "object" && !Array.isArray(risk)) {
      (risk as Record<string, unknown>).risk_title = translatedRiskTitle;
    }
  }

  const articleResolved = await resolveEnglishArticleTitle({
    title: articleTitle,
    rawText: input.articleText,
    cachedEnglishTitle:
      typeof input.extractionJson.english_article_title === "string"
        ? input.extractionJson.english_article_title
        : null,
  });
  if (articleResolved.title) {
    const originalArticleTitle = articleTitle?.trim() ?? "";
    if (
      articleResolved.translated &&
      originalArticleTitle &&
      articleResolved.title !== originalArticleTitle
    ) {
      input.extractionJson.original_article_title = originalArticleTitle;
      input.extractionJson.english_article_title = articleResolved.title;
    }
    articleTitle = articleResolved.title;
  }

  return { riskTitle, articleTitle };
}

async function buildPersistedExtraction(input: {
  articleId: number;
  articleText: string;
  articleTitle: string | null;
  result: Awaited<ReturnType<typeof pythonExtractRisk>>;
  resolvedModel: string;
}) {
  const risk = input.result.object.risk ?? {};
  let riskTitle = (risk.risk_title as string) || "Untitled risk";
  const rawDomain = String(risk.domains ?? "").trim();
  const description = String(risk.description ?? "").trim();
  const domainResolution = resolveCatalogDomain({
    llmDomain: rawDomain,
    title: riskTitle,
    description: description || riskTitle,
    articleText: input.articleText,
  });
  const domains = domainResolution.domain ?? (rawDomain || null);
  const inTaxonomy = isDomainInTaxonomy(domains ?? "");

  const catalogMatches = await findCatalogRiskMatches({
    domain: domains ?? "",
    title: riskTitle,
    description: description || riskTitle,
    primaryRisk: (risk.primary_risk as string) ?? undefined,
    secondaryRisk: (risk.secondary_risks as string) ?? undefined,
    limit: 5,
  });

  const extractionJson = mergeCatalogMatchesIntoExtraction(
    {
      ...(input.result.object as Record<string, unknown>),
      risk: {
        ...(risk as Record<string, unknown>),
        ...(domains ? { domains } : {}),
      },
      domain_resolution: {
        llm_domain: domainResolution.llmDomain,
        resolved_domain: domainResolution.domain,
        method: domainResolution.method,
        confidence: Math.round(domainResolution.confidence * 100),
        definition_scores: domainResolution.definitionScores
          .slice(0, 3)
          .map((score) => ({
            catalog_domain: score.catalogDomain,
            aiq_name: score.aiqName,
            score_percent: Math.round(score.score * 100),
            keyword_hits: score.keywordHits,
            matched_keywords: score.matchedKeywords.slice(0, 8),
          })),
      },
    },
    catalogMatches,
  );

  if (!inTaxonomy) {
    extractionJson.review_status = "pending";
    extractionJson.review_reason =
      "Extracted domain does not match any of the 7 risk taxonomy domains.";
  }

  const sourceLanguage = await detectTextLanguage(input.articleText);
  if (sourceLanguage) {
    extractionJson.source_language = sourceLanguage;
  }
  let articleTitle = input.articleTitle;
  if (sourceLanguage && !isEnglishLanguageCode(sourceLanguage)) {
    extractionJson.is_non_english = true;
    extractionJson.review_status = "pending";
    const existingReason = String(extractionJson.review_reason ?? "").trim();
    extractionJson.review_reason = existingReason
      ? `${existingReason} ${NON_ENGLISH_REVIEW_REASON}`
      : NON_ENGLISH_REVIEW_REASON;
    const localized = await applyEnglishLocalizedFields({
      riskTitle,
      articleTitle: input.articleTitle,
      articleText: input.articleText,
      extractionJson,
      resolvedModel: input.resolvedModel,
    });
    riskTitle = localized.riskTitle;
    articleTitle = localized.articleTitle;
  }

  return {
    riskTitle,
    articleTitle,
    domains,
    primaryRisk: (risk.primary_risk as string) ?? null,
    secondaryRisk: (risk.secondary_risks as string) ?? null,
    sector: (risk.sector as string) ?? null,
    industry: (risk.industry as string) ?? null,
    intent: (risk.intent as string) ?? null,
    qualityScore: qualityScoreFromObject(input.result.object),
    extractionJson,
    modelName: input.resolvedModel,
    sourceFlag: input.result.sourceFlag,
  };
}

function toRiskInsertValues(
  persisted: Awaited<ReturnType<typeof buildPersistedExtraction>>,
) {
  const { articleTitle: _articleTitle, ...riskRow } = persisted;
  return riskRow;
}

function qualityScoreFromObject(obj: RiskExtractionObject): number | null {
  return resolveQualityScore100({
    qualityScore: null,
    extractionJson: obj,
  });
}

async function persistTranslatedArticleTitle(
  articleId: number,
  _currentTitle: string | null,
  nextTitle: string | null | undefined,
): Promise<void> {
  await persistEnglishArticleTitle(articleId, nextTitle ?? null);
}

/**
 * Run LLM risk extraction on ingested article text and persist `risks` row.
 * At most one risk per (article, model). Re-runs with the same model return the
 * existing risk without inserting a duplicate.
 * Stub/fallback extractions return `skipped` (not persisted).
 */
export async function extractRiskForArticle(
  articleId: number,
): Promise<ExtractRiskResult> {
  const [article] = await db
    .select({
      id: articles.id,
      url: articles.url,
      title: articles.title,
      rawText: articles.rawText,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);

  if (!article) {
    return { outcome: "skipped", reason: "article not found" };
  }

  const text = article.rawText?.trim() ?? "";
  if (!text) {
    return { outcome: "skipped", reason: "no article text for extraction" };
  }

  try {
    const result = await pythonExtractRisk({
      text,
      title: article.title ?? "",
      url: article.url,
    });

    const resolvedModel = displayModelName(result.model);
    const modelKey = normalizeModelKey(resolvedModel);
    const existing = await findExistingRiskForArticleModel(articleId, modelKey);

    await recordObservabilityMetrics({
      modelName: resolvedModel,
      url: article.url,
      wordCount:
        result.metrics.word_count > 0
          ? result.metrics.word_count
          : text.split(/\s+/).filter(Boolean).length,
      tokensGenerated: result.metrics.tokens_generated,
      durationMs: result.metrics.duration_ms,
    });

    if (existing) {
      const persisted = await buildPersistedExtraction({
        articleId,
        articleText: text,
        articleTitle: article.title,
        result,
        resolvedModel,
      });
      const shouldRefreshStoredScore =
        (existing.qualityScore == null || existing.qualityScore === 0) &&
        persisted.qualityScore != null &&
        persisted.qualityScore > 0;
      const shouldRefreshNonEnglish = Boolean(
        (persisted.extractionJson as { is_non_english?: boolean }).is_non_english,
      );

      if (shouldRefreshStoredScore || shouldRefreshNonEnglish) {
        await db
          .update(risks)
          .set({
            ...toRiskInsertValues(persisted),
            updatedAt: new Date(),
          })
          .where(eq(risks.id, existing.id));
      }

      await persistTranslatedArticleTitle(
        articleId,
        article.title,
        persisted.articleTitle,
      );

      return {
        outcome: "done",
        riskId: existing.id,
        created: false,
      };
    }

    const persisted = await buildPersistedExtraction({
      articleId,
      articleText: text,
      articleTitle: article.title,
      result,
      resolvedModel,
    });

    const [row] = await db
      .insert(risks)
      .values({
        articleId: article.id,
        ...toRiskInsertValues(persisted),
      })
      .returning({ id: risks.id });

    await persistTranslatedArticleTitle(
      articleId,
      article.title,
      persisted.articleTitle,
    );

    await db
      .update(articles)
      .set({
        riskCount: sql`${articles.riskCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(articles.id, articleId));

    return { outcome: "done", riskId: row!.id, created: true };
  } catch (err) {
    if (err instanceof StubExtractionError) {
      // StubExtractionError means Python responded; the LLM path ran but returned
      // a fallback object (Bedrock/JSON failure, etc.). Do not append dev-setup hints.
      return { outcome: "skipped", reason: err.message };
    }
    throw err;
  }
}
