import { createHash } from "node:crypto";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { logger } from "../../logger/logger.js";

export const EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";
/** 256 dims: the 1.2k-row catalog doesn't need 1024-dim discrimination. */
export const EMBEDDING_DIMS = 256;

/** Titan v2 accepts up to ~8,192 tokens; cap characters well below that. */
const MAX_INPUT_CHARS = 8000;
const MAX_ATTEMPTS = 3;

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
    });
  }
  return client;
}

export function embeddingTextHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isRetryableError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  return (
    name === "ThrottlingException" ||
    name === "ServiceUnavailableException" ||
    name === "ModelTimeoutException" ||
    name === "InternalServerException"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let unavailableLogged = false;

/**
 * Embed a single text with Titan v2. Returns null on any failure (throttling
 * after retries, access denied, bad response) — callers degrade to lexical
 * matching, so this must never throw.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const input = text.trim().slice(0, MAX_INPUT_CHARS);
  if (!input) return null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await getClient().send(
        new InvokeModelCommand({
          modelId: EMBEDDING_MODEL_ID,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            inputText: input,
            dimensions: EMBEDDING_DIMS,
            normalize: true,
          }),
        }),
      );
      const decoded = JSON.parse(new TextDecoder().decode(response.body)) as {
        embedding?: unknown;
      };
      const embedding = decoded.embedding;
      if (
        Array.isArray(embedding) &&
        embedding.length === EMBEDDING_DIMS &&
        embedding.every((v) => typeof v === "number" && Number.isFinite(v))
      ) {
        return embedding as number[];
      }
      logger.warn("Bedrock embedding response malformed", {
        dims: Array.isArray(embedding) ? embedding.length : null,
      });
      return null;
    } catch (err) {
      if (isRetryableError(err) && attempt < MAX_ATTEMPTS) {
        const backoff = 500 * 2 ** (attempt - 1) + Math.random() * 250;
        await sleep(backoff);
        continue;
      }
      if (!unavailableLogged) {
        unavailableLogged = true;
        logger.warn(
          "Bedrock embeddings unavailable; matching degrades to lexical scoring",
          {
            message: (err as Error)?.message,
            name: (err as { name?: string })?.name,
          },
        );
      }
      return null;
    }
  }
  return null;
}

/** Embed many texts with bounded concurrency; positions align with input. */
export async function embedTexts(
  texts: string[],
  opts?: { concurrency?: number },
): Promise<(number[] | null)[]> {
  const concurrency = Math.max(1, opts?.concurrency ?? 2);
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  let next = 0;

  async function workerLoop(): Promise<void> {
    while (next < texts.length) {
      const index = next;
      next += 1;
      results[index] = await embedText(texts[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, texts.length) }, workerLoop),
  );
  return results;
}

/**
 * Cosine similarity. Titan vectors are requested normalized, so this is a
 * dot product, but norms are computed anyway to stay correct for any input.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
