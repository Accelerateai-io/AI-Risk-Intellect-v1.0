import { normalizeNarrativeText } from "../../utils/normalizeNarrativeText.js";
import { decodeDisplayTitle } from "../../utils/decodeHtmlEntities.js";
import { parseCatalogMatchesFromExtraction } from "./riskCatalogMatch.service.js";
import { resolveQualityScore100, resolveReviewWhy } from "./riskQuality.js";
import {
  impactLabel,
  likelihoodLabel,
  resolveRiskScoring,
} from "./riskScoring.js";

export type EvidenceBreakdownItem = {
  field: string;
  strength: string;
  sourceText: string;
  specificity?: string;
  taxonomyAlignment?: string;
};

export type ReviewQueueItemDto = {
  id: string;
  displayId: string;
  title: string;
  domain: string;
  primaryRisk: string;
  secondaryRisk: string;
  qualityScore: number | null;
  scoreLabel: string;
  priority: "Low" | "Medium" | "High";
  category: string;
  reviewWhy: string;
  reviewReason: string;
  articleUrl: string;
  ingestedAt: string;
};

export type HumanReviewInfo = {
  status: "pending" | "approved" | "rejected" | "classified" | null;
  classification: "raw" | "structured" | null;
  reviewedBy: string | null;
  reviewedByUsername: string | null;
  reviewedAt: string | null;
  feedback: string | null;
};

export type CatalogRiskMatchDto = {
  riskId: string;
  title: string;
  description: string;
  domain: string;
  accuracyPercent: number;
  domainMatchPercent: number;
  descriptionMatchPercent: number;
  matchSummary: string;
};

export type VerifierCheckDto = {
  name: string;
  pass: boolean | null;
  reason: string;
};

/** Evidence-discipline fields (BUG-01/02/03) and verifier verdict (BUG-06). */
export type EvidenceDisciplineDto = {
  sourceType: string | null;
  evidenceType: string | null;
  demonstratedFinding: string | null;
  statedImplication: string | null;
  paperStance: string | null;
  proposedMitigation: string | null;
  mitigationsInSource: string[];
  reviewReasons: string[];
  verifier: {
    ran: boolean;
    passed: boolean | null;
    groundingScore: number | null;
    checks: VerifierCheckDto[];
    unsupportedClaims: string[];
    modelUsed: string | null;
  } | null;
  extraction: {
    mode: string | null;
    chunks: number | null;
    llmCalls: number | null;
    mergeStrategy: string | null;
    modelUsed: string | null;
    modelFallback: boolean;
    referencesRemoved: boolean | null;
  };
};

export type RiskDto = {
  id: string;
  /** Sequential display id (R-1, R-01, R-10, …). */
  displayId: string;
  title: string;
  domain: string;
  primaryRisk: string;
  secondaryRisk: string;
  sector: string;
  industry: string;
  intent: string;
  /** Display string on the 0–1 scale, or "—" when unscored. Not machine-safe. */
  qualityScore: string;
  /** Same value as a number on the 0–1 scale, or null. Use this for thresholds. */
  qualityScoreUnit: number | null;
  reviewWhy: string;
  reviewReason: string;
  primaryKey: string;
  tagKey: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  description: string;
  attackVector: string;
  observableIndicators: string;
  timing: string;
  articleId: number;
  articleTitle: string;
  articleUrl: string;
  ingestedAt: string;
  modelName: string | null;
  riskScoring: {
    likelihood: number | null;
    likelihoodLabel: string;
    impact: number | null;
    impactLabel: string;
    severityScore: number | null;
    severityBand: string;
    likelihoodReasoning: string;
    impactReasoning: string;
    lossCategories: string[];
  };
  product: {
    name: string | null;
    vendor: string | null;
  };
  humanReview: HumanReviewInfo;
  riskAnalysis: {
    risk_identified: string;
    article_context: string;
    alignment_reasoning: string;
    /** Top catalog matches from `risk_mappings` (detail view only). */
    catalogMatches: CatalogRiskMatchDto[];
  };
  modelSelfEvaluation: {
    decision_rationale: string;
  };
  scores: {
    overall: { value: number; max: number };
    metrics: {
      label: string;
      value: number;
      max: number;
      reasoning?: string;
    }[];
    justification: {
      decision_rationale: string;
      context_clarity_reasoning?: string;
      keyword_reasoning?: string;
      tagging_reasoning?: string;
      evidence_reasoning?: string;
    };
  };
  evidence: {
    snippet: string;
    sources: string;
    dataToIdentifyRisk: string;
    breakdown: EvidenceBreakdownItem[];
  };
  evidenceDiscipline: EvidenceDisciplineDto;
};

type ExtractionMeta = {
  model_used?: unknown;
  model_fallback?: unknown;
  verification?: { review_reasons?: unknown };
  verifier?: Record<string, unknown>;
  extraction?: Record<string, unknown>;
};

