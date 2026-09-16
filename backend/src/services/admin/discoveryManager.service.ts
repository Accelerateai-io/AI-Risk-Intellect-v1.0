import type { ChildProcess } from "node:child_process";
import type { CronScheduleConfig } from "../../config/cronScheduleConfig.js";
import { createLogger } from "../../logger/index.js";
import { clampSetTimeoutMs } from "../../utils/timerUtils.js";
import { workerState } from "../../workers/state.js";
import {
  killChildProcess,
  spawnBackendScript,
} from "./spawnBackendScript.js";
import { ensureWorkerProcessRunning, getWorkerStatus } from "./workerManager.service.js";
import {
  computeCronDiscoveryWaitMs,
  getCronStartSkipReason,
  recordCronJobEvent,
  shouldStartScheduledCronRun,
} from "./cronJobEvents.service.js";
import {
  loadActiveCronScheduleConfig,
  loadActiveCronScheduleId,
} from "./cronSchedule.service.js";

const discoveryManagerLog = createLogger("discovery-manager");

/** Planned exit when a legacy loop child finishes one cron cycle (CLI / RUN_ONCE=false). */
const CRON_LOOP_PLANNED_EXIT_CODE = 12;

let suppressExitCronStopNotification = false;
let scheduleNextCronRunPending = false;
let cronLoopRestartTimer: ReturnType<typeof setTimeout> | null = null;

export function clearCronLoopRestartTimer(): void {
  if (cronLoopRestartTimer) {
    clearTimeout(cronLoopRestartTimer);
    cronLoopRestartTimer = null;
  }
}

async function tryStartScheduledCronDiscovery(
  schedule: CronScheduleConfig,
): Promise<boolean> {
  if (isRunning()) {
    return false;
  }

  const shouldStart = await shouldStartScheduledCronRun(schedule.id, schedule);
  if (!shouldStart) {
    const skipReason = await getCronStartSkipReason(schedule.id, schedule);
    discoveryManagerLog.info("Skipping cron discovery launch", {
      scheduleId: schedule.id,
      reason: skipReason ?? "unknown",
    });
    return false;
  }

  startCronScheduledDiscoveryProcess(schedule);
  ensureWorkerProcessRunning();
  discoveryManagerLog.info("Starting scheduled cron discovery run", {
    scheduleId: schedule.id,
  });
  return true;
}

const CRON_TIMER_POLL_MS = 60_000;

function armCronDiscoveryTimer(scheduleId: string, delayMs: number): void {
  const timerMs = clampSetTimeoutMs(
    delayMs > CRON_TIMER_POLL_MS ? CRON_TIMER_POLL_MS : delayMs,
    1_000,
  );
  discoveryManagerLog.info("Scheduled next cron discovery run", {
    scheduleId,
    waitMs: delayMs,
    ...(timerMs < delayMs ? { timerChunkMs: timerMs } : {}),
  });

  cronLoopRestartTimer = setTimeout(() => {
    cronLoopRestartTimer = null;
    scheduleCronDiscoveryAttempt();
  }, timerMs);
}

function scheduleCronDiscoveryAttempt(): void {
  void loadActiveCronScheduleConfig()
    .then(async (active) => {
      if (!active?.active || active.ingestLinkIds.length === 0) return;

      const delayMs = await computeCronDiscoveryWaitMs(active.id, active);
      if (delayMs == null) {
        discoveryManagerLog.info("No upcoming cron discovery run", {
          scheduleId: active.id,
        });
        return;
      }

      if (delayMs <= 0) {
        const started = await tryStartScheduledCronDiscovery(active);
        if (!started) {
          const retryMs = await computeCronDiscoveryWaitMs(active.id, active);
          if (retryMs != null && retryMs > 0) {
            armCronDiscoveryTimer(active.id, retryMs);
          }
        }
        return;
      }

      armCronDiscoveryTimer(active.id, delayMs);
    })
    .catch((err) => {
      discoveryManagerLog.error("Failed to schedule cron discovery", { err });
    });
}

export function scheduleNextCronDiscoveryRun(
  schedule: CronScheduleConfig,
): void {
  clearCronLoopRestartTimer();
  scheduleCronDiscoveryAttempt();
}

function handleDiscoveryScheduledExit(
  wasScheduledMode: boolean,
  suppressedNotification: boolean,
  exitCode: number | null,
): void {
  if (!wasScheduledMode || suppressedNotification || scheduleNextCronRunPending) {
    return;
  }

  scheduleNextCronRunPending = true;
  void loadActiveCronScheduleConfig()
    .then((schedule) => {
      if (!schedule?.active || schedule.ingestLinkIds.length === 0) return;
      scheduleNextCronDiscoveryRun(schedule);
      if (exitCode === CRON_LOOP_PLANNED_EXIT_CODE || exitCode === 0) {
        discoveryManagerLog.info(
          "Cron discovery finished scheduled run; waiting until next occurrence",
          { scheduleId: schedule.id },
        );
      }
    })
    .catch((err) => {
      discoveryManagerLog.error("Failed to schedule next cron discovery run", {
        err,
      });
    })
    .finally(() => {
      scheduleNextCronRunPending = false;
    });
}

