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

  const fetched = await fetchPageContentDetailed(url);
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

      const article = await applyIngestToArticle(articleId, {
        text: result.text,
        html: null,
        url,
        title: result.title || title,
      });

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

    const article = await applyIngestToArticle(articleId, {
      text,
      html,
      url,
      title: pageTitle || url,
    });

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
