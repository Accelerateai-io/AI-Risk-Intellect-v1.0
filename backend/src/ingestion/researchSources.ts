/**
 * Research-paper sources are out of scope for AIRI (decision, 25 Nov 2026).
 *
 * AIRI exists to find real-world AI risks: incidents, enforcement, regulator
 * notices, and reporting or analysis of them. Research papers describe what
 * could happen in a lab, not what is happening, and in prod they were 65% of
 * articles and 68% of risk records. Turning the arXiv feeds off in Controls
 * stops most of them; this check, run by the job worker before any fetch or
 * LLM call, also stops a paper that arrives another way (another feed, a
 * manual job, a batch rerun). The job ends as skipped with code RESEARCH, so
 * batch runs still finish.
 *
 * Config:
 *   RESEARCH_SOURCES_BLOCKED=0      turns the check off (default: on)
 *   RESEARCH_SOURCE_DOMAINS=a,b     replaces the default domain list
 */

/** Skip message stored on the job. Classified as RESEARCH by jobSkipReasonCode. */
export const RESEARCH_SOURCE_SKIP_MESSAGE =
  "research paper source: out of scope for AIRI";

/**
 * Hosts that serve research papers. Matched on the host and its subdomains,
 * so export.arxiv.org and papers.ssrn.com match, while spectrum.ieee.org
 * (news) does not match ieeexplore.ieee.org (papers).
 */
export const DEFAULT_RESEARCH_SOURCE_DOMAINS: readonly string[] = [
  "arxiv.org",
  "openreview.net",
  "biorxiv.org",
  "medrxiv.org",
  "ssrn.com",
  "paperswithcode.com",
  "aclanthology.org",
  "proceedings.neurips.cc",
  "proceedings.mlr.press",
  "semanticscholar.org",
  "researchgate.net",
  "ieeexplore.ieee.org",
  "dl.acm.org",
];

function envDomains(): readonly string[] {
  const raw = process.env.RESEARCH_SOURCE_DOMAINS;
  if (raw == null || raw.trim() === "") return DEFAULT_RESEARCH_SOURCE_DOMAINS;
  return raw
    .split(",")
    .map((d: string) => d.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

export function researchSourcesBlocked(): boolean {
  const raw = (process.env.RESEARCH_SOURCES_BLOCKED ?? "").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/** True when the URL's host is (a subdomain of) a research-paper source. */
export function isResearchSourceUrl(
  url: string,
  domains: readonly string[] = envDomains(),
): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Skip reason when the URL should not be ingested, or null to continue. */
export function researchSourceSkipReason(url: string): string | null {
  if (!researchSourcesBlocked()) return null;
  return isResearchSourceUrl(url) ? RESEARCH_SOURCE_SKIP_MESSAGE : null;
}
