import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { createLogger } from "../../logger/index.js";

const jobLog = createLogger("job");
import { ACTIVE_JOB_STATUSES } from "../../jobs/jobFactory.js";
import { articles } from "../../schema/articles/articles.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { extractRiskForArticle } from "./extractRisk.service.js";
import { processUrlToDb } from "./processUrl.service.js";
import {
  ensureAssignedBatchModelForJob,
  refreshBatchRunStatusForJob,
} from "../admin/batchRuns.service.js";
import {
  DO_NOT_EXECUTE_REASON,
  isUrlDoNotExecute,
} from "../jobs/urlExecutionBlocks.service.js";
import {
  JOB_MAX_RUNTIME_MS,
  JOB_TIMEOUT_SKIP_REASON,
  abortActiveJobRun,
  endJobRunTimer,
  isAbortOrTimeoutError,
  noteActiveAttemptJob,
  skipJobIfStillRunning,
  skipStaleRunningJobs,
  startJobRunTimer,
} from "../jobs/jobTimeout.service.js";
import {
  executionLadderSkipReason,
  executionRetryLimits,
  jobTimeoutSkipReason,
} from "../jobs/jobRuntimeSettings.service.js";
import { assignedModelForRetryTarget } from "../jobs/workerRetryTargets.service.js";
import {
  getLlmModelConfig,
  syncPythonLlmModel,
} from "../admin/llmModelConfig.service.js";
import {
  beginJobPipelineTrace,
  claimExecutionTimeReport,
  endJobPipelineTrace,
  formatExecutionTimeSkipReport,
  notePreparingPython,
} from "../jobs/jobPipelineTrace.js";

export { JOB_MAX_RUNTIME_MS, JOB_TIMEOUT_SKIP_REASON, skipStaleRunningJobs };

export type ClaimedJob = {
  id: number;
  articleId: number;
  url: string;
  source: "manual" | "rss" | "api" | "etl_reports";
  tries: number;
  ingestLinkItemId: number | null;
  batchRunId: number | null;
  modelName: string | null;
  modelLabel: string | null;
};

class JobTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobTimeoutError";
  }
}

function isTimeoutSkipError(err: unknown): boolean {
  if (err instanceof JobTimeoutError) return true;
  if (isAbortOrTimeoutError(err)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|timed out|aborted due to timeout|took more than \d+ minutes/i.test(
    message,
  );
}

/** Claim one pending job: pending → running (increments tries). */
export async function claimNextJob(
  onlyJobIds?: number[],
): Promise<ClaimedJob | null> {
  const pendingOnly =
    onlyJobIds && onlyJobIds.length > 0
      ? and(eq(jobs.status, "pending"), inArray(jobs.id, onlyJobIds))
      : eq(jobs.status, "pending");

  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({
        id: jobs.id,
        articleId: jobs.articleId,
        url: jobs.url,
        source: jobs.source,
        tries: jobs.tries,
        ingestLinkItemId: jobs.ingestLinkItemId,
        batchRunId: jobs.batchRunId,
        modelName: jobs.modelName,
        modelLabel: jobs.modelLabel,
      })
      .from(jobs)
      .where(pendingOnly)
      .orderBy(asc(jobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!pending) {
      return null;
    }

    const runStartedAt = new Date();
    const [claimed] = await tx
      .update(jobs)
      .set({
        status: "running",
        tries: sql`${jobs.tries} + 1`,
        startedAt: runStartedAt,
        updatedAt: runStartedAt,
      })
      .where(eq(jobs.id, pending.id))
      .returning({
        id: jobs.id,
        articleId: jobs.articleId,
        url: jobs.url,
        source: jobs.source,
        tries: jobs.tries,
        ingestLinkItemId: jobs.ingestLinkItemId,
        batchRunId: jobs.batchRunId,
        modelName: jobs.modelName,
        modelLabel: jobs.modelLabel,
      });

    return claimed ?? null;
  });
}

