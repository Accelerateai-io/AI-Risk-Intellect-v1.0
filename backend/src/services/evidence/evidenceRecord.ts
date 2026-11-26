/**
 * Evidence Record v1 (`evidence-record-1.0`): what AIRI exports to AI-Q over the
 * Evidence Bridge. Spec: AIRI Evidence Bridge Build Spec v1.3, sections 3 and 4.
 *
 * Pure functions only (no DB). Ported from the reference mapping shipped with the
 * sample file (reference/mapFromAiri.mjs) so the live export and the sample agree.
 */
import type { RiskDto } from "../risks/riskDto.js";
import { FACTS_V2_PIPELINE_VERSION } from "../risks/riskDto.js";
import { contentHash } from "./canonicalJson.js";

export const EVIDENCE_SCHEMA_VERSION = "evidence-record-1.0";

export const EVIDENCE_DOMAINS = [
  "Discrimination and Toxicity",
  "Privacy and Security",
  "Misinformation",
  "Malicious Actors and Misuse",
  "Human-Computer Interaction",
  "Socioeconomic and Environmental",
  "AI System Safety, Failures, and Limitations",
] as const;

export const EVIDENCE_CHECKS = [
  "claim_is_demonstrated",
  "mitigations_reflected",
  "not_attributed_to_proposed_method",
  "severity_within_evidence",
  "evidence_type_consistent",
  "rationale_supported",
  "domain_correct",
  "primary_secondary_correct",
  "catalog_match",
] as const;

export const RETRACTION_REASON_REPROCESSED =
  "re-processed; new version under review";
export const RETRACTION_REASON_REMOVED = "removed from AIRI";

export type EvidenceKind =
  | "research_result"
  | "reported_incident"
  | "allegation"
  | "confirmed_finding";

export type EvidenceRecordV1 = {
  schema_version: string;
  record_id: string;
  version: number;
  airi_row_id: string;
  display_id: string | null;
  checkpoint?: number;
  content_hash?: string;
  status: "verified" | "retracted";
  decision_reason: string | null;
  supersedes_version: number | null;
  retraction_reason: string | null;
  published_at: string;
  approved_by: string | null;
  approval_reason: string | null;
  approved_at: string | null;
  source_url: string | null;
  publisher: string | null;
  source_published_at: string | null;
  retrieved_at: string | null;
  document_hash: string | null;
  source_type: string | null;
  quote: string | null;
  quote_location: { start: number; end: number } | null;
  risk_title: string | null;
  summary: string | null;
  domain: string | null;
  intent: string | null;
  timing: string | null;
  evidence_kind: EvidenceKind | null;
  likelihood: number | null;
  impact: number | null;
  likelihood_rationale: string | null;
  impact_rationale: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  sector: string | null;
  industry: string | null;
  use_case_tags: string[];
  jurisdictions: string[];
  affected_groups: string[];
  vendor: string | null;
  product: string | null;
  model: string | null;
  suggested_risk_ids: string[];
  checks: Record<string, boolean | null>;
  pipeline_version: string | null;
};

const s = (v: unknown): string | null =>
  typeof v === "string" && v.trim() && v.trim() !== "—" ? v.trim() : null;
const int15 = (v: unknown): number | null =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5 ? (v as number) : null;

/** ISO 8601 UTC without milliseconds, e.g. 2026-11-24T20:00:00Z. */
export function isoUtc(v: unknown): string | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  const str = s(v);
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** research_result / reported_incident from AIRI source_type; allegation vs confirmed_finding is later AIRI work. */
export function evidenceKind(sourceType: string | null | undefined): EvidenceKind | null {
  const t = (sourceType ?? "").trim();
  if (["empirical_study", "benchmark", "preprint", "academic_paper"].includes(t)) {
    return "research_result";
  }
  if (t === "news" || t === "incident_report") return "reported_incident";
  return null;
}

export type CrossingDecision = { crosses: boolean; reason: string };

/** Which AIRI rows cross the bridge (spec section 4). */
export function crossingDecision(dto: RiskDto): CrossingDecision {
  const a = dto.assessment;
  if (!a || a.pipelineVersion !== FACTS_V2_PIPELINE_VERSION) {
    return {
      crosses: false,
      reason: "older record without a facts-v2 assessment: excluded until re-verified",
    };
  }
  const pub = a.publicationStatus;
  const reason = a.decisionReason;
  const review = dto.humanReview?.status;
  if (pub === "published" && reason === "VERIFIED") {
    return { crosses: true, reason: "published + VERIFIED" };
  }
  // Asad, 24 Nov 2026: CATALOG_SUGGESTED crosses; REPAIRED, PUBLISHED_LABELLED, PUBLISHED_WITH_NOTES stay out.
  if (pub === "published" && reason === "CATALOG_SUGGESTED") {
    return { crosses: true, reason: "published + CATALOG_SUGGESTED" };
  }
  if (pub === "held" && review === "approved") {
    // The bridge needs who approved it, when and why (spec section 3). Legacy
    // approvals without them would only be quarantined by AI-Q, so hold them back.
    const hr = dto.humanReview;
    const complete =
      !!(s(hr?.reviewedByUsername) ?? s(hr?.reviewedBy)) &&
      !!isoUtc(hr?.reviewedAt) &&
      !!s(hr?.feedback);
    return complete
      ? { crosses: true, reason: "held, approved by a person" }
      : {
          crosses: false,
          reason: "held and marked approved, but without reviewer, time and reason: not exported",
        };
  }
  if (pub === "published") {
    return { crosses: false, reason: `published + ${reason}: stays in AIRI for v1` };
  }
  if (pub === "retired") return { crosses: false, reason: "retired" };
  return {
    crosses: false,
    reason: `${pub ?? "unknown"} + ${reason ?? "no reason"}: not exported`,
  };
}

