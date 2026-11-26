import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSESSMENT_CHECKS,
  dropSecondaryClause,
  runFactsV2AssessmentCycle,
  type AssessRequest,
  type RiskAssessment,
} from "./workflowDecision.js";
import { factualTitle, intentFromSource } from "./preSaveFieldValidation.js";

// Ghassan's 25 Nov non-research run: the saved record must be the record the
// checker saw (R-17), repair must not leave broken punctuation (R-216), and the
// checker must see the article title (N-03 / R-209 is covered where the title
// is added, in extractRisk.service.ts assessFactsV2).

function allPass(): RiskAssessment {
  const checks = {} as NonNullable<RiskAssessment["checks"]>;
  for (const name of ASSESSMENT_CHECKS) {
    checks[name] =
      name === "catalog_match"
        ? { pass: true, best_id: "RISK-1000", verdict: "related", percent: 80 }
        : { pass: true, quote: "the source quote" };
  }
  return {
    ran: true,
    parsed: true,
    checks,
    grounding_score: 0.92,
    quoted_support: ["the source quote"],
    safety_claim: "none",
    repair: null,
    buyer_relevance: { pass: true, use_case: "hospital", consequence: "wrong care" },
  } as RiskAssessment;
}

const SOURCE =
  "The tool returned wrong answers on 26% of baseline tasks. The authors do not claim support for clinical use.";

test("R-17: an unsupported 'impossible' cut does not leave an unfinished title", () => {
  const title = "Benchmark shows clinical support is impossible";
  const out = factualTitle(title, SOURCE);
  assert.doesNotMatch(out, /\bis$/);
  assert.equal(out, title, "keeps the original rather than a fragment");
});

test("a clean cut is still applied", () => {
  assert.equal(
    factualTitle("Model triage errors in hospital emergency rooms prevent safe care", "The model made triage errors."),
    "Model triage errors in hospital emergency rooms",
  );
});

test("R-17: the title the checker saw is the title that is saved", async () => {
  const extraction: Record<string, unknown> = {
    risk: {
      risk_title: "Triage model errors in emergency rooms make safe care impossible",
      description: "The tool returned wrong answers on 26% of baseline tasks.",
      demonstrated_finding: "Wrong answers on 26% of tasks.",
      evidence_type: "demonstrated",
      domains: "AI System Safety, Failures, and Limitations",
      primary_risk: "Technical Risks",
      secondary_risks: "Reliability Risk",
    },
    risk_scoring: {
      likelihood: 3,
      likelihood_reasoning: "Measured on baseline tasks.",
      impact: 3,
      impact_reasoning: "Wrong answers could affect care.",
    },
  };
  const seen: string[] = [];
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: SOURCE,
    catalogCandidates: [],
    hints: {},
    assess: async (request: AssessRequest) => {
      seen.push(String((request.record.risk as Record<string, unknown>).risk_title));
      return allPass();
    },
  });
  const saved = String((extraction.risk as Record<string, unknown>).risk_title);
  assert.equal(seen.length, result.assessCalls);
  assert.equal(saved, seen[seen.length - 1], "saved title equals the checked title");
  assert.doesNotMatch(saved, /impossible/i, "unsupported word removed before the check");
});

test("N-03: the assessor reads title + body; the rule-based guards read the body only", async () => {
  const body = "The insurer used a model to cut off rehab coverage for older patients.";
  const run = async (assessorSourceText?: string) => {
    const extraction: Record<string, unknown> = {
      risk: {
        risk_title: "Insurer model cut off rehab coverage",
        description: "The insurer used a model to cut off coverage.",
        evidence_type: "demonstrated",
        intent: "Unknown",
      },
      risk_scoring: { likelihood: 3, impact: 3 },
    };
    let got = "";
    let record: Record<string, unknown> = {};
    await runFactsV2AssessmentCycle({
      extractionJson: extraction,
      sourceText: body,
      assessorSourceText,
      catalogCandidates: [],
      hints: {},
      assess: async (request) => {
        got = request.sourceText;
        record = request.record;
        return allPass();
      },
    });
    return { got, record, extraction };
  };
  const headline = "TITLE: Is this AI insurer a scam? 90% error rate claimed\n\n" + body;
  const titled = await run(headline);
  const plain = await run();
  assert.match(titled.got, /^TITLE: Is this AI insurer a scam\?/);
  assert.equal(plain.got, body, "defaults to the body");
  // The headline alone would flip intent to Malicious...
  assert.equal(intentFromSource("Unknown", headline), "Malicious");
  assert.equal(intentFromSource("Unknown", body), "Unknown");
  // ...so the guards and pre-save must read the body only.
  assert.equal(
    (titled.extraction.risk as Record<string, unknown>).intent,
    (plain.extraction.risk as Record<string, unknown>).intent,
  );
  assert.equal("pre_save_checks" in titled.record, false, "pre-save notes are not sent to the assessor");
});

test("R-216: removing a clause between commas leaves no ',,'", () => {
  const clause = "affecting millions of users at scale";
  const { extractionJson, removed } = dropSecondaryClause(
    {
      risk: { description: `The voice system misheard orders, ${clause}, and staff corrected them.` },
      risk_scoring: { impact_reasoning: `Orders were wrong, ${clause}.` },
    },
    clause,
  );
  assert.equal(removed, true);
  const risk = extractionJson.risk as Record<string, string>;
  const scoring = extractionJson.risk_scoring as Record<string, string>;
  assert.equal(risk.description, "The voice system misheard orders, and staff corrected them.");
  assert.equal(scoring.impact_reasoning, "Orders were wrong.");
  // A-04: a clause removed from the end must not leave a trailing comma.
  const tail = dropSecondaryClause(
    { risk: { description: "Investors lost money, affecting thousands at scale" }, risk_scoring: {} },
    "affecting thousands at scale",
  );
  assert.equal((tail.extractionJson.risk as Record<string, string>).description, "Investors lost money");
});
