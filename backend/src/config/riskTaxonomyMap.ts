/**
 * Equivalence map between the extraction schema's primary/secondary risk
 * vocabulary (python/app/llm/system_prompt.txt) and the vocabulary used in
 * `risk_mappings.primary_risk` / `risk_mappings.secondary_risks`.
 *
 * The two vocabularies diverged: the catalog uses values like
 * "Security Risk; Data Risk" and "Operational Risk" while extraction emits
 * "Technical/Performance Risk" (which never appears in the catalog). Mapping
 * happens here at scoring time so the catalog data stays untouched.
 */

export const EXTRACTION_SECONDARY_RISKS = [
  "Security Risk",
  "Privacy Risk",
  "Technical/Performance Risk",
  "Data Risk",
  "Compliance/Regulatory Risk",
  "Legal/Liability Risk",
  "Third-Party/Vendor Risk",
  "Business/Financial Risk",
  "Reputational Risk",
  "Ethical Risk",
  "Strategic Risk",
] as const;

export type ExtractionSecondaryRisk = (typeof EXTRACTION_SECONDARY_RISKS)[number];

export type SecondaryEquivalence = {
  /** Catalog labels describing the same risk class (score 0.8). */
  equivalent: string[];
  /** Catalog labels describing an adjacent risk class (score 0.4). */
  related: string[];
};

export const SECONDARY_RISK_MAP: Record<ExtractionSecondaryRisk, SecondaryEquivalence> = {
  "Security Risk": {
    equivalent: ["Security Risk"],
    related: ["Data Risk", "Privacy Risk"],
  },
  "Privacy Risk": {
    equivalent: ["Privacy Risk", "Data Risk"],
    related: ["Security Risk", "Compliance/Regulatory Risk"],
  },
  // The catalog has no "Technical/Performance Risk" label; its closest class
  // is "Operational Risk", with security/data failures as adjacent classes.
  "Technical/Performance Risk": {
    equivalent: ["Operational Risk"],
    related: ["Security Risk", "Data Risk"],
  },
  "Data Risk": {
    equivalent: ["Data Risk"],
    related: ["Privacy Risk", "Security Risk"],
  },
  "Compliance/Regulatory Risk": {
    equivalent: ["Compliance/Regulatory Risk"],
    related: ["Legal/Liability Risk", "Operational Risk"],
  },
  "Legal/Liability Risk": {
    equivalent: ["Legal/Liability Risk"],
    related: ["Compliance/Regulatory Risk"],
  },
  "Third-Party/Vendor Risk": {
    equivalent: ["Third-Party/Vendor Risk"],
    related: ["Operational Risk", "Security Risk"],
  },
  "Business/Financial Risk": {
    equivalent: ["Business/Financial Risk"],
    related: ["Strategic Risk", "Reputational Risk"],
  },
  "Reputational Risk": {
    equivalent: ["Reputational Risk"],
    related: ["Ethical Risk", "Business/Financial Risk"],
  },
  "Ethical Risk": {
    equivalent: ["Ethical Risk"],
    related: ["Reputational Risk"],
  },
  "Strategic Risk": {
    equivalent: ["Strategic Risk"],
    related: ["Business/Financial Risk", "Reputational Risk"],
  },
};

/** Primary categories adjacent enough to earn partial credit (score 0.4). */
export const PRIMARY_RISK_RELATED: Record<string, string[]> = {
  "Technical Risks": ["Operational Risks"],
  "Operational Risks": ["Technical Risks", "Business Risks"],
  "Business Risks": ["Operational Risks"],
};

const EXACT_SCORE = 1;
const EQUIVALENT_SCORE = 0.8;
const RELATED_SCORE = 0.4;

/**
 * Canonical form for risk labels: case/punctuation-insensitive and tolerant
 * of singular/plural ("Technical Risks" ~ "Technical Risk").
 */
export function normalizeRiskLabel(label: string | null | undefined): string {
  const fp = String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return fp.replace(/risks$/, "risk");
}

/** Split a catalog value like "Security Risk; Data Risk" into labels. */
export function splitCatalogRiskList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function findSecondaryEquivalence(
  extracted: string,
): SecondaryEquivalence | null {
  const normalized = normalizeRiskLabel(extracted);
  if (!normalized) return null;
  for (const key of EXTRACTION_SECONDARY_RISKS) {
    if (normalizeRiskLabel(key) === normalized) return SECONDARY_RISK_MAP[key];
  }
  return null;
}

/**
 * 0–1 alignment between an extracted secondary risk and a catalog
 * `secondary_risks` value (possibly a semicolon-separated list). Takes the
 * best score over the list entries.
 */
export function secondaryAlignmentScore(
  extracted: string | null | undefined,
  catalogList: string | null | undefined,
): number {
  const extractedNorm = normalizeRiskLabel(extracted);
  if (!extractedNorm) return 0;
  const catalogLabels = splitCatalogRiskList(catalogList);
  if (catalogLabels.length === 0) return 0;

  const equivalence = findSecondaryEquivalence(String(extracted));
  const equivalentNorms = new Set(
    (equivalence?.equivalent ?? []).map(normalizeRiskLabel),
  );
  const relatedNorms = new Set((equivalence?.related ?? []).map(normalizeRiskLabel));

  let best = 0;
  for (const label of catalogLabels) {
    const norm = normalizeRiskLabel(label);
    if (norm === extractedNorm) return EXACT_SCORE;
    if (equivalentNorms.has(norm)) best = Math.max(best, EQUIVALENT_SCORE);
    else if (relatedNorms.has(norm)) best = Math.max(best, RELATED_SCORE);
  }
  return best;
}

/** 0–1 alignment between extracted and catalog primary risk categories. */
export function primaryAlignmentScore(
  extracted: string | null | undefined,
  catalogPrimary: string | null | undefined,
): number {
  const extractedNorm = normalizeRiskLabel(extracted);
  const catalogNorm = normalizeRiskLabel(catalogPrimary);
  if (!extractedNorm || !catalogNorm) return 0;
  if (extractedNorm === catalogNorm) return EXACT_SCORE;

  for (const [key, related] of Object.entries(PRIMARY_RISK_RELATED)) {
    if (normalizeRiskLabel(key) !== extractedNorm) continue;
    if (related.some((label) => normalizeRiskLabel(label) === catalogNorm)) {
      return RELATED_SCORE;
    }
  }
  return 0;
}

export type TaxonomyAlignmentInput = {
  primaryRisk?: string | null;
  secondaryRisk?: string | null;
  catalogPrimary?: string | null;
  catalogSecondary?: string | null;
};

/**
 * Combined 0–1 alignment. Secondary carries more weight than primary: within
 * a domain the secondary class is the discriminating signal, while primary
 * has only three coarse values.
 */
export function taxonomyAlignmentScore(input: TaxonomyAlignmentInput): number {
  const primary = primaryAlignmentScore(input.primaryRisk, input.catalogPrimary);
  const secondary = secondaryAlignmentScore(
    input.secondaryRisk,
    input.catalogSecondary,
  );
  return 0.4 * primary + 0.6 * secondary;
}
