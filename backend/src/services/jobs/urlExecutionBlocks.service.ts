import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { urlExecutionBlocks } from "../../schema/jobs/urlExecutionBlocks.js";
import { HttpError } from "../../utils/httpError.js";
import { normalizeUrl } from "../../utils/fetchUtils.js";

export const DO_NOT_EXECUTE_REASON = "Do not execute";

export type UrlExecutionBlockInfo = {
  url: string;
  modelName: string | null;
  modelLabel: string | null;
};

function urlExecutionKeyVariants(url: string): string[] {
  const keys = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    keys.add(trimmed);
    if (trimmed.endsWith("/") && trimmed.split("/").length > 3) {
      keys.add(trimmed.replace(/\/+$/, ""));
    }
  };

  add(url);
  if (/^http:/i.test(url)) add(url.replace(/^http:/i, "https:"));
  if (/^https:/i.test(url)) add(url.replace(/^https:/i, "http:"));
  try {
    add(normalizeUrl(url));
  } catch {
    // keep non-normalized variants
  }
  return [...keys];
}

function executionUrlKey(url: string): string {
  try {
    return normalizeUrl(url).toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

async function listBlockUrls(): Promise<Array<{ id: number; url: string }>> {
  try {
    return await db
      .select({ id: urlExecutionBlocks.id, url: urlExecutionBlocks.url })
      .from(urlExecutionBlocks);
  } catch {
    return [];
  }
}

function isMissingBlockModelColumnError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /does not exist/i.test(message) &&
    /url_execution_blocks|model_name|model_label/i.test(message)
  );
}

export async function isUrlDoNotExecute(url: string): Promise<boolean> {
  const variants = urlExecutionKeyVariants(url);
  if (variants.length === 0) return false;

  try {
    const [row] = await db
      .select({ id: urlExecutionBlocks.id })
      .from(urlExecutionBlocks)
      .where(inArray(urlExecutionBlocks.url, variants))
      .limit(1);
    if (row) return true;
  } catch (err) {
    if (!isMissingBlockModelColumnError(err)) throw err;
  }

  const key = executionUrlKey(url);
  const rows = await listBlockUrls();
  return rows.some((row) => executionUrlKey(row.url) === key);
}

export async function getUrlExecutionBlock(
  url: string,
): Promise<UrlExecutionBlockInfo | null> {
  const variants = urlExecutionKeyVariants(url);
  if (variants.length === 0) return null;

  try {
    const [row] = await db
      .select({
        url: urlExecutionBlocks.url,
        modelName: urlExecutionBlocks.modelName,
        modelLabel: urlExecutionBlocks.modelLabel,
      })
      .from(urlExecutionBlocks)
      .where(inArray(urlExecutionBlocks.url, variants))
      .limit(1);
    if (!row) return null;
    return {
      url: row.url,
      modelName: row.modelName?.trim() || null,
      modelLabel: row.modelLabel?.trim() || row.modelName?.trim() || null,
    };
  } catch (err) {
    if (!isMissingBlockModelColumnError(err)) throw err;
    const [row] = await db
      .select({ url: urlExecutionBlocks.url })
      .from(urlExecutionBlocks)
      .where(inArray(urlExecutionBlocks.url, variants))
      .limit(1);
    if (!row) return null;
    return { url: row.url, modelName: null, modelLabel: null };
  }
}

