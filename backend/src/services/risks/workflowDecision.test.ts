import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { jobSkipReasonCode } from "../../ingestion/filters.js";
import { needsHumanReview } from "./riskQuality.js";
import { applyPublicationDecision } from "./publicationGate.js";
import {
  ASSESSMENT_CHECKS,
  appendEvidenceEntry,
  decideWorkflow,
  dropSecondaryClause,
  isFactsV2Extraction,
  runFactsV2AssessmentCycle,
  type RiskAssessment,
} from "./workflowDecision.js";

const FIVE_WORD_HINT =
  "Uncited likelihood_reasoning: no 5-word span found in the source.";

function checks(
  patch: Partial<Record<(typeof ASSESSMENT_CHECKS)[number], Record<string, unknown>>> = {},
): RiskAssessment["checks"] {
  const all = {} as NonNullable<RiskAssessment["checks"]>;
  for (const name of ASSESSMENT_CHECKS) {
    all[name] =
      name === "catalog_match"
        ? { pass: true, best_id: "AIQ-0100", verdict: "same mechanism", percent: 88 }
        : { pass: true, quote: "a supported paraphrase of the measured result" };
  }
  return { ...all, ...patch } as RiskAssessment["checks"];
}

function assessment(patch: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    ran: true,
    parsed: true,
    checks: checks(),
    grounding_score: 0.91,
    quoted_support: ["the benchmark measured a three percent drop"],
    safety_claim: "none",
    repair: null,
    ...patch,
  };
}

function record(): Record<string, unknown> {
  return {
    pipeline_version: "2026.11.facts-v2",
    _meta: { extraction_contract: "facts_v2" },
    citation_hints: [FIVE_WORD_HINT],
    risk: {
      risk_title: "Accuracy drop on the benchmark",
      description: "The benchmark measured a three percent drop. account fraud at scale",
      domains: "7. AI System Safety, Failures, & Limitations",
      primary_risk: "Technical Risks",
      secondary_risks: "Technical/Performance Risk",
      evidence_type: "demonstrated",
    },
    risk_scoring: {
      likelihood: 2,
      likelihood_reasoning: "The benchmark measured a three percent drop.",
      impact: 2,
      impact_reasoning: "The benchmark measured a three percent drop.",
    },
  };
}

test("facts-v2 markers are the pipeline version and the extraction contract", () => {
  assert.equal(
    isFactsV2Extraction({ pipeline_version: "2026.11.facts-v2" }),
    true,
  );
  assert.equal(
    isFactsV2Extraction({ _meta: { extraction_contract: "facts_v2" } }),
    true,
  );
  assert.equal(isFactsV2Extraction({ pipeline_version: "2026.11" }), false);
});

test("a facts-v2 record does not need a self-assessment score", async () => {
  const extraction = record();
  assert.equal(
    (extraction as { justification?: unknown }).justification,
    undefined,
  );
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "The benchmark measured a three percent drop.",
    catalogCandidates: [],
    hints: { citation_hints: [FIVE_WORD_HINT] },
    assess: async () => assessment(),
  });
  assert.equal(result.decision.reason, "VERIFIED");
  assert.equal(result.decision.publication, "publish");
  assert.equal(extraction.publication_status, "published");
  assert.equal(
    needsHumanReview({ qualityScore: null, extractionJson: extraction }),
    false,
  );
});

test("a supported paraphrase is not held by the five-word rule", async () => {
  const extraction = record();
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "The benchmark measured a three percent drop on held-out data.",
    catalogCandidates: [],
    hints: { citation_hints: [FIVE_WORD_HINT] },
    assess: async () =>
      assessment({
        checks: checks({
          rationale_supported: {
            pass: true,
            quote: "accuracy fell by about three percent in the reported test",
          },
        }),
      }),
  });
  assert.equal(result.decision.reason, "VERIFIED");
  assert.equal(result.decision.publication, "publish");
  assert.deepEqual(extraction.citation_hints, [FIVE_WORD_HINT]);
  assert.equal(
    (extraction.verifier_checks as { rationale_supported: { pass: boolean } })
      .rationale_supported.pass,
    true,
  );
});

test("an unsupported main claim is held", () => {
  const decision = decideWorkflow({
    assessment: assessment({
      checks: checks({
        claim_is_demonstrated: { pass: false, reason: "the source only speculates" },
      }),
    }),
    evidenceType: "demonstrated",
  });
  assert.equal(decision.reason, "CLAIM_UNSUPPORTED");
  assert.equal(decision.publication, "hold");
});

