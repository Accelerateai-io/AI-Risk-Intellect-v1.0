import { abandonEmptyArticleShell } from "../../ingestion/articleShellDedup.js";
import { extractTitleFromHtml } from "../../ingestion/extractText.js";
import {
  detectBotBlockPage,
  getExcludedNonAiTopicSkipReason,
  looksLikeSoft404,
  SkipIngest,
} from "../../ingestion/filters.js";
import {
  ArticleDuplicateError,
  applyIngestToArticle,
  checkArticleDedupExcluding,
  type DedupeReason,
} from "../../ingestion/persist.js";
import {
  pythonIngestHtml,
  pythonIngestPdf,
} from "../../ingestion/pythonBridge.js";
import {
  fetchPageContentDetailed,
  formatPageFetchSkipReason,
  validateUrl,
  UrlFetchError,
} from "../../utils/fetchUtils.js";
import { parseArxivAbsId, resolveArxivSource } from "../../ingestion/arxiv.js";
import {
  extractionQuarantineReason,
  readExtractionQuality,
} from "../../ingestion/extractionQuality.js";
import { recordQuarantine, releaseQuarantine } from "../../ingestion/quarantine.js";
import { researchSourceSkipReason } from "../../ingestion/researchSources.js";
import { getJobRunSignal } from "../jobs/jobTimeout.service.js";
import {
  noteFeedStored,
  noteFeedStoreStarted,
  noteWebsiteExtractCompleted,
  noteWebsiteExtractStarted,
  noteWebsiteFetchStarted,
} from "../jobs/jobPipelineTrace.js";

export type ProcessUrlSuccess = {
  outcome: "done";
  articleId: number;
  title: string | null;
};

export type ProcessUrlSkipped = {
  outcome: "skipped";
  reason: string;
};

export type ProcessUrlResult = ProcessUrlSuccess | ProcessUrlSkipped;

/**
 * Port of `process_url_to_db` — fetch, extract, dedupe, persist on existing article.
 *
 * Terminal outcomes for the worker:
 * - `done` — content stored on article
 * - `skipped` — dedupe, fetch failed, soft-404, not AI-related, etc.
 * - `error` — thrown to caller for exception handling
 */
function dedupeSkipReason(
  canonicalArticleId: number,
  reason: DedupeReason,
): string {
  const why =
    reason === "content"
      ? "same extracted text as that article"
      : "this URL is already stored on that article";
  return `dedupe hit → article ${canonicalArticleId} (${why})`;
}

async function skipForDedup(
  articleId: number,
  canonicalArticleId: number,
  reason: DedupeReason,
  jobId?: number,
): Promise<ProcessUrlSkipped> {
  if (jobId != null && canonicalArticleId !== articleId) {
    await abandonEmptyArticleShell({
      jobId,
      shellArticleId: articleId,
      canonicalArticleId,
    });
  }
  return {
    outcome: "skipped",
    reason: dedupeSkipReason(canonicalArticleId, reason),
  };
}

