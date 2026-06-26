/** R-1 … R-9 when total < 10; zero-pad to 2 digits when total >= 10 (R-01, R-10, …). */
export function formatRiskDisplayId(
  sequence: number,
  totalCount: number,
): string {
  if (sequence < 1) return "R-?";
  const minDigits = totalCount < 10 ? 1 : 2;
  return `R-${String(sequence).padStart(minDigits, "0")}`;
}

const DISPLAY_ID_RE = /^R-(\d+)$/i;

export function parseRiskDisplaySequence(displayId: string): number | null {
  const match = DISPLAY_ID_RE.exec(displayId.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
