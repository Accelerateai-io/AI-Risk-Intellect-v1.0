import type { ChildProcess } from "node:child_process";

/** Shared worker/discovery runtime flags (port of `app.workers.state`). */
export const workerState = {
  discoveryEnabled: false,
  discoveryRunMode: null as "loop" | "once" | "cron" | null,
  discoveryStop: null as AbortController | null,
  discoveryChild: null as ChildProcess | null,
  jobWorkerEnabled: false,
  jobWorkerStop: null as AbortController | null,
  jobWorkerChild: null as ChildProcess | null,
};
