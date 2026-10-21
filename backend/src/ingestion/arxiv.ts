/**
 * arXiv source canonicalisation (BUG-09).
 *
 * arxiv.org/abs/<id> pages are HTML abstract pages; fetching them ingests the
 * abstract as if it were the paper. We rewrite abs URLs to the PDF and send the
 * PDF down the normal ingestion path.
 *
 * Withdrawn papers: if the current PDF 404s, or the abstract page's "Submission
 * history" is marked "(withdrawn)", we must NOT silently fall back to an older
 * version (v1 etc.) — that would ingest a paper the authors retracted. Instead
 * the source is skipped (not ingested) with reason "Source withdrawn by authors".
 */

export const SOURCE_WITHDRAWN_REASON = "Source withdrawn by authors";

const ARXIV_ABS_RE = /arxiv\.org\/abs\/([^\s?#]+)/i;
const ARXIV_VERSION_SUFFIX_RE = /v\d+$/i;

/** Strip a trailing version suffix (v1, v2, …) from an arXiv id. */
export function stripArxivVersion(id: string): string {
  return id.replace(ARXIV_VERSION_SUFFIX_RE, "");
}

/**
 * Extract the version-less arXiv id from an abs URL, or null if not an abs URL.
 * Handles new ids ("2609.09124", "2609.09124v2") and old ids ("cs/0112017").
 */
export function parseArxivAbsId(url: string): string | null {
  const match = ARXIV_ABS_RE.exec(url ?? "");
  if (!match) return null;
  let id = match[1];
  try {
    id = decodeURIComponent(id);
  } catch {
    // leave id as-is if it is not valid percent-encoding
  }
  id = id.replace(/\/+$/, ""); // trailing slash
  return stripArxivVersion(id);
}

export function isArxivAbsUrl(url: string): boolean {
  return parseArxivAbsId(url) != null;
}

export function arxivAbsUrl(id: string): string {
  return `https://arxiv.org/abs/${id}`;
}

export function arxivPdfUrl(id: string): string {
  return `https://arxiv.org/pdf/${id}`;
}

/**
 * Rewrite an arxiv.org/abs/<id> URL (with or without a version suffix) to the
 * version-less arxiv.org/pdf/<id>. Non-arXiv-abs URLs are returned unchanged.
 * (TC-27)
 */
export function rewriteArxivAbsToPdf(url: string): string {
  const id = parseArxivAbsId(url);
  return id ? arxivPdfUrl(id) : url;
}

/**
 * True when an abstract page's "Submission history" marks the paper withdrawn.
 * Scoped to the submission-history block when present to avoid matching papers
 * that merely discuss withdrawal.
 */
export function submissionHistoryIsWithdrawn(absHtml: string): boolean {
  if (!absHtml) return false;
  const lower = absHtml.toLowerCase();
  const idx = lower.indexOf("submission history");
  const scope = idx >= 0 ? lower.slice(idx) : lower;
  return (
    scope.includes("(withdrawn)") ||
    scope.includes("paper has been withdrawn")
  );
}

export type ArxivPdfFetch =
  | { ok: true; bytes: Buffer }
  | { ok: false; status: number };

export type ArxivHtmlFetch = { ok: true; html: string } | { ok: false };

export type ArxivResolution =
  | { kind: "pdf"; url: string; bytes: Buffer }
  | { kind: "withdrawn"; reason: string }
  | { kind: "fetch_failed"; reason: string };

/**
 * Resolve an arXiv id to an ingestible PDF, or a withdrawn/failed outcome.
 *
 * Only ever requests the version-less abs and pdf URLs, so an older version
 * (v1) can never be substituted for a withdrawn current version.
 */
export async function resolveArxivSource(input: {
  id: string;
  fetchAbsHtml: (url: string) => Promise<ArxivHtmlFetch>;
  fetchPdf: (url: string) => Promise<ArxivPdfFetch>;
}): Promise<ArxivResolution> {
  const absUrl = arxivAbsUrl(input.id);
  const pdfUrl = arxivPdfUrl(input.id);

  const abs = await input.fetchAbsHtml(absUrl);
  if (abs.ok && submissionHistoryIsWithdrawn(abs.html)) {
    return { kind: "withdrawn", reason: SOURCE_WITHDRAWN_REASON };
  }

  const pdf = await input.fetchPdf(pdfUrl);
  if (pdf.ok) {
    return { kind: "pdf", url: pdfUrl, bytes: pdf.bytes };
  }
  if (pdf.status === 404) {
    // Current PDF is gone — treat as withdrawn. Do NOT fall back to an older
    // version.
    return { kind: "withdrawn", reason: SOURCE_WITHDRAWN_REASON };
  }
  return { kind: "fetch_failed", reason: `HTTP ${pdf.status} for arXiv PDF` };
}