async function finishJob(
  jobId: number,
  status: "done" | "skipped" | "error",
  errorMessage: string | null,
  batchRefresh?: { ingestLinkItemId: number | null; url: string },
): Promise<void> {
  const [existing] = await db
    .select({ id: jobs.id, url: jobs.url, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!existing || existing.status !== "running") return;

  const blocked = await isUrlDoNotExecute(existing.url);
  const nextStatus = blocked ? "skipped" : status;
  const nextMessage = blocked ? DO_NOT_EXECUTE_REASON : errorMessage;

  await db
    .update(jobs)
    .set({
      status: nextStatus,
      errorMessage: nextMessage,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")));

  if (batchRefresh) {
    try {
      await refreshBatchRunStatusForJob(batchRefresh);
    } catch (err) {
      jobLog.warn("Could not refresh batch run status after job", {
        jobId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function printLiveExecutionTimeSkip(job: ClaimedJob): Promise<void> {
  const trace = claimExecutionTimeReport(job.id);
  if (!trace) return;

  let articleChars = trace.storedChars ?? trace.extractedChars ?? 0;
  try {
    const [article] = await db
      .select({ rawText: articles.rawText })
      .from(articles)
      .where(eq(articles.id, job.articleId))
      .limit(1);
    articleChars = article?.rawText?.trim().length ?? 0;
  } catch (err) {
    jobLog.warn("Could not read stored article text for timeout check", {
      jobId: job.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const lines = formatExecutionTimeSkipReport(trace, { articleChars });
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  jobLog.info("execution-time skip checks", {
    jobId: job.id,
    url: job.url,
    step: trace.step,
    detail: trace.detail,
    articleChars,
  });
}

async function jobStillRunning(jobId: number): Promise<boolean> {
  const [row] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  return row?.status === "running";
}

/**
 * Do not execute is written by the API process. This worker must notice that
 * and abort the in-flight attempt, otherwise the single queue stays on this
 * URL and every other job remains pending.
 */
function watchForReleasedJob(job: ClaimedJob): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void (async () => {
      if (stopped) return;
      const [running, blocked] = await Promise.all([
        jobStillRunning(job.id),
        isUrlDoNotExecute(job.url),
      ]);
      if (stopped || (running && !blocked)) return;
      stopped = true;
      clearInterval(timer);
      if (blocked) {
        process.stdout.write(
          `[job] jobId=${job.id} url=${job.url} do not execute — stopping this attempt so the next pending URL can run\n`,
        );
      }
      abortActiveJobRun();
    })();
  }, 2_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Resolve the model this job must use:
 * 1) model snapshotted on the job row at enqueue time
 * 2) model assigned to the batch (if any)
 * 3) live Controls model (legacy fallback)
 */
async function resolveJobExtractionModel(job: ClaimedJob): Promise<{
  modelId: string;
  modelLabel: string;
  batchId: number | null;
}> {
  const jobModel = job.modelName?.trim() || null;
  if (jobModel) {
    await syncPythonLlmModel(jobModel);
    return {
      modelId: jobModel,
      modelLabel: job.modelLabel?.trim() || jobModel,
      batchId: job.batchRunId,
    };
  }

  const batchModel = await ensureAssignedBatchModelForJob({
    batchRunId: job.batchRunId,
    ingestLinkItemId: job.ingestLinkItemId,
    url: job.url,
  });
  if (batchModel?.modelName?.trim()) {
    return {
      modelId: batchModel.modelName.trim(),
      modelLabel:
        batchModel.modelLabel?.trim() || batchModel.modelName.trim(),
      batchId: batchModel.batchId,
    };
  }

  const activeModel = getLlmModelConfig();
  const modelId = activeModel.modelId?.trim() || "unknown";
  return {
    modelId,
    modelLabel: activeModel.modelLabel?.trim() || modelId,
    batchId: null,
  };
}

/**
 * Process one claimed job through the status machine:
 * running → done | skipped | error
 */
export async function processClaimedJob(job: ClaimedJob): Promise<void> {
  const log = (msg: string, extra?: Record<string, unknown>) => {
    jobLog.info(msg, { jobId: job.id, ...extra });
  };

  const batchRefresh = {
    ingestLinkItemId: job.ingestLinkItemId,
    url: job.url,
  };

  const runWork = async (): Promise<void> => {
    if (await isUrlDoNotExecute(job.url)) {
      log("do not execute, skipping LLM");
      await finishJob(job.id, "skipped", DO_NOT_EXECUTE_REASON, batchRefresh);
      return;
    }

    const [articleRow] = await db
      .select({ title: articles.title })
      .from(articles)
      .where(eq(articles.id, job.articleId))
      .limit(1);

    log("ingest start", { url: job.url, jobSource: job.source });
    const ingest = await processUrlToDb(job.url, job.articleId, {
      title: articleRow?.title ?? undefined,
    });

    if (!(await jobStillRunning(job.id))) {
      log("stopped during ingest, aborting");
      await printLiveExecutionTimeSkip(job);
      return;
    }

    if (await isUrlDoNotExecute(job.url)) {
      log("do not execute after ingest, skipping LLM");
      await finishJob(job.id, "skipped", DO_NOT_EXECUTE_REASON, batchRefresh);
      return;
    }

    if (ingest.outcome === "skipped") {
      log("ingest skipped", { reason: ingest.reason });
      await finishJob(job.id, "skipped", ingest.reason, batchRefresh);
      return;
    }

    log("ingest done", { articleId: ingest.articleId });
    notePreparingPython();

    const assigned = await resolveJobExtractionModel(job);

    console.log(
      `[batch-worker] extracting url=${job.url} batchId=${assigned.batchId ?? "—"} model=${assigned.modelLabel} (${assigned.modelId}) jobId=${job.id} source=${job.source}`,
    );
    jobLog.info("risk extract start", {
      jobId: job.id,
      url: job.url,
      batchId: assigned.batchId,
      modelId: assigned.modelId,
      modelLabel: assigned.modelLabel,
      jobSource: job.source,
      modelSource: job.modelName?.trim()
        ? "job"
        : assigned.batchId != null
          ? "batch"
          : "controls",
    });

    const extract = await extractRiskForArticle(job.articleId, {
      modelId: assigned.modelId !== "unknown" ? assigned.modelId : null,
    });

    if (!(await jobStillRunning(job.id))) {
      log("stopped during risk extract, aborting");
      await printLiveExecutionTimeSkip(job);
      return;
    }

    if (await isUrlDoNotExecute(job.url)) {
      log("do not execute after extract, skipping");
      await finishJob(job.id, "skipped", DO_NOT_EXECUTE_REASON, batchRefresh);
      return;
    }

    if (extract.outcome === "skipped") {
      log("risk extract skipped", { reason: extract.reason });
      await finishJob(job.id, "skipped", extract.reason, batchRefresh);
      return;
    }

    log(
      extract.created ? "done" : "done (risk already exists for this model)",
      {
        riskId: extract.riskId,
        created: extract.created,
        modelName: extract.modelName,
        url: job.url,
      },
    );
    if (!(await jobStillRunning(job.id))) {
      log("timed out before finish, not marking done", { url: job.url });
      await printLiveExecutionTimeSkip(job);
      return;
    }
    await finishJob(job.id, "done", null, batchRefresh);
  };

  noteActiveAttemptJob(job.id);
  beginJobPipelineTrace({
    jobId: job.id,
    url: job.url,
    articleId: job.articleId,
  });

  try {
    const limits = executionRetryLimits(5);
    const startMinutes = limits[0] ?? 5;

    for (let index = 0; index < limits.length; index += 1) {
      const minutes = limits[index]!;
      const isLast = index === limits.length - 1;
      const blockedNow = await isUrlDoNotExecute(job.url);
      if (!(await jobStillRunning(job.id)) || blockedNow) {
        if (blockedNow) {
          process.stdout.write(
            `[job] jobId=${job.id} url=${job.url} do not execute — leaving this URL so the next pending URL can run\n`,
          );
          await finishJob(job.id, "skipped", DO_NOT_EXECUTE_REASON, batchRefresh);
        }
        return;
      }

      process.stdout.write(
        `[job] jobId=${job.id} url=${job.url} allowing ${minutes} minutes${index + 1 < limits.length ? `, then ${limits[index + 1]} minutes if this attempt does not finish` : ""}\n`,
      );
      log("execution interval", {
        url: job.url,
        interval: index + 1,
        intervals: limits.length,
        minutes,
      });

      await db
        .update(jobs)
        .set({
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));

      const stopWatch = watchForReleasedJob(job);
      const signal = await startJobRunTimer(minutes * 60_000);
      const timeoutPromise = new Promise<never>((_, reject) => {
        const fail = () => {
          reject(new JobTimeoutError(jobTimeoutSkipReason(minutes)));
        };
        if (signal.aborted) {
          fail();
          return;
        }
        signal.addEventListener("abort", fail, { once: true });
      });

      const work = runWork();
      try {
        await Promise.race([work, timeoutPromise]);
      } catch (err) {
        abortActiveJobRun();
        await work.catch(() => undefined);
        const blocked = await isUrlDoNotExecute(job.url);
        if (!(await jobStillRunning(job.id)) || blocked) {
          if (blocked) {
            await finishJob(job.id, "skipped", DO_NOT_EXECUTE_REASON, batchRefresh);
          }
          return;
        }

        const message = err instanceof Error ? err.message : String(err);
        if (!isLast) {
          const nextMinutes = limits[index + 1];
          process.stdout.write(
            `[job] jobId=${job.id} url=${job.url} did not finish in ${minutes} minutes. Retrying with ${nextMinutes} minutes.\n`,
          );
          log("execution interval retry", {
            url: job.url,
            minutes,
            nextMinutes,
            message,
          });
          endJobRunTimer();
          continue;
        }

        const reason = executionLadderSkipReason(
          startMinutes,
          minutes,
          limits.length,
        );
        log("skipped URL after the final execution-time interval", {
          url: job.url,
          minutes,
          intervals: limits.length,
        });
        await printLiveExecutionTimeSkip(job);
        await skipJobIfStillRunning(job.id, reason);
        return;
      } finally {
        stopWatch();
      }

      await work.catch(() => undefined);
      return;
    }
  } finally {
    noteActiveAttemptJob(null);
    endJobRunTimer();
    endJobPipelineTrace();
  }
}

/** Claim and process a single job, if any are pending. */
export async function runOneJob(onlyJobIds?: number[]): Promise<boolean> {
  await skipStaleRunningJobs();
  if (onlyJobIds && onlyJobIds.length === 0) return false;
  const job = await claimNextJob(onlyJobIds);
  if (!job) {
    return false;
  }

  let claimed = job;
  if (onlyJobIds) {
    const assigned = await assignedModelForRetryTarget(job.id);
    if (assigned && job.modelName?.trim() !== assigned.modelName) {
      await db
        .update(jobs)
        .set({
          modelName: assigned.modelName,
          modelLabel: assigned.modelLabel,
        })
        .where(eq(jobs.id, job.id));
      claimed = {
        ...job,
        modelName: assigned.modelName,
        modelLabel: assigned.modelLabel,
      };
    }
  }

  await processClaimedJob(claimed);
  return true;
}

/** True when at least one ingest job is waiting to run. */
export async function hasPendingJobs(): Promise<boolean> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.status, "pending"))
    .limit(1);

  return row != null;
}

/** True when any ingest job is pending or currently running. */
export async function hasActiveIngestJobs(): Promise<boolean> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(inArray(jobs.status, [...ACTIVE_JOB_STATUSES]))
    .limit(1);

  return row != null;
}
