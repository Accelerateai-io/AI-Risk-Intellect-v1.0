/** Minimum score that may proceed to LLM risk extraction. */
export function extractionQualityThreshold(): number {
  const parsed = Number(process.env.EXTRACTION_QUALITY_MIN ?? "80");
  if (!Number.isFinite(parsed)) return 80;
  return Math.min(100, Math.max(0, parsed));
}

export type ExtractionQuality = {
  score: number;
  parts: Record<string, number>;
  reasons: string[];
};

export function readExtractionQuality(
  details: unknown,
): ExtractionQuality | null {
  if (!details || typeof details !== "object") return null;
  const quality = (details as { extraction_quality?: unknown }).extraction_quality;
  if (!quality || typeof quality !== "object") return null;
  const score = (quality as { score?: unknown }).score;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  const parts = (quality as { parts?: unknown }).parts;
  const reasons = (quality as { reasons?: unknown }).reasons;
  return {
    score,
    parts: parts && typeof parts === "object" ? (parts as Record<string, number>) : {},
    reasons: Array.isArray(reasons) ? reasons.map(String) : [],
  };
}

/** Null when the article may proceed. Missing quality is not treated as a pass. */
export function extractionQuarantineReason(
  quality: ExtractionQuality | null,
): string | null {
  const threshold = extractionQualityThreshold();
  if (!quality) {
    return `extraction quality unverifiable below threshold ${threshold}`;
  }
  if (quality.score >= threshold) return null;
  return `extraction quality ${quality.score}/100 below threshold ${threshold}`;
}