export async function getDoNotExecuteBlocks(
  urls: string[],
): Promise<Map<string, UrlExecutionBlockInfo>> {
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const variants = [...new Set(unique.flatMap((url) => urlExecutionKeyVariants(url)))];
  if (variants.length === 0) return new Map();

  const mapRow = (row: {
    url: string;
    modelName?: string | null;
    modelLabel?: string | null;
  }): UrlExecutionBlockInfo => ({
    url: row.url,
    modelName: row.modelName?.trim() || null,
    modelLabel: row.modelLabel?.trim() || row.modelName?.trim() || null,
  });

  let rows: Array<{
    url: string;
    modelName?: string | null;
    modelLabel?: string | null;
  }>;
  try {
    rows = await db
      .select({
        url: urlExecutionBlocks.url,
        modelName: urlExecutionBlocks.modelName,
        modelLabel: urlExecutionBlocks.modelLabel,
      })
      .from(urlExecutionBlocks)
      .where(inArray(urlExecutionBlocks.url, variants));
  } catch (err) {
    if (!isMissingBlockModelColumnError(err)) throw err;
    rows = await db
      .select({ url: urlExecutionBlocks.url })
      .from(urlExecutionBlocks)
      .where(inArray(urlExecutionBlocks.url, variants));
  }

  const byStoredUrl = new Map(rows.map((row) => [row.url, mapRow(row)]));
  const result = new Map<string, UrlExecutionBlockInfo>();
  for (const url of unique) {
    for (const key of urlExecutionKeyVariants(url)) {
      const block = byStoredUrl.get(key);
      if (block) {
        result.set(url, block);
        break;
      }
    }
  }
  return result;
}

export async function getDoNotExecuteUrlSet(urls: string[]): Promise<Set<string>> {
  const blocks = await getDoNotExecuteBlocks(urls);
  return new Set(blocks.keys());
}

export async function clearUrlDoNotExecute(url: string): Promise<boolean> {
  const variants = urlExecutionKeyVariants(url);
  const key = executionUrlKey(url);
  let deleted = 0;

  if (variants.length > 0) {
    try {
      const rows = await db
        .delete(urlExecutionBlocks)
        .where(inArray(urlExecutionBlocks.url, variants))
        .returning({ id: urlExecutionBlocks.id });
      deleted += rows.length;
    } catch (err) {
      if (!isMissingBlockModelColumnError(err)) throw err;
    }
  }

  const leftover = await listBlockUrls();
  const extraIds = leftover
    .filter((row) => executionUrlKey(row.url) === key)
    .map((row) => row.id);
  if (extraIds.length > 0) {
    const rows = await db
      .delete(urlExecutionBlocks)
      .where(inArray(urlExecutionBlocks.id, extraIds))
      .returning({ id: urlExecutionBlocks.id });
    deleted += rows.length;
  }

  return deleted > 0;
}

/** Persist the URL block and skip pending/running jobs for it. */
export async function markJobUrlDoNotExecute(jobId: number): Promise<{
  id: number;
  url: string;
  status: string;
}> {
  const [job] = await db
    .select({
      id: jobs.id,
      url: jobs.url,
      status: jobs.status,
      ingestLinkItemId: jobs.ingestLinkItemId,
      modelName: jobs.modelName,
      modelLabel: jobs.modelLabel,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job) {
    throw HttpError.notFound("Job not found.");
  }

  const url = normalizeUrl(job.url);
  const modelName = job.modelName?.trim() || null;
  const modelLabel = job.modelLabel?.trim() || modelName;

  try {
    await db
      .insert(urlExecutionBlocks)
      .values({
        url,
        ...(modelName ? { modelName } : {}),
        ...(modelLabel ? { modelLabel } : {}),
      })
      .onConflictDoNothing({ target: urlExecutionBlocks.url });
  } catch (err) {
    if (!isMissingBlockModelColumnError(err)) throw err;
    await db
      .insert(urlExecutionBlocks)
      .values({ url })
      .onConflictDoNothing({ target: urlExecutionBlocks.url });
  }

  await db
    .update(jobs)
    .set({
      status: "skipped",
      errorMessage: DO_NOT_EXECUTE_REASON,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(jobs.status, ["pending", "running"]),
        eq(jobs.id, jobId),
      ),
    );

  await db
    .update(jobs)
    .set({
      status: "skipped",
      errorMessage: DO_NOT_EXECUTE_REASON,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.url, url), inArray(jobs.status, ["pending", "running"])));

  try {
    const { refreshBatchRunStatusForJob } = await import(
      "../admin/batchRuns.service.js"
    );
    await refreshBatchRunStatusForJob({
      ingestLinkItemId: job.ingestLinkItemId,
      url,
    });
  } catch {
    // Batch refresh is best-effort; the URL block still applies.
  }

  const [updated] = await db
    .select({ id: jobs.id, url: jobs.url, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  return updated ?? { id: job.id, url, status: job.status };
}
