import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { jobSkipReasonCode } from "./filters.js";
import {
  RESEARCH_SOURCE_SKIP_MESSAGE,
  isResearchSourceUrl,
  researchSourceSkipReason,
} from "./researchSources.js";

const savedBlocked = process.env.RESEARCH_SOURCES_BLOCKED;
const savedDomains = process.env.RESEARCH_SOURCE_DOMAINS;

function clearEnv(): void {
  delete process.env.RESEARCH_SOURCES_BLOCKED;
  delete process.env.RESEARCH_SOURCE_DOMAINS;
}

beforeEach(clearEnv);

afterEach(() => {
  if (savedBlocked === undefined) delete process.env.RESEARCH_SOURCES_BLOCKED;
  else process.env.RESEARCH_SOURCES_BLOCKED = savedBlocked;
  if (savedDomains === undefined) delete process.env.RESEARCH_SOURCE_DOMAINS;
  else process.env.RESEARCH_SOURCE_DOMAINS = savedDomains;
});

describe("isResearchSourceUrl", () => {
  it("matches research-paper hosts and their subdomains", () => {
    for (const url of [
      "https://arxiv.org/abs/2610.31874",
      "https://arxiv.org/pdf/2610.31874v2",
      "http://export.arxiv.org/abs/2503.13938",
      "https://www.arxiv.org/abs/2605.10201",
      "https://openreview.net/forum?id=abc",
      "https://www.medrxiv.org/content/10.1101/2024.01.01.24300001v1",
      "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1",
      "https://ieeexplore.ieee.org/document/123",
      "https://dl.acm.org/doi/10.1145/1",
    ]) {
      assert.equal(isResearchSourceUrl(url), true, url);
    }
  });

  it("does not match news, blogs, regulators or look-alike hosts", () => {
    for (const url of [
      "https://www.statnews.com/2023/03/13/medicare-advantage-plans-denial-artificial-intelligence",
      "https://spectrum.ieee.org/andon-labs-agentic-ai-businesses",
      "https://www.schneier.com/blog/archives/2026/10/training-ais-to-solve-captchas.html",
      "https://deepmind.google/blog/alphagenome-ai-for-better-understanding-the-genome",
      "https://www.ftc.gov/news-events/news/press-releases/2026/08/x",
      "https://notarxiv.org/abs/1",
      "https://arxiv.org.evil.example/abs/1",
      "https://example.com/?u=https://arxiv.org/abs/1",
      "not a url",
      "",
    ]) {
      assert.equal(isResearchSourceUrl(url), false, url);
    }
  });

  it("uses RESEARCH_SOURCE_DOMAINS in place of the defaults", () => {
    process.env.RESEARCH_SOURCE_DOMAINS = " nature.com , .example.org ";
    assert.equal(isResearchSourceUrl("https://www.nature.com/articles/x"), true);
    assert.equal(isResearchSourceUrl("https://sub.example.org/p"), true);
    assert.equal(isResearchSourceUrl("https://arxiv.org/abs/1"), false);
  });
});

describe("researchSourceSkipReason", () => {
  it("skips research URLs by default", () => {
    assert.equal(
      researchSourceSkipReason("https://arxiv.org/abs/2610.31874"),
      RESEARCH_SOURCE_SKIP_MESSAGE,
    );
    assert.equal(researchSourceSkipReason("https://apnews.com/article/x"), null);
  });

  it("can be turned off with RESEARCH_SOURCES_BLOCKED=0", () => {
    for (const off of ["0", "false", "off", "no", "OFF"]) {
      process.env.RESEARCH_SOURCES_BLOCKED = off;
      assert.equal(
        researchSourceSkipReason("https://arxiv.org/abs/2610.31874"),
        null,
        off,
      );
    }
  });

  it("is stored as the RESEARCH skip code, not NOT_AI or FETCH_FAIL", () => {
    assert.equal(jobSkipReasonCode(RESEARCH_SOURCE_SKIP_MESSAGE), "RESEARCH");
  });
});
