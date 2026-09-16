import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { riskEmbeddings } from "../../schema/risks/riskEmbeddings.js";
import {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL_ID,
  embeddingTextHash,
} from "../aws/bedrockEmbeddings.service.js";

/** Canonical text embedded for an extracted risk. */
export function buildRiskEmbeddingText(title: string, description: string): string {
  return `${title.trim()}\n${description.trim()}`.trim();
}

/** Insert or refresh the stored embedding for a risk row. */
export async function upsertRiskEmbedding(input: {
  riskId: string;
  embedding: number[];
  text: string;
}): Promise<void> {
  const textHash = embeddingTextHash(input.text);
  await db
    .insert(riskEmbeddings)
    .values({
      riskId: input.riskId,
      model: EMBEDDING_MODEL_ID,
      dims: EMBEDDING_DIMS,
      textHash,
      embedding: input.embedding,
    })
    .onConflictDoUpdate({
      target: riskEmbeddings.riskId,
      set: {
        model: EMBEDDING_MODEL_ID,
        dims: EMBEDDING_DIMS,
        textHash,
        embedding: input.embedding,
        updatedAt: sql`now()`,
      },
    });
}

/** Stored embedding for a risk, or null when absent. */
export async function getRiskEmbedding(riskId: string): Promise<{
  embedding: number[];
  textHash: string;
} | null> {
  const [row] = await db
    .select({
      embedding: riskEmbeddings.embedding,
      textHash: riskEmbeddings.textHash,
    })
    .from(riskEmbeddings)
    .where(eq(riskEmbeddings.riskId, riskId))
    .limit(1);
  return row ?? null;
}
