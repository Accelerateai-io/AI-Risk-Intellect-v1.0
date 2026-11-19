import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectBotBlockPage,
  getExcludedNonAiTopicSkipReason,
  jobSkipReasonCode,
  BOT_BLOCK_SKIP_MESSAGE,
  FETCH_FAILED_SKIP_MESSAGE,
  PAYWALL_SKIP_MESSAGE,
  NOT_AI_RELATED_SKIP_MESSAGE,
} from "./filters.js";

describe("detectBotBlockPage (B-4)", () => {
  // R-24: CISA "Access Denied" interstitial served with a 403. Previously this
  // slipped through (no Cloudflare keyword) and produced a junk risk row.
  const CISA_ACCESS_DENIED =
    "<html><head><title>Access Denied</title></head><body>" +
    "<h1>Access Denied</h1><p>You don't have permission to access " +
    '"http://www.cisa.gov/" on this server.</p></body></html>';

  it("flags a bare 403 access-denied page (R-24)", () => {
    assert.equal(
      detectBotBlockPage(CISA_ACCESS_DENIED, { httpStatus: 403 }),
      FETCH_FAILED_SKIP_MESSAGE,
    );
  });

  it("flags 401 and 429 unconditionally", () => {
    assert.equal(
      detectBotBlockPage("<html><body>nope</body></html>", { httpStatus: 401 }),
      FETCH_FAILED_SKIP_MESSAGE,
    );
    assert.equal(
      detectBotBlockPage("<html><body>slow down</body></html>", {
        httpStatus: 429,
      }),
      FETCH_FAILED_SKIP_MESSAGE,
    );
  });

  it("flags a paywall interstitial with no article body", () => {
    assert.equal(
      detectBotBlockPage(
        "<html><body><p>Subscribe to continue reading this article.</p></body></html>",
        { httpStatus: 200 },
      ),
      PAYWALL_SKIP_MESSAGE,
    );
  });

  it("does NOT flag a full article that mentions a paywall phrase in its footer (B-4 review)", () => {
    const body = "<p>".concat(
      "Real AI governance analysis of model risk. ".repeat(40),
      "</p>",
    );
    const footer =
      "<footer>Subscribe to continue reading our weekly newsletter.</footer>";
    const html = `<html><body>${body}${footer}</body></html>`;
    assert.equal(detectBotBlockPage(html, { httpStatus: 200 }), null);
    // And when the extractor already supplied the substantial body text.
    assert.equal(
      detectBotBlockPage("<html>subscribe to continue reading</html>", {
        httpStatus: 200,
        extractedText: "A".repeat(800),
      }),
      null,
    );
  });

  it("does not flag a normal 200 article page", () => {
    const article =
      "<html><body>" +
      "<p>".concat("A".repeat(800), "</p>") +
      "</body></html>";
    assert.equal(detectBotBlockPage(article, { httpStatus: 200 }), null);
  });

  it("leaves pure 404/410 to the HTTP-status path", () => {
    assert.equal(
      detectBotBlockPage("<html><body>A real long body here</body></html>", {
        httpStatus: 404,
      }),
      null,
    );
  });
});

describe("getExcludedNonAiTopicSkipReason", () => {
  it("does not classify NOT_AI until the article content has been read", () => {
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        url: "https://espn.com/nfl/football",
      }),
      null,
    );
    assert.equal(
      getExcludedNonAiTopicSkipReason({ title: "Best travel destinations" }),
      null,
    );
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        url: "https://espn.com/nfl/football",
        title: "Sunday recap",
        text: "The football match ended after extra time.",
      }),
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

  it("keeps the Air Canada chatbot article after the travel page is read", () => {
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        url: "https://www.bbc.com/travel/article/20240222-air-canada-chatbot-misinformation-what-travellers-should-know",
        title:
          "Airline held liable for its chatbot giving passenger bad advice - what this means for travellers",
        text:
          "When Air Canada's chatbot gave incorrect information to a traveller, the airline argued its chatbot is responsible for its own actions. Artificial intelligence is having a growing impact on the way we travel. This type of mistake, in which generative AI tools present inaccurate information, is known as AI hallucination. Expedia launched a ChatGPT plug-in to help with trip planning.",
      }),
      null,
    );
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        url: "https://www.bbc.com/travel/article/20240222-air-canada-chatbot-misinformation-what-travellers-should-know",
        title: "Air Canada chatbot misinformation",
      }),
      null,
    );
  });

  it("does not drop the arXiv papers that failed in processing", () => {
    for (const url of [
      "https://arxiv.org/abs/2307.15043",
      "https://arxiv.org/abs/2401.05566",
      "https://arxiv.org/abs/2503.13938",
      "https://arxiv.org/abs/2602.13473",
      "https://arxiv.org/abs/2605.10201",
    ]) {
      assert.equal(getExcludedNonAiTopicSkipReason({ url, title: "arXiv paper" }), null);
    }
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

describe("jobSkipReasonCode (B-4)", () => {
  it("classifies fetch/block/paywall/HTTP reasons as FETCH_FAIL", () => {
    for (const reason of [
      BOT_BLOCK_SKIP_MESSAGE,
      FETCH_FAILED_SKIP_MESSAGE,
      PAYWALL_SKIP_MESSAGE,
      "HTTP 403",
      "Could not reach the site — connection failed",
      "The site did not respond in time (connection timed out).",
      "Cannot resolve hostname (DNS lookup failed).",
      "html text too small",
      "Fetch failed: the site returned an error or access-denied response (HTTP 403)",
    ]) {
      assert.equal(jobSkipReasonCode(reason), "FETCH_FAIL", reason);
    }
  });

  it("classifies non-AI reasons as NOT_AI", () => {
    assert.equal(jobSkipReasonCode(NOT_AI_RELATED_SKIP_MESSAGE), "NOT_AI");
    assert.equal(
      jobSkipReasonCode("no AI-relevant risk in content"),
      "NOT_AI",
    );
  });

  it("returns null for timeouts, do-not-execute and empty reasons", () => {
    assert.equal(
      jobSkipReasonCode(
        "Skipped because this URL took more than 5 minutes without finishing — it was taking too long.",
      ),
      null,
    );
    assert.equal(jobSkipReasonCode(""), null);
    assert.equal(jobSkipReasonCode(null), null);
  });
});
