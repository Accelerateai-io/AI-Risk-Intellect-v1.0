import type { ChildProcess } from "node:child_process";
import { createLogger } from "../../logger/index.js";
import { workerState } from "../../workers/state.js";

const workerManagerLog = createLogger("worker-manager");
import {
  killChildProcess,
  spawnBackendScript,
} from "./spawnBackendScript.js";

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

export function ensureWorkerProcessRunning(): {
  pid: number | null;
  started: boolean;
} {
  if (isRunning()) {
    return {
      pid: workerState.jobWorkerChild?.pid ?? null,
      started: false,
    };
  }

  try {
    const { pid } = startWorkerProcess();
    return { pid, started: true };
  } catch {
    return { pid: null, started: false };
  }
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
  const child = workerState.jobWorkerChild;
  if (!child || child.killed) {
    workerState.jobWorkerEnabled = false;
    workerState.jobWorkerChild = null;
    return;
  }

  workerState.jobWorkerStop?.abort();
  killChildProcess(child);
}
