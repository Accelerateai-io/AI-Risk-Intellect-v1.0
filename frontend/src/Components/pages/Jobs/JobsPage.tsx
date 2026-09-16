import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Ban,
  CheckCircle2,
  Clock,
  FilterX,
  Info,
  ListChecks,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  // Trash2,
  SkipForward,
  Timer,
  XCircle,
  Zap,
  CircleAlert,
  MoreHorizontal,
  Play,
  Settings2,
  X,
} from "lucide-react";
import { authFetch } from "../../../utils/authFetch";
import { readApiErrorMessage } from "../../../utils/readApiErrorMessage";
import { formatDurationMs, formatJobExecutedAt } from "../../../utils/formatDate";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import { usePolling } from "../../../utils/usePolling";
import { executeJob } from "../../../utils/jobsEnqueueApi";
import {
  EXECUTE_JOB_SEARCH_PARAM,
  setPendingUrlExecute,
} from "../../../utils/pendingUrlExecute";
import { positionTableTip } from "../../../utils/positionTableTip";
import { PageHeader } from "../../Layout/PageHeader";
import { DataTablePagination } from "../../common/DataTablePagination";
import { UrlIngestionDialog } from "../../common/UrlIngestionDialog";
import "../Users/usersPage.css";
import "./jobsPage.css";

// type JobTab = "regular" | "aiid";

type MetricAccent = "blue" | "green" | "amber" | "red" | "slate";

type Metric = {
  key: string;
  label: string;
  value: string;
  accent: MetricAccent;
  Icon: LucideIcon;
};

const TERMINAL_JOB_STATUSES = new Set(["done", "completed", "error", "skipped"]);
const SLOW_JOB_MS = 2 * 60 * 1000;

type JobRow = {
  id: number;
  url: string;
  status: string;
  jobType: string;
  source: string;
  sourceKey: string;
  tries: string;
  executionTime: string;
  executionMs: number | null;
  llmDurationMs: number | null;
  wordCount: number | null;
  slowReasons: string[];
  executed: string;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  riskFetchedAt: string;
  errorMessage: string;
  doNotExecute: boolean;
  assignedModelName: string;
  assignedModelLabel: string;
  batchName: string;
  modelName: string;
  modelLabel: string;
};

function resolveJobStartedAt(
  row: Pick<JobRow, "startedAt" | "createdAt">,
): string {
  return row.startedAt.trim() || row.createdAt.trim();
}

function resolveJobCompletedAt(
  row: Pick<JobRow, "status" | "updatedAt" | "riskFetchedAt">,
): string {
  const status = row.status.toLowerCase();
  if (status === "done" || status === "completed") {
    return row.riskFetchedAt || row.updatedAt;
  }
  if (status === "error" || status === "failed" || status === "skipped") {
    return row.updatedAt;
  }
  return "";
}

function formatJobExecutedDisplay(
  row: Pick<
    JobRow,
    "status" | "startedAt" | "createdAt" | "updatedAt" | "riskFetchedAt"
  >,
): string {
  const status = row.status.toLowerCase();
  if (status === "running") {
    return formatJobExecutedAt(resolveJobStartedAt(row));
  }
  const completedAt = resolveJobCompletedAt(row);
  if (TERMINAL_JOB_STATUSES.has(status) && completedAt) {
    return formatJobExecutedAt(completedAt);
  }
  if (status === "pending") {
    return "—";
  }
  return "—";
}

function jobExecutionMs(
  row: Pick<
    JobRow,
    | "status"
    | "startedAt"
    | "createdAt"
    | "updatedAt"
    | "riskFetchedAt"
    | "llmDurationMs"
  >,
): number | null {
  const status = row.status.toLowerCase();
  const startedAt = row.startedAt.trim();

  if (status === "running") {
    const start = startedAt || row.createdAt.trim();
    const startedMs = new Date(start).getTime();
    if (Number.isNaN(startedMs)) return null;
    return Math.max(0, Date.now() - startedMs);
  }

  if (!TERMINAL_JOB_STATUSES.has(status) && status !== "failed") return null;

  if (startedAt) {
    const startedMs = new Date(startedAt).getTime();
    const completedAt = resolveJobCompletedAt(row);
    const completedMs = new Date(completedAt).getTime();
    if (!Number.isNaN(startedMs) && !Number.isNaN(completedMs)) {
      const elapsed = Math.max(0, completedMs - startedMs);
      if (elapsed > 0) return elapsed;
    }
  }

  if (row.llmDurationMs != null && row.llmDurationMs > 0) {
    return row.llmDurationMs;
  }

  if (!startedAt) return null;
  return 0;
}

const JOB_TIMEOUT_SKIP_MS = 5 * 60 * 1000;
const JOB_TIMEOUT_SKIP_REASON =
  "Skipped because this URL took more than 5 minutes without finishing — it was taking too long.";
const DO_NOT_EXECUTE_DISPLAY_REASON =
  "This URL is marked do not execute. The LLM will not run for it.";

function jobIsDoNotExecute(
  row: Pick<JobRow, "doNotExecute" | "errorMessage">,
): boolean {
  return row.doNotExecute || /do not execute/i.test(row.errorMessage);
}

function buildSlowJobReasons(
  row: Pick<
    JobRow,
    | "status"
    | "tries"
    | "errorMessage"
    | "executionMs"
    | "llmDurationMs"
    | "wordCount"
    | "doNotExecute"
  >,
): string[] {
  const status = row.status.toLowerCase();
  const error = row.errorMessage.trim();

  if (status === "skipped" && /took more than 5 minutes/i.test(error)) {
    return [error];
  }

  if (
    status === "running" &&
    row.executionMs != null &&
    row.executionMs >= JOB_TIMEOUT_SKIP_MS
  ) {
    return [JOB_TIMEOUT_SKIP_REASON];
  }

  if (row.executionMs == null || row.executionMs <= SLOW_JOB_MS) return [];

  const points: string[] = [];
  const tries = Number(row.tries);
  const total = formatDurationMs(row.executionMs);

  points.push(
    `Total run time is ${total}, which is over the 2-minute threshold.`,
  );

  if (status === "running") {
    points.push(
      "The worker is still fetching the page or waiting for LLM extraction to finish.",
    );
    return points;
  }

  if (row.llmDurationMs != null && row.llmDurationMs > 0) {
    points.push(
      `LLM risk extraction took ${formatDurationMs(row.llmDurationMs)}.`,
    );
    const otherMs = row.executionMs - row.llmDurationMs;
    if (otherMs >= 30_000) {
      points.push(
        `Page fetch and ingest took about ${formatDurationMs(otherMs)}.`,
      );
    }
  } else if (status === "done") {
    points.push(
      "Most of the extra time is from LLM extraction, catalog matching, and embeddings.",
    );
  }

  if (row.wordCount != null && row.wordCount >= 2500) {
    points.push(
      `The article is long (${row.wordCount.toLocaleString()} words), so the model has more text to process.`,
    );
  }

  if (Number.isFinite(tries) && tries > 1) {
    points.push(
      `This job ran ${tries} times, and each retry repeats ingest and extraction.`,
    );
  }

  if (status === "error") {
    if (/timeout/i.test(error)) {
      points.push(
        "The source site timed out. Ingest waits up to 2 minutes for a response.",
      );
    } else if (/fetch|reach|dns|ssl|firewall|did not respond/i.test(error)) {
      points.push(
        "Fetching the article was slow or blocked (DNS, SSL, firewall, or the site).",
      );
    } else if (error) {
      points.push(`It then failed: ${formatJobIssueMessage(error)}`);
    } else {
      points.push("The job failed after this long run.");
    }
  }

  if (status === "skipped" && error) {
    points.push(`It was skipped because: ${error}`);
  }

  return points;
}