export type RecordIdentity = {
  recordId: string;
  version: number;
  publishedAt: string;
  /** articles.sha256 until AIRI keeps per-version text (spec section 3). */
  documentHash: string | null;
  /** articles.created_at until AIRI records the real fetch time (spec section 3). */
  retrievedAt: string | null;
};

function withHash(rec: EvidenceRecordV1): EvidenceRecordV1 {
  const { content_hash: _drop, ...rest } = rec;
  return { ...rest, content_hash: contentHash(rest as Record<string, unknown>) };
}

export function toEvidenceRecord(dto: RiskDto, id: RecordIdentity): EvidenceRecordV1 {
  const a = dto.assessment;
  const checks: Record<string, boolean | null> = {};
  let quote: string | null = null;
  for (const c of a?.checks ?? []) {
    if (!(EVIDENCE_CHECKS as readonly string[]).includes(c.name)) continue;
    checks[c.name] = c.pass === true || c.pass === false ? c.pass : null;
    if (c.name === "claim_is_demonstrated" && s(c.quote)) quote = s(c.quote);
  }
  const approved =
    a?.publicationStatus === "held" && dto.humanReview?.status === "approved";
  const conf = s(a?.confidence)?.toUpperCase();
  const catalog = (dto.riskAnalysis?.catalogMatches ?? [])
    .map((m) => m.riskId)
    .filter((x) => /^RISK-\d+$/.test(x ?? ""));

  return withHash({
    schema_version: EVIDENCE_SCHEMA_VERSION,
    record_id: id.recordId,
    version: id.version,
    airi_row_id: dto.id,
    display_id: s(dto.displayId),
    status: "verified",
    decision_reason: s(a?.decisionReason),
    supersedes_version: id.version > 1 ? id.version - 1 : null,
    retraction_reason: null,
    published_at: id.publishedAt,
    approved_by: approved
      ? (s(dto.humanReview?.reviewedByUsername) ?? s(dto.humanReview?.reviewedBy))
      : null,
    approval_reason: approved ? s(dto.humanReview?.feedback) : null,
    approved_at: approved ? isoUtc(dto.humanReview?.reviewedAt) : null,
    source_url: s(dto.articleUrl),
    publisher: null,
    source_published_at: null,
    retrieved_at: id.retrievedAt,
    document_hash: id.documentHash,
    source_type: s(dto.evidenceDiscipline?.sourceType),
    quote,
    quote_location: null,
    risk_title: s(dto.title),
    summary: s(dto.description),
    domain: s(dto.domain),
    intent: s(dto.intent),
    timing: s(dto.timing),
    evidence_kind: evidenceKind(dto.evidenceDiscipline?.sourceType),
    likelihood: int15(dto.riskScoring?.likelihood),
    impact: int15(dto.riskScoring?.impact),
    likelihood_rationale: s(dto.riskScoring?.likelihoodReasoning),
    impact_rationale: s(dto.riskScoring?.impactReasoning),
    confidence: conf === "HIGH" || conf === "MEDIUM" || conf === "LOW" ? conf : null,
    sector: s(dto.sector),
    industry: s(dto.industry),
    use_case_tags: [],
    jurisdictions: [],
    affected_groups: [],
    vendor: s(dto.product?.vendor),
    product: s(dto.product?.name),
    model: null,
    suggested_risk_ids: [...new Set(catalog)],
    checks,
    pipeline_version: s(a?.pipelineVersion),
  });
}

/** A retraction version: identity + lifecycle; text fields null when it is a legal removal. */
export function toRetraction(
  prev: EvidenceRecordV1,
  opts: {
    version: number;
    publishedAt: string;
    reason: string;
    airiRowId?: string;
    legal?: boolean;
    /** AIRI's current decision reason for the row, when there is one. */
    decisionReason?: string | null;
  },
): EvidenceRecordV1 {
  const legal = Boolean(opts.legal);
  return withHash({
    ...prev,
    checkpoint: undefined,
    content_hash: undefined,
    version: opts.version,
    airi_row_id: opts.airiRowId ?? prev.airi_row_id,
    status: "retracted",
    decision_reason: s(opts.decisionReason) ?? prev.decision_reason,
    supersedes_version: opts.version - 1,
    retraction_reason: opts.reason,
    published_at: opts.publishedAt,
    approved_by: null,
    approval_reason: null,
    approved_at: null,
    source_url: legal ? null : prev.source_url,
    publisher: null,
    source_published_at: null,
    quote: legal ? null : prev.quote,
    quote_location: legal ? null : prev.quote_location,
    risk_title: legal ? null : prev.risk_title,
    summary: legal ? null : prev.summary,
    likelihood_rationale: legal ? null : prev.likelihood_rationale,
    impact_rationale: legal ? null : prev.impact_rationale,
    vendor: legal ? null : prev.vendor,
    product: legal ? null : prev.product,
    model: null,
  });
}

/**
 * Same content? Compares two records ignoring the fields a new version would
 * change anyway (version, supersedes_version, published_at) and the fields that
 * are never hashed (checkpoint, display_id).
 */
export function sameContent(a: EvidenceRecordV1, b: EvidenceRecordV1): boolean {
  const norm = (r: EvidenceRecordV1) =>
    contentHash({
      ...r,
      version: 0,
      supersedes_version: null,
      published_at: "",
      content_hash: undefined,
      checkpoint: undefined,
    } as Record<string, unknown>);
  return norm(a) === norm(b);
}
