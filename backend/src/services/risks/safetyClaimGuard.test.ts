import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyAiRelated,
  detectBotBlockPage,
  FETCH_FAILED_SKIP_MESSAGE,
  jobSkipReasonCode,
} from "../../ingestion/filters.js";
import {
  ASSESSMENT_CHECKS,
  decideWorkflow,
  runFactsV2AssessmentCycle,
  type RiskAssessment,
} from "./workflowDecision.js";
import { resolveSafetyClaim } from "./safetyClaimGuard.js";

function checks(
  patch: Partial<Record<(typeof ASSESSMENT_CHECKS)[number], Record<string, unknown>>> = {},
): RiskAssessment["checks"] {
  const all = {} as NonNullable<RiskAssessment["checks"]>;
  for (const name of ASSESSMENT_CHECKS) {
    all[name] =
      name === "catalog_match"
        ? { pass: true, best_id: "RISK-1000", verdict: "related", percent: 80 }
        : { pass: true, quote: "measured result" };
  }
  return { ...all, ...patch } as RiskAssessment["checks"];
}

function assessment(patch: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    ran: true,
    parsed: true,
    checks: checks(),
    grounding_score: 0.92,
    quoted_support: ["test result"],
    safety_claim: "none",
    repair: null,
    ...patch,
  };
}

function record(impact: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    risk: {
      risk_title: "Measured model error",
      description: "The test reports a model error.",
      demonstrated_finding: "The test counted the errors.",
      stated_implication: "",
      evidence_type: "demonstrated",
      primary_risk: "Technical Risks",
      secondary_risks: "Technical/Performance Risk",
      ...(extra.risk as Record<string, unknown> | undefined),
    },
    risk_scoring: {
      likelihood: 3,
      likelihood_reasoning: "The test counted the errors.",
      impact: 3,
      impact_reasoning: impact,
    },
  };
}

test("potential patient-safety impact is real_world when the source shows only test errors", () => {
  const source =
    "The confusion matrix showed 8 immediate cases labelled elective and 6 urgent cases labelled immediate. The model could improve prioritization and patient care.";
  const claim = resolveSafetyClaim(
    record(
      "Misclassification could lead to incorrect prioritization affecting patient scheduling in hospital operating rooms, representing meaningful operational harm to healthcare delivery.",
      {
        risk: {
          demonstrated_finding:
            "8 immediate cases were misclassified as elective and 6 urgent cases were misclassified as immediate.",
        },
      },
    ),
    source,
    "none",
  );
  assert.equal(claim, "real_world");
});

test("a differently worded clinical consequence is also real_world", () => {
  const claim = resolveSafetyClaim(
    record("The misclassification may injure patients by delaying urgent surgery."),
    "Errors were counted on a held-out transcription test.",
    "none",
  );
  assert.equal(claim, "real_world");
});

test("a denial of patient-safety consequences stays unheld", () => {
  const claim = resolveSafetyClaim(
    record(
      "The demonstrated impact is measurable performance degradation across benchmark metrics in a research setting, with no reported deployment harm or patient safety consequences.",
    ),
    "Removing the constraint degraded benchmark metrics. No clinical incident is reported.",
    "real_world",
  );
  assert.equal(claim, "none");
});

test("a denial of physical harm in a simulation stays unheld", () => {
  const claim = resolveSafetyClaim(
    record(
      "The measured effect is a 28.5% task failure rate in simulation with no reported physical harm, equipment damage, or deployment consequences beyond task incompletion.",
    ),
    "The topology-guided variant achieved a 71.5% success rate over 200 simulations.",
    "real_world",
  );
  assert.equal(claim, "none");
});

test("a healthcare accuracy study with no patient-harm sentence stays unheld", () => {
  const claim = resolveSafetyClaim(
    record("The external-split AUC fell from 0.91 to 0.84 on the chest X-ray benchmark.", {
      risk: {
        description: "The model was scored on a public set of patient images.",
        demonstrated_finding: "External-split AUC was 0.84.",
      },
    }),
    "External-split AUC was 0.84. No clinical deployment is reported.",
    "real_world",
  );
  assert.equal(claim, "none");
});

test("a clinical extraction benchmark stays unheld", () => {
  const claim = resolveSafetyClaim(
    record("Medication-name extraction reached an F1 of 0.87 on the annotation set."),
    "The annotation set scores medication names. F1 was 0.87.",
    "none",
  );
  assert.equal(claim, "none");
});

test("a conditional simulation keeps the measured estimate when impact does not assert harm", () => {
  const claim = resolveSafetyClaim(
    record("The 71.5% figure is an empirical estimate from the simulation.", {
      risk: {
        demonstrated_finding: "The 71.5% figure is an empirical estimate, not a certified probability.",
        stated_implication: "If deployed on safety-critical equipment, physical harm could follow.",
        description: "If deployed on safety-critical equipment, physical harm could follow.",
      },
    }),
    "The 71.5% figure is an empirical estimate from the simulation. Results are not a deployed incident.",
    "none",
  );
  assert.equal(claim, "none");
});

