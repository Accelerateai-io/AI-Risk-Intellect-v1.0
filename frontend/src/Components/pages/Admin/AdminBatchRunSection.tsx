import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Rss,
  Ban,
  Workflow,
  X,
} from "lucide-react";
import {
  disableBatchRun,
  enableBatchRun,
  fetchBatchRun,
  fetchBatchRuns,
  startBatchRun,
  type BatchRun,
  type BatchRunItem,
  type BatchRunItemProcessingStatus,
  type BatchRunCounts,
} from "../../../utils/batchRunsApi";
import {
  fetchDiscoveryLogs,
  type DiscoveryLogRow,
} from "../../../utils/discoveryLogsApi";
import {
  fetchEtlReportUploads,
  type EtlReportRunSelection,
  type EtlReportUploadRow,
} from "../../../utils/etlReportsApi";
import {
  fetchIngestLinks,
  type IngestLinkRow,
} from "../../../utils/ingestLinksApi";
import {
  fetchLlmModelConfig,
  // type LlmModelOption,
} from "../../../utils/llmModelApi";
import { formatJobExecutedAt } from "../../../utils/formatDate";
import { waitForWorkerRunning } from "./adminServices";
import { DiscoveryStartDialog } from "./DiscoveryStartDialog";
// import { LlmModelPicker } from "./LlmModelPicker";
import { ReportsStartDialog } from "./etl/reports/ReportsStartDialog";
import "../Users/usersPage.css";
import "./adminPage.css";

type DiscoverySelection = {
  ingestLinkIds: number[];
  ingestLinkItemIds: number[];
};

type EtlSelection = EtlReportRunSelection;

type AdminBatchRunSectionProps = {
  idPrefix: string;
  busy?: boolean;
  onRunStart?: (sources: { rss: boolean; etl: boolean }) => void;
  onRunEnd?: () => void;
  onServicesChanged?: () => void;
};

function formatBatchUrlSerial(serial: number): string {
  return `B#${serial}`;
}

function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path =
      u.pathname.length > 40 ? `${u.pathname.slice(0, 37)}…` : u.pathname;
    const host = u.hostname.replace(/^www\./, "");
    return path === "/" ? host : `${host}${path}`;
  } catch {
    return url.length > 56 ? `${url.slice(0, 53)}…` : url;
  }
}

function batchStatusClass(status: string, disabled = false): string {
  if (disabled) return "adminPage__statusPill--not-processed";
  switch (status) {
    case "completed":
      return "adminPage__statusPill--done";
    case "partial":
      return "adminPage__statusPill--pending";
    case "failed":
      return "adminPage__statusPill--error";
    case "running":
      return "adminPage__statusPill--running";
    case "pending":
      return "adminPage__statusPill--pending";
    default:
      return "adminPage__statusPill--not-processed";
  }
}

function formatBatchStatusLabel(status: string, disabled = false): string {
  if (disabled) return "Disabled";
  switch (status) {
    case "completed":
      return "Completed";
    case "partial":
      return "Partial";
    case "failed":
      return "Failed";
    case "running":
      return "Processing";
    case "pending":
      return "Queued";
    default:
      return status;
  }
}

function batchStatusTitle(status: string, disabled = false): string {
  if (disabled) {
    return "This batch is disabled. Enable it to queue and run again.";
  }
  switch (status) {
    case "completed":
      return "All URLs in this batch finished processing under the assigned model.";
    case "partial":
      return "Batch finished with some URL failures.";
    case "failed":
      return "Batch failed to enqueue or process URLs.";
    case "running":
      return "Batch is processing. The assigned model stays locked until every URL finishes.";
    case "pending":
      return "Queued — will start automatically when the current batch finishes.";
    default:
      return "Batch status.";
  }
}

function resolveItemProcessingStatus(
  item: BatchRunItem,
): BatchRunItemProcessingStatus {
  if (item.processingStatus) return item.processingStatus;
  if (item.status === "failed") return "failed";
  if (item.status === "started") return "running";
  return "pending";
}

