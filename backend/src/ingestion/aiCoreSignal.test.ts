import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  NOT_AI_RELATED_SKIP_MESSAGE,
  classifyAiRelated,
  getExcludedNonAiTopicSkipReason,
  hasNoAiSignal,
} from "./filters.js";

// Mirrors python/tests/test_ai_core_signal.py. Generic words alone
// (safety, token, inference, prompt, dataset, "mL" in a dosage) are not AI signal.

const FDA_RECALL =
  "Acme Pharma is voluntarily recalling one lot of Ondansetron Injection, 2 mg/mL, " +
  "10 mL multi-dose vials, to the hospital level due to a potential safety issue: " +
  "particulate matter found during inspection.";
const SECURITY_ADVISORY =
  "A vulnerability in the web management interface could allow an unauthenticated, " +
  "remote attacker to obtain a valid session token and gain administrative access.";
const FINANCE_PAGE =
  "The Board released a new dataset on household debt. Staff caution against " +
  "drawing an inference about default rates. Read the prompt notes at the end.";
const AI_INCIDENT =
  "A hospital chatbot gave patients incorrect dosing advice for 10 mL syringes; " +
  "the vendor said the safety filters failed.";

test("recall, advisory and finance pages have no AI signal", () => {
  assert.equal(
    hasNoAiSignal({
      text: FDA_RECALL,
      title: "Acme Pharma Issues Voluntary Recall",
      url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/acme",
    }),
    true,
  );
  assert.equal(hasNoAiSignal({ text: SECURITY_ADVISORY }), true);
  assert.equal(hasNoAiSignal({ text: FINANCE_PAGE }), true);
  assert.equal(hasNoAiSignal({ text: "Each kit contains a 5 ML syringe." }), true);
});

test("real AI pages keep their signal", () => {
  assert.equal(hasNoAiSignal({ text: AI_INCIDENT }), false);
  assert.equal(hasNoAiSignal({ text: "The bank's ML model denied more loans." }), false);
  assert.equal(hasNoAiSignal({ text: "Algorithmic underwriting must explain denials." }), false);
  assert.equal(hasNoAiSignal({ text: "" }), false);
});

test("classifyAiRelated needs a core term", () => {
  const [ok, details] = classifyAiRelated(`${SECURITY_ADVISORY} ${FINANCE_PAGE}`);
  assert.equal(ok, false);
  assert.equal(details.core_hits, 0);
  assert.ok(details.include_hits >= 2);
  const [ok2] = classifyAiRelated(`${AI_INCIDENT} Prompt injection was involved.`);
  assert.equal(ok2, true);
});

test("a generic title word no longer rescues a sports page", () => {
  const text = "Sunday football recap: the home team won after a late safety.";
  assert.equal(
    getExcludedNonAiTopicSkipReason({ title: "Safety first", text }),
    NOT_AI_RELATED_SKIP_MESSAGE,
  );
  assert.equal(getExcludedNonAiTopicSkipReason({ title: "AI referees", text }), null);
});

// Shared with python/tests/test_ai_core_signal.py so the two gates stay in step.
const FIXTURES = JSON.parse(
  readFileSync(
    new URL("../../../python/tests/fixtures_ai_signal.json", import.meta.url),
    "utf8",
  ),
) as {
  no_ai_signal: string[];
  ai_signal: string[];
  ai_signal_from_url_only: [string, string][];
};

test("shared fixtures: no AI signal", () => {
  for (const text of FIXTURES.no_ai_signal) {
    assert.equal(hasNoAiSignal({ text }), true, text);
  }
});

test("shared fixtures: AI signal", () => {
  for (const text of FIXTURES.ai_signal) {
    assert.equal(hasNoAiSignal({ text }), false, text);
  }
  for (const [title, url] of FIXTURES.ai_signal_from_url_only) {
    assert.equal(hasNoAiSignal({ title, url }), false, url);
  }
});