test("a deployed patient-harm incident is real_world", () => {
  const claim = resolveSafetyClaim(
    record("A deployed dosing tool gave the wrong dose and a patient was harmed.", {
      risk: { demonstrated_finding: "A patient was harmed after the wrong dose." },
    }),
    "The hospital reported that a patient was harmed after the deployed dosing tool gave the wrong dose.",
    "none",
  );
  assert.equal(claim, "real_world");
});

test("research_only remains when the record asserts no safety harm", () => {
  const claim = resolveSafetyClaim(
    record("Representability fell below one instance in ten thousand in the sample."),
    "Under uniform sampling, representability falls below the detection limit.",
    "research_only",
  );
  assert.equal(claim, "research_only");
});

test("the safety hold survives a repair proposal and failed benefit-based checks", async () => {
  const extraction = record(
    "Misclassification could lead to incorrect prioritization affecting patient scheduling in hospital operating rooms, representing operational harm to healthcare delivery.",
  );
  let calls = 0;
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText:
      "The confusion matrix counted test misclassifications. The authors say the method could improve patient care and resource allocation.",
    catalogCandidates: [],
    hints: {},
    assess: async () => {
      calls += 1;
      return assessment({
        safety_claim: "none",
        repair: {
          drop_clause: "operational harm to healthcare delivery",
          reason: "source does not show the harm",
        },
        checks: checks({
          severity_within_evidence: {
            pass: false,
            reason: "A benefit sentence does not show patient harm.",
          },
          rationale_supported: {
            pass: false,
            reason: "Improved patient care does not support the harm rationale.",
          },
          catalog_match: { pass: true, best_id: "RISK-1146", verdict: "related", percent: 65 },
        }),
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.decision.reason, "SAFETY_HOLD");
  assert.equal(result.decision.publication, "hold");
  assert.equal(extraction.safety_claim, "real_world");
  assert.match(String((extraction.risk_scoring as { impact_reasoning: string }).impact_reasoning), /operational harm/);
});

test("an observed may-statement is held as an unsupported claim", async () => {
  const extraction = record("The paper reports a measured drop on the benchmark.", {
    risk: {
      demonstrated_finding:
        "The authors observed that models may generate unsupported details in their rationales during time series classification.",
      description:
        "The authors observed that models may generate unsupported details in their rationales.",
      evidence_type: "mitigation_target",
    },
  });
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText:
      "Vision-language models may generate unsupported details, so the method discards some rationales before they enter the knowledge bank.",
    catalogCandidates: [],
    hints: {},
    assess: async () =>
      assessment({
        checks: checks({
          catalog_match: { pass: true, best_id: "RISK-1", verdict: "same mechanism", percent: 85 },
        }),
      }),
  });
  assert.equal(result.decision.reason, "CLAIM_UNSUPPORTED");
  assert.equal(result.decision.publication, "hold");
});

test("a measured observation that the source states as fact is not held for wording", async () => {
  const extraction = record("Accuracy fell by three points on the held-out set.", {
    risk: {
      demonstrated_finding: "The authors observed that accuracy fell by three points on the held-out set.",
    },
  });
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "The authors observed that accuracy fell by three points on the held-out set.",
    catalogCandidates: [],
    hints: {},
    assess: async () => assessment(),
  });
  assert.equal(result.decision.reason, "VERIFIED");
});

test("a demonstrated wording of a source may-warning is held", async () => {
  const extraction = record("Benchmark performance changed.", {
    risk: {
      demonstrated_finding:
        "The paper demonstrates through experiments that VLMs can generate unsupported details in rationales and that spurious rules can accumulate.",
      evidence_type: "mitigation_target",
    },
  });
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText:
      "This is crucial because models may generate unsupported details in their rationales. The method discards some of them.",
    catalogCandidates: [],
    hints: {},
    assess: async () =>
      assessment({
        checks: checks({
          catalog_match: { pass: true, best_id: "RISK-1", verdict: "same mechanism", percent: 65 },
        }),
      }),
  });
  assert.equal(result.decision.reason, "CLAIM_UNSUPPORTED");
  assert.equal(result.decision.publication, "hold");
});