type JobMetrics = {
  total: number;
  successRate: number;
  pending: number;
  failed: number;
  running: number;
  completed24h: number;
  avgProcessingSeconds: number;
  skipped: number;
};

function labelize(value: string): string {
  return value.replace(/_/g, " ").toUpperCase();
}

/** Map deprecated API statuses to current labels for display and filters. */
function normalizeJobStatus(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
      return "done";
    case "failed":
      return "error";
    default:
      return status;
  }
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSourceLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "rss") return "RSS";
  if (normalized === "etl_reports" || normalized === "api") return "ETL Reports";
  return capitalize(value);
}

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case "pending":
      return "jobsPage__badge jobsPage__badge--ingest";
    case "running":
      return "jobsPage__badge jobsPage__badge--ingest";
    case "done":
      return "jobsPage__badge jobsPage__badge--ingest";
    case "error":
      return "jobsPage__badge jobsPage__badge--skipped";
    case "skipped":
      return "jobsPage__badge jobsPage__badge--skipped";
    default:
      return "jobsPage__badge jobsPage__badge--skipped";
  }
}

function typeBadgeClass(jobType: string): string {
  return jobType.toLowerCase() === "ingest"
    ? "jobsPage__badge jobsPage__badge--ingest"
    : "jobsPage__badge jobsPage__badge--skipped";
}

function buildMetrics(m: JobMetrics): Metric[] {
  return [
    { key: "total", label: "TOTAL JOBS", value: String(m.total), accent: "blue", Icon: ListChecks },
    { key: "success", label: "SUCCESS RATE", value: `${m.successRate}%`, accent: "green", Icon: CheckCircle2 },
    { key: "pending", label: "PENDING QUEUE", value: String(m.pending), accent: "amber", Icon: Clock },
    { key: "failed", label: "FAILED JOBS", value: String(m.failed), accent: "red", Icon: XCircle },
    { key: "running", label: "RUNNING NOW", value: String(m.running), accent: "slate", Icon: Zap },
    { key: "completed24h", label: "24H COMPLETED", value: String(m.completed24h), accent: "slate", Icon: Activity },
    {
      key: "avgProc",
      label: "AVG PROCESSING",
      value: m.avgProcessingSeconds > 0 ? `${m.avgProcessingSeconds}s` : "0s",
      accent: "slate",
      Icon: Timer,
    },
    { key: "skipped", label: "SKIPPED", value: String(m.skipped), accent: "slate", Icon: SkipForward },
  ];
}

type StatusHelpItem = { status: string; description: string };

const JOB_STATUS_HELP_BY_KEY: Record<string, StatusHelpItem> = {
  pending: {
    status: "Pending",
    description: "Queued and waiting for the worker to pick it up.",
  },
  running: {
    status: "Running",
    description: "The worker is actively processing this job.",
  },
  done: {
    status: "Done",
    description: "Finished successfully; content was ingested or processed.",
  },
  skipped: {
    status: "Skipped",
    description:
      "Finished without storing content (took more than 5 minutes, duplicate URL, fetch failed, bot protection, not AI-related, or do not execute).",
  },
  error: {
    status: "Error",
    description: "Failed due to an unexpected error; may be retried.",
  },
};

const JOB_STATUS_HELP_ALL: StatusHelpItem[] = [
  JOB_STATUS_HELP_BY_KEY.pending,
  JOB_STATUS_HELP_BY_KEY.running,
  JOB_STATUS_HELP_BY_KEY.done,
  JOB_STATUS_HELP_BY_KEY.skipped,
  JOB_STATUS_HELP_BY_KEY.error,
];

function statusHelpFor(displayStatus: string): StatusHelpItem | undefined {
  return JOB_STATUS_HELP_BY_KEY[displayStatus.toLowerCase().trim()];
}

