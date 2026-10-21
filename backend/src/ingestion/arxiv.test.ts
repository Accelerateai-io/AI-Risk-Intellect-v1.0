import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SOURCE_WITHDRAWN_REASON,
  arxivPdfUrl,
  isArxivAbsUrl,
  parseArxivAbsId,
  resolveArxivSource,
  rewriteArxivAbsToPdf,
  submissionHistoryIsWithdrawn,
  type ArxivPdfFetch,
} from "./arxiv.js";

// TC-27: arXiv abs URLs are canonicalised to the version-less PDF URL.
describe("rewriteArxivAbsToPdf (TC-27)", () => {
  it("rewrites an abs URL to the pdf URL", () => {
    assert.equal(
      rewriteArxivAbsToPdf("https://arxiv.org/abs/2609.09124"),
      "https://arxiv.org/pdf/2609.09124",
    );
  });

  it("drops the version suffix", () => {
    assert.equal(
      rewriteArxivAbsToPdf("https://arxiv.org/abs/2609.09124v3"),
      "https://arxiv.org/pdf/2609.09124",
    );
  });

  it("handles http, trailing slash and query strings", () => {
    assert.equal(
      rewriteArxivAbsToPdf("http://arxiv.org/abs/2505.13520/"),
      "https://arxiv.org/pdf/2505.13520",
    );
    assert.equal(
      rewriteArxivAbsToPdf("https://arxiv.org/abs/2505.13520?context=cs"),
      "https://arxiv.org/pdf/2505.13520",
    );
  });

  it("handles old-style ids with a category slash", () => {
    assert.equal(
      rewriteArxivAbsToPdf("https://arxiv.org/abs/cs/0112017"),
      "https://arxiv.org/pdf/cs/0112017",
    );
  });

  it("leaves non-arXiv and already-PDF URLs unchanged", () => {
    assert.equal(
      rewriteArxivAbsToPdf("https://example.com/paper.pdf"),
      "https://example.com/paper.pdf",
    );
    assert.equal(
      rewriteArxivAbsToPdf("https://arxiv.org/pdf/2609.09124"),
      "https://arxiv.org/pdf/2609.09124",
    );
  });

  it("parses the id and detects abs URLs", () => {
    assert.equal(parseArxivAbsId("https://arxiv.org/abs/2609.09124v2"), "2609.09124");
    assert.equal(parseArxivAbsId("https://example.com/x"), null);
    assert.equal(isArxivAbsUrl("https://arxiv.org/abs/2505.13520"), true);
    assert.equal(isArxivAbsUrl("https://arxiv.org/pdf/2505.13520"), false);
  });
});

describe("submissionHistoryIsWithdrawn", () => {
  it("is true when the submission history is marked withdrawn", () => {
    const html =
      "<h2>Submission history</h2><p>From ... [v1] ... [v2] Tue (withdrawn)</p>";
    assert.equal(submissionHistoryIsWithdrawn(html), true);
  });

  it("is false for a normal submission history", () => {
    const html = "<h2>Submission history</h2><p>From ... [v1] Mon, 1 Jan 2026</p>";
    assert.equal(submissionHistoryIsWithdrawn(html), false);
  });

  it("is false when the abstract merely discusses withdrawal", () => {
    const html =
      "<blockquote>We study how models should be (withdrawn) from service.</blockquote>" +
      "<h2>Submission history</h2><p>[v1] normal</p>";
    assert.equal(submissionHistoryIsWithdrawn(html), false);
  });
});

describe("resolveArxivSource", () => {
  const normalAbsHtml = "<h2>Submission history</h2><p>[v1] Mon</p>";

  // Fixture: 2609.09124 = normal paper, PDF returns 200.
  it("returns the PDF for a normal paper (2609.09124)", async () => {
    const pdfCalls: string[] = [];
    const result = await resolveArxivSource({
      id: "2609.09124",
      fetchAbsHtml: async () => ({ ok: true, html: normalAbsHtml }),
      fetchPdf: async (url) => {
        pdfCalls.push(url);
        return { ok: true, bytes: Buffer.from("%PDF-1.7 real paper") };
      },
    });
    assert.equal(result.kind, "pdf");
    if (result.kind === "pdf") {
      assert.equal(result.url, "https://arxiv.org/pdf/2609.09124");
      assert.ok(result.bytes.length > 0);
    }
    // Only the version-less PDF URL is ever requested.
    assert.deepEqual(pdfCalls, ["https://arxiv.org/pdf/2609.09124"]);
  });

  // Fixture: 2505.13520 = withdrawn. Current PDF 404s; v1 is still downloadable
  // but must NOT be used.
  it("flags a withdrawn paper and never falls back to v1 (2505.13520)", async () => {
    const pdfCalls: string[] = [];
    const fetchPdf = async (url: string): Promise<ArxivPdfFetch> => {
      pdfCalls.push(url);
      // v1 would be downloadable, but the resolver must never request it.
      if (url.endsWith("v1")) return { ok: true, bytes: Buffer.from("old v1") };
      return { ok: false, status: 404 };
    };
    const result = await resolveArxivSource({
      id: "2505.13520",
      fetchAbsHtml: async () => ({ ok: true, html: normalAbsHtml }),
      fetchPdf,
    });
    assert.equal(result.kind, "withdrawn");
    if (result.kind === "withdrawn") {
      assert.equal(result.reason, SOURCE_WITHDRAWN_REASON);
    }
    assert.deepEqual(pdfCalls, ["https://arxiv.org/pdf/2505.13520"]);
    assert.ok(!pdfCalls.some((u) => /v\d+$/.test(u)), "must not request a versioned URL");
  });

  it("flags withdrawn when the abs page says so even if the PDF is 200", async () => {
    let pdfFetched = false;
    const result = await resolveArxivSource({
      id: "2505.13520",
      fetchAbsHtml: async () => ({
        ok: true,
        html: "<h2>Submission history</h2><p>[v2] (withdrawn)</p>",
      }),
      fetchPdf: async () => {
        pdfFetched = true;
        return { ok: true, bytes: Buffer.from("stub") };
      },
    });
    assert.equal(result.kind, "withdrawn");
    assert.equal(pdfFetched, false, "should short-circuit before fetching the PDF");
  });

  it("returns fetch_failed for a transient non-404 error (not withdrawn)", async () => {
    const result = await resolveArxivSource({
      id: "2609.09124",
      fetchAbsHtml: async () => ({ ok: false }),
      fetchPdf: async () => ({ ok: false, status: 503 }),
    });
    assert.equal(result.kind, "fetch_failed");
  });

  it("falls through to the PDF when the abs page is unavailable", async () => {
    const result = await resolveArxivSource({
      id: "2609.09124",
      fetchAbsHtml: async () => ({ ok: false }),
      fetchPdf: async (url) => ({ ok: true, bytes: Buffer.from(url) }),
    });
    assert.equal(result.kind, "pdf");
  });
});

export const ARXIV_PDF_URL_SAMPLE = arxivPdfUrl("2609.09124");
