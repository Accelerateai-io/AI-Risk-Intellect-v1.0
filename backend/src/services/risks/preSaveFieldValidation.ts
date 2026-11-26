/**
 * Source check for the fields that are written onto a risk row.
 *
 * Runs after extraction and after assessor corrections, and before the row
 * is stored. A value is kept only when it is in the approved taxonomy and
 * the article supports it. Repair and publication checks are not this step.
 */

import { CATALOG_DOMAINS, type TaxonomyDomain } from "../../config/aiqRiskTaxonomy.js";
import { EXTRACTION_SECONDARY_RISKS } from "../../config/riskTaxonomyMap.js";
import { alignSecondaryClassification } from "./classificationAlignment.js";
import {
  normalizeLabelToCatalogDomain,
  resolveCatalogDomain,
  scoreDomainsFromDefinitions,
} from "./riskDomainResolver.service.js";

export const APPROVED_INTENTS = ["Malicious", "Accidental", "Systemic", "Unknown"] as const;
export const APPROVED_PRIMARY = [
  "Technical Risks",
  "Operational Risks",
  "Business Risks",
] as const;

const SECONDARY_TO_PRIMARY: Record<string, (typeof APPROVED_PRIMARY)[number]> = {
  "Security Risk": "Technical Risks",
  "Privacy Risk": "Technical Risks",
  "Technical/Performance Risk": "Technical Risks",
  "Data Risk": "Technical Risks",
  "Compliance/Regulatory Risk": "Operational Risks",
  "Legal/Liability Risk": "Operational Risks",
  "Third-Party/Vendor Risk": "Operational Risks",
  "Operational Risk": "Operational Risks",
  "Business/Financial Risk": "Business Risks",
  "Reputational Risk": "Business Risks",
  "Ethical Risk": "Business Risks",
  "Strategic Risk": "Business Risks",
};

const ACCIDENTAL_EVIDENCE =
  /\b(accident(?:al|ally)?|unintended|inadvertent|by mistake|unexpected(?:ly)?|unintentional(?:ly)?|not (?:intended|deliberate)|malfunction)\b/i;

const DELIBERATE_EVIDENCE =
  /\b(deliberate(?:ly)?|intentional(?:ly)?|on purpose|without consent|non-consensual|threat actor|adversar(?:y|ial)|malicious(?:ly)?|cyber ?attacks?|exploit(?:ed|ing|s)?|phishing|ransomware|scam|fraud(?:ulent)?)\b/i;

const DEEPFAKE = /\b(deepfake|likeness)\b/i;
const DEEPFAKE_ACT =
  /\b(was created by|created by|viral|circulat\w*|posted|without consent|non-consensual)\b/i;

const TITLE_ABSOLUTE =
  /\b(prevents?|preclud\w*|impossible|not possible|isn't possible|isnt possible|scalability|real[- ]time|decision support)\b/gi;

export type PreSaveCorrection = {
  field: "intent" | "domains" | "primary_risk" | "secondary_risks" | "risk_title";
  from: string;
  to: string;
  reason: string;
};

export function approvedDomain(value: string | undefined | null): TaxonomyDomain | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return normalizeLabelToCatalogDomain(trimmed);
}

export function approvedPrimary(value: string | undefined | null): string | null {
  const trimmed = value?.trim() ?? "";
  return (APPROVED_PRIMARY as readonly string[]).includes(trimmed) ? trimmed : null;
}

export function approvedSecondary(value: string | undefined | null): string | null {
  const trimmed = value?.trim() ?? "";
  return (EXTRACTION_SECONDARY_RISKS as readonly string[]).includes(trimmed) ? trimmed : null;
}

/** The article has to mention the domain. A taxonomy label alone is not enough. */
export function domainSupportedBySource(
  domain: TaxonomyDomain,
  sourceText: string,
): boolean {
  const row = scoreDomainsFromDefinitions(sourceText).find(
    (score) => score.catalogDomain === domain,
  );
  return Boolean(row && (row.keywordHits > 0 || row.score >= 0.06));
}

/** Accidental is kept only when the article describes an unintended event. */
export function intentFromSource(current: string, sourceText: string): string {
  const source = sourceText || "";
  const stated = (APPROVED_INTENTS as readonly string[]).includes(current) ? current : "Unknown";
  const accidental = ACCIDENTAL_EVIDENCE.test(source);
  const deliberate =
    DELIBERATE_EVIDENCE.test(source) ||
    (DEEPFAKE.test(source) && DEEPFAKE_ACT.test(source));

  if (stated === "Accidental" && !accidental) {
    return deliberate ? "Malicious" : "Unknown";
  }
  if (stated === "Unknown" && deliberate && !accidental) return "Malicious";
  return stated;
}

export function unsupportedTitleClaim(title: string, sourceText: string): string | null {
  const source = (sourceText || "").toLowerCase().replace(/-/g, " ");
  TITLE_ABSOLUTE.lastIndex = 0;
  for (const match of title.matchAll(TITLE_ABSOLUTE)) {
    const word = match[0].toLowerCase().replace(/-/g, " ");
    if (!source.includes(word)) {
      return `Title overstates the source: '${match[0]}' is not a claim the source makes.`;
    }
  }
  return null;
}