function batchUrlStatusClass(status: BatchRunItemProcessingStatus): string {
  switch (status) {
    case "done":
      return "adminPage__statusPill--done";
    case "running":
      return "adminPage__statusPill--running";
    case "failed":
      return "adminPage__statusPill--error";
    case "pending":
    default:
      return "adminPage__statusPill--pending";
  }
}

function formatBatchUrlStatusLabel(
  status: BatchRunItemProcessingStatus,
): string {
  switch (status) {
    case "done":
      return "Done";
    case "running":
      return "Running";
    case "failed":
      return "Failed";
    case "pending":
    default:
      return "Pending";
  }
}

function batchUrlStatusTitle(item: BatchRunItem): string {
  const processingStatus = resolveItemProcessingStatus(item);
  if (item.errorMessage?.trim()) return item.errorMessage.trim();

  switch (processingStatus) {
    case "pending":
      return "Waiting in the ingest job queue.";
    case "running":
      return "Ingest job is running.";
    case "done":
      return "Ingest job finished.";
    case "failed":
      return "Enqueue or ingest failed.";
    default:
      return "Ingest job status.";
  }
}

function isBatchDisabled(batch: Pick<BatchRun, "disabled">): boolean {
  return Boolean(batch.disabled);
}

function canDisableBatch(batch: BatchRun): boolean {
  if (isBatchDisabled(batch)) return false;
  return batch.status === "pending" || batch.status === "running";
}

function disableBatchConfirmTitle(batch: BatchRun): string {
  if (batch.status === "running") {
    return `Disable processing Batch #${batch.id}?`;
  }
  return `Disable queued Batch #${batch.id}?`;
}

function disableBatchConfirmBody(batch: BatchRun): string {
  if (batch.status === "running") {
    return "Remaining jobs for this batch will pause. The next queued batch will start if one exists. You can enable this batch later.";
  }
  return "This batch will not start until you enable it again.";
}

function emptyBatchCounts(total = 0): BatchRunCounts {
  return {
    total,
    pending: total,
    running: 0,
    done: 0,
    failed: 0,
  };
}

function countsFromItems(items: BatchRunItem[]): BatchRunCounts {
  const counts = emptyBatchCounts(0);
  counts.total = items.length;
  for (const item of items) {
    counts[resolveItemProcessingStatus(item)] += 1;
  }
  return counts;
}

function batchCounts(
  batch: BatchRun,
  liveItems?: BatchRunItem[],
): BatchRunCounts {
  const items =
    liveItems && liveItems.length > 0
      ? liveItems
      : batch.items && batch.items.length > 0
        ? batch.items
        : null;
  const fromItems = items ? countsFromItems(items) : null;
  const fromApi =
    batch.counts && batch.counts.total > 0 ? batch.counts : null;

  if (fromItems && fromApi) {
    const itemProgress = fromItems.running + fromItems.done + fromItems.failed;
    const apiProgress = fromApi.running + fromApi.done + fromApi.failed;
    return itemProgress >= apiProgress ? fromItems : fromApi;
  }
  if (fromItems) return fromItems;
  if (fromApi) return fromApi;
  return emptyBatchCounts(batch.rssItemCount + batch.etlItemCount);
}

