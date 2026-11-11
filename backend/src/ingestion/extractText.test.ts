import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractTitleFromHtml } from "./extractText.js";

// Titles: arXiv abstract pages (e.g. 2304.10041 in the golden set) expose the
// real paper title via <meta name="citation_title">, while <title> carries a
// "[arXiv id]" prefix. extractTitleFromHtml must return the clean title.
describe("extractTitleFromHtml (titles)", () => {
  const ARXIV_TITLE =
    "Unvalidated Formal Policy Synthesis in Continuous Systems May Fail " +
    "Under Real-World Deployment";

  it("prefers citation_title on an arXiv abstract page (2304.10041)", () => {
    const html =
      "<html><head>" +
      `<title>[2304.10041] ${ARXIV_TITLE}</title>` +
      `<meta name="citation_title" content="${ARXIV_TITLE}"/>` +
      "</head><body>abstract…</body></html>";
    assert.equal(extractTitleFromHtml(html), ARXIV_TITLE);
  });

  it("strips the [arXiv id] prefix when only <title> is present", () => {
    const html = `<html><head><title>[2304.10041] ${ARXIV_TITLE}</title></head></html>`;
    assert.equal(extractTitleFromHtml(html), ARXIV_TITLE);
  });

  it("falls back to og:title when there is no citation_title", () => {
    const html =
      '<html><head><meta property="og:title" content="A Real Headline"/>' +
      "<title>Site Name</title></head></html>";
    assert.equal(extractTitleFromHtml(html), "A Real Headline");
  });

  it("uses a plain <title> for an ordinary page", () => {
    const html = "<html><head><title>OpenAI Back in Court</title></head></html>";
    assert.equal(extractTitleFromHtml(html), "OpenAI Back in Court");
  });

  it("returns empty string when there is no title at all (caller uses Untitled)", () => {
    assert.equal(extractTitleFromHtml("<html><body>no title here</body></html>"), "");
  });

  // titles review: content capture must not truncate at an apostrophe.
  it("keeps an apostrophe in a double-quoted meta content (not truncated)", () => {
    const html =
      '<html><head><meta property="og:title" content="Google\'s New Model Raises Safety Concerns"/></head></html>';
    assert.equal(
      extractTitleFromHtml(html),
      "Google's New Model Raises Safety Concerns",
    );
  });

  it("captures single-quoted meta content containing a double quote", () => {
    const html =
      "<html><head><meta name='citation_title' content='The &quot;Alignment&quot; Problem'/></head></html>";
    assert.equal(extractTitleFromHtml(html), 'The "Alignment" Problem');
  });

  // titles review: strip ONLY a real arXiv id prefix, never a normal "[...]".
  it("strips old-style and versioned arXiv id prefixes", () => {
    assert.equal(
      extractTitleFromHtml("<title>[hep-th/9901001] String Theory Review</title>"),
      "String Theory Review",
    );
    assert.equal(
      extractTitleFromHtml("<title>[arXiv:2304.10041v2] Versioned Paper</title>"),
      "Versioned Paper",
    );
  });

  it("does NOT strip a non-arXiv bracket prefix like [Opinion]", () => {
    assert.equal(
      extractTitleFromHtml("<title>[Opinion] Why AI Safety Matters</title>"),
      "[Opinion] Why AI Safety Matters",
    );
    assert.equal(
      extractTitleFromHtml("<title>[Update] OpenAI Court Case</title>"),
      "[Update] OpenAI Court Case",
    );
  });
});
