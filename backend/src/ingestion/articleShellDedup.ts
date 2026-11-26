import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { articles } from "../schema/articles/articles.js";
import { jobs } from "../schema/jobs/jobs.js";
import { risks } from "../schema/risks/risks.js";

export type ArticleShellRow = {
  id: number;
  title: string | null;
  rawText: string | null;
  html: string | null;
};

export type ShellDeletionBlocker = "content" | "risks" | "other_jobs" | "missing";

export type DedupShellTx = {
  reassignJob(
    jobId: number,
    shellArticleId: number,
    canonicalArticleId: number,
  ): Promise<void>;
  loadShell(articleId: number): Promise<ArticleShellRow | null>;
  countRisks(articleId: number): Promise<number>;
  countOtherJobs(articleId: number, jobId: number): Promise<number>;
  deleteShell(articleId: number): Promise<void>;
};

export type DedupShellCleanupResult = {
  deletedShell: boolean;
  blocker: ShellDeletionBlocker | null;
};

function blank(value: string | null | undefined): boolean {
  return !value?.trim();
}

/** A shell is empty when ingest never stored a title, body, or HTML. */
export function isEmptyArticleShell(
  row: Pick<ArticleShellRow, "title" | "rawText" | "html">,
): boolean {
  return blank(row.title) && blank(row.rawText) && blank(row.html);
}

/**
 * Point the current job at the canonical article, then delete the shell only
 * when it has no stored content and nothing else still references it.
 * The caller must run this inside a single transaction so a failed delete
 * rolls the job reassignment back. Job status is not changed.
 */
export async function reassignJobAndDropEmptyShell(
  tx: DedupShellTx,
  input: {
    jobId: number;
    shellArticleId: number;
    canonicalArticleId: number;
  },
): Promise<DedupShellCleanupResult> {
  if (input.shellArticleId === input.canonicalArticleId) {
    return { deletedShell: false, blocker: null };
  }

  await tx.reassignJob(
    input.jobId,
    input.shellArticleId,
    input.canonicalArticleId,
  );

  const shell = await tx.loadShell(input.shellArticleId);
  if (!shell) {
    return { deletedShell: false, blocker: "missing" };
  }
  if (!isEmptyArticleShell(shell)) {
    return { deletedShell: false, blocker: "content" };
  }
  if ((await tx.countRisks(input.shellArticleId)) > 0) {
    return { deletedShell: false, blocker: "risks" };
  }
  if ((await tx.countOtherJobs(input.shellArticleId, input.jobId)) > 0) {
    return { deletedShell: false, blocker: "other_jobs" };
  }

  await tx.deleteShell(input.shellArticleId);
  return { deletedShell: true, blocker: null };
}

export async function runDedupShellCleanup(
  run: <T>(fn: (tx: DedupShellTx) => Promise<T>) => Promise<T>,
  input: {
    jobId: number;
    shellArticleId: number;
    canonicalArticleId: number;
  },
): Promise<DedupShellCleanupResult> {
  return run((tx) => reassignJobAndDropEmptyShell(tx, input));
}

function drizzleDedupTx(tx: Pick<typeof db, "select" | "update" | "delete">): DedupShellTx {
  return {
    async reassignJob(jobId, shellArticleId, canonicalArticleId) {
      await tx
        .update(jobs)
        .set({ articleId: canonicalArticleId, updatedAt: new Date() })
        .where(and(eq(jobs.id, jobId), eq(jobs.articleId, shellArticleId)));
    },
    async loadShell(articleId) {
      const [row] = await tx
        .select({
          id: articles.id,
          title: articles.title,
          rawText: articles.rawText,
          html: articles.html,
        })
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1);
      return row ?? null;
    },
    async countRisks(articleId) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(risks)
        .where(eq(risks.articleId, articleId));
      return Number(row?.n ?? 0);
    },
    async countOtherJobs(articleId, jobId) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(and(eq(jobs.articleId, articleId), ne(jobs.id, jobId)));
      return Number(row?.n ?? 0);
    },
    async deleteShell(articleId) {
      await tx.delete(articles).where(eq(articles.id, articleId));
    },
  };
}

/**
 * After `dedupe hit → article N` and before content is written, attach this
 * job to article N and remove the empty shell when it is safe to do so.
 */
export async function abandonEmptyArticleShell(input: {
  jobId: number;
  shellArticleId: number;
  canonicalArticleId: number;
}): Promise<DedupShellCleanupResult> {
  return runDedupShellCleanup(
    (fn) => db.transaction(async (tx) => fn(drizzleDedupTx(tx))),
    input,
  );
}