function isRunning(): boolean {
  return (
    workerState.discoveryEnabled &&
    workerState.discoveryChild != null &&
    workerState.discoveryChild.exitCode == null &&
    !workerState.discoveryChild.killed
  );
}

function attachDiscoveryChildHandlers(child: ChildProcess): void {
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trimEnd();
    if (text) discoveryManagerLog.info(text);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trimEnd();
    if (text) discoveryManagerLog.warn(text);
  });

  child.on("error", (err) => {
    discoveryManagerLog.error("Child process error", { err });
    const runMode = workerState.discoveryRunMode;
    const wasScheduledMode = runMode === "loop" || runMode === "cron";
    workerState.discoveryEnabled = false;
    workerState.discoveryRunMode = null;
    workerState.discoveryChild = null;
    handleDiscoveryScheduledExit(wasScheduledMode, false, null);
  });

  child.on("exit", (code) => {
    const runMode = workerState.discoveryRunMode;
    const wasLoopMode = runMode === "loop";
    const wasCronMode = runMode === "cron";
    const wasScheduledMode = wasLoopMode || wasCronMode;
    const suppressed = suppressExitCronStopNotification;
    const plannedCronExit =
      wasLoopMode && code === CRON_LOOP_PLANNED_EXIT_CODE;

    if (wasLoopMode && !suppressed && !plannedCronExit) {
      void loadActiveCronScheduleId().then((scheduleId) =>
        recordCronJobEvent(
          scheduleId,
          "stopped",
          "RSS feed discovery CRON job stopped unexpectedly.",
        ),
      );
    }

    if (wasCronMode && !suppressed && code !== 0 && code != null) {
      void loadActiveCronScheduleId().then((scheduleId) =>
        recordCronJobEvent(
          scheduleId,
          "stopped",
          "RSS feed discovery CRON job stopped unexpectedly.",
        ),
      );
    }

    suppressExitCronStopNotification = false;
    workerState.discoveryEnabled = false;
    workerState.discoveryRunMode = null;
    workerState.discoveryChild = null;
    workerState.discoveryStop = null;

    handleDiscoveryScheduledExit(wasScheduledMode, suppressed, code);
  });
}

function attachEphemeralDiscoveryHandlers(child: ChildProcess): void {
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trimEnd();
    if (text) discoveryManagerLog.info(text);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trimEnd();
    if (text) discoveryManagerLog.warn(text);
  });
  child.on("error", (err) => {
    discoveryManagerLog.error("Manual discovery child error", { err });
  });
}

function spawnManualDiscoveryProcess(options: {
  ingestLinkIds: number[];
  ingestLinkItemIds: number[];
  batchRunId?: number;
}): ChildProcess {
  return spawnBackendScript("src/workers/discoveryService.ts", {
    env: {
      DISCOVERY_INGEST_LINK_IDS: options.ingestLinkIds.join(","),
      DISCOVERY_INGEST_LINK_ITEM_IDS: options.ingestLinkItemIds.join(","),
      RUN_ONCE: "true",
      ...(options.batchRunId != null
        ? { BATCH_RUN_ID: String(options.batchRunId) }
        : {}),
    },
  });
}

export function getDiscoveryStatus(): {
  running: boolean;
  pid: number | null;
} {
  const child = workerState.discoveryChild;
  return {
    running: isRunning(),
    pid: child?.pid ?? null,
  };
}

export function startDiscoveryLoopProcess(options?: {
  recordStartedEvent?: boolean;
}): { pid: number } {
  if (isRunning()) {
    return { pid: workerState.discoveryChild!.pid! };
  }

  const child = spawnBackendScript("src/workers/discoveryService.ts", {
    env: {
      RUN_ONCE: "false",
    },
  });

  workerState.discoveryChild = child;
  workerState.discoveryEnabled = true;
  workerState.discoveryRunMode = "loop";

  attachDiscoveryChildHandlers(child);

  if (!child.pid) {
    workerState.discoveryRunMode = null;
    throw new Error("Failed to start discovery process (no PID).");
  }

  if (options?.recordStartedEvent) {
    void loadActiveCronScheduleId().then((scheduleId) =>
      recordCronJobEvent(
        scheduleId,
        "started",
        "RSS feed discovery CRON job started.",
      ),
    );
  }

  return { pid: child.pid };
}

function startCronScheduledDiscoveryProcess(
  schedule: CronScheduleConfig,
): { pid: number } {
  if (isRunning()) {
    return { pid: workerState.discoveryChild!.pid! };
  }

  const child = spawnBackendScript("src/workers/discoveryService.ts", {
    env: {
      RUN_ONCE: "true",
      CRON_SCHEDULED_RUN: "true",
      DISCOVERY_INGEST_LINK_IDS: schedule.ingestLinkIds.join(","),
    },
  });

  workerState.discoveryChild = child;
  workerState.discoveryEnabled = true;
  workerState.discoveryRunMode = "cron";

  attachDiscoveryChildHandlers(child);

  if (!child.pid) {
    workerState.discoveryRunMode = null;
    throw new Error("Failed to start scheduled cron discovery (no PID).");
  }

  return { pid: child.pid };
}