/** Shorten a title that states a result the article does not state. */
export function factualTitle(title: string, sourceText: string): string {
  let updated = title || "";
  if (!unsupportedTitleClaim(updated, sourceText)) return updated.trim();
  const source = (sourceText || "").toLowerCase();
  if (!source.includes("scalability")) {
    updated = updated.replace(/\bscalability limitations\b/gi, "");
    updated = updated.replace(/\bscalability\b/gi, "");
  }
  const verb = updated.match(
    /\b(prevents?|preclud\w*|impossible|not possible|isn't possible|isnt possible)\b/i,
  );
  if (verb && verb.index != null && !source.includes(updated.slice(verb.index).toLowerCase())) {
    updated = updated.slice(0, verb.index);
  }
  if (/\breal[- ]time\b|\bdecision support\b/i.test(updated)) {
    if (!source.replace(/-/g, " ").includes("real time")) {
      updated = updated.replace(/\breal[- ]time\b/gi, "");
    }
    if (!source.includes("decision support")) {
      updated = updated.replace(/\bdecision support\b/gi, "");
    }
  }
  updated = updated
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\band\s+(and|in)\b/gi, "$1")
    .trim()
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "");
  if (updated.split(/\s+/).filter(Boolean).length < 4) return title.trim();
  // A cut that leaves an unfinished sentence ("...but the source does not
  // claim support is", R-17) is worse than the original: keep the original
  // and let the checks judge it.
  if (DANGLING_END.test(updated)) return title.trim();
  return updated;
}

const DANGLING_END =
  /\b(?:is|are|was|were|be|been|being|the|a|an|of|to|for|from|with|by|and|or|but|that|which|who|its|their|this|these|than|as|at|in|on|not|no|can|could|may|might|will|would|should|does|do|did|has|have|had)$/i;

function remember(
  corrections: PreSaveCorrection[],
  field: PreSaveCorrection["field"],
  from: string,
  to: string,
  reason: string,
): void {
  if (from === to) return;
  corrections.push({ field, from, to, reason });
}

/**
 * Correct intent, domain, category, and title on the extraction that will be stored.
 * Returns the corrections that were applied.
 */
export function applyPreSaveFieldValidation(
  extractionJson: Record<string, unknown>,
  sourceText: string,
  options: { keepTitle?: boolean } = {},
): PreSaveCorrection[] {
  const risk = (extractionJson.risk ?? {}) as Record<string, unknown>;
  const corrections: PreSaveCorrection[] = [];
  const source = sourceText || "";

  const intentFrom = String(risk.intent ?? "").trim();
  const intentTo = intentFromSource(intentFrom, source);
  if (intentTo !== intentFrom) {
    remember(
      corrections,
      "intent",
      intentFrom,
      intentTo,
      intentTo === "Malicious"
        ? "The article describes a deliberate act, so the intent is Malicious."
        : intentFrom === "Accidental"
          ? "Accidental is not supported by the article. Intent is Unknown until the source says otherwise."
          : "Intent must be Malicious, Accidental, Systemic, or Unknown.",
    );
    risk.intent = intentTo;
  }

  const titleFrom = String(risk.risk_title ?? "").trim();
  const titleTo = options.keepTitle ? titleFrom : factualTitle(titleFrom, source);
  if (titleTo && titleTo !== titleFrom) {
    remember(
      corrections,
      "risk_title",
      titleFrom,
      titleTo,
      unsupportedTitleClaim(titleFrom, source) ??
        "The title stated a result the article does not state.",
    );
    risk.risk_title = titleTo;
    if (extractionJson.english_risk_title === titleFrom) {
      extractionJson.english_risk_title = titleTo;
    }
  }

  const domainFrom = String(risk.domains ?? "").trim();
  let domainTo = approvedDomain(domainFrom);
  if (!domainTo) {
    const resolved = resolveCatalogDomain({
      llmDomain: null,
      title: String(risk.risk_title ?? ""),
      description: String(risk.description ?? ""),
      articleText: source,
    });
    domainTo = resolved.domain;
  }
  if (domainTo && domainTo !== domainFrom) {
    remember(
      corrections,
      "domains",
      domainFrom,
      domainTo,
      (CATALOG_DOMAINS as readonly string[]).includes(domainFrom)
        ? "Domain normalized to the approved taxonomy label."
        : "The stored domain was not one of the seven domains. It was replaced from the article.",
    );
    risk.domains = domainTo;
  }

  const secondaryFrom = String(risk.secondary_risks ?? "").trim();
  const secondaryApproved = approvedSecondary(secondaryFrom);
  let primaryFrom = String(risk.primary_risk ?? "").trim();
  let primaryTo = approvedPrimary(primaryFrom);
  if (!primaryTo && secondaryApproved && SECONDARY_TO_PRIMARY[secondaryApproved]) {
    primaryTo = SECONDARY_TO_PRIMARY[secondaryApproved];
  }
  if (primaryTo && primaryTo !== primaryFrom) {
    remember(
      corrections,
      "primary_risk",
      primaryFrom,
      primaryTo,
      "Category must be Technical Risks, Operational Risks, or Business Risks.",
    );
    risk.primary_risk = primaryTo;
    primaryFrom = primaryTo;
  }

  const aligned = alignSecondaryClassification(risk, source);
  if (aligned) {
    if (aligned.secondary !== secondaryFrom) {
      remember(
        corrections,
        "secondary_risks",
        secondaryFrom,
        aligned.secondary,
        aligned.reason,
      );
      risk.secondary_risks = aligned.secondary;
    }
    if (aligned.primary !== String(risk.primary_risk ?? "").trim()) {
      remember(
        corrections,
        "primary_risk",
        String(risk.primary_risk ?? ""),
        aligned.primary,
        aligned.reason,
      );
      risk.primary_risk = aligned.primary;
    }
  }

  extractionJson.risk = risk;
  if (corrections.length) {
    const prior = Array.isArray(extractionJson.pre_save_checks)
      ? (extractionJson.pre_save_checks as PreSaveCorrection[])
      : [];
    extractionJson.pre_save_checks = [...prior, ...corrections];
  }
  return corrections;
}
