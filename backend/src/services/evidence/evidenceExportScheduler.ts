/**
 * Runs the Evidence Bridge export on a timer inside the API server.
 * Off unless EVIDENCE_EXPORT_ENABLED=1. Interval: EVIDENCE_EXPORT_INTERVAL_MINUTES
 * (default 15). Several API instances are safe: each run takes a Postgres
 * advisory lock and skips if another run holds it.
 */
import { createLogger } from "../../logger/index.js";
import { runEvidenceExport } from "./evidenceExport.service.js";

const log = createLogger("evidence-export");
let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export function evidenceExportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["1", "true", "yes", "on"].includes(
    (env.EVIDENCE_EXPORT_ENABLED ?? "").trim().toLowerCase(),
  );
}

export function evidenceExportIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.EVIDENCE_EXPORT_INTERVAL_MINUTES);
  const minutes = Number.isFinite(n) && n >= 1 ? n : 15;
  return Math.round(minutes * 60_000);
}

export function startEvidenceExportScheduler(): void {
  if (timer || !evidenceExportEnabled()) return;
  const tick = (): void => {
    if (inFlight) return;
    inFlight = true;
    void runEvidenceExport()
      .catch((err) => log.error("Evidence export run failed", { err }))
      .finally(() => {
        inFlight = false;
      });
  };
  const first = setTimeout(tick, 30_000);
  first.unref();
  timer = setInterval(tick, evidenceExportIntervalMs());
  timer.unref();
  log.info("Evidence export scheduler started", {
    intervalMs: evidenceExportIntervalMs(),
  });
}