export async function processUrlToDb(
  url: string,
  articleId: number,
  options?: { title?: string; jobId?: number },
): Promise<ProcessUrlResult> {
  try {
    await validateUrl(url);
  } catch (err) {
    const msg =
      err instanceof UrlFetchError ? err.message : "URL validation failed";
    return { outcome: "skipped", reason: msg };
  }

  // Research papers are out of scope (25 Nov 2026): skip before any fetch or
  // LLM call, whichever way the URL arrived (feed, manual job, rerun).
  const researchSkip = researchSourceSkipReason(url);
  if (researchSkip) {
    return { outcome: "skipped", reason: researchSkip };
  }

  const signal = getJobRunSignal();
  noteWebsiteFetchStarted();

  // BUG-09: arxiv.org/abs pages are HTML, so fetching them ingests the abstract
  // as if it were the paper. Rewrite to the version-less PDF and send it down
  // the existing PDF path. Withdrawn sources (current PDF 404s, or the abstract
  // page's submission history is marked withdrawn) are skipped (not ingested)
  // with reason "Source withdrawn by authors" rather than falling back to an
  // older version.
  // Titles fall back to "Untitled", never the raw URL (titles). For arXiv the
  // /abs/ page is rewritten to a PDF (title-less), so capture the real title
  // from the abstract HTML's <title>/citation_title before the rewrite.
  const UNTITLED = "Untitled";
  let fetched: Awaited<ReturnType<typeof fetchPageContentDetailed>>;
  let arxivTitle = "";
  const arxivId = parseArxivAbsId(url);
  if (arxivId) {
    const resolution = await resolveArxivSource({
      id: arxivId,
      fetchAbsHtml: async (absUrl) => {
        const r = await fetchPageContentDetailed(absUrl, 30_000, signal);
        if (r.ok && r.page.kind === "html") {
          if (!arxivTitle) arxivTitle = extractTitleFromHtml(r.page.html);
          return { ok: true, html: r.page.html };
        }
        return { ok: false };
      },
      fetchPdf: async (pdfUrl) => {
        const r = await fetchPageContentDetailed(pdfUrl, 30_000, signal);
        if (r.ok && r.page.kind === "pdf") {
          return { ok: true, bytes: r.page.bytes };
        }
        const statusMatch = !r.ok ? /HTTP (\d+)/.exec(r.reason) : null;
        return { ok: false, status: statusMatch ? Number(statusMatch[1]) : 0 };
      },
    });
    if (resolution.kind === "withdrawn") {
      // Skipped (not ingested): the withdrawn paper is not stored as a valid
      // source; the skip reason is "Source withdrawn by authors".
      return { outcome: "skipped", reason: resolution.reason };
    }
    if (resolution.kind === "fetch_failed") {
      return { outcome: "skipped", reason: resolution.reason };
    }
    fetched = {
      ok: true,
      page: { kind: "pdf", bytes: resolution.bytes, title: arxivTitle },
    };
  } else {
    fetched = await fetchPageContentDetailed(url, 30_000, signal);
  }
  if (!fetched.ok) {
    const reason = formatPageFetchSkipReason(fetched.reason);
    await recordQuarantine({
      url,
      title: options?.title,
      reason,
      status: "fetch_quarantine",
      responseMeta: { reason: fetched.reason },
    });
    return { outcome: "skipped", reason };
  }

  const page = fetched.page;
  const title = options?.title?.trim() || page.title?.trim() || arxivTitle || "";

  try {
    if (page.kind === "pdf") {
      let result;
      try {
        noteWebsiteExtractStarted();
        result = await pythonIngestPdf(page.bytes, {
          url,
          title,
          skipAiCheck: true,
        });
      } catch (err) {
        if (err instanceof SkipIngest) {
          return { outcome: "skipped", reason: err.message };
        }
        throw err;
      }

      noteWebsiteExtractCompleted(result.text.trim().length);

      const pdfQuality = readExtractionQuality(result.details);
      const pdfQualityReason = extractionQuarantineReason(pdfQuality);
      if (pdfQualityReason) {
        await recordQuarantine({
          url,
          title,
          extractedText: result.text,
          qualityScore: pdfQuality?.score ?? null,
          validation: pdfQuality,
          reason: pdfQualityReason,
          sourceType: "pdf",
          status: "extraction_quarantine",
        });
        return { outcome: "skipped", reason: pdfQualityReason };
      }

      const excludedAfterExtract = getExcludedNonAiTopicSkipReason({
        url,
        title: result.title || title,
        text: result.text,
      });
      if (excludedAfterExtract) {
        return { outcome: "skipped", reason: excludedAfterExtract };
      }

      const dup = await checkArticleDedupExcluding(
        { url, text: result.text },
        articleId,
      );
      if (dup) {
        return skipForDedup(articleId, dup.article.id, dup.reason, options?.jobId);
      }

      noteFeedStoreStarted();
      await releaseQuarantine(url);
      const article = await applyIngestToArticle(articleId, {
        text: result.text,
        html: null,
        url,
        // Title precedence: manual (caller-supplied) -> arXiv abstract title ->
        // PDF-extracted title -> Untitled. Previously the PDF title won over the
        // manual/arXiv title. (titles review)
        title:
          options?.title?.trim() ||
          arxivTitle.trim() ||
          result.title?.trim() ||
          UNTITLED,
      });
      noteFeedStored(result.text.trim().length);

      return {
        outcome: "done",
        articleId: article.id,
        title: article.title,
      };
    }

    const html = page.html;
    if (!html.trim()) {
      return { outcome: "skipped", reason: "empty html" };
    }

    const botBlockBeforeExtract = detectBotBlockPage(html);
    if (botBlockBeforeExtract) {
      return { outcome: "skipped", reason: botBlockBeforeExtract };
    }

    // Title precedence: manual (caller-supplied) -> page/arXiv meta title ->
    // re-extracted <title>. Manual must win over the scraped title. (titles review)
    const pageTitle =
      options?.title?.trim() || page.title?.trim() || extractTitleFromHtml(html) || "";
    const minTextBytes = 200;

    let text: string;
    let htmlDetails: unknown;
    try {
      noteWebsiteExtractStarted();
      const extracted = await pythonIngestHtml(html, {
        url,
        title: pageTitle,
        skipAiCheck: true,
      });
      text = extracted.text;
      htmlDetails = extracted.details;
    } catch (err) {
      if (err instanceof SkipIngest) {
        return { outcome: "skipped", reason: err.message };
      }
      throw err;
    }

    noteWebsiteExtractCompleted(text.trim().length);

    const htmlQuality = readExtractionQuality(htmlDetails);
    const htmlQualityReason = extractionQuarantineReason(htmlQuality);
    if (htmlQualityReason) {
      await recordQuarantine({
        url,
        title: pageTitle,
        extractedText: text,
        qualityScore: htmlQuality?.score ?? null,
        validation: htmlQuality,
        reason: htmlQualityReason,
        sourceType: "html",
        status: "extraction_quarantine",
      });
      return { outcome: "skipped", reason: htmlQualityReason };
    }

    const excludedAfterExtract = getExcludedNonAiTopicSkipReason({
      url,
      title: pageTitle,
      text,
    });
    if (excludedAfterExtract) {
      return { outcome: "skipped", reason: excludedAfterExtract };
    }

    if (
      looksLikeSoft404(html, 200, {
        extractedText: text,
        minTextBytes,
      })
    ) {
      const botBlockAfterExtract = detectBotBlockPage(html, {
        extractedText: text,
      });
      return {
        outcome: "skipped",
        reason: botBlockAfterExtract ?? "soft-404 or too little text",
      };
    }

    const dup = await checkArticleDedupExcluding({ url, text }, articleId);
    if (dup) {
      return skipForDedup(articleId, dup.article.id, dup.reason, options?.jobId);
    }

    noteFeedStoreStarted();
    await releaseQuarantine(url);
    const article = await applyIngestToArticle(articleId, {
      text,
      html,
      url,
      title: pageTitle || UNTITLED,
    });
    noteFeedStored(text.trim().length);

    return {
      outcome: "done",
      articleId: article.id,
      title: article.title,
    };
  } catch (err) {
    if (err instanceof SkipIngest) {
      return { outcome: "skipped", reason: err.message };
    }
    if (err instanceof ArticleDuplicateError) {
      return skipForDedup(articleId, err.article.id, err.reason, options?.jobId);
    }
    throw err;
  }
}