type ExtractionJson = {
  _meta?: ExtractionMeta;
  risk?: Record<string, unknown>;
  risk_scoring?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  review_status?: string;
  review_classification?: string;
  review_feedback?: string;
  reviewed_at?: string;
  approved_at?: string;
  rejected_at?: string;
  classified_at?: string;
  reviewed_by?: {
    user_id?: string;
    username?: string;
    email?: string;
    display_name?: string;
  };
  justification?: {
    self_assessment?: Record<string, unknown>;
    decision_rationale?: string;
    evidence_breakdown?: Array<Record<string, unknown>>;
  };
  controls?: Array<Record<string, unknown>>;
  /** Catalog `risk_mappings` IDs matched at extraction time. */
  catalog_matches?: unknown[];
  is_non_english?: boolean;
  english_risk_title?: string;
  original_risk_title?: string;
  english_article_title?: string;
  original_article_title?: string;
};

type RiskRowInput = {
  id: string;
  articleId: number;
  riskTitle: string;
  domains: string | null;
  primaryRisk: string | null;
  secondaryRisk: string | null;
  sector: string | null;
  industry: string | null;
  intent: string | null;
  qualityScore: number | null;
  likelihood: number | null;
  impact: number | null;
  severityScore: number | null;
  severityBand: string | null;
  aiProductName: string | null;
  aiProductVendor: string | null;
  extractionJson: unknown;
  modelName: string | null;
  createdAt: Date;
  articleTitle: string | null;
  articleUrl: string;
};

function str(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v).trim();
}

function resolveEnglishRiskTitle(
  row: Pick<RiskRowInput, "riskTitle">,
  ext: ExtractionJson,
  risk: Record<string, unknown>,
): string {
  const english = decodeDisplayTitle(str(ext.english_risk_title));
  if (english) return english;

  const fromJson = decodeDisplayTitle(str(risk.risk_title));
  const fromColumn = decodeDisplayTitle(str(row.riskTitle));
  const original = decodeDisplayTitle(str(ext.original_risk_title));

  if (fromJson && original && fromJson !== original) return fromJson;
  if (fromColumn && original && fromColumn !== original) return fromColumn;
  return fromColumn || fromJson || "Untitled risk";
}

function resolveEnglishArticleTitle(
  row: Pick<RiskRowInput, "articleTitle" | "articleUrl">,
  ext: ExtractionJson,
): string {
  const english = decodeDisplayTitle(str(ext.english_article_title));
  if (english) return english;

  const fromColumn = decodeDisplayTitle(str(row.articleTitle));
  const original = decodeDisplayTitle(str(ext.original_article_title));
  if (fromColumn && original && fromColumn !== original) return fromColumn;
  return fromColumn || row.articleUrl;
}

/** Full narrative text for UI — never word-capped; strips only a trailing fragment. */
function narrative(v: unknown, fallback = ""): string {
  const raw = str(v, fallback);
  if (!raw) return raw;
  return normalizeNarrativeText(raw);
}

function primaryKeyFromLabel(primary: string): string {
  const l = primary.toLowerCase();
  if (l.includes("operational")) return "operational";
  if (l.includes("business")) return "business";
  return "technical";
}

function tagKeyFromDomain(domain: string): string {
  const d = domain.toLowerCase();
  if (d.includes("discrimination") || d.includes("toxicity")) return "bias";
  if (d.includes("privacy") || d.includes("security")) return "privacy";
  if (d.includes("safety") || d.includes("failure")) return "safety";
  return "general";
}

function confidenceFromScore(
  score: number | null,
  level?: string,
): RiskDto["confidence"] {
  const lvl = (level ?? "").toLowerCase();
  if (lvl === "high") return "HIGH";
  if (lvl === "medium") return "MEDIUM";
  if (lvl === "low") return "LOW";
  if (score == null) return "MEDIUM";
  if (score >= 85) return "HIGH";
  if (score >= 65) return "MEDIUM";
  return "LOW";
}

/** Stored scores are 0–100; the API publishes 0–1. */
function qualityScoreToUnit(score: number | null): number | null {
  if (score == null) return null;
  return Number((score <= 1 ? score : score / 100).toFixed(2));
}

function formatQualityScore(score: number | null): string {
  const unit = qualityScoreToUnit(score);
  return unit == null ? "—" : unit.toFixed(2);
}

function mapEvidenceBreakdown(
  items: Array<Record<string, unknown>>,
): EvidenceBreakdownItem[] {
  return items
    .map((item) => ({
      field: str(item.field, "Evidence"),
      strength: str(item.strength),
      sourceText: narrative(item.source_text),
      specificity: str(item.specificity) || undefined,
      taxonomyAlignment: str(item.taxonomy_alignment) || undefined,
    }))
    .filter((item) => item.sourceText.length > 0);
}

