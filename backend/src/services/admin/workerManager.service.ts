import type { ChildProcess } from "node:child_process";
import { inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { createLogger } from "../../logger/index.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { workerState } from "../../workers/state.js";
import {
  killChildProcess,
  spawnBackendScript,
} from "./spawnBackendScript.js";

const workerManagerLog = createLogger("worker-manager");

const PENDING_WATCH_MS = Math.max(
  1000,
  Number.parseInt(process.env.WORKER_PENDING_WATCH_MS ?? "2000", 10) || 2000,
);

let pendingWatchTimer: ReturnType<typeof setInterval> | null = null;
let pendingWatchInFlight = false;
/** Set only by Admin → Stop. Blocks automatic restarts until Retry or Admin → Start. */
let stoppedByAdmin = false;

const ACTIVE_JOB_STATUSES = ["pending", "running"] as const;

function isRunning(): boolean {
  return (
    workerState.jobWorkerEnabled &&
    workerState.jobWorkerChild != null &&
    workerState.jobWorkerChild.exitCode == null &&
    !workerState.jobWorkerChild.killed
  );
}

export function getWorkerStatus(): {
  running: boolean;
  pid: number | null;
} {
  const child = workerState.jobWorkerChild;
  return {
    running: isRunning(),
    pid: child?.pid ?? null,
  };
}

export function ensureWorkerProcessRunning(options?: {
  /** User Retry and Admin Start clear an admin stop and start the worker. */
  overrideAdminStop?: boolean;
}): {
  pid: number | null;
  started: boolean;
} {
  if (options?.overrideAdminStop) {
    stoppedByAdmin = false;
  } else if (stoppedByAdmin) {
    return { pid: null, started: false };
  }

  if (isRunning()) {
    return {
      pid: workerState.jobWorkerChild?.pid ?? null,
      started: false,
    };
  }

  try {
    const { pid } = spawnWorkerProcess();
    return { pid, started: true };
  } catch {
    return { pid: null, started: false };
  }
}

async function hasActiveIngestJobs(): Promise<boolean> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(inArray(jobs.status, [...ACTIVE_JOB_STATUSES]))
    .limit(1);

  return row != null;
}

/**
 * Start the worker when a job is pending or running.
 * An admin stop blocks this until the user clicks Retry or the admin starts it.
 */
export async function ensureWorkerIfPendingJobs(): Promise<void> {
  if (stoppedByAdmin || isRunning()) return;

  const active = await hasActiveIngestJobs();
  if (!active) return;

  const { pid, started } = ensureWorkerProcessRunning();
  if (started) {
    workerManagerLog.info("Started worker because jobs are pending or running", {
      pid,
    });
  }
}

/**
 * Keep the worker running while jobs are pending or running.
 * Does not restart a worker the admin stopped.
 */
export function startPendingJobWorkerWatch(): void {
  if (pendingWatchTimer) return;

  const tick = (): void => {
    if (pendingWatchInFlight) return;
    pendingWatchInFlight = true;
    void ensureWorkerIfPendingJobs()
      .catch((err) => {
        workerManagerLog.warn("Pending-job worker check failed", { err });
      })
      .finally(() => {
        pendingWatchInFlight = false;
      });
  };

  tick();
  pendingWatchTimer = setInterval(tick, PENDING_WATCH_MS);
  pendingWatchTimer.unref();
}

/**
 * Discovery runs in a child process; ask the API server to start the managed worker.
 */
export async function requestWorkerServiceStart(): Promise<void> {
  if (process.env.BACKEND_MANAGED_CHILD === "1") {
    const port = process.env.PORT ?? process.env.BACKEND_PORT ?? "5005";
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/internal/services/worker/ensure`,
        {
          method: "POST",
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) {
        workerManagerLog.warn("Worker ensure request failed", {
          status: res.status,
        });
      }
    } catch (err) {
      workerManagerLog.warn("Could not request worker start from API", { err });
    }
    return;
  }

  ensureWorkerProcessRunning();
}

export function startWorkerProcess(): { pid: number } {
  stoppedByAdmin = false;
  return spawnWorkerProcess();
}

function spawnWorkerProcess(): { pid: number } {
  if (isRunning()) {
    return { pid: workerState.jobWorkerChild!.pid! };
  }

  const child = spawnBackendScript("src/workers/jobWorker.ts");

  workerState.jobWorkerChild = child;
  workerState.jobWorkerEnabled = true;

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trimEnd();
    if (text) workerManagerLog.info(text);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trimEnd();
    if (text) workerManagerLog.warn(text);
  });

  child.on("error", (err) => {
    workerManagerLog.error("Child process error", { err });
    workerState.jobWorkerEnabled = false;
    workerState.jobWorkerChild = null;
  });

  child.on("exit", () => {
    workerState.jobWorkerEnabled = false;
    workerState.jobWorkerChild = null;
    workerState.jobWorkerStop = null;
  });

  if (!child.pid) {
    throw new Error("Failed to start worker process (no PID).");
  }

  return { pid: child.pid };
}

export function stopWorkerProcess(): void {
  stoppedByAdmin = true;
  const child = workerState.jobWorkerChild;
  if (!child || child.killed) {
    workerState.jobWorkerEnabled = false;
    workerState.jobWorkerChild = null;
    return;
  }

  workerState.jobWorkerStop?.abort();
  killChildProcess(child);
}
