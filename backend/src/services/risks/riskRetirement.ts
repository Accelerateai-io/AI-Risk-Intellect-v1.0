/**
 * Reprocessing keeps every earlier risk row for audit, but those rows must
 * leave the published register. The newest extraction is the only record that
 * may stay published.
 */

export const RETIRED_PUBLICATION_STATUS = "retired";

export const RETIRED_REASON = "Superseded by article reprocessing";

export function isRetiredRisk(extractionJson: unknown): boolean {
  const ext = (extractionJson ?? {}) as { publication_status?: unknown };
  return (
    String(ext.publication_status ?? "").trim().toLowerCase() ===
    RETIRED_PUBLICATION_STATUS
  );
}

/**
 * Copy of an extraction with published status removed. Review fields, scores,
 * and the rest of the row stay so the history record is still readable.
 * A second retirement keeps the original publication status.
 */
export function retireExtractionForReprocess(
  extractionJson: unknown,
  successorRiskId: string,
  retiredAt: string,
): Record<string, unknown> {
  const ext = {
    ...((extractionJson ?? {}) as Record<string, unknown>),
  };
  const current = String(ext.publication_status ?? "").trim().toLowerCase();
  if (current !== RETIRED_PUBLICATION_STATUS) {
    ext.previous_publication_status = current || null;
  }
  ext.publication_status = RETIRED_PUBLICATION_STATUS;
  ext.published_automatically = false;
  ext.retired_at = retiredAt;
  ext.retired_reason = RETIRED_REASON;
  ext.superseded_by_risk_id = successorRiskId;
  return ext;
}