function stopActiveDiscoveryForReschedule(): void {
  clearCronLoopRestartTimer();

  if (isRunning()) {
    suppressExitCronStopNotification = true;
    const child = workerState.discoveryChild;
    workerState.discoveryStop?.abort();
    workerState.discoveryEnabled = false;
    workerState.discoveryRunMode = null;
    workerState.discoveryChild = null;
    workerState.discoveryStop = null;
    if (child && !child.killed && child.pid) {
      killChildProcess(child);
    }
  }
}

async function rescheduleCronDiscoveryAfterSave(): Promise<void> {
  const schedule = await loadActiveCronScheduleConfig();
  if (!schedule?.active || schedule.ingestLinkIds.length === 0) return;

  const delayMs = await computeCronDiscoveryWaitMs(schedule.id, schedule);
  if (delayMs == null) {
    discoveryManagerLog.info("No upcoming cron discovery run", {
      scheduleId: schedule.id,
    });
    return;
  }

  if (delayMs <= 0) {
    const started = await tryStartScheduledCronDiscovery(schedule);
    if (!started) {
      const retryMs = await computeCronDiscoveryWaitMs(schedule.id, schedule);
      if (retryMs != null && retryMs > 0) {
        armCronDiscoveryTimer(schedule.id, retryMs);
      }
    }
    return;
  }

  armCronDiscoveryTimer(schedule.id, delayMs);
}

/** Stop the cron loop child (if any) and reschedule the next run at the configured time. */
export function restartDiscoveryLoopProcess(): { pid: number | null } {
  stopActiveDiscoveryForReschedule();
  void rescheduleCronDiscoveryAfterSave().catch((err) => {
    discoveryManagerLog.error("Failed to reschedule cron discovery", { err });
  });
  return { pid: getDiscoveryStatus().pid };
}

/** Await rescheduling so cron save responses reflect an immediate start when due. */
export async function restartAndRescheduleCronDiscovery(): Promise<void> {
  stopActiveDiscoveryForReschedule();
  await rescheduleCronDiscoveryAfterSave();
}

export function startDiscoveryProcess(options: {
  ingestLinkIds?: number[];
  ingestLinkItemIds?: number[];
  batchRunId?: number;
}): { pid: number } {
  const ingestLinkIds = options.ingestLinkIds ?? [];
  const ingestLinkItemIds = options.ingestLinkItemIds ?? [];
  const batchRunId = options.batchRunId;

  if (isRunning() && workerState.discoveryRunMode === "once") {
    return { pid: workerState.discoveryChild!.pid! };
  }

  // A scheduled cron run may be in progress; manual discovery still runs separately.
  if (
    isRunning() &&
    (workerState.discoveryRunMode === "loop" ||
      workerState.discoveryRunMode === "cron")
  ) {
    const child = spawnManualDiscoveryProcess({
      ingestLinkIds,
      ingestLinkItemIds,
      batchRunId,
    });
    attachEphemeralDiscoveryHandlers(child);
    if (!child.pid) {
      throw new Error("Failed to start manual discovery process (no PID).");
    }
    discoveryManagerLog.info(
      "Started manual discovery alongside scheduled cron run",
      { pid: child.pid },
    );
    return { pid: child.pid };
  }

  const child = spawnManualDiscoveryProcess({
    ingestLinkIds,
    ingestLinkItemIds,
    batchRunId,
  });

  workerState.discoveryChild = child;
  workerState.discoveryEnabled = true;
  workerState.discoveryRunMode = "once";

  attachDiscoveryChildHandlers(child);

  if (!child.pid) {
    workerState.discoveryRunMode = null;
    throw new Error("Failed to start discovery process (no PID).");
  }

  return { pid: child.pid };
}

export function stopDiscoveryProcess(): void {
  clearCronLoopRestartTimer();

  const child = workerState.discoveryChild;
  if (!child || child.killed) {
    workerState.discoveryEnabled = false;
    workerState.discoveryRunMode = null;
    workerState.discoveryChild = null;
    return;
  }

  if (workerState.discoveryRunMode === "loop") {
    suppressExitCronStopNotification = true;
    void loadActiveCronScheduleId().then((scheduleId) =>
      recordCronJobEvent(
        scheduleId,
        "stopped",
        "RSS feed discovery CRON job stopped.",
      ),
    );
  } else if (workerState.discoveryRunMode === "cron") {
    suppressExitCronStopNotification = true;
  }

  workerState.discoveryStop?.abort();
  killChildProcess(child);
}

export function getServicesStatus(): Record<string, { running: boolean; pid: number | null }> {
  return {
    worker: getWorkerStatus(),
    discovery: getDiscoveryStatus(),
  };
}
