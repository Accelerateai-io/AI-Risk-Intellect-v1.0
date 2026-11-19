/**
 * Every check that does not pass keeps a sentence a reviewer can trace:
 * what failed, and the quote, correction, or catalog entry that shows why.
 */

export const CHECK_LABELS: Record<string, string> = {
  claim_is_demonstrated: "Claim is demonstrated",
  mitigations_reflected: "Mitigations reflected",
  not_attributed_to_proposed_method: "Not attributed to the proposed method",
  severity_within_evidence: "Severity within evidence",
  evidence_type_consistent: "Evidence type consistent",
  rationale_supported: "Rationale supported",
  domain_correct: "Domain correct",
  primary_secondary_correct: "Primary and secondary correct",
  catalog_match: "Catalog match",
};

const FAILED_EXPLANATIONS: Record<string, string> = {
  claim_is_demonstrated:
    "The source does not show this risk as a measured result or a real incident.",
  mitigations_reflected:
    "Safeguards or limitations from the source are missing from the record.",
  not_attributed_to_proposed_method:
    "The record blames the method the source proposes.",
  severity_within_evidence:
    "The likelihood or impact goes beyond what the source reports.",
  evidence_type_consistent:
    "The evidence label does not match the kind of result in the source.",
  rationale_supported:
    "A likelihood or impact explanation is not supported by the source.",
  domain_correct: "The domain does not match the harm described in the source.",
  primary_secondary_correct:
    "The risk categories do not match how the harm happens.",
  catalog_match: "No catalog entry describes this same risk.",
};

export type CheckEvidence = {
  pass?: boolean | null;
  reason?: string | null;
  quote?: string | null;
  corrected?: string | null;
  corrected_primary?: string | null;
  corrected_secondary?: string | null;
  best_id?: string | null;
  verdict?: string | null;
  percent?: number | null;
};

function bareResult(reason: string): boolean {
  const text = reason.trim();
  if (!text) return true;
  if (/^(failed|check failed|catalog judge score)$/i.test(text)) return true;
  if (/^[\d.\s%]+$/.test(text)) return true;
  return /^(below|under|over|above)\s+\d+(\.\d+)?\s*percent$/i.test(text);
}

/** Sentence stored on a check that did not pass. Passed checks keep their own text. */
export function failedCheckExplanation(name: string, entry: CheckEvidence): string {
  if (entry.pass === true) return String(entry.reason ?? "").trim();

  const stored = String(entry.reason ?? "").trim();
  const base = bareResult(stored)
    ? (FAILED_EXPLANATIONS[name] ?? `The ${CHECK_LABELS[name] ?? name} check failed.`)
    : stored;

  const traces: string[] = [];
  const quote = String(entry.quote ?? "").trim();
  if (quote && !base.includes(quote)) traces.push(`Source quote: “${quote}”.`);
  const corrected = String(entry.corrected ?? "").trim();
  if (corrected && !base.includes(corrected)) {
    traces.push(`Corrected value: ${corrected}.`);
  }
  const primary = String(entry.corrected_primary ?? "").trim();
  const secondary = String(entry.corrected_secondary ?? "").trim();
  const categories = [primary, secondary].filter(Boolean).join(" / ");
  if (categories && !base.includes(categories)) {
    traces.push(`Corrected categories: ${categories}.`);
  }
  if (name === "catalog_match") {
    const id = String(entry.best_id ?? "").trim();
    const verdict = String(entry.verdict ?? "").trim();
    if (id && !base.includes(id)) traces.push(`Closest catalog entry: ${id}.`);
    if (verdict && !base.toLowerCase().includes(verdict.toLowerCase())) {
      traces.push(`Verdict: ${verdict}.`);
    }
  }
  if (stored && bareResult(stored) && !base.includes(stored)) {
    traces.push(`Recorded result: ${stored}.`);
  }

  const explanation = [base, ...traces].join(" ").trim();
  if (entry.pass == null) {
    return `This check did not run, so there is no verdict to trace. ${explanation}`;
  }
  return explanation;
}

export function failedCheckNote(name: string, entry: CheckEvidence): string {
  const label = CHECK_LABELS[name] ?? name;
  return `${name} (${label}): ${failedCheckExplanation(name, entry)}`;
}
