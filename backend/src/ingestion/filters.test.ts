import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getExcludedNonAiTopicSkipReason,
  NOT_AI_RELATED_SKIP_MESSAGE,
} from "./filters.js";

describe("getExcludedNonAiTopicSkipReason", () => {
  it("skips sports/travel/recipe URLs with a stable info message", () => {
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        url: "https://espn.com/nfl/football",
      }),
      NOT_AI_RELATED_SKIP_MESSAGE,
    );
    assert.equal(
      getExcludedNonAiTopicSkipReason({ title: "Best travel destinations" }),
      NOT_AI_RELATED_SKIP_MESSAGE,
    );
  });

  it("allows AI-related URLs", () => {
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        url: "https://example.com/ai-safety-policy",
      }),
      null,
    );
  });

  it("allows AI articles when extracted text includes site nav terms like travel", () => {
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        url: "https://www.kqed.org/news/12082064/openai-back-in-court-over-canada-school-shooters-use-of-chatgpt",
        title:
          "OpenAI Back in Court Over Canada School Shooter's Use of ChatGPT",
        text:
          "Travel Food Sports. The artificial intelligence company OpenAI said ChatGPT was used before the attack.",
      }),
      null,
    );
  });
});
