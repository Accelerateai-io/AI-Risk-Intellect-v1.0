import { CATALOG_DOMAINS } from "../../config/aiqRiskTaxonomy.js";
import {
  computeSeverityScore,
  severityBandFromScore,
} from "./riskScoring.js";

/** Normalizes a raw domain to a canonical taxonomy domain, or null if invalid. */
export type DomainNormalizer = (raw: string) => string | null;

/** Default: exact (case-insensitive) match against the 7 taxonomy domains.
 *  The service layer injects riskCatalogMatch.normalizeToCatalogDomain for fuzzy handling. */
const defaultNormalizeDomain: DomainNormalizer = (raw) => {
  const s = raw.trim();
  if (!s) return null;
  const hit = CATALOG_DOMAINS.find((d) => d.toLowerCase() === s.toLowerCase());
  return hit ?? null;
};

export type BuildRiskFieldEditOptions = {
  normalizeDomain?: DomainNormalizer;
};

/**
 * Human Review field editing — pure domain logic (no DB).
 *
 * The server-side allow-list is the ONLY authority for what a reviewer may change;
 * the frontend is never trusted. `buildRiskFieldEdit` validates a patch, recomputes
 * derived fields (severity = likelihood × impact), preserves the model's original
 * extraction as provenance, and returns the exact column/JSON updates + an audit
 * change-set for `risk_edit_logs`.
 */

export class RiskFieldValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "RiskFieldValidationError";
    this.field = field;
  }
}

/** Overview fields a reviewer may correct. Score, URL, date, and Article ID stay read-only. */
export const EDITABLE_RISK_FIELDS = [
  "riskTitle",
  "articleTitle",
  "description",
  "domains",
  "primaryRisk",
  "secondaryRisk",
  "sector",
  "industry",
  "intent",
  "likelihood",
  "impact",
  "aiProductName",
  "aiProductVendor",
  "attackVector",
  "observableIndicators",
  "timing",
] as const;
export type EditableRiskField = (typeof EDITABLE_RISK_FIELDS)[number];

const EDITABLE_SET = new Set<string>(EDITABLE_RISK_FIELDS);

/** Soft title cap only — classification/product fields are unbounded `text`. */
const MAX_LEN: Record<string, number> = {
  riskTitle: 4000,
};

export type EditableCurrentState = {
  riskTitle: string | null;
  articleTitle: string | null;
  domains: string | null;
  primaryRisk: string | null;
  secondaryRisk: string | null;
  sector: string | null;
  industry: string | null;
  intent: string | null;
  qualityScore: number | null;
  likelihood: number | null;
  impact: number | null;
  aiProductName: string | null;
  aiProductVendor: string | null;
  extractionJson: Record<string, unknown> | null | undefined;
};

export type RiskFieldEditResult = {
  /** Drizzle `.set()` payload (camelCase columns) — includes recomputed severity + qualityManual. */
  columnUpdates: Record<string, unknown>;
  /** New extraction_json to persist (english_risk_title / risk.description synced). */
  extractionJson: Record<string, unknown>;
  extractionJsonChanged: boolean;
  /** Field-level before/after for risk_edit_logs. */
  changes: Record<string, { from: unknown; to: unknown }>;
  changedFields: string[];
  qualityOverridden: boolean;
  articleUpdates: { title?: string };
};

function trimStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function validateScale1to5(field: string, v: unknown): number {
  const n = typeof v === "number" ? v : Number(trimStr(v));
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new RiskFieldValidationError(
      field,
      `${field} must be an integer between 1 and 5`,
    );
  }
  return n;
}

function validateLength(field: string, value: string): string {
  const max = MAX_LEN[field];
  if (max != null && value.length > max) {
    throw new RiskFieldValidationError(
      field,
      `${field} must be at most ${max} characters`,
    );
  }
  return value;
}

/**
 * Validate a patch against the allow-list and produce the exact updates.
 * Throws RiskFieldValidationError on any unknown/immutable field or invalid value.
 */