export function AdminBatchRunSection({
  idPrefix,
  busy = false,
  onRunStart,
  onRunEnd,
  onServicesChanged,
}: AdminBatchRunSectionProps) {
  const baseId = useId();
  // Model picker commented out — use active model from Controls.
  // const [options, setOptions] = useState<LlmModelOption[]>([]);
  // const [inferenceProfiles, setInferenceProfiles] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedModelLabel, setSelectedModelLabel] = useState("");
  const [optionsLoading, setOptionsLoading] = useState(true);

  const [rssSelection, setRssSelection] = useState<DiscoverySelection | null>(
    null,
  );
  const [etlSelection, setEtlSelection] = useState<EtlSelection | null>(null);

  const [links, setLinks] = useState<IngestLinkRow[]>([]);
  const [uploads, setUploads] = useState<EtlReportUploadRow[]>([]);
  const [logs, setLogs] = useState<DiscoveryLogRow[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [rssDialogOpen, setRssDialogOpen] = useState(false);
  const [etlDialogOpen, setEtlDialogOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const [batches, setBatches] = useState<BatchRun[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);
  const [batchItemsById, setBatchItemsById] = useState<
    Record<number, BatchRunItem[]>
  >({});
  const [itemsLoadingId, setItemsLoadingId] = useState<number | null>(null);
  const [batchListTab, setBatchListTab] = useState<"running" | "disabled">(
    "running",
  );
  const [mutatingBatchId, setMutatingBatchId] = useState<number | null>(null);
  const [disableTarget, setDisableTarget] = useState<BatchRun | null>(null);

  const loadModelConfig = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const result = await fetchLlmModelConfig();
      if (!result.ok) {
        toast.error(result.message, { autoClose: 3000 });
        return;
      }
      // setOptions(result.config.options);
      // setInferenceProfiles(Boolean(result.config.inferenceProfiles));
      setSelectedModel(result.config.modelId);
      setSelectedModelLabel(result.config.modelLabel);
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const [linksResult, uploadsResult, logsResult] = await Promise.all([
        fetchIngestLinks(),
        fetchEtlReportUploads(),
        fetchDiscoveryLogs(),
      ]);
      if (linksResult.ok)
        setLinks(linksResult.links.filter((link) => !link.archived));
      if (uploadsResult.ok)
        setUploads(uploadsResult.uploads.filter((upload) => !upload.archived));
      if (logsResult.ok) setLogs(logsResult.logs);
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  const loadBatches = useCallback(async (silent = false) => {
    if (!silent) setBatchesLoading(true);
    try {
      const result = await fetchBatchRuns(25);
      if (!result.ok) {
        if (!silent) toast.error(result.message, { autoClose: 3000 });
        return;
      }
      setBatches((prev) => {
        const prevById = new Map(prev.map((batch) => [batch.id, batch]));
        return result.batches.map((next) => {
          const current = prevById.get(next.id);
          if (!current?.items?.length) return next;
          return { ...next, items: current.items };
        });
      });
    } finally {
      if (!silent) setBatchesLoading(false);
    }
  }, []);

  const reloadExpandedBatchItems = useCallback(async (batchId: number) => {
    const result = await fetchBatchRun(batchId);
    if (!result.ok) return;
    setBatchItemsById((prev) => ({
      ...prev,
      [batchId]: result.batch.items ?? [],
    }));
    setBatches((prev) =>
      prev.map((batch) => (batch.id === batchId ? result.batch : batch)),
    );
  }, []);

  useEffect(() => {
    void loadModelConfig();
    void loadBatches();
  }, [loadModelConfig, loadBatches]);

  useEffect(() => {
    const activeIds = new Set<number>();
    if (expandedBatchId != null) activeIds.add(expandedBatchId);
    for (const [id, items] of Object.entries(batchItemsById)) {
      const hasActive = items.some((item) => {
        const status = resolveItemProcessingStatus(item);
        return status === "pending" || status === "running";
      });
      if (hasActive) activeIds.add(Number(id));
    }
    if (activeIds.size === 0) return;

    const intervalId = window.setInterval(() => {
      for (const id of activeIds) void reloadExpandedBatchItems(id);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [batchItemsById, expandedBatchId, reloadExpandedBatchItems]);

  const activeBatch = useMemo(
    () =>
      batches.find(
        (batch) => batch.status === "running" && !isBatchDisabled(batch),
      ) ?? null,
    [batches],
  );

  const queuedBatches = useMemo(
    () =>
      batches.filter(
        (batch) => batch.status === "pending" && !isBatchDisabled(batch),
      ),
    [batches],
  );

  const runningBatches = useMemo(
    () => batches.filter((batch) => !isBatchDisabled(batch)),
    [batches],
  );

  const disabledBatches = useMemo(
    () => batches.filter((batch) => isBatchDisabled(batch)),
    [batches],
  );

  const displayedBatches =
    batchListTab === "disabled" ? disabledBatches : runningBatches;

  useEffect(() => {
    if (!activeBatch && queuedBatches.length === 0) return;

    const intervalId = window.setInterval(() => {
      void loadBatches(true);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [activeBatch, queuedBatches.length, loadBatches]);

  const openRssDialog = () => {
    setRssDialogOpen(true);
    void loadSources();
  };

  const openEtlDialog = () => {
    setEtlDialogOpen(true);
    void loadSources();
  };

  // const handleModelChange = (modelId: string) => {
  //   setSelectedModel(modelId);
  //   setSelectedModelLabel(modelLabelFor(options, modelId));
  // };

  const rssItemCount = rssSelection?.ingestLinkItemIds.length ?? 0;
  const etlReportCount = etlSelection?.selectedReportCount ?? 0;
  const hasRss = rssItemCount > 0;
  const hasEtl = etlReportCount > 0;
  const canRun =
    Boolean(selectedModel) &&
    !optionsLoading &&
    !isRunning &&
    !busy &&
    (hasRss || hasEtl);

  const toggleBatchExpand = async (batchId: number) => {
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null);
      return;
    }
    setExpandedBatchId(batchId);

    setItemsLoadingId(batchId);
    try {
      await reloadExpandedBatchItems(batchId);
    } finally {
      setItemsLoadingId(null);
    }
  };

  const handleDisableBatch = async () => {
    if (!disableTarget) return;
    if (!canDisableBatch(disableTarget) || mutatingBatchId != null) return;

    setMutatingBatchId(disableTarget.id);
    try {
      const result = await disableBatchRun(disableTarget.id);
      if (!result.ok) {
        toast.error(result.message, { autoClose: 3500 });
        return;
      }
      toast.success(result.message, { autoClose: 3000 });
      if (expandedBatchId === disableTarget.id) setExpandedBatchId(null);
      setDisableTarget(null);
      setBatchListTab("disabled");
      await loadBatches(true);
      onServicesChanged?.();
    } finally {
      setMutatingBatchId(null);
    }
  };

  const handleEnableBatch = async (batch: BatchRun) => {
    if (!isBatchDisabled(batch) || mutatingBatchId != null) return;

    setMutatingBatchId(batch.id);
    try {
      const result = await enableBatchRun(batch.id);
      if (!result.ok) {
        toast.error(result.message, { autoClose: 3500 });
        return;
      }
      toast.success(result.message, { autoClose: 3000 });
      setBatchListTab("running");
      await loadBatches(true);
      onServicesChanged?.();
    } finally {
      setMutatingBatchId(null);
    }
  };

  const handleRun = async () => {
    if (!canRun || !selectedModel) return;

    if (!hasRss && !hasEtl) {
      toast.error("Select RSS feeds and/or ETL reports before running.", {
        autoClose: 3000,
      });
      return;
    }

    setIsRunning(true);
    onRunStart?.({ rss: hasRss, etl: hasEtl });
    try {
      const modelResult = await fetchLlmModelConfig();
      if (!modelResult.ok) {
        toast.error(modelResult.message, { autoClose: 3000 });
        return;
      }

      const modelId = modelResult.config.modelId;
      setSelectedModel(modelId);
      setSelectedModelLabel(modelResult.config.modelLabel);

      const result = await startBatchRun({
        modelId,
        ingestLinkIds: rssSelection?.ingestLinkIds,
        ingestLinkItemIds: rssSelection?.ingestLinkItemIds,
        uploadIds: etlSelection?.uploadIds,
        reportIds: etlSelection?.reportIds,
        excludeReportIds: etlSelection?.excludeReportIds,
      });

      if (!result.ok) {
        toast.error(result.message, { autoClose: 3500 });
        return;
      }

      if (result.batch.status === "running") {
        await waitForWorkerRunning(20_000);
        onServicesChanged?.();
      }

      toast.success(result.message, { autoClose: 4500 });

      setBatchItemsById((prev) => ({
        ...prev,
        [result.batch.id]: result.batch.items ?? [],
      }));
      setExpandedBatchId(result.batch.id);
      setRssSelection(null);
      setEtlSelection(null);
      await loadBatches(true);
    } finally {
      setIsRunning(false);
      void loadModelConfig();
      onRunEnd?.();
      onServicesChanged?.();
    }
  };

  return (
    <section
      className="adminPage__card adminPage__batchCard"
      aria-labelledby={`${idPrefix}-batch-title`}
    >
      <div className="adminPage__cardHead">
        <span className="settingsPage__cardIconWrap" aria-hidden>
          <Layers size={20} strokeWidth={2} />
        </span>
        <div className="adminPage__cardHeadText">
          <h2 id={`${idPrefix}-batch-title`} className="adminPage__cardTitle">
            Batch run
          </h2>
          <p className="adminPage__cardHint">
            Select RSS feeds and ETL reports, then run. You can queue more
            batches while one is processing — the next starts automatically when
            the current batch finishes, using its assigned model.
          </p>
        </div>
      </div>

      <div className="adminPage__batchModel">
        <div className="adminPage__batchModelHead">
          <div className="adminPage__modelLabelRow">
            <span className="adminPage__modelLabel">Active model</span>
            <span
              className="adminPage__modelCurrent"
              role="status"
              aria-live="polite"
              title={selectedModel || undefined}
            >
              {optionsLoading
                ? "Loading…"
                : selectedModelLabel || selectedModel || "—"}
            </span>
          </div>
          <button
            type="button"
            className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend adminPage__batchRunBtn"
            disabled={!canRun}
            aria-busy={isRunning}
            onClick={() => void handleRun()}
          >
            {isRunning ? (
              <>
                <Loader2 className="usersPage__spinner" size={16} aria-hidden />
                {activeBatch ? "Queueing…" : "Starting…"}
              </>
            ) : (
              <>
                <Play size={16} strokeWidth={2} aria-hidden />
                {activeBatch ? "Queue Batch" : "Run Batch"}
              </>
            )}
          </button>
        </div>
        <div className="adminPage__batchModelNotes">
          <p className="adminPage__batchModelNote">
            To select or change the model, go to the Controls tab. Only one batch
            processes at a time; additional batches are queued and auto-start next.
          </p>
          {activeBatch ? (
            <p className="adminPage__batchActiveNotice" role="status">
              Batch #{activeBatch.id} is processing with{" "}
              <strong>
                {activeBatch.modelLabel || activeBatch.modelName}
              </strong>
              .
              {queuedBatches.length > 0
                ? ` ${queuedBatches.length} more batch${
                    queuedBatches.length === 1 ? "" : "es"
                  } queued — will start automatically when this finishes.`
                : " You can still add another batch; it will queue and start next."}
            </p>
          ) : queuedBatches.length > 0 ? (
            <p className="adminPage__batchActiveNotice" role="status">
              {queuedBatches.length} batch
              {queuedBatches.length === 1 ? "" : "es"} queued and will start
              shortly.
            </p>
          ) : null}
        </div>
        {/* Model dropdown commented out — change model on Controls.
        <LlmModelPicker
          idPrefix={`${idPrefix}-batch-model`}
          options={options}
          value={selectedModel}
          selectedLabel={selectedModelLabel}
          inferenceProfiles={inferenceProfiles}
          onChange={handleModelChange}
          disabled={isRunning || busy || !options.length}
          loading={optionsLoading}
        />
        */}
      </div>

      <div className="adminPage__batchRow">
        <div className="adminPage__batchBox">
          <h3 className="adminPage__batchBoxTitle">
            <Rss size={16} strokeWidth={2} aria-hidden />
            RSS Feeds
          </h3>
          <p className="adminPage__batchBoxMeta">
            {hasRss
              ? `${rssItemCount} item${rssItemCount === 1 ? "" : "s"} selected`
              : "None selected"}
          </p>
          <button
            type="button"
            className="adminPage__ghostBtn"
            disabled={isRunning || busy}
            onClick={openRssDialog}
          >
            Select Feeds
          </button>
        </div>

        <div className="adminPage__batchBox">
          <h3 className="adminPage__batchBoxTitle">
            <Workflow size={16} strokeWidth={2} aria-hidden />
            ETL Reports
          </h3>
          <p className="adminPage__batchBoxMeta">
            {hasEtl
              ? `${etlReportCount} report${etlReportCount === 1 ? "" : "s"} selected`
              : "None selected"}
          </p>
          <button
            type="button"
            className="adminPage__ghostBtn"
            disabled={isRunning || busy}
            onClick={openEtlDialog}
          >
            Select Reports
          </button>
        </div>
      </div>

      <div className="adminPage__batchHistory">
        <div className="adminPage__batchHistoryHead">
          <h3 className="adminPage__batchHistoryTitle">Recent batches</h3>
          <button
            type="button"
            className="adminPage__ghostBtn adminPage__batchRefreshBtn"
            disabled={batchesLoading}
            onClick={() => {
              void loadBatches();
              if (expandedBatchId != null) {
                void reloadExpandedBatchItems(expandedBatchId);
              }
            }}
          >
            <RefreshCw size={14} strokeWidth={2} aria-hidden />
            Refresh
          </button>
        </div>

        <div
          className="usersPage__tabs adminPage__batchTabs"
          role="tablist"
          aria-label="Batch lists"
        >
          <button
            type="button"
            role="tab"
            aria-selected={batchListTab === "running"}
            className={`usersPage__tab${batchListTab === "running" ? " usersPage__tab--selected" : ""}`}
            onClick={() => setBatchListTab("running")}
          >
            Running
            <span className="usersPage__tabCount" aria-hidden>
              {runningBatches.length}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={batchListTab === "disabled"}
            className={`usersPage__tab${batchListTab === "disabled" ? " usersPage__tab--selected" : ""}`}
            onClick={() => setBatchListTab("disabled")}
          >
            Disabled
            <span className="usersPage__tabCount" aria-hidden>
              {disabledBatches.length}
            </span>
          </button>
        </div>

        <p className="adminPage__batchDetailsHint">
          Expand a batch to see its assigned model and every RSS / ETL URL.
          Status: <strong>Queued</strong> waits, <strong>Processing</strong>{" "}
          runs under its model, then Completed / Partial / Failed. Disable a
          queued or processing batch to pause it; enable it again from the
          Disabled tab.
        </p>

        {batchesLoading ? (
          <p className="adminPage__batchHistoryEmpty" role="status">
            Loading batches…
          </p>
        ) : displayedBatches.length === 0 ? (
          <p className="adminPage__batchHistoryEmpty" role="status">
            {batchListTab === "disabled"
              ? "No disabled batches."
              : batches.length === 0
                ? "No batch runs yet. Start one above to track feeds, reports, and the model used."
                : "No running batches."}
          </p>
        ) : (
          <ul className="adminPage__batchHistoryList" role="list">
            {displayedBatches.map((batch) => {
              const isOpen = expandedBatchId === batch.id;
              const items = batchItemsById[batch.id] ?? [];
              const isLoadingItems = itemsLoadingId === batch.id;
              const isMutating = mutatingBatchId === batch.id;
              const disabled = isBatchDisabled(batch);
              const showDisable = canDisableBatch(batch);
              const showEnable = disabled;
              const counts = batchCounts(batch, batchItemsById[batch.id]);
              return (
                <li key={batch.id} className="adminPage__batchHistoryItem">
                  <div className="adminPage__batchHistoryRow">
                    <button
                      type="button"
                      className="adminPage__batchHistoryToggle"
                      aria-expanded={isOpen}
                      onClick={() => void toggleBatchExpand(batch.id)}
                    >
                      <span className="adminPage__batchHistoryToggleTop">
                        <span className="adminPage__batchHistoryToggleMain">
                          {isOpen ? (
                            <ChevronDown size={16} strokeWidth={2} aria-hidden />
                          ) : (
                            <ChevronRight size={16} strokeWidth={2} aria-hidden />
                          )}
                          <span className="adminPage__batchHistoryId">
                            Batch #{batch.id}
                          </span>
                          <span
                            className={`adminPage__statusPill adminPage__statusPill--batch ${batchStatusClass(batch.status, disabled)}`}
                            title={batchStatusTitle(batch.status, disabled)}
                          >
                            {formatBatchStatusLabel(batch.status, disabled)}
                          </span>
                          <span
                            className="adminPage__batchCounts"
                            aria-label={`Batch #${batch.id} URL counts`}
                          >
                            <span className="adminPage__batchCount adminPage__batchCount--all">
                              <strong>{counts.total}</strong>
                              All
                            </span>
                            <span className="adminPage__batchCount adminPage__batchCount--pending">
                              <strong>{counts.pending}</strong>
                              Pending
                            </span>
                            <span className="adminPage__batchCount adminPage__batchCount--running">
                              <strong>{counts.running}</strong>
                              Running
                            </span>
                            <span className="adminPage__batchCount adminPage__batchCount--done">
                              <strong>{counts.done}</strong>
                              Done
                            </span>
                            <span className="adminPage__batchCount adminPage__batchCount--failed">
                              <strong>{counts.failed}</strong>
                              Failed
                            </span>
                          </span>
                        </span>
                        <span className="adminPage__batchHistoryMeta">
                          <span>
                            {batch.rssItemCount} RSS · {batch.etlItemCount} ETL
                          </span>
                          <span className="adminPage__batchHistoryWhen">
                            <span>{formatJobExecutedAt(batch.createdAt)}</span>
                            <span
                              className="adminPage__batchHistoryModel"
                              title={batch.modelName}
                            >
                              {batch.modelLabel || batch.modelName}
                            </span>
                          </span>
                        </span>
                      </span>
                    </button>
                    {showDisable ? (
                      <button
                        type="button"
                        className="adminPage__batchDeleteBtn"
                        disabled={mutatingBatchId != null}
                        aria-busy={isMutating}
                        aria-label={`Disable batch #${batch.id}`}
                        title={
                          batch.status === "running"
                            ? "Disable this processing batch"
                            : "Disable this queued batch"
                        }
                        onClick={() => setDisableTarget(batch)}
                      >
                        {isMutating ? (
                          <Loader2
                            className="usersPage__spinner"
                            size={15}
                            aria-hidden
                          />
                        ) : (
                          <Ban size={15} strokeWidth={2} aria-hidden />
                        )}
                      </button>
                    ) : null}
                    {showEnable ? (
                      <button
                        type="button"
                        className="adminPage__batchEnableBtn"
                        disabled={mutatingBatchId != null}
                        aria-busy={isMutating}
                        aria-label={`Enable batch #${batch.id}`}
                        title="Enable this batch so it can run again"
                        onClick={() => void handleEnableBatch(batch)}
                      >
                        {isMutating ? (
                          <Loader2
                            className="usersPage__spinner"
                            size={15}
                            aria-hidden
                          />
                        ) : (
                          <Play size={15} strokeWidth={2} aria-hidden />
                        )}
                      </button>
                    ) : null}
                  </div>

                  {isOpen ? (
                    <div className="adminPage__batchHistoryDetail">
                      <p className="adminPage__batchAssignedModel">
                        Assigned model:{" "}
                        <strong title={batch.modelName}>
                          {batch.modelLabel || batch.modelName}
                        </strong>
                      </p>
                      {isLoadingItems ? (
                        <p
                          className="adminPage__batchHistoryEmpty"
                          role="status"
                        >
                          Loading URLs…
                        </p>
                      ) : items.length === 0 ? (
                        <p
                          className="adminPage__batchHistoryEmpty"
                          role="status"
                        >
                          No URLs stored for this batch.
                        </p>
                      ) : (
                        <ul className="adminPage__batchUrlList" role="list">
                          {items.map((item, index) => {
                            const processingStatus =
                              resolveItemProcessingStatus(item);
                            const serial =
                              typeof item.serial === "number" && item.serial > 0
                                ? item.serial
                                : index + 1;
                            return (
                            <li
                              key={item.id}
                              className="adminPage__batchUrlRow"
                            >
                              <span
                                className="adminPage__batchUrlSerial"
                                title={`URL ${serial} in Batch #${batch.id}`}
                              >
                                {formatBatchUrlSerial(serial)}
                              </span>
                              <span
                                className={`adminPage__batchUrlSource adminPage__batchUrlSource--${item.sourceType}`}
                              >
                                {item.sourceType === "rss" ? "RSS" : "ETL"}
                              </span>
                              <span className="adminPage__batchUrlText">
                                <span className="adminPage__batchUrlLabel">
                                  {item.sourceType === "rss"
                                    ? item.feedName ||
                                      `Feed #${item.ingestLinkId ?? "—"}`
                                    : item.title ||
                                      `Report #${item.reportId ?? "—"}`}
                                </span>
                                <a
                                  className="adminPage__batchUrlLink"
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={item.url}
                                >
                                  {displayUrl(item.url)}
                                </a>
                              </span>
                              <span
                                className={`adminPage__statusPill adminPage__batchUrlStatus ${batchUrlStatusClass(processingStatus)}`}
                                title={batchUrlStatusTitle(item)}
                              >
                                {formatBatchUrlStatusLabel(processingStatus)}
                              </span>
                            </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <DiscoveryStartDialog
        open={rssDialogOpen}
        links={links}
        logs={logs}
        linksLoading={sourcesLoading}
        starting={false}
        title="Select RSS feeds"
        hint="Choose extracted feed URLs for this batch. They will run with the model selected above."
        confirmLabel="Use selection"
        confirmingLabel="Saving…"
        onClose={() => setRssDialogOpen(false)}
        onStart={(selection) => {
          setRssSelection(selection);
          setRssDialogOpen(false);
          toast.success(
            `Selected ${selection.ingestLinkItemIds.length} RSS item${
              selection.ingestLinkItemIds.length === 1 ? "" : "s"
            }.`,
            { autoClose: 2500 },
          );
        }}
      />

      <ReportsStartDialog
        open={etlDialogOpen}
        uploads={uploads}
        uploadsLoading={sourcesLoading}
        starting={false}
        title="Select ETL reports"
        hint="Choose report URLs for this batch. They will run with the model selected above."
        confirmLabel="Use selection"
        confirmingLabel="Saving…"
        onClose={() => setEtlDialogOpen(false)}
        onStart={(selection) => {
          setEtlSelection(selection);
          setEtlDialogOpen(false);
          toast.success(
            `Selected ${selection.selectedReportCount} ETL report${
              selection.selectedReportCount === 1 ? "" : "s"
            }.`,
            { autoClose: 2500 },
          );
        }}
      />

      {disableTarget ? (
        <div
          className="usersPage__overlay"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget && mutatingBatchId == null) {
              setDisableTarget(null);
            }
          }}
        >
          <div
            className="usersPage__dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${baseId}-disable-title`}
            aria-describedby={`${baseId}-disable-desc`}
          >
            <div className="usersPage__dialogHead">
              <h2 id={`${baseId}-disable-title`} className="usersPage__dialogTitle">
                {disableBatchConfirmTitle(disableTarget)}
              </h2>
              <button
                type="button"
                className="usersPage__dialogClose"
                onClick={() => setDisableTarget(null)}
                disabled={mutatingBatchId != null}
                aria-label="Close"
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div className="usersPage__dialogBody">
              <p id={`${baseId}-disable-desc`} className="adminPage__batchDeleteConfirmText">
                {disableBatchConfirmBody(disableTarget)}
              </p>
              <div className="usersPage__dialogActions">
                <button
                  type="button"
                  className="usersPage__btn usersPage__btn--logoutTone"
                  disabled={mutatingBatchId != null}
                  onClick={() => setDisableTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
                  disabled={mutatingBatchId != null}
                  aria-busy={mutatingBatchId != null}
                  onClick={() => void handleDisableBatch()}
                >
                  {mutatingBatchId != null ? "Disabling…" : "Disable"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
