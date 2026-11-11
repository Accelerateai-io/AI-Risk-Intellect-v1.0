import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  hasEvidenceReviewReasons,
  needsHumanReview,
  citationHintReasons,
} from "./riskQuality.js";

// B-1 (VERIFIER_DECIDES_PUBLISH). OFF = today's behaviour (any evidence reason
// holds). ON = an "Uncited <field>_reasoning: no 5-word span" citation miss is a
// non-blocking hint ONLY when the 9-check verifier ran, passed, and scored
// grounding >= 0.6. "Source support failed" grounding misses, safety holds,
// verifier-failed / no-verifier records, the old 4-check pass, and low grounding
// all stay held. Fixtures mirror the 30-record golden set (real reason strings).

const CITATION_REASON =
  "Uncited likelihood_reasoning: no 5-word span found in the source (BUG-04 / TC-09)";
const CITATION_REASON_2 =
  "Uncited impact_reasoning: no 5-word span found in the source (BUG-04 / TC-09)";
const VERIFIER_SPAN_REASON =
  "Source support failed: demonstrated_finding does not contain a five-word span from the source.";
const HEALTHCARE_REASON =
  "Unsupported healthcare claim: the record states harm the source does not show.";

function verifierMeta(opts: {
  ran?: boolean;
  passed?: boolean;
  checks?: number;
  grounding?: number;
}): unknown {
  if (opts.ran === undefined) return undefined;
  const checks: Record<string, { pass: boolean }> = {};
  for (let i = 0; i < (opts.checks ?? 0); i += 1) checks[`check_${i}`] = { pass: true };
  return {
    ran: opts.ran,
    passed: opts.passed,
    checks,
    grounding_score: opts.grounding,
  };
}

function record(opts: {
  ran?: boolean;
  passed?: boolean;
  checks?: number;
  grounding?: number;
  reasons: string[];
}): unknown {
  return {
    _meta: {
      verifier: verifierMeta(opts),
      verification: { review_reasons: opts.reasons },
    },
  };
}

// 9-check verifier, passed, well grounded — the only thing that qualifies.
const PASS9 = { ran: true, passed: true, checks: 9, grounding: 0.95 };

// R-25/26/28/29 — citation-only misses on a 9-check-verified record -> publish.
const R_PUBLISH = record({ ...PASS9, reasons: [CITATION_REASON, CITATION_REASON_2] });
// R-23 — "Source support failed" grounding miss stays BLOCKING (not a citation miss).
const R23 = record({ ...PASS9, reasons: [VERIFIER_SPAN_REASON, CITATION_REASON_2] });
// R-22 — unsupported healthcare-claim safety hold stays BLOCKING.
const R22 = record({ ...PASS9, grounding: 0.92, reasons: [HEALTHCARE_REASON, CITATION_REASON_2] });
// R-19 — verifier ran but FAILED.
const R19 = record({
  ran: true,
  passed: false,
  checks: 9,
  grounding: 0.95,
  reasons: ["Verifier: claim_is_demonstrated failed - speculative", CITATION_REASON],
});
// R-01..R-11 — no verifier result at all.
const R01 = record({ reasons: [CITATION_REASON] });
// Old 4-check verifier passed — does NOT count as the 9-check pass.
const R_4CHECK = record({ ran: true, passed: true, checks: 4, grounding: 0.95, reasons: [CITATION_REASON] });
// 9-check passed but grounding below the 0.6 minimum.
const R_LOWGROUND = record({ ran: true, passed: true, checks: 9, grounding: 0.5, reasons: [CITATION_REASON] });

const HIGH_QUALITY = 95;

afterEach(() => {
  delete process.env.VERIFIER_DECIDES_PUBLISH;
});

describe("VERIFIER_DECIDES_PUBLISH OFF (default) — today's behaviour", () => {
  it("holds every record that has any evidence reason, incl. citation-only", () => {
    delete process.env.VERIFIER_DECIDES_PUBLISH;
    for (const r of [R_PUBLISH, R23, R22, R19, R01, R_4CHECK, R_LOWGROUND]) {
      assert.equal(hasEvidenceReviewReasons(r), true);
      assert.equal(
        needsHumanReview({ qualityScore: HIGH_QUALITY, extractionJson: r }),
        true,
      );
    }
  });
});

describe("VERIFIER_DECIDES_PUBLISH ON (B-1)", () => {
  it("publishes 9-check-verified, citation-only records (R-25/26/28/29)", () => {
    process.env.VERIFIER_DECIDES_PUBLISH = "1";
    assert.equal(hasEvidenceReviewReasons(R_PUBLISH), false);
    assert.equal(
      needsHumanReview({ qualityScore: HIGH_QUALITY, extractionJson: R_PUBLISH }),
      false,
    );
    assert.ok(citationHintReasons(R_PUBLISH).length > 0); // hint kept on the record
  });

  it("KEEPS the 'Source support failed' grounding miss held (R-23)", () => {
    process.env.VERIFIER_DECIDES_PUBLISH = "1";
    assert.equal(hasEvidenceReviewReasons(R23), true);
    assert.equal(
      needsHumanReview({ qualityScore: HIGH_QUALITY, extractionJson: R23 }),
      true,
    );
  });

  it("keeps the unsupported-healthcare-claim hold (R-22)", () => {
    process.env.VERIFIER_DECIDES_PUBLISH = "1";
    assert.equal(hasEvidenceReviewReasons(R22), true);
  });

  it("still holds verifier-failed (R-19) and no-verifier (R-01) records", () => {
    process.env.VERIFIER_DECIDES_PUBLISH = "on";
    assert.equal(hasEvidenceReviewReasons(R19), true);
    assert.equal(hasEvidenceReviewReasons(R01), true);
  });

  it("does NOT count the old 4-check pass or grounding below 0.6", () => {
    process.env.VERIFIER_DECIDES_PUBLISH = "1";
    assert.equal(hasEvidenceReviewReasons(R_4CHECK), true);
    assert.equal(hasEvidenceReviewReasons(R_LOWGROUND), true);
    assert.equal(citationHintReasons(R_4CHECK).length, 0);
    assert.equal(citationHintReasons(R_LOWGROUND).length, 0);
  });
});
