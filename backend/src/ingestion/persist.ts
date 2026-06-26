import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { articles } from "../schema/articles/articles.js";
import { jobs } from "../schema/jobs/jobs.js";
import { contentSha256 } from "./contentHash.js";
import { localizeArticleTitleForStorage } from "../services/articles/articleTitleLocalization.js";

export type StoredArticle = {
  id: number;
  url: string;
  title: string | null;
  rawText: string | null;
  html: string | null;
  sha256: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DedupeReason = "url" | "content";

/**
 * Thrown when persist finds an existing article (URL or content hash deduplication).
 * Port of worker dedupe hit on `Article.sha256` / unique URL.
 */
export class ArticleDuplicateError extends Error {
  constructor(
    public readonly article: StoredArticle,
    public readonly reason: DedupeReason = "url",
  ) {
    super(
      reason === "content"
        ? "Content already exists in the database (duplicate hash)."
        : "URL is already in the database.",
    );
    this.name = "ArticleDuplicateError";
  }
}

export type PersistArticleInput = {
  text: string;
  html?: string | null;
  url?: string;
  title?: string;
};

const articleSelection = {
  id: articles.id,
  url: articles.url,
  title: articles.title,
  rawText: articles.rawText,
  html: articles.html,
  sha256: articles.sha256,
  createdAt: articles.createdAt,
  updatedAt: articles.updatedAt,
};

/** Look up article by canonical URL. */
export async function findArticleByUrl(
  url: string,
): Promise<StoredArticle | null> {
  const [row] = await db
    .select(articleSelection)
    .from(articles)
    .where(eq(articles.url, url))
    .limit(1);
  return row ?? null;
}

/** Look up article by content SHA-256 (port of `Article.filter_by(sha256=h)`). */
export async function findArticleBySha256(
  sha256: string,
): Promise<StoredArticle | null> {
  const [row] = await db
    .select(articleSelection)
    .from(articles)
    .where(eq(articles.sha256, sha256))
    .limit(1);
  return row ?? null;
}

type DedupeCheckInput = {
  url: string;
  text: string;
};

/**
 * Content dedup first (sha256), then URL — matches `process_url_to_db` ordering.
 * Returns existing article to reuse, or null if new content.
 */
export async function checkArticleDedup(
  input: DedupeCheckInput,
): Promise<{ article: StoredArticle; reason: DedupeReason } | null> {
  const trimmed = input.text.trim();
  if (trimmed) {
    const hash = contentSha256(trimmed);
    const byContent = await findArticleBySha256(hash);
    if (byContent) {
      return { article: byContent, reason: "content" };
    }
  }

  if (input.url) {
    const byUrl = await findArticleByUrl(input.url);
    if (byUrl) {
      return { article: byUrl, reason: "url" };
    }
  }

  return null;
}

/**
 * Dedupe check for updating an existing article shell — ignores the same row.
 */
export async function checkArticleDedupExcluding(
  input: DedupeCheckInput,
  existingArticleId: number,
): Promise<{ article: StoredArticle; reason: DedupeReason } | null> {
  const dup = await checkArticleDedup(input);
  if (!dup || dup.article.id === existingArticleId) {
    return null;
  }
  return dup;
}

function hashForText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed ? contentSha256(trimmed) : null;
}

async function resolveStoredTitle(
  title: string | null,
  rawText: string,
): Promise<string | null> {
  return localizeArticleTitleForStorage({
    title,
    rawText,
  });
}

/**
 * Port of `app.ingestion.persist.persist_article` with content + URL deduplication.
 */
export async function persistArticle(
  input: PersistArticleInput,
): Promise<StoredArticle> {
  const url = input.url ?? "";
  const title = await resolveStoredTitle(
    (input.title ?? "").trim() || null,
    input.text,
  );

  const dup = await checkArticleDedup({ url, text: input.text });
  if (dup) {
    throw new ArticleDuplicateError(dup.article, dup.reason);
  }

  const [article] = await db
    .insert(articles)
    .values({
      url,
      title,
      rawText: input.text,
      html: input.html ?? null,
      sha256: hashForText(input.text),
    })
    .returning(articleSelection);

  return article;
}

/** Update an existing article row after extraction (worker path). */
export async function applyIngestToArticle(
  articleId: number,
  input: PersistArticleInput,
): Promise<StoredArticle> {
  const url = input.url ?? "";
  const title = await resolveStoredTitle(
    (input.title ?? "").trim() || null,
    input.text,
  );

  const dup = await checkArticleDedupExcluding(
    { url, text: input.text },
    articleId,
  );
  if (dup) {
    throw new ArticleDuplicateError(dup.article, dup.reason);
  }

  const [article] = await db
    .update(articles)
    .set({
      url,
      title,
      rawText: input.text,
      html: input.html ?? null,
      sha256: hashForText(input.text),
      updatedAt: new Date(),
    })
    .where(eq(articles.id, articleId))
    .returning(articleSelection);

  if (!article) {
    throw new Error(`Article not found: ${articleId}`);
  }

  return article;
}

export type PersistArticleResult = {
  article: {
    id: number;
    url: string;
    title: string | null;
    createdAt: Date;
  };
  job: {
    id: number;
    url: string;
    status: string;
    jobType: string;
    source: string;
    createdAt: Date;
  };
  created: boolean;
  deduplicated?: boolean;
  dedupeReason?: DedupeReason;
};

/**
 * Persist article + ingest job. Reuses existing article on content URL dedup hit
 * without creating a duplicate job (port of worker `dedupe hit → article {id}`).
 */
export async function persistArticleWithJob(
  input: PersistArticleInput & { source: "manual" | "rss" },
): Promise<PersistArticleResult> {
  const url = input.url ?? "";
  const title = await resolveStoredTitle(
    (input.title ?? "").trim() || null,
    input.text,
  );

  const dup = await checkArticleDedup({ url, text: input.text });
  if (dup) {
    throw new ArticleDuplicateError(dup.article, dup.reason);
  }

  return db.transaction(async (tx) => {
    const [article] = await tx
      .insert(articles)
      .values({
        url,
        title,
        rawText: input.text,
        html: input.html ?? null,
        sha256: hashForText(input.text),
      })
      .returning({
        id: articles.id,
        url: articles.url,
        title: articles.title,
        createdAt: articles.createdAt,
      });

    const [job] = await tx
      .insert(jobs)
      .values({
        articleId: article.id,
        url,
        status: "done",
        jobType: "ingest",
        source: input.source,
        tries: 1,
      })
      .returning({
        id: jobs.id,
        url: jobs.url,
        status: jobs.status,
        jobType: jobs.jobType,
        source: jobs.source,
        createdAt: jobs.createdAt,
      });

    return {
      article,
      job,
      created: true,
    };
  });
}
