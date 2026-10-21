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
export async function processUrlToDb(
  url: string,
  articleId: number,
  options?: { title?: string },
): Promise<ProcessUrlResult> {
  try {
    await validateUrl(url);
  } catch (err) {
    const msg =
      err instanceof UrlFetchError ? err.message : "URL validation failed";
    return { outcome: "skipped", reason: msg };
  }

  const excludedBeforeFetch = getExcludedNonAiTopicSkipReason({
    url,
    title: options?.title,
  });
  if (excludedBeforeFetch) {
    return { outcome: "skipped", reason: excludedBeforeFetch };
  }

  const signal = getJobRunSignal();
  noteWebsiteFetchStarted();

  // BUG-09: arxiv.org/abs pages are HTML, so fetching them ingests the abstract
  // as if it were the paper. Rewrite to the version-less PDF and send it down
  // the existing PDF path. Withdrawn sources (current PDF 404s, or the abstract
  // page's submission history is marked withdrawn) are skipped (not ingested)
  // with reason "Source withdrawn by authors" rather than falling back to an
  // older version.
  let fetched: Awaited<ReturnType<typeof fetchPageContentDetailed>>;
  const arxivId = parseArxivAbsId(url);
  if (arxivId) {
    const resolution = await resolveArxivSource({
      id: arxivId,
      fetchAbsHtml: async (absUrl) => {
        const r = await fetchPageContentDetailed(absUrl, 30_000, signal);
        return r.ok && r.page.kind === "html"
          ? { ok: true, html: r.page.html }
          : { ok: false };
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
    fetched = { ok: true, page: { kind: "pdf", bytes: resolution.bytes, title: "" } };
  } else {
    fetched = await fetchPageContentDetailed(url, 30_000, signal);
  }
  if (!fetched.ok) {
    return {
      outcome: "skipped",
      reason: formatPageFetchSkipReason(fetched.reason),
    };
  }

  const page = fetched.page;
  const title =
    options?.title?.trim() ||
    (page.kind === "html" ? page.title : "") ||
    url;

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
        return {
          outcome: "skipped",
          reason: `dedupe hit → article ${dup.article.id}`,
        };
      }

      noteFeedStoreStarted();
      const article = await applyIngestToArticle(articleId, {
        text: result.text,
        html: null,
        url,
        title: result.title || title,
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

    const pageTitle = page.title || extractTitleFromHtml(html) || title;
    const minTextBytes = 200;

    let text: string;
    try {
      noteWebsiteExtractStarted();
      const extracted = await pythonIngestHtml(html, {
        url,
        title: pageTitle,
        skipAiCheck: true,
      });
      text = extracted.text;
    } catch (err) {
      if (err instanceof SkipIngest) {
        return { outcome: "skipped", reason: err.message };
      }
      throw err;
    }

    noteWebsiteExtractCompleted(text.trim().length);

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
      return {
        outcome: "skipped",
        reason: `dedupe hit → article ${dup.article.id}`,
      };
    }

    noteFeedStoreStarted();
    const article = await applyIngestToArticle(articleId, {
      text,
      html,
      url,
      title: pageTitle || url,
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
      return {
        outcome: "skipped",
        reason: `dedupe hit → article ${err.article.id}`,
      };
    }
    throw err;
  }
}
