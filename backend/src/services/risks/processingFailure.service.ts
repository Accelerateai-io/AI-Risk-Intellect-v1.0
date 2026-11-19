import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { risks } from "../../schema/risks/risks.js";
import { isRetiredRisk } from "./riskRetirement.js";
import { buildProcessingFailureExtraction } from "./processingFailure.js";

/**
 * Store a held risk for an article whose processing failed after retries.
 * An existing live row is left in place. Retired history does not count as
 * the current record.
 */
export async function persistProcessingFailureRisk(
  articleId: number,
  reason: string,
): Promise<string | null> {
  const prior = await db
    .select({
      id: risks.id,
      extractionJson: risks.extractionJson,
    })
    .from(risks)
    .where(eq(risks.articleId, articleId));

  const live = prior.find((row) => !isRetiredRisk(row.extractionJson));
  if (live) return live.id;

  const [article] = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!article) return null;

  const detail = reason.trim() || "Processing failed after retries.";
  const [row] = await db
    .insert(risks)
    .values({
      articleId,
      riskTitle: article.title?.trim() || "Processing failed",
      extractionJson: buildProcessingFailureExtraction(detail),
      sourceFlag: "processing_failure",
    })
    .returning({ id: risks.id });

  await db
    .update(articles)
    .set({
      riskCount: sql`${articles.riskCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(articles.id, articleId));

  console.log(
    `[batch-worker] held failure record articleId=${articleId} riskId=${row!.id} reason=${detail}`,
  );
  return row!.id;
}
