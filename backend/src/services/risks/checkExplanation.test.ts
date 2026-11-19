import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { failedCheckExplanation, failedCheckNote } from "./checkExplanation.js";

describe("failed check explanations", () => {
  it("keeps a clear model reason and adds the source quote", () => {
    const text = failedCheckExplanation("claim_is_demonstrated", {
      pass: false,
      reason: "The source only speculates.",
      quote: "the attack might succeed",
    });
    assert.match(text, /source only speculates/i);
    assert.match(text, /Source quote: “the attack might succeed”/);
  });

  it("explains a failed check that arrived without a reason", () => {
    const text = failedCheckNote("domain_correct", {
      pass: false,
      corrected: "2. Privacy & Security",
    });
    assert.match(text, /^domain_correct \(Domain correct\): /);
    assert.match(text, /does not match the harm/);
    assert.match(text, /Corrected value: 2\. Privacy & Security/);
  });

  it("explains a check that did not run", () => {
    const text = failedCheckExplanation("rationale_supported", { pass: null });
    assert.match(text, /did not run/);
    assert.match(text, /not supported by the source/);
  });

  it("names the catalog entry when the match fails", () => {
    const text = failedCheckExplanation("catalog_match", {
      pass: false,
      reason: "below 60 percent",
      best_id: "RISK-484",
      verdict: "related",
    });
    assert.match(text, /No catalog entry describes this same risk/);
    assert.match(text, /RISK-484/);
    assert.match(text, /related/);
    assert.match(text, /Recorded result: below 60 percent/);
  });
});