test("checks 2, 4, 5, 6, 7 and 8 do not hold a record on their own", () => {
  const decision = decideWorkflow({
    assessment: assessment({
      checks: checks({
        mitigations_reflected: { pass: false, reason: "a safeguard was omitted" },
        severity_within_evidence: { pass: false, reason: "impact is high" },
        evidence_type_consistent: { pass: false, reason: "label is off" },
        rationale_supported: { pass: false, reason: "weak paraphrase" },
        domain_correct: { pass: false, corrected: "2. Privacy & Security" },
        primary_secondary_correct: {
          pass: false,
          corrected_primary: "Technical Risks",
          corrected_secondary: "Privacy Risk",
        },
      }),
    }),
    evidenceType: "demonstrated",
  });
  assert.equal(decision.reason, "VERIFIED");
  assert.equal(decision.publication, "publish");
  assert.equal(decision.confidence, "MEDIUM");
  assert.equal(decision.notes.length, 6);
});

test("all nine checks are stored", async () => {
  const extraction = record();
  await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "source",
    catalogCandidates: [{ id: "AIQ-0100" }],
    hints: {},
    assess: async () => assessment(),
  });
  const stored = extraction.verifier_checks as Record<string, unknown>;
  assert.deepEqual(Object.keys(stored).sort(), [...ASSESSMENT_CHECKS].sort());
});

test("every decision reason code", async () => {
  assert.equal(decideWorkflow({ stage: "fetch_fail" }).reason, "FETCH_FAIL");
  assert.equal(decideWorkflow({ stage: "fetch_fail" }).publication, "skip");
  assert.equal(decideWorkflow({ stage: "not_ai" }).reason, "NOT_AI");
  assert.equal(decideWorkflow({ stage: "not_ai" }).publication, "skip");
  assert.equal(
    decideWorkflow({ stage: "duplicate", forceReprocess: false }).reason,
    "MERGED",
  );
  assert.equal(
    decideWorkflow({ stage: "duplicate", forceReprocess: true, assessment: assessment(), evidenceType: "demonstrated" }).reason,
    "VERIFIED",
  );

  assert.equal(
    decideWorkflow({
      assessment: assessment({ grounding_score: 0.4 }),
      evidenceType: "demonstrated",
    }).reason,
    "CLAIM_UNSUPPORTED",
  );

  assert.equal(
    decideWorkflow({
      assessment: assessment({ safety_claim: "real_world" }),
      evidenceType: "demonstrated",
    }).reason,
    "SAFETY_HOLD",
  );

  assert.equal(
    decideWorkflow({
      assessment: assessment({
        checks: checks({
          catalog_match: { best_id: "AIQ-0412", verdict: "related", percent: 54 },
        }),
      }),
      evidenceType: "demonstrated",
    }).reason,
    "CATALOG_SUGGESTED",
  );

  assert.equal(
    decideWorkflow({
      assessment: assessment({ safety_claim: "research_only" }),
      evidenceType: "demonstrated",
    }).reason,
    "PUBLISHED_LABELLED",
  );

  assert.equal(
    decideWorkflow({
      assessment: assessment(),
      evidenceType: "hypothesized",
    }).reason,
    "PUBLISHED_LABELLED",
  );

  const repaired = record();
  let calls = 0;
  const repairedResult = await runFactsV2AssessmentCycle({
    extractionJson: repaired,
    sourceText: "source",
    catalogCandidates: [],
    hints: {},
    assess: async (request) => {
      calls += 1;
      const description = String(
        ((request.record.risk ?? {}) as { description?: string }).description ?? "",
      );
      if (calls === 1) {
        return assessment({
          repair: { drop_clause: "account fraud at scale", reason: "not in source" },
        });
      }
      assert.equal(description.includes("account fraud at scale"), false);
      return assessment();
    },
  });
  assert.equal(calls, 2);
  assert.equal(repairedResult.decision.reason, "REPAIRED");
  assert.equal(repairedResult.decision.publication, "publish");
  assert.equal(
    String((repaired.risk as { description: string }).description).includes(
      "account fraud at scale",
    ),
    false,
  );

  const failed = record();
  const failedResult = await runFactsV2AssessmentCycle({
    extractionJson: failed,
    sourceText: "source",
    catalogCandidates: [],
    hints: {},
    assess: async () => {
      const description = String(
        ((failed.risk ?? {}) as { description?: string }).description ?? "",
      );
      if (description.includes("account fraud at scale")) {
        return assessment({
          repair: { drop_clause: "account fraud at scale", reason: "not in source" },
        });
      }
      return assessment({
        checks: checks({
          claim_is_demonstrated: { pass: false, reason: "still unsupported" },
        }),
      });
    },
  });
  assert.equal(failedResult.decision.reason, "REPAIR_FAILED");
  assert.equal(failedResult.decision.publication, "hold");
  assert.equal(failed.publication_status, "held");
  assert.equal(
    String((failed.risk as { description: string }).description).includes(
      "account fraud at scale",
    ),
    false,
  );

  assert.equal(
    decideWorkflow({ assessment: assessment(), evidenceType: "demonstrated" }).reason,
    "VERIFIED",
  );
});

