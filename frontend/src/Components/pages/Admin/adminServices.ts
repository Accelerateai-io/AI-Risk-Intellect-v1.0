import { authFetch } from "../../../utils/authFetch";

export type ServiceKey = "worker" | "discovery";
export type ApiServiceState = "stopped" | "running";
export type ServiceState = ApiServiceState | "starting" | "stopping" | "idle";
export type PendingAction = "starting" | "stopping";

export const DEFAULT_API_STATUS: Record<ServiceKey, ApiServiceState> = {
  worker: "stopped",
  discovery: "stopped",
};

export function serviceStatusLabel(status: ServiceState): string {
  switch (status) {
    case "starting":
      return "Starting...";
    case "stopping":
      return "Stopping...";
    case "running":
      return "Running";
    case "idle":
      return "Idle";
    default:
      return "Stopped";
  }
}

export function serviceStatusPillClass(status: ServiceState): string {
  switch (status) {
    case "running":
      return "adminPage__statusPill--running";
    case "starting":
    case "stopping":
      return "adminPage__statusPill--pending";
    case "idle":
      return "adminPage__statusPill--idle";
    default:
      return "adminPage__statusPill--stopped";
  }
}

export function isServiceBusy(status: ServiceState): boolean {
  return status === "starting" || status === "stopping";
}

export function displayServiceStatus(
  key: ServiceKey,
  apiStatus: Record<ServiceKey, ApiServiceState>,
  pending: Partial<Record<ServiceKey, PendingAction>>,
): ServiceState {
  return pending[key] ?? apiStatus[key];
}

/** Reports worker: process may be up while the report queue is empty (e.g. after skip). */
export function resolveReportsWorkerDisplayStatus(
  workerStatus: ServiceState,
  workerApiRunning: boolean,
  hasActiveReportJobs: boolean,
  options?: { runWarmup?: boolean },
): ServiceState {
  if (workerStatus === "starting" || workerStatus === "stopping") {
    return workerStatus;
  }
  if (!workerApiRunning) {
    return "stopped";
  }
  if (hasActiveReportJobs || options?.runWarmup) {
    return "running";
  }
  return "idle";
}

export async function readServiceApiStatus(): Promise<Record<
  ServiceKey,
  ApiServiceState
> | null> {
  let res: Response;
  try {
    res = await authFetch("/admin/services/status");
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as {
    services?: Record<string, { running?: boolean }>;
  };
  return {
    worker:
      data.services?.worker?.running === true ? "running" : "stopped",
    discovery:
      data.services?.discovery?.running === true ? "running" : "stopped",
  };
}

export async function waitForServiceApiState(
  key: ServiceKey,
  expectRunning: boolean,
  maxMs = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const status = await readServiceApiStatus();
    if (status) {
      const running = status[key] === "running";
      if (running === expectRunning) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** After RSS discovery or cron save, the worker should be up; discovery may stay idle until run time. */
export async function waitForWorkerRunning(maxMs = 30_000): Promise<boolean> {
  return waitForServiceApiState("worker", true, maxMs);
}

/** @deprecated Prefer waitForWorkerRunning — cron discovery is timer-driven, not always running. */
export async function waitForDiscoveryAndWorkerRunning(
  maxMs = 30_000,
): Promise<{ discovery: boolean; worker: boolean }> {
  const worker = await waitForWorkerRunning(maxMs);
  const discovery = await waitForServiceApiState("discovery", true, 5_000);
  return { discovery, worker };
}
