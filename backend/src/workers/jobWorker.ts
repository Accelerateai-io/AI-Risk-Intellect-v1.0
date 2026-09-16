/**
 * Port of `app/workers/job_worker.py` — poll pending jobs:
 *   pending → running → done | skipped | error
 *
 *   npm run worker
 */
import "../bootstrap.js";
import { createLogger } from "../logger/index.js";
import {
  runOneJob,
  hasActiveIngestJobs,
  skipStaleRunningJobs,
} from "../services/worker/jobWorker.service.js";
import { abortActiveJobRun } from "../services/jobs/jobTimeout.service.js";
import { hasRunningBatchRun } from "../services/admin/batchRuns.service.js";
import {
  assertPythonServiceReady,
  syncPythonLlmFromEnv,
} from "../services/worker/pythonHealth.js";
import { workerState } from "./state.js";

const log = createLogger("job-worker");

const POLL_MS = Math.max(
  500,
  Number.parseInt(process.env.JOB_POLL_MS ?? "2000", 10) || 2000,
);

const MANAGED_CHILD = process.env.BACKEND_MANAGED_CHILD === "1";
const AUTO_STOP_WHEN_IDLE =
  MANAGED_CHILD && process.env.WORKER_AUTO_STOP !== "0";
const IDLE_POLLS_BEFORE_STOP = Math.max(
  1,
  Number.parseInt(process.env.WORKER_IDLE_POLLS ?? "2", 10) || 2,
);

let stopRequested = false;

function handleShutdown(signal: string): void {
  stopRequested = true;
  log.warn("shutdown signal received (%s)", signal);
  workerState.jobWorkerStop?.abort();
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function workerLoop(): Promise<void> {
  const stopController = new AbortController();
  workerState.jobWorkerStop = stopController;
  workerState.jobWorkerEnabled = true;

  log.info("worker loop starting (poll_ms=%d)", POLL_MS);

  try {
    await assertPythonServiceReady();
    await syncPythonLlmFromEnv();
    log.info("python ingest/extract service is reachable and LLM config synced");
  } catch (err) {
    log.error(
      "python service not ready — start backend with npm run dev (or npm run py:dev). %s",
      String(err),
    );
  }

  let watchdog: ReturnType<typeof setInterval> | null = null;
  try {
    let idlePolls = 0;
    watchdog = setInterval(() => {
      void skipStaleRunningJobs().then((skipped) => {
        if (skipped > 0) abortActiveJobRun();
      });
    }, 10_000);

    while (!stopRequested && !stopController.signal.aborted) {
      const ran = await runOneJob();
      if (ran) {
        idlePolls = 0;
        continue;
      }

      if (AUTO_STOP_WHEN_IDLE) {
        const [activeJobs, batchProcessing] = await Promise.all([
          hasActiveIngestJobs(),
          hasRunningBatchRun(),
        ]);
        if (!activeJobs && !batchProcessing) {
          idlePolls += 1;
          if (idlePolls >= IDLE_POLLS_BEFORE_STOP) {
            log.info(
              "no active jobs or processing batches — stopping managed worker (idle_polls=%d)",
              idlePolls,
            );
            break;
          }
        } else {
          idlePolls = 0;
        }
      }

      await sleep(POLL_MS, stopController.signal);
    }
  } catch (err) {
    if (stopRequested || stopController.signal.aborted) {
      log.info("cancelled");
    } else {
      log.error("crash: %s", String(err));
    }
  } finally {
    if (watchdog) clearInterval(watchdog);
    workerState.jobWorkerEnabled = false;
    workerState.jobWorkerStop = null;
  }

  log.info("exiting");
}

log.info("booting");

workerLoop().catch((err) => {
  log.error("fatal: %s", String(err));
  process.exitCode = 1;
});