test("additional evidence preserves entries and ignores a duplicate pair", () => {
  const first = appendEvidenceEntry(
    [{ article_id: 1, url: "https://example.test/a" }],
    { article_id: 2, url: "https://example.test/b" },
  );
  const second = appendEvidenceEntry(first, {
    article_id: 2,
    url: "https://example.test/b",
  });
  assert.deepEqual(second, first);
  assert.equal(second.length, 2);
  assert.equal(second[0].url, "https://example.test/a");
});

test("domain correction is applied and the old quality gate is not", async () => {
  const extraction = record();
  await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "source",
    catalogCandidates: [],
    hints: {},
    assess: async () =>
      assessment({
        checks: checks({
          domain_correct: { pass: false, corrected: "2. Privacy & Security" },
        }),
      }),
  });
  assert.equal(
    (extraction.risk as { domains: string }).domains,
    "2. Privacy & Security",
  );
  const gate = applyPublicationDecision({
    qualityScore: null,
    extractionJson: extraction,
    domains: "2. Privacy & Security",
  });
  assert.equal(gate, "publish");
  assert.equal(extraction.publication_status, "published");
});

test("the worker calls assessment, decision, and the merge append", () => {
  const source = readFileSync(
    new URL("../worker/extractRisk.service.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /assessFactsV2\(/);
  assert.match(source, /runFactsV2AssessmentCycle\(/);
  assert.match(source, /appendAdditionalEvidence\(/);
  assert.match(source, /MERGED_SKIP_MESSAGE/);
  assert.match(source, /pythonAssessRisk\(/);
  assert.equal(jobSkipReasonCode("merged with existing risk"), "MERGED");
  assert.equal(jobSkipReasonCode("fetch failed"), "FETCH_FAIL");
  assert.equal(jobSkipReasonCode("not ai related"), "NOT_AI");
});

test("a security mechanism is relabeled without changing the catalog decision", async () => {
  const extraction = record();
  extraction.risk = {
    ...(extraction.risk as object),
    risk_title: "Agents with internal access can take harmful actions",
    description:
      "Imperfectly aligned agents with system access are treated as an insider threat and may carry out cyber attacks.",
    attack_vector: "Unauthorized actions by an agent that has access to internal systems.",
    stated_implication: "Harmful actions can run before a supervisor blocks them.",
    secondary_risks: "Technical/Performance Risk",
    evidence_type: "mitigation_target",
    domains: "Privacy and Security",
  };
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "The roadmap treats internal agents as an insider threat.",
    catalogCandidates: [],
    hints: {},
    assess: async () =>
      assessment({
        grounding_score: 0.95,
        checks: checks({
          catalog_match: {
            pass: false,
            best_id: "RISK-1060",
            verdict: "related",
            percent: 45,
          },
          primary_secondary_correct: { pass: true },
        }),
      }),
  });
  const risk = extraction.risk as { primary_risk: string; secondary_risks: string; domains: string };
  assert.equal(risk.secondary_risks, "Security Risk");
  assert.equal(risk.primary_risk, "Technical Risks");
  assert.equal(risk.domains, "Privacy and Security");
  assert.equal(result.decision.reason, "CATALOG_SUGGESTED");
  assert.equal(result.decision.publication, "publish");
  assert.equal(extraction.grounding_score, 0.95);
});

test("an output-quality failure stays Technical/Performance Risk", async () => {
  const extraction = record();
  extraction.risk = {
    ...(extraction.risk as object),
    risk_title: "Hallucinations in generated answers",
    description: "The model produces inaccurate output and inconsistent responses on ordinary questions.",
    secondary_risks: "Technical/Performance Risk",
  };
  await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "The evaluation reports hallucinations.",
    catalogCandidates: [],
    hints: {},
    assess: async () => assessment(),
  });
  assert.equal(
    (extraction.risk as { secondary_risks: string }).secondary_risks,
    "Technical/Performance Risk",
  );
  assert.equal(extraction.decision_reason, "VERIFIED");
});

test("grounding below 0.6 still holds after a security relabel", async () => {
  const extraction = record();
  extraction.risk = {
    ...(extraction.risk as object),
    risk_title: "Prompt injection against an agent",
    description: "A prompt injection attack causes credential exposure.",
    secondary_risks: "Technical/Performance Risk",
  };
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "source",
    catalogCandidates: [],
    hints: {},
    assess: async () => assessment({ grounding_score: 0.4 }),
  });
  assert.equal(
    (extraction.risk as { secondary_risks: string }).secondary_risks,
    "Security Risk",
  );
  assert.equal(result.decision.reason, "CLAIM_UNSUPPORTED");
  assert.equal(result.decision.publication, "hold");
});

test("dropSecondaryClause removes only the named clause", () => {
  const dropped = dropSecondaryClause(record(), "account fraud at scale");
  assert.equal(dropped.removed, true);
  assert.equal(
    String((dropped.extractionJson.risk as { description: string }).description).includes(
      "three percent drop",
    ),
    true,
  );
});
