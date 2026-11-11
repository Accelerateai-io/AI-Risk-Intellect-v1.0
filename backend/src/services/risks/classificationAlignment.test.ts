import assert from "node:assert/strict";
import { test } from "node:test";
import { alignSecondaryClassification } from "./classificationAlignment.js";

function risk(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    risk_title: "A measured result",
    description: "The source reports the result.",
    attack_vector: "",
    stated_implication: "",
    primary_risk: "Technical Risks",
    secondary_risks: "Technical/Performance Risk",
    ...patch,
  };
}

test("security mechanisms move off Technical/Performance Risk", () => {
  const cases = [
    "An agent with internal access can take harmful actions, including cyber attacks.",
    "The attack is prompt injection that causes credential exposure.",
    "The paper shows data exposure after system compromise.",
  ];
  for (const description of cases) {
    const aligned = alignSecondaryClassification(
      risk({ description, secondary_risks: "Technical/Performance Risk" }),
    );
    assert.ok(aligned, description);
    assert.equal(aligned?.secondary, "Security Risk");
    assert.equal(aligned?.primary, "Technical Risks");
  }
});

test("output-quality mechanisms stay Technical/Performance Risk", () => {
  const cases = [
    "The model hallucinates citations.",
    "Users see inaccurate output and inconsistent responses.",
    "Removing the constraint causes performance degradation.",
    "Held-out accuracy fell by three percent.",
  ];
  for (const description of cases) {
    assert.equal(
      alignSecondaryClassification(
        risk({ description, secondary_risks: "Technical/Performance Risk" }),
      ),
      null,
      description,
    );
  }
});

test("an output-quality record mislabeled as Security Risk is corrected", () => {
  const aligned = alignSecondaryClassification(
    risk({
      description: "The benchmark shows a hallucination rate and an accuracy drop.",
      secondary_risks: "Security Risk",
      primary_risk: "Operational Risks",
    }),
  );
  assert.equal(aligned?.secondary, "Technical/Performance Risk");
  assert.equal(aligned?.primary, "Technical Risks");
});

test("CAPTCHA solving performance is not treated as a security mechanism", () => {
  const solving = [
    "CAPTCHA-solving accuracy improved to 90%",
    "AI model successfully solves CAPTCHA challenges",
  ];
  for (const description of solving) {
    assert.equal(
      alignSecondaryClassification(
        risk({ description, secondary_risks: "Technical/Performance Risk" }),
      ),
      null,
      description,
    );
  }
});

test("CAPTCHA bypass wording without a source attack outcome stays performance", () => {
  const inserted = [
    "The system bypasses CAPTCHA protection to gain unauthorized access",
    "CAPTCHA evasion enables unauthorized account access",
    "The agent defeats the CAPTCHA and then enters the account",
    "Circumventing CAPTCHA protection exposes the service",
    "The CAPTCHA solver reached 85.4% accuracy and recovered every round of a simulated arms race.",
  ];
  const source =
    "The detector reached 85.4% accuracy across 16 classes and recovered after each perturbation.";
  for (const description of inserted) {
    assert.equal(
      alignSecondaryClassification(
        risk({ description, secondary_risks: "Technical/Performance Risk" }),
        source,
      ),
      null,
      description,
    );
    const corrected = alignSecondaryClassification(
      risk({
        description,
        secondary_risks: "Security Risk",
        primary_risk: "Technical Risks",
      }),
      source,
    );
    assert.equal(corrected?.secondary, "Technical/Performance Risk", description);
    assert.equal(corrected?.primary, "Technical Risks");
  }
});

test("a source-reported CAPTCHA attack outcome is Security Risk", () => {
  const source =
    "After solving the challenge, the intruder completed an account takeover and used stolen credentials.";
  const aligned = alignSecondaryClassification(
    risk({
      description: "The paper reports a CAPTCHA solver with 90% accuracy.",
      secondary_risks: "Technical/Performance Risk",
    }),
    source,
  );
  assert.equal(aligned?.secondary, "Security Risk");
  assert.equal(aligned?.primary, "Technical Risks");
});

test("an agent security failure is Security Risk on a new assessment", () => {
  const aligned = alignSecondaryClassification(
    risk({
      risk_title:
        "Imperfectly aligned agents with internal system access could execute harmful actions",
      description:
        "Internal agents are treated as insider threats and could take part in cyber attacks, including unintentional data deletion.",
      secondary_risks: "Technical/Performance Risk",
    }),
    "Analysis of coding agent tasks found flagged events and the need to prevent major cyber attacks.",
  );
  assert.equal(aligned?.secondary, "Security Risk");
  assert.equal(aligned?.primary, "Technical Risks");
});

test("a mixed or already matching record is not rewritten", () => {
  assert.equal(
    alignSecondaryClassification(
      risk({
        description: "A prompt injection also increased hallucinations in the replies.",
      }),
    ),
    null,
  );
  assert.equal(
    alignSecondaryClassification(
      risk({
        description:
          "The model bypasses CAPTCHA protection, and its accuracy fell on the same benchmark.",
      }),
    ),
    null,
  );
  assert.equal(
    alignSecondaryClassification(
      risk({
        description: "The agent can take harmful actions.",
        secondary_risks: "Security Risk",
      }),
    ),
    null,
  );
  assert.equal(
    alignSecondaryClassification(
      risk({
        description: "The scheduling agent causes a workflow outage.",
        secondary_risks: "Operational Risk",
        primary_risk: "Operational Risks",
      }),
    ),
    null,
  );
});
