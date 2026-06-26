import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import {
  detectTextLanguage,
  isEnglishLanguageCode,
} from "../../utils/languageDetect.js";
import { translateTextToEnglish } from "../../utils/translateTextToEnglish.js";

const CJK_TITLE_PATTERN = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf\uac00-\ud7af]/;

function looksLikeNonEnglishTitle(title: string): boolean {
  return CJK_TITLE_PATTERN.test(title);
}

async function isNonEnglishContent(
  title: string | null,
  rawText: string | null | undefined,
): Promise<boolean> {
  const textSample = rawText?.trim() ?? "";
  if (textSample.length >= 50) {
    const lang = await detectTextLanguage(textSample);
    if (lang) return !isEnglishLanguageCode(lang);
  }

  const titleSample = title?.trim() ?? "";
  if (titleSample.length >= 20) {
    const lang = await detectTextLanguage(titleSample.padEnd(50, " "));
    if (lang) return !isEnglishLanguageCode(lang);
  }

  return looksLikeNonEnglishTitle(titleSample);
}

export async function resolveEnglishArticleTitle(input: {
  title: string | null;
  rawText?: string | null;
  cachedEnglishTitle?: string | null;
}): Promise<{ title: string | null; translated: boolean }> {
  const cached = input.cachedEnglishTitle?.trim();
  if (cached) return { title: cached, translated: false };

  const original = input.title?.trim() || null;
  if (!original) return { title: null, translated: false };

  if (!(await isNonEnglishContent(original, input.rawText))) {
    return { title: original, translated: false };
  }

  const translated = await translateTextToEnglish(original);
  if (!translated || translated === original) {
    return { title: original, translated: false };
  }

  return { title: translated, translated: true };
}

export async function persistEnglishArticleTitle(
  articleId: number,
  title: string | null,
): Promise<void> {
  const normalized = title?.trim() ?? "";
  if (!normalized) return;

  await db
    .update(articles)
    .set({
      title: normalized,
      updatedAt: new Date(),
    })
    .where(eq(articles.id, articleId));
}

export async function localizeArticleTitleForStorage(input: {
  title: string | null;
  rawText?: string | null;
}): Promise<string | null> {
  const resolved = await resolveEnglishArticleTitle(input);
  return resolved.title;
}

export async function resolveEnglishRiskTitle(input: {
  title: string | null;
  rawText?: string | null;
  cachedEnglishTitle?: string | null;
}): Promise<{ title: string | null; translated: boolean }> {
  const cached = input.cachedEnglishTitle?.trim();
  if (cached) return { title: cached, translated: false };

  const original = input.title?.trim() || null;
  if (!original) return { title: null, translated: false };

  if (!(await isNonEnglishContent(original, input.rawText))) {
    return { title: original, translated: false };
  }

  const translated = await translateTextToEnglish(original);
  if (!translated || translated === original) {
    return { title: original, translated: false };
  }

  return { title: translated, translated: true };
}
