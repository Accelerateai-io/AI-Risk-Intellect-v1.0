import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeNarrativeText,
  splitSentences,
} from "./normalizeNarrativeText.js";

// B-5: abbreviation-safe sentence splitting. Kept in parity with
// python/tests/test_abbreviation_split.py.

describe("splitSentences (B-5)", () => {
  it("does not split on a U.S. abbreviation", () => {
    assert.deepEqual(
      splitSentences("The tool was deployed by a U.S. agency. It raised concerns."),
      ["The tool was deployed by a U.S. agency.", "It raised concerns."],
    );
  });

  it("does not split on common abbreviations (Fig. e.g. i.e. et al. No. vs.)", () => {
    for (const text of [
      "See Fig. 2 for details. The next point follows.",
      "We used e.g. GPT-4 and Claude. Results varied.",
      "That is, i.e. the model failed. A fix is pending.",
      "Smith et al. reported the bug. It was fixed.",
      "Compare No. 5 and vs. the baseline. Scores rose.",
    ]) {
      assert.equal(splitSentences(text).length, 2, text);
    }
  });

  it("does not split on decimals", () => {
    assert.equal(
      splitSentences("Accuracy fell to 3.14 percent overall. That is bad.").length,
      2,
    );
  });
});

// R-26 (ETO Scout, vol. 30) — real stored text from the golden set
// (docs/remediation/gold_set/sources/R-13765.txt and its record). "U.S." must
// never be a sentence boundary: the record's own title "...in U.S. AI Models..."
// has "U.S." immediately before a capitalized word ("AI"), which is exactly the
// boundary the splitter used to break on — cutting the sentence at "U.S.".
describe("R-26 real 'U.S.' text (B-5)", () => {
  // Verbatim R-26 record title.
  const R26_TITLE =
    "Safety Filters in U.S. AI Models Prevent Legitimate Security Use, " +
    "Forcing Reliance on Foreign Models.";
  // Verbatim R-26 evidence snippet.
  const R26_EVIDENCE =
    "U.S.-based AI developer community Hugging Face used a Chinese AI model " +
    "to complete forensic analysis after an intrusion by an autonomous " +
    "attacker, because U.S. models' safety filters made them unusable.";

  it("keeps 'U.S. AI' in the real title as ONE sentence (was cut at U.S.)", () => {
    assert.deepEqual(splitSentences(R26_TITLE), [R26_TITLE]);
  });

  it("keeps the real evidence snippet ('U.S.-based', 'U.S. models') as one sentence", () => {
    assert.deepEqual(splitSentences(R26_EVIDENCE), [R26_EVIDENCE]);
  });

  it("normalizeNarrativeText keeps the full U.S. sentence, dropping only a trailing fragment", () => {
    // A real description ending mid-thought after the U.S. sentence: the
    // incomplete tail is dropped, the full "U.S. AI" sentence is preserved.
    const withFragment = `${R26_TITLE} The incident further shows`;
    assert.equal(normalizeNarrativeText(withFragment), R26_TITLE);
  });

  it("does not truncate the real title when it is already complete", () => {
    assert.equal(normalizeNarrativeText(R26_TITLE), R26_TITLE);
  });
});
