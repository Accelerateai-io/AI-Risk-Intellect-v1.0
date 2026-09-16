import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogRiskMatch } from "./riskCatalogMatch.service.js";
import {
  applyJudgeVerdicts,
  isJudgeEnabled,
  judgeAndApplyVerdicts,
  parseVerdicts,
} from "./riskMatchJudge.service.js";

function match(overrides: Partial<CatalogRiskMatch> = {}): CatalogRiskMatch {
  return {
    riskId: "MAP-1",
    title: "Catalog risk",
    description: "Some catalog description",
    domain: "Misinformation",
    accuracyPercent: 50,
    domainMatchPercent: 80,
    descriptionMatchPercent: 40,
    matchSummary: "s",
    heuristicPercent: 50,
    ...overrides,
  };
}

describe("parseVerdicts", () => {
  const candidates = [match({ riskId: "MAP-1" }), match({ riskId: "MAP-2" })];

  it("parses a plain JSON verdict payload", () => {
    const raw = JSON.stringify({
      verdicts: [
        { risk_id: "MAP-1", is_match: true, adjusted_percent: 82, reasoning: "Same mechanism." },
        { risk_id: "MAP-2", is_match: false, adjusted_percent: 20, reasoning: "Topic only." },
      ],
    });
    const verdicts = parseVerdicts(raw, candidates);
    assert.ok(verdicts);
    assert.equal(verdicts.length, 2);
    assert.equal(verdicts[0].riskId, "MAP-1");
    assert.equal(verdicts[0].isMatch, true);
    assert.equal(verdicts[0].adjustedPercent, 82);
  });

  it("parses JSON wrapped in a code fence with prose around it", () => {
    const raw =
      'Here you go:\n```json\n{"verdicts":[{"risk_id":"MAP-1","is_match":true,"adjusted_percent":75.4,"reasoning":"ok"}]}\n```';
    const verdicts = parseVerdicts(raw, candidates);
    assert.ok(verdicts);
    assert.equal(verdicts[0].adjustedPercent, 75);
  });

  it("drops verdicts for unknown risk ids", () => {
    const raw = JSON.stringify({
      verdicts: [
        { risk_id: "MAP-999", is_match: true, adjusted_percent: 90, reasoning: "x" },
        { risk_id: "MAP-1", is_match: true, adjusted_percent: 70, reasoning: "y" },
      ],
    });
    const verdicts = parseVerdicts(raw, candidates);
    assert.ok(verdicts);
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].riskId, "MAP-1");
  });

  it("returns null for malformed output", () => {
    assert.equal(parseVerdicts("not json at all", candidates), null);
    assert.equal(parseVerdicts('{"verdicts": []}', candidates), null);
    assert.equal(
      parseVerdicts('{"verdicts":[{"risk_id":"MAP-1"}]}', candidates),
      null,
    );
    assert.equal(
      parseVerdicts(
        '{"verdicts":[{"risk_id":"MAP-1","is_match":true,"adjusted_percent":150,"reasoning":"x"}]}',
        candidates,
      ),
      null,
    );
  });
});

describe("applyJudgeVerdicts", () => {
  it("blends 0.4 heuristic with 0.6 adjusted", () => {
    const result = applyJudgeVerdicts(
      [match({ riskId: "MAP-1", accuracyPercent: 50, heuristicPercent: 50 })],
      [{ riskId: "MAP-1", isMatch: true, adjustedPercent: 90, reasoning: "r" }],
    );
    assert.equal(result[0].accuracyPercent, Math.round(0.4 * 50 + 0.6 * 90));
    assert.equal(result[0].heuristicPercent, 50);
    assert.equal(result[0].judgeVerdict, "match");
    assert.equal(result[0].judgeReasoning, "r");
  });

  it("caps non-matches at 35", () => {
    const result = applyJudgeVerdicts(
      [match({ riskId: "MAP-1", accuracyPercent: 60, heuristicPercent: 60 })],
      [{ riskId: "MAP-1", isMatch: false, adjustedPercent: 55, reasoning: "" }],
    );
    assert.ok(result[0].accuracyPercent <= 35);
    assert.equal(result[0].judgeVerdict, "no_match");
  });

  it("keeps heuristic scores for candidates without verdicts and re-sorts", () => {
    const result = applyJudgeVerdicts(
      [
        match({ riskId: "MAP-1", accuracyPercent: 60, heuristicPercent: 60 }),
        match({ riskId: "MAP-2", accuracyPercent: 40, heuristicPercent: 40 }),
      ],
      [{ riskId: "MAP-2", isMatch: true, adjustedPercent: 95, reasoning: "" }],
    );
    assert.equal(result[0].riskId, "MAP-2");
    assert.equal(result[0].accuracyPercent, Math.round(0.4 * 40 + 0.6 * 95));
    assert.equal(result[1].riskId, "MAP-1");
    assert.equal(result[1].accuracyPercent, 60);
    assert.equal(result[1].judgeVerdict, undefined);
  });
});

describe("judgeAndApplyVerdicts", () => {
  it("returns the matches untouched when the judge yields no verdicts", async () => {
    // Empty candidates make judgeCatalogMatches short-circuit to null with no
    // Bedrock call — the deterministic "judge unavailable" path. The helper
    // must return the input unchanged, matching the old inline
    // `if (verdicts) matches = applyJudgeVerdicts(...)` behavior exactly.
    const matches: CatalogRiskMatch[] = [];
    const result = await judgeAndApplyVerdicts(matches, {
      title: "t",
      description: "d",
      domain: "Misinformation",
    });
    assert.equal(result, matches);
  });
});

describe("isJudgeEnabled", () => {
  it("defaults to enabled and honours the env kill-switch", () => {
    delete process.env.MATCH_JUDGE_ENABLED;
    assert.equal(isJudgeEnabled(), true);
    process.env.MATCH_JUDGE_ENABLED = "false";
    try {
      assert.equal(isJudgeEnabled(), false);
    } finally {
      delete process.env.MATCH_JUDGE_ENABLED;
    }
  });
});