test("a measured ablation quoted as a claim failure still publishes as labelled", async () => {
  const extraction = record(
    "The ablation study shows substantial performance degradation across benchmarks when domain constraints are removed, representing a limited but measurable quality reduction in a research setting.",
    {
      risk: {
        demonstrated_finding:
          "Ablation study shows removing domain-informed subspace initialization causes substantial performance degradation across all five benchmarks.",
        evidence_type: "mitigation_target",
      },
    },
  );
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText:
      "Removing DISI reverts the agent to unconstrained generation. As shown in Fig. 2, both variants degrade substantially across all five benchmarks.",
    catalogCandidates: [],
    hints: {},
    assess: async () =>
      assessment({
        safety_claim: "none",
        grounding_score: 0.85,
        checks: checks({
          claim_is_demonstrated: {
            pass: false,
            quote:
              "Removing DISI reverts the agent to unconstrained generation over the full space S. As shown in Fig. 2, both variants degrade substantially across all five benchmarks on primary and secondary metrics alike",
            reason:
              "The source does not show this risk as a measured result or a real incident.",
          },
          catalog_match: { pass: true, best_id: "RISK-1088", verdict: "same mechanism", percent: 72 },
        }),
      }),
  });
  assert.equal(result.decision.reason, "PUBLISHED_LABELLED");
  assert.equal(result.decision.publication, "publish");
});

test("an ablation that denies reported harm publishes as a mitigation target", async () => {
  const extraction = record(
    "The demonstrated impact is measurable performance degradation across benchmark metrics in a research setting, with no reported deployment harm or patient safety consequences.",
    {
      risk: {
        demonstrated_finding:
          "The ablation study shows that removing Domain-Informed Subspace Initialization causes substantial performance degradation across all five benchmarks.",
        evidence_type: "demonstrated",
      },
    },
  );
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "Removing the initialization degraded benchmark metrics. No clinical incident is reported.",
    catalogCandidates: [],
    hints: {},
    assess: async () =>
      assessment({
        safety_claim: "real_world",
        checks: checks({
          catalog_match: { pass: true, best_id: "RISK-1148", verdict: "related", percent: 65 },
        }),
      }),
  });
  assert.equal(result.decision.reason, "PUBLISHED_LABELLED");
  assert.equal(result.decision.publication, "publish");
  assert.equal(
    (extraction.risk as { evidence_type?: string }).evidence_type,
    "mitigation_target",
  );
});

test("failed severity and rationale checks do not hold when there is no safety claim", () => {
  const decision = decideWorkflow({
    assessment: assessment({
      checks: checks({
        severity_within_evidence: { pass: false, reason: "beyond the evidence" },
        rationale_supported: { pass: false, reason: "benefit sentence" },
      }),
    }),
    evidenceType: "demonstrated",
  });
  assert.equal(decision.reason, "VERIFIED");
  assert.equal(decision.publication, "publish");
  assert.ok(decision.notes.some((note) => note.startsWith("severity_within_evidence")));
  assert.ok(decision.notes.some((note) => note.startsWith("rationale_supported")));
});

test("low grounding holds before repair and does not become a safety hold", async () => {
  let calls = 0;
  const extraction = record("Potential reputational damage from a misread story.");
  const result = await runFactsV2AssessmentCycle({
    extractionJson: extraction,
    sourceText: "Human review is required to interpret the co-occurrence rules.",
    catalogCandidates: [],
    hints: {},
    assess: async () => {
      calls += 1;
      return assessment({
        grounding_score: 0.4,
        repair: { drop_clause: "reputational damage", reason: "not in source" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.decision.reason, "CLAIM_UNSUPPORTED");
  assert.equal(result.decision.publication, "hold");
});

test("a demonstrated breach with a weak catalog match stays a suggestion", () => {
  const decision = decideWorkflow({
    assessment: assessment({
      checks: checks({
        catalog_match: { pass: false, best_id: "RISK-484", verdict: "related", percent: 47 },
      }),
    }),
    evidenceType: "demonstrated",
  });
  assert.equal(decision.reason, "CATALOG_SUGGESTED");
  assert.equal(decision.publication, "publish");
});

test("a blocked fetch and a non-AI vulnerability bulletin produce no risk decision", () => {
  assert.equal(decideWorkflow({ stage: "fetch_fail" }).reason, "FETCH_FAIL");
  assert.equal(decideWorkflow({ stage: "not_ai" }).reason, "NOT_AI");
  assert.equal(
    detectBotBlockPage("<html><body>Access Denied</body></html>", { httpStatus: 403 }),
    FETCH_FAILED_SKIP_MESSAGE,
  );
  assert.equal(jobSkipReasonCode(FETCH_FAILED_SKIP_MESSAGE), "FETCH_FAIL");
  const [related] = classifyAiRelated(
    "The alert adds four known exploited vulnerabilities in conventional server software to the catalog.",
    { title: "Vulnerability catalog alert" },
  );
  assert.equal(related, false);
  assert.equal(jobSkipReasonCode("content has no AI-relevant risk"), "NOT_AI");
});