function StatusHelpIcon({
  placement = "below",
  status,
}: {
  placement?: "above" | "below";
  status?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const rowHelp = status ? statusHelpFor(status) : undefined;
  const items = rowHelp ? [rowHelp] : JOB_STATUS_HELP_ALL;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const ariaLabel = rowHelp
    ? `What does ${rowHelp.status} mean?`
    : "What do job statuses mean?";

  return (
    <div ref={wrapRef} className="jobsPage__statusHelp">
      <button
        type="button"
        className="jobsPage__statusHelpBtn"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={14} strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={rowHelp ? `${rowHelp.status} definition` : "Job status definitions"}
          className={`jobsPage__statusHelpPanel jobsPage__statusHelpPanel--${placement}${rowHelp ? " jobsPage__statusHelpPanel--single" : ""}`}
        >
          <p className="jobsPage__statusHelpTitle">
            {rowHelp ? rowHelp.status : "Job statuses"}
          </p>
          <ul className="jobsPage__statusHelpList">
            {items.map((item) => (
              <li key={item.status}>
                {!rowHelp ? (
                  <span className="jobsPage__statusHelpTerm">{item.status}</span>
                ) : null}
                <span className="jobsPage__statusHelpDesc">{item.description}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const JOB_ISSUE_DEFAULT_MESSAGE: Record<string, string> = {
  skipped:
    "This job finished without storing content or risks. No detailed reason was recorded.",
  error: "This job failed with an unexpected error. No detailed reason was recorded.",
};

function jobHasIssueInfo(status: string): boolean {
  const s = status.toLowerCase();
  return s === "skipped" || s === "error";
}

/** Normalize legacy fetch/network skip reasons for the info panel. */
function formatJobIssueMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;

  if (trimmed === "Do not execute" || /do not execute/i.test(trimmed)) {
    return DO_NOT_EXECUTE_DISPLAY_REASON;
  }

  if (/took more than 5 minutes/i.test(trimmed)) {
    return trimmed;
  }

  if (
    trimmed.includes("blocked automated access") ||
    trimmed.startsWith("Cannot resolve hostname") ||
    trimmed.startsWith("Could not reach the site") ||
    trimmed.startsWith("Could not fetch this URL") ||
    trimmed.startsWith("Connection ") ||
    trimmed.startsWith("The site did not respond") ||
    trimmed.startsWith("The site returned an error") ||
    trimmed.startsWith("SSL/TLS") ||
    trimmed.startsWith("Temporary DNS")
  ) {
    return trimmed;
  }

  if (trimmed.startsWith("timeout")) {
    return "The site did not respond in time (connection timed out).";
  }

  if (/^fetch failed:\s*network error:\s*fetch failed$/i.test(trimmed)) {
    return "Could not reach the site — connection failed (DNS, SSL, firewall, or the server may be down).";
  }

  if (trimmed.startsWith("fetch failed:")) {
    return formatJobIssueMessage(trimmed.slice("fetch failed:".length).trim());
  }

  if (trimmed.startsWith("network error:")) {
    const detail = trimmed.slice("network error:".length).trim();
    if (!detail || detail.toLowerCase() === "fetch failed") {
      return "Could not reach the site — connection failed (DNS, SSL, firewall, or the server may be down).";
    }
    return `Could not reach the site — ${detail}`;
  }

  return trimmed;
}

function useJobsTableTip(
  open: boolean,
  wrapRef: RefObject<HTMLDivElement | null>,
  estimatedWidth: number,
) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({
    top: 0,
    left: 0,
    maxWidth: estimatedWidth,
    maxHeight: 240,
  });

  const updatePos = useCallback(() => {
    const trigger = wrapRef.current;
    if (!trigger) return;
    setPos(
      positionTableTip({
        trigger,
        panel: panelRef.current,
        estimatedWidth,
      }),
    );
  }, [estimatedWidth, wrapRef]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const frame = window.requestAnimationFrame(updatePos);
    return () => window.cancelAnimationFrame(frame);
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const scrollRoot = wrapRef.current?.closest(".jobsPage__tableScroll");
    const onMove = () => updatePos();
    scrollRoot?.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      scrollRoot?.removeEventListener("scroll", onMove);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, updatePos, wrapRef]);

  return { panelRef, pos };
}

function JobSlowReasonIcon({
  jobId,
  executionTime,
  reasons,
}: {
  jobId: number;
  executionTime: string;
  reasons: string[];
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { panelRef, pos } = useJobsTableTip(open, wrapRef, 352);
  const closeTimer = useRef(0);
  const isSkipReason = reasons.some((reason) =>
    /took more than 5 minutes|do not execute/i.test(reason),
  );

  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      if (pinned) return;
      setOpen(false);
    }, 120);
  }, [cancelClose, pinned]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
      setPinned(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, panelRef]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  if (reasons.length === 0) {
    return (
      <span className="jobsPage__infoEmpty" aria-hidden>
        —
      </span>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="jobsPage__errorInfo"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={`jobsPage__errorInfoBtn jobsPage__slowReasonBtn${open ? " jobsPage__errorInfoBtn--open" : ""}`}
        aria-label={`Why job #${jobId} took ${executionTime}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (pinned) {
            setPinned(false);
            setOpen(false);
            return;
          }
          setPinned(true);
          setOpen(true);
        }}
      >
        <Timer size={16} strokeWidth={2} aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="tooltip"
              className="jobsPage__errorInfoPanel jobsPage__errorInfoPanel--portal"
              style={{
                top: pos.top,
                left: pos.left,
                maxWidth: pos.maxWidth,
                maxHeight: pos.maxHeight,
              }}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              <p className="jobsPage__errorInfoTitle">
                {isSkipReason ? "Why this URL was skipped" : "Why this run was slow"}
              </p>
              <p className="jobsPage__errorInfoMeta">
                Job #{jobId} · {executionTime}
              </p>
              <ul className="jobsPage__slowReasons">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function JobErrorInfoIcon({
  jobId,
  status,
  message,
}: {
  jobId: number;
  status: string;
  message: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { panelRef, pos } = useJobsTableTip(open, wrapRef, 352);
  const statusKey = status.toLowerCase();
  const hasIssue = jobHasIssueInfo(status);
  const body =
    formatJobIssueMessage(message) ||
    (hasIssue ? JOB_ISSUE_DEFAULT_MESSAGE[statusKey] ?? "" : "");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, panelRef]);

  if (!hasIssue) {
    return <span className="jobsPage__infoEmpty" aria-hidden="true">—</span>;
  }

  const toneClass =
    statusKey === "error" ? " jobsPage__errorInfoBtn--failed" : "";

  return (
    <div ref={wrapRef} className="jobsPage__errorInfo">
      <button
        type="button"
        className={`jobsPage__errorInfoBtn${toneClass}${open ? " jobsPage__errorInfoBtn--open" : ""}`}
        aria-label={`Why job #${jobId} was not fully processed`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleAlert size={16} strokeWidth={2} aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label={`Job #${jobId} processing details`}
              className="jobsPage__errorInfoPanel jobsPage__errorInfoPanel--portal"
              style={{
                top: pos.top,
                left: pos.left,
                maxWidth: pos.maxWidth,
                maxHeight: pos.maxHeight,
              }}
            >
              <p className="jobsPage__errorInfoTitle">Why this URL was not processed</p>
              <p className="jobsPage__errorInfoMeta">
                Job #{jobId} · {status}
              </p>
              <p className="jobsPage__errorInfoBody">{body}</p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function JobModelInfoIcon({
  jobId,
  modelLabel,
}: {
  jobId: number;
  modelLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { panelRef, pos } = useJobsTableTip(open, wrapRef, 280);

  if (!modelLabel.trim()) return null;

  return (
    <div
      ref={wrapRef}
      className="jobsPage__statusHelp"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="jobsPage__statusHelpBtn"
        aria-label={`Model for job #${jobId}: ${modelLabel}`}
        aria-expanded={open}
        aria-controls={panelId}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Info size={14} strokeWidth={2} aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="tooltip"
              className="jobsPage__errorInfoPanel jobsPage__errorInfoPanel--portal jobsPage__modelTipPanel"
              style={{
                top: pos.top,
                left: pos.left,
                maxWidth: pos.maxWidth,
                maxHeight: pos.maxHeight,
              }}
            >
              <p className="jobsPage__errorInfoTitle">Model</p>
              <p className="jobsPage__errorInfoBody">{modelLabel}</p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const EMPTY_METRICS: JobMetrics = {
  total: 0,
  successRate: 0,
  pending: 0,
  failed: 0,
  running: 0,
  completed24h: 0,
  avgProcessingSeconds: 0,
  skipped: 0,
};

type JobPagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

const EMPTY_PAGINATION: JobPagination = {
  page: 0,
  pageSize: 100,
  total: 0,
  pageCount: 1,
};

function normalizeJobsFromApi(raw: unknown): {
  jobs: JobRow[];
  metrics: JobMetrics;
  pagination: JobPagination;
} {
  const data = raw as {
    jobs?: Array<{
      id?: number;
      url?: string;
      status?: string;
      jobType?: string;
      source?: string;
      tries?: number;
      errorMessage?: string | null;
      createdAt?: string;
      startedAt?: string | null;
      updatedAt?: string;
      riskFetchedAt?: string | null;
      llmDurationMs?: number | null;
      wordCount?: number | null;
      doNotExecute?: boolean;
      assignedModelName?: string | null;
      assignedModelLabel?: string | null;
      batchRunId?: number | null;
      batchName?: string | null;
      modelName?: string | null;
      modelLabel?: string | null;
    }>;
    metrics?: Partial<JobMetrics>;
    pagination?: {
      page?: number;
      pageSize?: number;
      total?: number;
      pageCount?: number;
    };
  };

  const jobs: JobRow[] = (data.jobs ?? []).map((j) => {
    const status = labelize(normalizeJobStatus(j.status ?? ""));
    const updatedAt = j.updatedAt ?? "";
    const row: JobRow = {
      id: j.id ?? 0,
      url: j.url ?? "",
      status,
      jobType: labelize(j.jobType ?? ""),
      sourceKey: (j.source ?? "").trim().toLowerCase(),
      source: formatSourceLabel(j.source ?? ""),
      tries: String(j.tries ?? 0),
      executionTime: "—",
      executionMs: null,
      llmDurationMs:
        typeof j.llmDurationMs === "number" ? j.llmDurationMs : null,
      wordCount: typeof j.wordCount === "number" ? j.wordCount : null,
      slowReasons: [],
      createdAt: j.createdAt ?? "",
      startedAt: j.startedAt ?? "",
      updatedAt,
      riskFetchedAt: j.riskFetchedAt ?? "",
      executed: "—",
      errorMessage: (j.errorMessage ?? "").trim(),
      doNotExecute: Boolean(j.doNotExecute),
      assignedModelName: (j.assignedModelName ?? j.modelName ?? "").trim(),
      assignedModelLabel: (
        j.assignedModelLabel ??
        j.assignedModelName ??
        j.modelLabel ??
        j.modelName ??
        ""
      ).trim(),
      batchName:
        (j.batchName ?? "").trim() ||
        (typeof j.batchRunId === "number" ? `Batch #${j.batchRunId}` : "-"),
      modelName: (j.modelName ?? "").trim(),
      modelLabel: (j.modelLabel ?? j.modelName ?? "").trim(),
    };
    row.executed = formatJobExecutedDisplay(row);
    row.executionMs = jobExecutionMs(row);
    row.executionTime = formatDurationMs(row.executionMs);
    row.slowReasons = buildSlowJobReasons(row);
    return row;
  });

  const page = data.pagination?.page ?? 0;
  const pageSize = data.pagination?.pageSize ?? 100;
  const filteredTotal = data.pagination?.total ?? jobs.length;
  return {
    jobs,
    metrics: {
      total: data.metrics?.total ?? jobs.length,
      successRate: data.metrics?.successRate ?? 0,
      pending: data.metrics?.pending ?? 0,
      failed: data.metrics?.failed ?? 0,
      running: data.metrics?.running ?? 0,
      completed24h: data.metrics?.completed24h ?? 0,
      avgProcessingSeconds: data.metrics?.avgProcessingSeconds ?? 0,
      skipped: data.metrics?.skipped ?? 0,
    },
    pagination: {
      page,
      pageSize,
      total: filteredTotal,
      pageCount:
        data.pagination?.pageCount ??
        Math.max(1, Math.ceil(filteredTotal / pageSize)),
    },
  };
}

export function JobsPage() {
  const baseId = useId();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // const [tab, setTab] = useState<JobTab>("regular");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [source, setSource] = useState("all");
  const [execution, setExecution] = useState("all");
  // const [importType, setImportType] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [jobPage, setJobPage] = useState(0);
  const [jobPageSize, setJobPageSize] = useState(100);
  const [jobPagination, setJobPagination] = useState<JobPagination>(EMPTY_PAGINATION);
  const [refreshing, setRefreshing] = useState(false);
  const [enqueueOpen, setEnqueueOpen] = useState(false);
  const [rowMenuOpenId, setRowMenuOpenId] = useState<number | null>(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [blockTarget, setBlockTarget] = useState<JobRow | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [executeTarget, setExecuteTarget] = useState<JobRow | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executeMode, setExecuteMode] = useState<"assigned" | "other">("assigned");
  const [rows, setRows] = useState<JobRow[]>([]);
  const [metrics, setMetrics] = useState<JobMetrics>(EMPTY_METRICS);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "idle",
  );

  const focusJobId = Number.parseInt(searchParams.get("job") ?? "", 10);
  const highlightedJobId =
    Number.isFinite(focusJobId) && focusJobId >= 1 ? focusJobId : null;

  useEffect(() => {
    const jobParam = searchParams.get("job")?.trim() ?? "";
    const searchParam = searchParams.get("search")?.trim() ?? "";
    const nextSearch = jobParam || searchParam;
    if (!nextSearch) return;
    setSearchQuery(nextSearch);
    setDebouncedSearch(nextSearch);
    setJobPage(0);
  }, [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setJobPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const loadJobs = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      setRows([]);
      setLoadState("idle");
      return;
    }

    if (!silent) {
      setLoadState("loading");
    }
    try {
      const params = new URLSearchParams({
        page: String(jobPage),
        pageSize: String(jobPageSize),
        status,
        type,
        source,
        execution,
      });
      const q = debouncedSearch.trim();
      if (q) params.set("search", q);

      const res = await authFetch(`/jobs?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (res.status === 401) {
        setLoadState("idle");
        return;
      }
      if (!res.ok) {
        if (!silent) {
          setLoadState("error");
          toast.error(data.error?.message ?? "Could not load jobs.", {
            autoClose: 3000,
          });
        }
        return;
      }
      const parsed = normalizeJobsFromApi(data);
      setRows(parsed.jobs);
      setMetrics(parsed.metrics);
      setJobPagination(parsed.pagination);
      if (jobPage > parsed.pagination.pageCount - 1) {
        setJobPage(Math.max(0, parsed.pagination.pageCount - 1));
      }
      setLoadState("idle");
    } catch {
      if (!silent) {
        setLoadState("error");
        toast.error("Network error while loading jobs.", { autoClose: 3000 });
      }
    }
  }, [jobPage, jobPageSize, status, type, source, execution, debouncedSearch]);

  useEffect(() => {
    setDocumentPageTitle("Jobs");
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const hasActiveJobs = metrics.pending > 0 || metrics.running > 0;
  const pollIntervalMs = hasActiveJobs ? 3_000 : 10_000;

  usePolling(() => loadJobs({ silent: true }), pollIntervalMs, true);

  const closeRowMenu = useCallback(() => {
    setRowMenuOpenId(null);
    setRowMenuAnchor(null);
  }, []);

  useEffect(() => {
    if (rowMenuOpenId == null) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-jobs-row-menu]")) return;
      closeRowMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRowMenu();
    };
    const onScroll = () => closeRowMenu();
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [rowMenuOpenId, closeRowMenu]);

  const displayMetrics = useMemo(() => buildMetrics(metrics), [metrics]);

  const pagerFrom =
    jobPagination.total === 0 ? 0 : jobPage * jobPageSize + 1;
  const pagerTo = Math.min((jobPage + 1) * jobPageSize, jobPagination.total);

  const rowMenuJob = useMemo(
    () =>
      rowMenuOpenId == null
        ? null
        : (rows.find((r) => r.id === rowMenuOpenId) ?? null),
    [rowMenuOpenId, rows],
  );

  useEffect(() => {
    closeRowMenu();
  }, [jobPage, closeRowMenu]);

  useEffect(() => {
    if (rowMenuOpenId != null && rowMenuJob == null) closeRowMenu();
  }, [rowMenuOpenId, rowMenuJob, closeRowMenu]);

  useEffect(() => {
    if (!executeTarget) return;
    setExecuteMode("assigned");
  }, [executeTarget]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadJobs();
    setRefreshing(false);
    toast.success("Job stats refreshed.", { autoClose: 2000 });
  }, [loadJobs]);

  const handleRetryJob = useCallback(
    async (jobId: number) => {
      try {
        const res = await authFetch(`/jobs/${jobId}/retry`, { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: { message?: string };
        };
        if (!res.ok) {
          toast.error(data.error?.message ?? "Could not retry job.", {
            autoClose: 3500,
          });
          return;
        }
        toast.success(data.message ?? "Job requeued.", { autoClose: 2500 });
        await loadJobs();
      } catch {
        toast.error("Network error while retrying job.", { autoClose: 3000 });
      }
    },
    [loadJobs],
  );

  const handleDeleteJob = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/jobs/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.error(
          readApiErrorMessage(data, "Could not delete this job."),
          { autoClose: 3500 },
        );
        return;
      }
      setDeleteTarget(null);
      toast.success(data.message ?? "Job deleted.", { autoClose: 2500 });
      await loadJobs();
    } catch {
      toast.error("Network error while deleting job.", { autoClose: 3000 });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting, loadJobs]);

  const handleMarkDoNotExecute = useCallback(
    async (target: JobRow | null) => {
      if (!target || blocking) return;
      setBlocking(true);
      try {
        const res = await authFetch(`/jobs/${target.id}/do-not-execute`, {
          method: "POST",
        });
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: { message?: string };
        };
        if (!res.ok) {
          toast.error(
            readApiErrorMessage(data, "Could not mark this URL as do not execute."),
            { autoClose: 3500 },
          );
          return;
        }
        setBlockTarget(null);
        setDeleteTarget(null);
        toast.success(
          data.message ??
            "This URL is marked do not execute. The LLM will not run for it.",
          { autoClose: 3000 },
        );
        await loadJobs();
      } catch {
        toast.error("Network error while marking this URL.", { autoClose: 3000 });
      } finally {
        setBlocking(false);
      }
    },
    [blocking, loadJobs],
  );

  const handleExecuteJob = useCallback(async () => {
    if (!executeTarget || executing) return;

    if (executeMode === "other") {
      const pending = {
        jobId: executeTarget.id,
        url: executeTarget.url,
      };
      setPendingUrlExecute(pending);
      setExecuteTarget(null);
      toast.info("Test and apply a model to run this URL.", {
        autoClose: 3500,
      });
      navigate(
        {
          pathname: "/controls",
          search: `?${EXECUTE_JOB_SEARCH_PARAM}=${pending.jobId}`,
          hash: "llm-model",
        },
        { state: { pendingUrlExecute: pending } },
      );
      return;
    }

    setExecuting(true);
    try {
      const result = await executeJob({ jobId: executeTarget.id });
      if (!result.ok) {
        toast.error(result.message, { autoClose: 3500 });
        return;
      }
      setExecuteTarget(null);
      toast.success(
        result.message ?? "This URL is running.",
        { autoClose: 3000 },
      );
      await loadJobs();
    } finally {
      setExecuting(false);
    }
  }, [executeTarget, executing, executeMode, loadJobs, navigate]);

  const clearFilters = () => {
    setStatus("all");
    setType("all");
    setSource("all");
    setExecution("all");
    setSearchQuery("");
    setDebouncedSearch("");
    setJobPage(0);
    if (searchParams.has("job") || searchParams.has("search")) {
      const next = new URLSearchParams(searchParams);
      next.delete("job");
      next.delete("search");
      setSearchParams(next, { replace: true });
    }
  };

  // const resetAiidImport = () => {
  //   setImportType("");
  // };

  const filterId = (name: string) => `${baseId}-${name}`;

  return (
    <main className="mainLayout__content jobsPage">
      <PageHeader
        title="Jobs"
        subtitle="Monitor and manage crawler jobs"
        actions={
          <>
            <button
              type="button"
              className="usersPage__inviteBtn"
              onClick={() => setEnqueueOpen(true)}
            >
              <Plus size={18} strokeWidth={2} aria-hidden />
              Enqueue
            </button>
            <button
              type="button"
              className="usersPage__inviteBtn"
              onClick={() => void handleRefresh()}
              disabled={refreshing || loadState === "loading"}
              aria-busy={refreshing || loadState === "loading"}
            >
              <RefreshCw
                size={18}
                strokeWidth={2}
                className={refreshing ? "pageHeader__refreshIcon--spin" : undefined}
                aria-hidden
              />
              Refresh
            </button>
          </>
        }
      />

      <UrlIngestionDialog
        variant="jobs"
        open={enqueueOpen}
        onClose={() => setEnqueueOpen(false)}
        onEnqueued={() => void loadJobs()}
      />

      {deleteTarget ? (
        <div
          className="jobsPage__enqueueOverlay"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget && !deleting && !blocking)
              setDeleteTarget(null);
          }}
        >
          <div
            className="jobsPage__enqueueDialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${baseId}-delete-title`}
            aria-describedby={`${baseId}-delete-desc`}
          >
            <div className="jobsPage__enqueueDialogHead">
              <h2 id={`${baseId}-delete-title`} className="jobsPage__enqueueDialogTitle">
                Delete job #{deleteTarget.id}?
              </h2>
            </div>
            <div className="jobsPage__enqueueDialogBody">
              <p id={`${baseId}-delete-desc`} className="jobsPage__deleteConfirmText">
                This removes the job from the queue. The article and any extracted
                risks are not deleted. Use Do not execute to skip the LLM for this
                URL from now on.
              </p>
            </div>
            <div className="jobsPage__enqueueDialogActions">
              <button
                type="button"
                className="jobsPage__enqueueBtn jobsPage__enqueueBtn--cancel"
                disabled={deleting || blocking}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              {deleteTarget.doNotExecute ? null : (
                <button
                  type="button"
                  className="jobsPage__enqueueBtn jobsPage__blockConfirmBtn"
                  disabled={deleting || blocking}
                  aria-busy={blocking}
                  onClick={() => void handleMarkDoNotExecute(deleteTarget)}
                >
                  {blocking ? "Saving…" : "Do not execute"}
                </button>
              )}
              <button
                type="button"
                className="jobsPage__enqueueBtn jobsPage__deleteConfirmBtn"
                disabled={deleting || blocking}
                aria-busy={deleting}
                onClick={() => void handleDeleteJob()}
              >
                {deleting ? "Deleting…" : "Delete job"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {blockTarget ? (
        <div
          className="jobsPage__enqueueOverlay"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget && !blocking) setBlockTarget(null);
          }}
        >
          <div
            className="jobsPage__enqueueDialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${baseId}-block-title`}
            aria-describedby={`${baseId}-block-desc`}
          >
            <div className="jobsPage__enqueueDialogHead">
              <h2 id={`${baseId}-block-title`} className="jobsPage__enqueueDialogTitle">
                Do not execute this URL?
              </h2>
            </div>
            <div className="jobsPage__enqueueDialogBody">
              <p id={`${baseId}-block-desc`} className="jobsPage__deleteConfirmText">
                The LLM will not run for this URL. Pending and running jobs for it
                will be skipped. The job row stays in the list.
              </p>
            </div>
            <div className="jobsPage__enqueueDialogActions">
              <button
                type="button"
                className="jobsPage__enqueueBtn jobsPage__enqueueBtn--cancel"
                disabled={blocking}
                onClick={() => setBlockTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="jobsPage__enqueueBtn jobsPage__blockConfirmBtn"
                disabled={blocking}
                aria-busy={blocking}
                onClick={() => void handleMarkDoNotExecute(blockTarget)}
              >
                {blocking ? "Saving…" : "Do not execute"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {executeTarget ? (
        <div
          className="jobsPage__enqueueOverlay"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget && !executing)
              setExecuteTarget(null);
          }}
        >
          <div
            className="jobsPage__enqueueDialog jobsPage__enqueueDialog--execute"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${baseId}-execute-title`}
            aria-describedby={`${baseId}-execute-desc`}
          >
            <div className="jobsPage__enqueueDialogHead">
              <h2
                id={`${baseId}-execute-title`}
                className="jobsPage__enqueueDialogTitle"
              >
                Execute this URL?
              </h2>
              <button
                type="button"
                className="jobsPage__enqueueDialogClose"
                disabled={executing}
                onClick={() => setExecuteTarget(null)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div className="jobsPage__enqueueDialogBody">
              <p id={`${baseId}-execute-desc`} className="jobsPage__deleteConfirmText">
                This URL is marked do not execute. Running it removes the block
                and queues the job again.
              </p>
              <p className="jobsPage__executeUrl" title={executeTarget.url}>
                {executeTarget.url}
              </p>
              <fieldset className="jobsPage__executeChoices" disabled={executing}>
                <legend className="jobsPage__enqueueLabel">How should it run?</legend>
                <label
                  className={`jobsPage__executeCard${
                    executeMode === "assigned" ? " jobsPage__executeCard--selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    className="jobsPage__executeCardInput"
                    name={`${baseId}-execute-model`}
                    checked={executeMode === "assigned"}
                    onChange={() => setExecuteMode("assigned")}
                  />
                  <span className="jobsPage__executeCardIcon" aria-hidden>
                    <Play size={16} strokeWidth={2} />
                  </span>
                  <span className="jobsPage__executeCardCopy">
                    <span className="jobsPage__executeCardTitle">
                      Assigned model
                    </span>
                    <span className="jobsPage__executeCardHint">
                      {executeTarget.assignedModelLabel ||
                        executeTarget.assignedModelName ||
                        executeTarget.modelLabel ||
                        "the model assigned when this URL was blocked"}
                    </span>
                  </span>
                </label>
                <label
                  className={`jobsPage__executeCard${
                    executeMode === "other" ? " jobsPage__executeCard--selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    className="jobsPage__executeCardInput"
                    name={`${baseId}-execute-model`}
                    checked={executeMode === "other"}
                    onChange={() => setExecuteMode("other")}
                  />
                  <span className="jobsPage__executeCardIcon" aria-hidden>
                    <Settings2 size={16} strokeWidth={2} />
                  </span>
                  <span className="jobsPage__executeCardCopy">
                    <span className="jobsPage__executeCardTitle">
                      Different model
                    </span>
                    <span className="jobsPage__executeCardHint">
                      Test and apply a model, then this URL starts running.
                    </span>
                  </span>
                </label>
              </fieldset>
            </div>
            <div className="jobsPage__enqueueDialogActions">
              <button
                type="button"
                className="jobsPage__enqueueBtn jobsPage__enqueueBtn--cancel"
                disabled={executing}
                onClick={() => setExecuteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="jobsPage__enqueueBtn jobsPage__blockConfirmBtn"
                disabled={executing}
                aria-busy={executing}
                onClick={() => void handleExecuteJob()}
              >
                {executing ? "Starting…" : "Execute"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* <div className="usersPage__tabs" role="tablist" aria-label="Job type">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "regular"}
          className={`usersPage__tab${tab === "regular" ? " usersPage__tab--selected" : ""}`}
          onClick={() => setTab("regular")}
        >
          Regular Jobs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "aiid"}
          className={`usersPage__tab${tab === "aiid" ? " usersPage__tab--selected" : ""}`}
          onClick={() => setTab("aiid")}
        >
          AIID Jobs
        </button>
      </div> */}

      <div className="jobsPage__grid">
        {displayMetrics.map((m) => (
          <article key={m.key} className="jobsPage__card">
            <div className={`jobsPage__cardIcon jobsPage__cardIcon--${m.accent}`}>
              <m.Icon size={22} strokeWidth={2} aria-hidden />
            </div>
            <div className="jobsPage__cardBody">
              <p className="jobsPage__cardLabel">{m.label}</p>
              <p className="jobsPage__cardValue">{m.value}</p>
            </div>
          </article>
        ))}
      </div>

      {/* {tab === "aiid" ? (
        <section className="jobsPage__import" aria-labelledby={`${baseId}-import-title`}>
          <h2 id={`${baseId}-import-title`} className="jobsPage__importTitle">
            + Import AIID Jobs
          </h2>
          <div className="jobsPage__importRow">
            <div className="jobsPage__importField">
              <label htmlFor={filterId("import-type")}>Import Type</label>
              <select
                id={filterId("import-type")}
                value={importType}
                onChange={(e) => setImportType(e.target.value)}
              >
                <option value="">Select Import type…</option>
                <option value="bulk">Bulk URL file</option>
                <option value="feed">Feed / sitemap</option>
                <option value="manual">Manual list</option>
              </select>
            </div>
            <div className="jobsPage__importActions">
              <button
                type="button"
                className="jobsPage__btnImport"
                onClick={() => {
                  if (!importType) {
                    toast.error("Select an import type.", { autoClose: 2500 });
                    return;
                  }
                  toast.info("AIID import is not connected to the API yet.", {
                    autoClose: 3500,
                  });
                }}
              >
                <Upload size={18} strokeWidth={2} aria-hidden />
                Start Import
              </button>
              <button type="button" className="jobsPage__btnReset" onClick={resetAiidImport}>
                Reset
              </button>
            </div>
          </div>
        </section>
      ) : null} */}

      <section className="jobsPage__filters" aria-label="Filter jobs">
        <div className="jobsPage__filter">
          <label htmlFor={filterId("status")}>STATUS</label>
          <select
            id={filterId("status")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setJobPage(0);
            }}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="done">Done</option>
            <option value="error">Error</option>
            <option value="skipped">Skipped</option>
          </select>
        </div>
        <div className="jobsPage__filter">
          <label htmlFor={filterId("type")}>TYPE</label>
          <select id={filterId("type")} value={type} onChange={(e) => {
            setType(e.target.value);
            setJobPage(0);
          }}>
            <option value="all">All</option>
            <option value="crawler">Crawler</option>
            <option value="indexer">Indexer</option>
            <option value="ingest">Ingest</option>
          </select>
        </div>
        <div className="jobsPage__filter">
          <label htmlFor={filterId("source")}>SOURCE</label>
          <select
            id={filterId("source")}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setJobPage(0);
            }}
          >
            <option value="all">All</option>
            <option value="rss">RSS</option>
            <option value="etl_reports">ETL Reports</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <div className="jobsPage__filter jobsPage__filter--execution">
          <label htmlFor={filterId("execution")}>EXECUTION</label>
          <select
            id={filterId("execution")}
            value={execution}
            onChange={(e) => {
              setExecution(e.target.value);
              setJobPage(0);
            }}
          >
            <option value="all">All</option>
            <option value="do_not_execute">Do not execute</option>
          </select>
        </div>
        <button
          type="button"
          className="jobsPage__clearBtn"
          onClick={clearFilters}
          aria-label="Clear Filter"
          data-tooltip="Clear Filter"
        >
          <FilterX size={18} strokeWidth={2} aria-hidden />
        </button>
        <div className="jobsPage__searchWrap">
          <Search
            className="jobsPage__searchIcon"
            size={18}
            strokeWidth={2}
            aria-hidden
          />
          <input
            id={filterId("search")}
            type="search"
            className="jobsPage__searchInput"
            placeholder="Search URL, ID, status…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            enterKeyHint="search"
            aria-label="Search jobs"
          />
        </div>
      </section>

      <section className="jobsPage__tableSection" aria-label="Job list">
        <div className="jobsPage__tableWrap" aria-busy={loadState === "loading"}>
          {loadState === "loading" && rows.length > 0 ? (
            <p className="jobsPage__loadingHint">Loading jobs…</p>
          ) : null}
          <div className="jobsPage__tableScroll">
            <table className="jobsPage__table">
            <thead>
              <tr>
                <th scope="col" className="jobsPage__th jobsPage__th--left">
                  ID
                </th>
                <th scope="col" className="jobsPage__th jobsPage__th--left">
                  URL
                </th>
                <th scope="col" className="jobsPage__th jobsPage__th--center">
                  STATUS
                </th>
                <th scope="col" className="jobsPage__th jobsPage__th--center">
                  TYPE
                </th>
                <th scope="col" className="jobsPage__th jobsPage__th--left">
                  SOURCE
                </th>
                <th scope="col" className="jobsPage__th jobsPage__th--left">
                  BATCH
                </th>
                <th scope="col" className="jobsPage__th jobsPage__th--left">
                  TRIES
                </th>
                <th
                  scope="col"
                  className="jobsPage__th jobsPage__th--center jobsPage__th--info"
                  aria-label="Processing details"
                >
                  INFO
                </th>
                        <th scope="col" className="jobsPage__th jobsPage__th--left">
                          EXECUTION TIME
                        </th>
                <th
                  scope="col"
                  className="jobsPage__th jobsPage__th--center jobsPage__th--reason"
                  aria-label="Execution time reasons"
                >
                  REASON
                </th>
                <th scope="col" className="jobsPage__th jobsPage__th--left">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {loadState === "loading" && rows.length === 0 ? (
                  <tr>
                    <td className="jobsPage__td jobsPage__emptyCell" colSpan={11}>
                      Loading jobs…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td className="jobsPage__td jobsPage__emptyCell" colSpan={11}>
                      {searchQuery.trim() ||
                      status !== "all" ||
                      type !== "all" ||
                      source !== "all" ||
                      execution !== "all"
                        ? "No jobs match your filters or search."
                        : loadState === "error"
                          ? "Could not load jobs."
                          : "No jobs to display."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className={[
                        jobIsDoNotExecute(row) ? "jobsPage__row--blocked" : "",
                        highlightedJobId === row.id ? "jobsPage__row--focus" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined}
                    >
                      <td className="jobsPage__td">
                        <span className="jobsPage__id">#{row.id}</span>
                      </td>
                      <td className="jobsPage__td jobsPage__td--url">
                        <div className="jobsPage__urlCell">
                          <a
                            href={row.url}
                            className="jobsPage__url"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {row.url}
                          </a>
                        </div>
                      </td>
                      <td className="jobsPage__td jobsPage__td--center jobsPage__td--status">
                        <div className="jobsPage__statusCell">
                          <span className={statusBadgeClass(row.status)}>
                            {row.status}
                          </span>
                          <StatusHelpIcon status={row.status} />
                        </div>
                      </td>
                      <td className="jobsPage__td jobsPage__td--center jobsPage__td--type">
                        <span className={typeBadgeClass(row.jobType)}>
                          {row.jobType}
                        </span>
                      </td>
                      <td className="jobsPage__td jobsPage__td--muted">{row.source}</td>
                      <td className="jobsPage__td jobsPage__td--muted">
                        {row.batchName.trim() && row.batchName !== "-" ? (
                          <div className="jobsPage__batchCell">
                            <span>{row.batchName}</span>
                            <JobModelInfoIcon
                              jobId={row.id}
                              modelLabel={row.modelLabel || row.modelName}
                            />
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="jobsPage__td jobsPage__td--muted">{row.tries}</td>
                      <td className="jobsPage__td jobsPage__td--center jobsPage__td--info">
                        <JobErrorInfoIcon
                          jobId={row.id}
                          status={row.status}
                          message={row.errorMessage}
                        />
                      </td>
                      <td className="jobsPage__td jobsPage__td--muted">
                        <div className="jobsPage__executionCell">
                          <span
                            className={`jobsPage__executionDuration${
                              row.slowReasons.length > 0
                                ? " jobsPage__executionDuration--slow"
                                : ""
                            }`}
                          >
                            {row.executionTime}
                          </span>
                          <span className="jobsPage__executionAt">{row.executed}</span>
                        </div>
                      </td>
                      <td className="jobsPage__td jobsPage__td--center jobsPage__td--reason">
                        <JobSlowReasonIcon
                          jobId={row.id}
                          executionTime={row.executionTime}
                          reasons={row.slowReasons}
                        />
                      </td>
                      <td className="jobsPage__td">
                        <div
                          className="jobsPage__rowMenuWrap"
                          data-jobs-row-menu={row.id}
                        >
                          <button
                            type="button"
                            className="jobsPage__kebabBtn"
                            aria-haspopup="menu"
                            aria-expanded={rowMenuOpenId === row.id}
                            aria-label={`Actions for job #${row.id}`}
                            onClick={(e) => {
                              const btn = e.currentTarget;
                              if (rowMenuOpenId === row.id) {
                                closeRowMenu();
                                return;
                              }
                              const rect = btn.getBoundingClientRect();
                              setRowMenuAnchor({
                                top: rect.bottom,
                                right: rect.right,
                              });
                              setRowMenuOpenId(row.id);
                            }}
                          >
                            <MoreHorizontal size={18} strokeWidth={2} aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
            </tbody>
          </table>
          </div>
          <DataTablePagination
            className="jobsPage__pager"
            page={jobPage}
            pageCount={jobPagination.pageCount}
            total={jobPagination.total}
            pageSize={jobPageSize}
            from={pagerFrom}
            to={pagerTo}
            onPageChange={setJobPage}
            onPageSizeChange={(size) => {
              setJobPageSize(size);
              setJobPage(0);
            }}
          />
        </div>
      </section>

      {rowMenuOpenId && rowMenuAnchor && rowMenuJob
        ? createPortal(
            <div
              className="jobsPage__rowMenu jobsPage__rowMenu--portal"
              role="menu"
              aria-orientation="vertical"
              data-jobs-row-menu={rowMenuOpenId}
              style={{
                top: Math.min(
                  rowMenuAnchor.top + 4,
                  Math.max(
                    8,
                    window.innerHeight - 100 - 8,
                  ),
                ),
                left: rowMenuAnchor.right,
              }}
            >
              {rowMenuJob.doNotExecute ? (
                <button
                  type="button"
                  className="jobsPage__rowMenuItem"
                  role="menuitem"
                  onClick={() => {
                    closeRowMenu();
                    setExecuteTarget(rowMenuJob);
                  }}
                >
                  <Play size={16} strokeWidth={2} aria-hidden />
                  Execute
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="jobsPage__rowMenuItem"
                    role="menuitem"
                    onClick={() => {
                      closeRowMenu();
                      void handleRetryJob(rowMenuJob.id);
                    }}
                  >
                    <RotateCw size={16} strokeWidth={2} aria-hidden />
                    Retry
                  </button>
                  <button
                    type="button"
                    className="jobsPage__rowMenuItem jobsPage__rowMenuItem--danger"
                    role="menuitem"
                    onClick={() => {
                      closeRowMenu();
                      setBlockTarget(rowMenuJob);
                    }}
                  >
                    <Ban size={16} strokeWidth={2} aria-hidden />
                    Do not execute
                  </button>
                </>
              )}
              {/*
              <button
                type="button"
                className="jobsPage__rowMenuItem jobsPage__rowMenuItem--danger"
                role="menuitem"
                onClick={() => {
                  closeRowMenu();
                  setDeleteTarget(rowMenuJob);
                }}
              >
                <Trash2 size={16} strokeWidth={2} aria-hidden />
                Delete
              </button>
              */}
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}
