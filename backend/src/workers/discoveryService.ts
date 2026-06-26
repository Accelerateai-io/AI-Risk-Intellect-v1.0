import "../bootstrap.js";

/**
 * Port of `app/workers/discovery_service.py` — run as standalone process:
 *   npm run discovery
 *   RUN_ONCE=true npm run discovery:once
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../logger/index.js";
import {
  autoIngestLoop,
  CRON_LOOP_PLANNED_EXIT_CODE,
} from "./rssDiscovery.js";
import { workerState } from "./state.js";

const log = createLogger("discovery-service");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const cfgPath = path.join(projectRoot, "config", "sources.yaml");

let stopRequested = false;

function handleShutdown(signal: string): void {
  stopRequested = true;
  log.warn("[discovery-service] shutdown signal received (%s)", signal);
  workerState.discoveryStop?.abort();
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

async function discoveryLoop(): Promise<void> {
  const runOnce = ["1", "true", "yes"].includes(
    (process.env.RUN_ONCE ?? "false").toLowerCase(),
  );

  log.info("[discovery-service] Discovery loop starting (run_once=%s)", runOnce);

  const stopController = new AbortController();
  workerState.discoveryStop = stopController;
  workerState.discoveryEnabled = true;

  let plannedCronExit = false;
  try {
    const result = await autoIngestLoop(stopController.signal, cfgPath, {
      runOnce,
    });
    plannedCronExit = result.plannedCronExit;
  } catch (err) {
    if (stopRequested || stopController.signal.aborted) {
      log.info("[discovery-service] cancelled");
    } else {
      log.error("[discovery-service] crash: %s", String(err));
    }
  } finally {
    workerState.discoveryEnabled = false;
    workerState.discoveryStop = null;
  }

  log.info("[discovery-service] exiting");
  if (plannedCronExit) {
    process.exitCode = CRON_LOOP_PLANNED_EXIT_CODE;
  }
}

log.info("[discovery-service] booting");

discoveryLoop().catch((err) => {
  log.error("[discovery-service] fatal: %s", String(err));
  process.exitCode = 1;
});
