/**
 * Port of `app.ingestion.extract_text`.
 */

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtmlTags(html: string): string {
  return collapseWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

export function extractTitleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return "";
  return collapseWhitespace(
    match[1].replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"),
  );
}

/** Port of `extract_from_html`. */
export function extractFromHtml(html: string): string {
  if (!html.trim()) return "";

  const articleMatch = html.match(
    /<article[\s\S]*?<\/article>/i,
  );
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  const chunk = articleMatch?.[0] ?? mainMatch?.[0] ?? html;

  return stripHtmlTags(chunk);
}

/** HTML-only; PDF/raw extraction runs in Python (`python/app/ingestion/extract_text.py`). */
