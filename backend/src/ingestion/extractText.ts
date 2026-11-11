/**
 * Port of `app.ingestion.extract_text`.
 */

import { decodeHtmlEntities } from "../utils/decodeHtmlEntities.js";

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

/** First `<meta>` whose name/property matches ``attrRe``, returning its content. */
function metaContent(html: string, attrRe: RegExp): string {
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    if (!attrRe.test(tag)) continue;
    // Capture the opening quote and read up to the SAME quote char. The old
    // `["']([^"']*)["']` stopped at the first quote OR apostrophe, so a title
    // like content="Google's new model" was truncated to "Google" (titles).
    const c = tag.match(/content=(["'])(.*?)\1/i);
    if (c?.[2]?.trim()) return c[2];
  }
  return "";
}

// Strip ONLY a real arXiv id prefix, e.g. "[2304.10041] Real Title" ->
// "Real Title". It must be an actual arXiv id — new style (2304.10041, optional
// version) or old style (hep-th/9901001, math.GT/0309136), with an optional
// "arXiv:" — so a legitimate "[Opinion] ..." / "[Update] ..." title is left
// untouched. (titles review)
const ARXIV_TITLE_PREFIX =
  /^\[\s*(?:arxiv:\s*)?(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z][a-z-]*(?:\.[A-Za-z]{2})?\/\d{7}(?:v\d+)?)\s*\]\s*/i;

/**
 * Resolve a page title. Prefers semantic metadata — `citation_title`
 * (arXiv / scholarly pages) then `og:title` — over the raw `<title>` tag, and
 * strips the "[arXiv id]" prefix arXiv puts on its `<title>` (B-5 titles).
 */
export function extractTitleFromHtml(html: string): string {
  const meta =
    metaContent(html, /\b(?:name|property)=["']citation_title["']/i) ||
    metaContent(html, /\bproperty=["']og:title["']/i);
  if (meta) {
    return collapseWhitespace(decodeHtmlEntities(meta)).replace(
      ARXIV_TITLE_PREFIX,
      "",
    );
  }
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return "";
  return collapseWhitespace(decodeHtmlEntities(match[1])).replace(
    ARXIV_TITLE_PREFIX,
    "",
  );
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const DROP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "nav",
  "footer",
  "form",
  "aside",
]);

/** Whole class/id segments. "tag-ai" and "category-news" are not chrome. */
const CHROME_SEGMENTS = new Set([
  "sidebar",
  "menu",
  "nav",
  "navbar",
  "navigation",
  "breadcrumb",
  "breadcrumbs",
  "tagcloud",
  "tags",
  "categories",
  "comments",
  "comment",
  "pagination",
  "pager",
  "cookie",
  "widget",
  "footer",
]);

const CHROME_ROLES = new Set([
  "navigation",
  "contentinfo",
  "banner",
  "complementary",
]);

const TAG_SCAN_RE = /<\/?([a-zA-Z][\w:-]*)([^>]*)>/g;

type ContentFrame = {
  tag: string;
  start: number;
  chrome: boolean;
  suppressed: boolean;
  parentSuppressed: boolean;
  inArticle: boolean;
  inMain: boolean;
  inBody: boolean;
  primaryArticle: boolean;
  primaryMain: boolean;
};

function attrValue(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? "";
}

function classIdSegments(attrs: string): string[] {
  const blob = `${attrValue(attrs, "class")} ${attrValue(attrs, "id")}`;
  return blob
    .split(/\s+/)
    .flatMap((token) => token.split(/[-_]+/))
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

function isCommentArticle(tag: string, attrs: string): boolean {
  return tag === "article" && classIdSegments(attrs).includes("comment");
}

function isChrome(
  tag: string,
  attrs: string,
  inArticle: boolean,
  inMain: boolean,
): boolean {
  if (DROP_TAGS.has(tag)) return true;
  if (tag === "header" && !inArticle && !inMain) return true;
  if (tag === "article" || tag === "main" || tag === "body") {
    return isCommentArticle(tag, attrs);
  }
  const role = attrValue(attrs, "role").trim().toLowerCase();
  if (CHROME_ROLES.has(role)) return true;
  return classIdSegments(attrs).some((segment) => CHROME_SEGMENTS.has(segment));
}

function applyCuts(text: string, cuts: Array<[number, number]>): string {
  if (cuts.length === 0) return text;
  const ordered = [...cuts].sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  let out = "";
  for (const [rawStart, rawEnd] of ordered) {
    const start = Math.max(0, Math.min(rawStart, text.length));
    const end = Math.max(start, Math.min(rawEnd, text.length));
    if (end <= cursor) continue;
    if (start > cursor) out += text.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  return out + text.slice(cursor);
}

/**
 * Keep the article (or main/body) and drop navigation, footers, sidebars,
 * comment blocks, and tag/category lists. Port of `isolate_main_content_html`.
 */
export function isolateMainContentHtml(html: string): string {
  const source = html || "";
  if (!source.trim()) return source;

  const stack: ContentFrame[] = [];
  const cuts: Array<[number, number]> = [];
  let articleSpan: [number, number] | null = null;
  let mainSpan: [number, number] | null = null;
  let bodySpan: [number, number] | null = null;

  TAG_SCAN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_SCAN_RE.exec(source))) {
    const closing = match[0].startsWith("</");
    const tag = match[1].toLowerCase();
    const attrs = match[2] ?? "";
    const start = match.index;
    const end = match.index + match[0].length;
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tag !== tag) continue;
        const frame = stack[index];
        stack.splice(index);
        if (frame.chrome && !frame.parentSuppressed) cuts.push([frame.start, end]);
        if (frame.primaryArticle && !articleSpan) articleSpan = [frame.start, end];
        if (frame.primaryMain && !mainSpan) mainSpan = [frame.start, end];
        if (tag === "body" && bodySpan) bodySpan = [bodySpan[0], end];
        break;
      }
      continue;
    }

    const parent = stack[stack.length - 1];
    const inArticle = parent?.inArticle ?? false;
    const inMain = parent?.inMain ?? false;
    const chrome = isChrome(tag, attrs, inArticle, inMain);
    const suppressed = (parent?.suppressed ?? false) || chrome;
    const frameArticle = inArticle || (tag === "article" && !isCommentArticle(tag, attrs));
    const frameMain = inMain || tag === "main";
    const frameBody = (parent?.inBody ?? false) || tag === "body";
    const primaryArticle = frameArticle && !inArticle && !articleSpan;
    const primaryMain = frameMain && !inMain && !mainSpan;
    const selfClosing = match[0].endsWith("/>") || VOID_TAGS.has(tag);
    if (selfClosing) {
      if (chrome && !(parent?.suppressed ?? false)) cuts.push([start, end]);
      continue;
    }
    if (tag === "body" && !bodySpan) bodySpan = [start, source.length];
    stack.push({
      tag,
      start,
      chrome,
      suppressed,
      parentSuppressed: parent?.suppressed ?? false,
      inArticle: frameArticle,
      inMain: frameMain,
      inBody: frameBody,
      primaryArticle,
      primaryMain,
    });
  }

  const span = articleSpan ?? mainSpan ?? bodySpan;
  if (!span) return source;
  const [spanStart, spanEnd] = span;
  const localCuts = cuts
    .filter(([cutStart, cutEnd]) => cutStart >= spanStart && cutEnd <= spanEnd && cutEnd > cutStart)
    .map(([cutStart, cutEnd]): [number, number] => [cutStart - spanStart, cutEnd - spanStart]);
  const piece = applyCuts(source.slice(spanStart, spanEnd), localCuts);
  if (!stripHtmlTags(piece)) return source;
  return `<!DOCTYPE html><html><body>${piece}</body></html>`;
}

/** Port of `extract_from_html`. */
export function extractFromHtml(html: string): string {
  if (!html.trim()) return "";
  return stripHtmlTags(isolateMainContentHtml(html));
}

/** HTML-only; PDF/raw extraction runs in Python (`python/app/ingestion/extract_text.py`). */