export function buildRiskFieldEdit(
  current: EditableCurrentState,
  patch: Record<string, unknown>,
  options: BuildRiskFieldEditOptions = {},
): RiskFieldEditResult {
  const normalizeDomain = options.normalizeDomain ?? defaultNormalizeDomain;
  // 1) Reject anything outside the allow-list (immutable/system fields included).
  for (const key of Object.keys(patch)) {
    if (!EDITABLE_SET.has(key)) {
      throw new RiskFieldValidationError(key, `${key} is not an editable field`);
    }
  }

  const ext: Record<string, unknown> = structuredClone(
    (current.extractionJson ?? {}) as Record<string, unknown>,
  );
  const riskJson = (ext.risk ?? {}) as Record<string, unknown>;

  const columnUpdates: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const articleUpdates: { title?: string } = {};
  let extractionJsonChanged = false;

  const record = (field: string, from: unknown, to: unknown) => {
    changes[field] = { from, to };
  };

  // Effective likelihood/impact (start from current, override if edited) for severity recompute.
  let effLikelihood = current.likelihood;
  let effImpact = current.impact;
  let scoringTouched = false;

  const simpleStringCols: Array<[EditableRiskField, keyof EditableCurrentState]> =
    [
      ["primaryRisk", "primaryRisk"],
      ["secondaryRisk", "secondaryRisk"],
      ["sector", "sector"],
      ["industry", "industry"],
      ["intent", "intent"],
      ["aiProductName", "aiProductName"],
      ["aiProductVendor", "aiProductVendor"],
    ];

  for (const key of Object.keys(patch)) {
    const raw = patch[key];

    switch (key as EditableRiskField) {
      case "articleTitle": {
        const next = trimStr(raw);
        if (!next) {
          throw new RiskFieldValidationError("articleTitle", "articleTitle cannot be empty");
        }
        const prev = trimStr(current.articleTitle);
        if (next !== prev) {
          articleUpdates.title = next;
          record("articleTitle", prev, next);
        }
        break;
      }

      case "riskTitle": {
        const next = validateLength("riskTitle", trimStr(raw));
        if (!next) {
          throw new RiskFieldValidationError("riskTitle", "riskTitle cannot be empty");
        }
        const prev = trimStr(current.riskTitle);
        if (next !== prev) {
          columnUpdates.riskTitle = next;
          // Make the human title authoritative in the DTO title-resolver, keep the
          // model original available as provenance (original_risk_title untouched).
          ext.english_risk_title = next;
          extractionJsonChanged = true;
          record("riskTitle", prev, next);
        }
        break;
      }

      case "description": {
        const next = trimStr(raw);
        const prev = trimStr(riskJson.description);
        if (next !== prev) {
          riskJson.description = next;
          ext.risk = riskJson;
          extractionJsonChanged = true;
          record("description", prev, next);
        }
        break;
      }

      case "attackVector": {
        const next = trimStr(raw);
        const prev = trimStr(riskJson.attack_vector);
        if (next !== prev) {
          riskJson.attack_vector = next;
          ext.risk = riskJson;
          extractionJsonChanged = true;
          record("attackVector", prev, next);
        }
        break;
      }

      case "observableIndicators": {
        const next = trimStr(raw);
        const prev = trimStr(riskJson.observable_indicators);
        if (next !== prev) {
          riskJson.observable_indicators = next;
          ext.risk = riskJson;
          extractionJsonChanged = true;
          record("observableIndicators", prev, next);
        }
        break;
      }

      case "timing": {
        const next = trimStr(raw);
        const prev = trimStr(riskJson.timing);
        if (next !== prev) {
          riskJson.timing = next;
          ext.risk = riskJson;
          extractionJsonChanged = true;
          record("timing", prev, next);
        }
        break;
      }

      case "domains": {
        const normalized = normalizeDomain(trimStr(raw));
        if (!normalized) {
          throw new RiskFieldValidationError(
            "domains",
            "domains must be one of the AI-Q taxonomy domains",
          );
        }
        const prev = trimStr(current.domains);
        if (normalized !== prev) {
          columnUpdates.domains = normalized;
          record("domains", prev, normalized);
        }
        break;
      }

      case "likelihood": {
        const next = validateScale1to5("likelihood", raw);
        if (next !== current.likelihood) {
          columnUpdates.likelihood = next;
          record("likelihood", current.likelihood, next);
          effLikelihood = next;
          scoringTouched = true;
        }
        break;
      }

      case "impact": {
        const next = validateScale1to5("impact", raw);
        if (next !== current.impact) {
          columnUpdates.impact = next;
          record("impact", current.impact, next);
          effImpact = next;
          scoringTouched = true;
        }
        break;
      }

      default: {
        // The remaining simple varchar columns.
        const entry = simpleStringCols.find(([k]) => k === key);
        if (!entry) break;
        const [, col] = entry;
        const next = validateLength(key, trimStr(raw));
        const prev = trimStr(current[col] as string | null);
        if (next !== prev) {
          columnUpdates[key] = next || null;
          record(key, prev, next);
        }
        break;
      }
    }
  }

  // Derived: recompute severity from the effective likelihood × impact. Never trust client.
  if (scoringTouched) {
    const prevSeverity = computeSeverityScore(current.likelihood, current.impact);
    const nextSeverity = computeSeverityScore(effLikelihood, effImpact);
    const prevBand = severityBandFromScore(prevSeverity);
    const nextBand = severityBandFromScore(nextSeverity);
    columnUpdates.severityScore = nextSeverity;
    columnUpdates.severityBand = nextBand;
    if (nextSeverity !== prevSeverity) {
      record("severityScore", prevSeverity, nextSeverity);
    }
    if (nextBand !== prevBand) {
      record("severityBand", prevBand, nextBand);
    }
  }

  return {
    columnUpdates,
    extractionJson: ext,
    extractionJsonChanged,
    changes,
    changedFields: Object.keys(changes),
    qualityOverridden: false,
    articleUpdates,
  };
}