function parseHumanReview(ext: ExtractionJson): HumanReviewInfo {
  const statusRaw = str(ext.review_status).toLowerCase();
  const status =
    statusRaw === "approved" ||
    statusRaw === "rejected" ||
    statusRaw === "classified" ||
    statusRaw === "pending"
      ? statusRaw
      : null;

  const classificationRaw = str(ext.review_classification).toLowerCase();
  const classification =
    classificationRaw === "raw" || classificationRaw === "structured"
      ? classificationRaw
      : null;

  const reviewedByRecord = ext.reviewed_by;
  const reviewedBy =
    str(reviewedByRecord?.display_name) ||
    str(reviewedByRecord?.username) ||
    str(reviewedByRecord?.email) ||
    null;

  return {
    status,
    classification,
    reviewedBy,
    reviewedByUsername: str(reviewedByRecord?.username) || null,
    reviewedAt:
      str(ext.reviewed_at) ||
      str(ext.approved_at) ||
      str(ext.rejected_at) ||
      str(ext.classified_at) ||
      null,
    feedback: str(ext.review_feedback) || null,
  };
}

function strOrNull(v: unknown): string | null {
  const text = str(v);
  return text ? text : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function stringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  const single = str(v);
  return single ? [single] : [];
}

const VERIFIER_CHECK_ORDER = [
  "claim_is_demonstrated",
  "mitigations_reflected",
  "not_attributed_to_proposed_method",
  "severity_within_evidence",
];

/** Evidence fields the reviewer must see to judge Patterns 1, 3 and 6. */
export function mapEvidenceDiscipline(ext: ExtractionJson): EvidenceDisciplineDto {
  const risk = ext.risk ?? {};
  const meta = ext._meta ?? {};
  const verifierRaw = meta.verifier;
  const extractionRaw = meta.extraction ?? {};
  const preprocess = (extractionRaw.preprocess ?? {}) as Record<string, unknown>;

  let verifier: EvidenceDisciplineDto["verifier"] = null;
  if (verifierRaw && typeof verifierRaw === "object") {
    const ran = verifierRaw.ran === true;
    const checksRaw = (verifierRaw.checks ?? {}) as Record<string, unknown>;
    const checks: VerifierCheckDto[] = VERIFIER_CHECK_ORDER.filter(
      (name) => name in checksRaw,
    ).map((name) => {
      const entry = (checksRaw[name] ?? {}) as Record<string, unknown>;
      return {
        name,
        pass: boolOrNull(entry.pass),
        reason: str(entry.reason),
      };
    });
    verifier = {
      ran,
      passed: ran ? boolOrNull(verifierRaw.passed) : null,
      groundingScore: numOrNull(verifierRaw.grounding_score),
      checks,
      unsupportedClaims: stringList(verifierRaw.unsupported_claims),
      modelUsed: strOrNull(verifierRaw.model_used),
    };
  }

  return {
    sourceType: strOrNull(risk.source_type),
    evidenceType: strOrNull(risk.evidence_type),
    demonstratedFinding: strOrNull(risk.demonstrated_finding),
    statedImplication: strOrNull(risk.stated_implication),
    paperStance: strOrNull(risk.paper_stance),
    proposedMitigation: strOrNull(risk.proposed_mitigation),
    mitigationsInSource: stringList(risk.mitigations_in_source),
    reviewReasons: stringList(meta.verification?.review_reasons),
    verifier,
    extraction: {
      mode: strOrNull(extractionRaw.mode),
      chunks: numOrNull(extractionRaw.chunks),
      llmCalls: numOrNull(extractionRaw.llm_calls),
      mergeStrategy: strOrNull(extractionRaw.merge_strategy),
      modelUsed: strOrNull(meta.model_used ?? extractionRaw.model_used),
      modelFallback: meta.model_fallback === true,
      referencesRemoved: boolOrNull(preprocess.references_removed),
    },
  };
}

