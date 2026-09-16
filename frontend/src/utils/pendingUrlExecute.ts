const STORAGE_KEY = "pendingUrlExecute";
export const EXECUTE_JOB_SEARCH_PARAM = "executeJob";

export type PendingUrlExecute = {
  jobId: number;
  url: string;
};

export type PendingUrlExecuteLocationState = {
  pendingUrlExecute?: PendingUrlExecute;
};

function isPendingUrlExecute(value: unknown): value is PendingUrlExecute {
  if (!value || typeof value !== "object") return false;
  const record = value as { jobId?: unknown; url?: unknown };
  return (
    typeof record.jobId === "number" &&
    Number.isFinite(record.jobId) &&
    record.jobId >= 1 &&
    typeof record.url === "string" &&
    record.url.trim().length > 0
  );
}

export function getPendingUrlExecute(): PendingUrlExecute | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPendingUrlExecute(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setPendingUrlExecute(pending: PendingUrlExecute): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
}

export function clearPendingUrlExecute(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

function pendingFromLocationState(state: unknown): PendingUrlExecute | null {
  if (!state || typeof state !== "object") return null;
  const pending = (state as PendingUrlExecuteLocationState).pendingUrlExecute;
  return isPendingUrlExecute(pending) ? pending : null;
}

/** Only treat this as an Execute-popup handoff when the job is in the URL or nav state. */
export function readPendingUrlExecuteFromNav(input: {
  searchParams: URLSearchParams;
  state: unknown;
}): PendingUrlExecute | null {
  const fromState = pendingFromLocationState(input.state);
  const jobParam = Number.parseInt(
    input.searchParams.get(EXECUTE_JOB_SEARCH_PARAM) ?? "",
    10,
  );
  const hasJobParam = Number.isFinite(jobParam) && jobParam >= 1;
  const stored = getPendingUrlExecute();

  if (fromState && (!hasJobParam || fromState.jobId === jobParam)) {
    return fromState;
  }
  if (hasJobParam && stored?.jobId === jobParam) return stored;
  return null;
}
