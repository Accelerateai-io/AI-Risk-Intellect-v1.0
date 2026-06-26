import {
  detectBotBlockPage,
  getExcludedNonAiTopicSkipReason,
  looksLikeSoft404,
  SkipIngest,
} from "./filters.js";
import {
  pythonIngestHtml,
  pythonIngestPdf,
  pythonIngestRaw,
} from "./pythonBridge.js";
import {
  persistArticleWithJob,
  type PersistArticleResult,
} from "./persist.js";

export type IngestOptions = {
  url?: string;
  title?: string;
  source?: "manual" | "rss";
};

/** Port of `ingest_html`. */
export async function ingestHtml(
  html: string,
  options: IngestOptions = {},
): Promise<PersistArticleResult> {
  const url = options.url ?? "";
  const title = options.title ?? "";
  const source = options.source ?? "manual";

  if (!html.trim()) {
    throw new SkipIngest("empty html");
  }

  const excludedBeforeExtract = getExcludedNonAiTopicSkipReason({ url, title });
  if (excludedBeforeExtract) {
    throw new SkipIngest(excludedBeforeExtract);
  }

  const botBlockBeforeExtract = detectBotBlockPage(html);
  if (botBlockBeforeExtract) {
    throw new SkipIngest(botBlockBeforeExtract);
  }

  const minTextBytes = 200;

  const extracted = await pythonIngestHtml(html, {
    url,
    title,
    skipAiCheck: true,
  });
  const text = extracted.text;

  const excludedAfterExtract = getExcludedNonAiTopicSkipReason({
    url,
    title,
    text,
  });
  if (excludedAfterExtract) {
    throw new SkipIngest(excludedAfterExtract);
  }

  if (looksLikeSoft404(html, 200, { extractedText: text, minTextBytes })) {
    const botBlockAfterExtract = detectBotBlockPage(html, {
      extractedText: text,
    });
    throw new SkipIngest(
      botBlockAfterExtract ?? "soft-404 or too little text",
    );
  }

  return persistArticleWithJob({
    text,
    html,
    url,
    title: extracted.title || title || url,
    source,
  });
}

/** Port of `ingest_pdf` — extraction + classification via Python. */
export async function ingestPdf(
  pdfBytes: Buffer,
  options: IngestOptions = {},
): Promise<PersistArticleResult> {
  const url = options.url ?? "";
  const title = options.title ?? "";
  const source = options.source ?? "manual";

  const excludedBeforeExtract = getExcludedNonAiTopicSkipReason({ url, title });
  if (excludedBeforeExtract) {
    throw new SkipIngest(excludedBeforeExtract);
  }

  const result = await pythonIngestPdf(pdfBytes, {
    url,
    title,
    skipAiCheck: true,
  });

  return persistArticleWithJob({
    text: result.text,
    html: null,
    url,
    title: result.title || title || url,
    source,
  });
}

/** Port of `ingest_raw_text` — normalization + classification via Python. */
export async function ingestRawText(
  raw: string,
  options: IngestOptions = {},
): Promise<PersistArticleResult> {
  const url = options.url ?? "";
  const title = options.title ?? "";
  const source = options.source ?? "manual";

  const excludedBeforeExtract = getExcludedNonAiTopicSkipReason({ url, title });
  if (excludedBeforeExtract) {
    throw new SkipIngest(excludedBeforeExtract);
  }

  const result = await pythonIngestRaw(raw, { url, title });

  return persistArticleWithJob({
    text: result.text,
    html: null,
    url,
    title: result.title || title || url,
    source,
  });
}