export function mapRiskRowToDto(
  row: RiskRowInput,
  displayId: string,
): RiskDto {
  const ext = (row.extractionJson ?? {}) as ExtractionJson;
  const catalogMatches = (parseCatalogMatchesFromExtraction(ext) ?? []).map(
    (match) => ({
      ...match,
      description: narrative(match.description, "No description available."),
      matchSummary: narrative(match.matchSummary),
    }),
  );
  const risk = ext.risk ?? {};
  const analysis = ext.analysis ?? {};
  const justification = ext.justification ?? {};
  const self = justification.self_assessment ?? {};

  const domain = str(row.domains ?? risk.domains, "—");
  const primaryRisk = str(row.primaryRisk ?? risk.primary_risk, "—");
  const secondaryRisk = str(row.secondaryRisk ?? risk.secondary_risks, "—");
  const quality = resolveQualityScore100({
    qualityScore: row.qualityScore,
    extractionJson: ext,
  });

  const description = narrative(risk.description);

  const scoreMetrics: RiskDto["scores"]["metrics"] = [
    {
      label: "Context Clarity",
      value: Number(self.context_clarity_score ?? 0),
      max: 45,
      reasoning: narrative(self.context_clarity_reasoning),
    },
    {
      label: "Keyword Matching",
      value: Number(self.keyword_score ?? 0),
      max: 20,
      reasoning: narrative(self.keyword_reasoning),
    },
    {
      label: "Tagging Accuracy",
      value: Number(self.tagging_accuracy_score ?? 0),
      max: 20,
      reasoning: narrative(self.tagging_reasoning),
    },
    {
      label: "Evidence Strength",
      value: Number(self.evidence_strength_score ?? 0),
      max: 15,
      reasoning: narrative(self.evidence_reasoning),
    },
  ];

  const evidenceBreakdown = mapEvidenceBreakdown(
    justification.evidence_breakdown ?? [],
  );
  const firstEvidence = evidenceBreakdown[0];

  const decisionRationale = narrative(
    self.decision_rationale ?? justification.decision_rationale,
  );

  const reviewWhy = resolveReviewWhy({
    qualityScore: row.qualityScore,
    extractionJson: ext,
    domains: row.domains,
  });
  const scoring = resolveRiskScoring({
    likelihood: row.likelihood,
    impact: row.impact,
    extractionJson: ext,
  });
  const productName =
    str(row.aiProductName ?? risk.ai_product_name) || null;
  const productVendor = productName
    ? str(row.aiProductVendor ?? risk.ai_product_vendor) || null
    : null;

  return {
    id: row.id,
    displayId,
    title: resolveEnglishRiskTitle(row, ext, risk),
    domain,
    primaryRisk,
    secondaryRisk,
    sector: str(row.sector ?? risk.sector, "—"),
    industry: str(row.industry ?? risk.industry, "—"),
    intent: str(row.intent ?? risk.intent, "—"),
    qualityScore: formatQualityScore(
      typeof quality === "number" && !Number.isNaN(quality) ? quality : null,
    ),
    qualityScoreUnit: qualityScoreToUnit(
      typeof quality === "number" && !Number.isNaN(quality) ? quality : null,
    ),
    reviewWhy: reviewWhy.label,
    reviewReason: reviewWhy.reason,
    primaryKey: primaryKeyFromLabel(primaryRisk),
    tagKey: tagKeyFromDomain(domain),
    confidence: confidenceFromScore(
      typeof quality === "number" && !Number.isNaN(quality) ? quality : null,
      str(self.confidence_level),
    ),
    description,
    attackVector: narrative(risk.attack_vector),
    observableIndicators: narrative(risk.observable_indicators),
    timing: narrative(risk.timing),
    articleId: row.articleId,
    articleTitle: resolveEnglishArticleTitle(row, ext),
    articleUrl: row.articleUrl,
    ingestedAt: row.createdAt.toISOString(),
    modelName: row.modelName,
    riskScoring: {
      likelihood: scoring.likelihood,
      likelihoodLabel: likelihoodLabel(scoring.likelihood) ?? "—",
      impact: scoring.impact,
      impactLabel: impactLabel(scoring.impact) ?? "—",
      severityScore: scoring.severityScore,
      severityBand: scoring.severityBand ?? "—",
      likelihoodReasoning: scoring.likelihoodReasoning,
      impactReasoning: scoring.impactReasoning,
      lossCategories: scoring.lossCategories,
    },
    product: {
      name: productName,
      vendor: productVendor,
    },
    humanReview: parseHumanReview(ext),
    riskAnalysis: {
      risk_identified: narrative(analysis.risk_identified),
      article_context: narrative(analysis.article_context),
      alignment_reasoning: narrative(analysis.alignment_reasoning),
      catalogMatches,
    },
    modelSelfEvaluation: {
      decision_rationale: decisionRationale,
    },
    scores: {
      overall: {
        value: Number(quality ?? self.total_score ?? 0),
        max: 100,
      },
      metrics: scoreMetrics,
      justification: {
        decision_rationale: decisionRationale,
        context_clarity_reasoning: narrative(self.context_clarity_reasoning),
        keyword_reasoning: narrative(self.keyword_reasoning),
        tagging_reasoning: narrative(self.tagging_reasoning),
        evidence_reasoning: narrative(self.evidence_reasoning),
      },
    },
    evidence: {
      snippet: narrative(firstEvidence?.sourceText ?? description),
      sources: narrative(risk.evidence_sources),
      dataToIdentifyRisk: narrative(risk.data_to_identify_risk),
      breakdown: evidenceBreakdown,
    },
    evidenceDiscipline: mapEvidenceDiscipline(ext),
  };
}
