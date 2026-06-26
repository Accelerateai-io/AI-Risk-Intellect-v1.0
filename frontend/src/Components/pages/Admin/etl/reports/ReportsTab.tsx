import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Upload,
  Zap,
} from "lucide-react";
import { AdminDataTable } from "../../AdminDataTable";
import { AdminSortableTh } from "../../AdminSortableTh";
import {
  nextTableSort,
  sortByTableState,
  type TableSortState,
} from "../../adminTableSort";
import { AdminServiceRow } from "../../AdminServiceRow";
import {
  resolveReportsWorkerDisplayStatus,
  type ServiceState,
} from "../../adminServices";
import {
  formatDisplayDate,
  formatDurationMs,
  // formatJobExecutedAt,
  formatRelativeDate,
} from "../../../../../utils/formatDate";
import {
  archiveEtlReportUpload,
  canExportReportUpload,
  extractEtlReportUpload,
  exportEtlReportUploadItems,
  fetchEtlReportUploadItems,
  fetchEtlReportUploads,
  reuploadEtlReportUpload,
  reportUploadItemDisplayCount,
  type EtlExtractionDisplayStatus,
  type EtlReportUploadItemRow,
  type EtlReportUploadRow,
} from "../../../../../utils/etlReportsApi";
import {
  fetchReportsLogs,
  type ReportsLogRow,
} from "../../../../../utils/reportsLogsApi";
import { usePagination } from "../../../../../utils/usePagination";
import { uploadEtlReports } from "../etlUpload";
import { ReportsUploadDialog } from "./ReportsUploadDialog";
import { ReportsStartDialog } from "./ReportsStartDialog";
import "../../../Users/usersPage.css";
import "../../adminRssFeeds.css";

interface ReportsTabProps {
  idPrefix: string;
  workerStatus: ServiceState;
  workerApiRunning: boolean;
  onReportsStart: (selection: {
    uploadIds: number[];
    reportIds: number[];
  }) => void;
  onWorkerStop: () => void;
}

const TABLE_COL_SPAN = 8;
const TERMINAL_DISCOVERY_STATUSES = new Set(["EXECUTED", "SKIPPED", "FAILED"]);
const RUNNING_DISCOVERY_STATUSES = new Set(["PENDING", "RUNNING"]);

function itemCountForRow(
  row: EtlReportUploadRow,
  items?: EtlReportUploadItemRow[],
): number {
  return reportUploadItemDisplayCount(row, items);
}

function extractionStatusLabel(status: EtlExtractionDisplayStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "processing":
      return "Processing";
    case "completed":
    case "partially_completed":
      return "Completed";
    case "skipped":
      return "Skipped";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function extractionStatusPillClass(status: EtlExtractionDisplayStatus): string {
  switch (status) {
    case "completed":
    case "partially_completed":
      return "adminPage__statusPill--running";
    case "processing":
      return "adminPage__statusPill--pending";
    case "skipped":
    case "failed":
    case "pending":
    default:
      return "adminPage__statusPill--stopped";
  }
}

function uploadItemsEmptyMessage(row: EtlReportUploadRow): string {
  if (row.status === "pending") {
    return "Use Extract to import report URLs from the saved file.";
  }
  if (row.extractionStatus === "skipped") {
    return "URLs are already present, so this file has been skipped.";
  }
  if (row.status === "failed") {
    return "Extraction failed. Reupload the file or run Extract again.";
  }
  return "Use Extract to import report URLs from the saved file.";
}

function extractionEndedAt(row: EtlReportUploadRow): string | null {
  if (row.status === "processing" || row.status === "pending") return null;
  return row.updatedAt;
}

function isUploadExtracting(
  row: EtlReportUploadRow,
  actionId: number | null,
): boolean {
  return row.status === "processing" || actionId === row.id;
}

function extractionProgressPercent(row: EtlReportUploadRow): number {
  if (row.totalRows <= 0) return 0;
  return Math.min(
    100,
    Math.round((row.importedRows / row.totalRows) * 100),
  );
}

type UploadSortKey =
  | "id"
  | "name"
  | "items"
  | "discovery"
  | "added"
  | "extractionStatus"
  | "extraction";

function getUploadSortValue(
  row: EtlReportUploadRow,
  key: UploadSortKey,
  progress: { completed: number },
): string | number | null {
  switch (key) {
    case "id":
      return row.id;
    case "name":
      return row.suggestedName?.trim() || "";
    case "items":
      return itemCountForRow(row);
    case "discovery":
      return progress.completed;
    case "added":
      return row.createdAt;
    case "extractionStatus":
      return extractionStatusLabel(row.extractionStatus);
    case "extraction": {
      const end = extractionEndedAt(row);
      if (!end) return null;
      return new Date(end).getTime() - new Date(row.createdAt).getTime();
    }
    default:
      return null;
  }
}

function uploadMatchesSearch(row: EtlReportUploadRow, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;

  const hay = [row.id, row.suggestedName ?? ""].join(" ").toLowerCase();
  return hay.includes(q);
}

export function ReportsTab({
  idPrefix,
  workerStatus,
  workerApiRunning,
  onReportsStart,
  onWorkerStop,
}: ReportsTabProps) {
  const baseId = useId();
  const [uploads, setUploads] = useState<EtlReportUploadRow[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsRefreshing, setUploadsRefreshing] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [reuploadTarget, setReuploadTarget] = useState<{
    id: number;
    suggestedName: string | null;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);
  const [exportUploadId, setExportUploadId] = useState<number | null>(null);
  const [uploadRowMenuOpenId, setUploadRowMenuOpenId] = useState<number | null>(
    null,
  );
  const [uploadRowMenuAnchor, setUploadRowMenuAnchor] = useState<{
    top: number;
    bottom: number;
    left: number;
    right: number;
  } | null>(null);
  const [uploadRowMenuPosition, setUploadRowMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const uploadRowMenuRef = useRef<HTMLDivElement>(null);
  const [expandedUploadId, setExpandedUploadId] = useState<number | null>(null);
  const [uploadItemsById, setUploadItemsById] = useState<
    Record<number, EtlReportUploadItemRow[]>
  >({});
  const [uploadItemsLoadingId, setUploadItemsLoadingId] = useState<number | null>(
    null,
  );
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [logRows, setLogRows] = useState<ReportsLogRow[]>([]);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [runWarmup, setRunWarmup] = useState(false);
  const [uploadSearchQuery, setUploadSearchQuery] = useState("");
  const [uploadPageSize, setUploadPageSize] = useState(10);
  const [uploadSort, setUploadSort] = useState<TableSortState<UploadSortKey> | null>(
    null,
  );

  const sid = (name: string) => `${idPrefix}-reports-${baseId}-${name}`;

  const latestLogRows = useMemo(() => {
    const latestByReport = new Map<number, ReportsLogRow>();

    for (const row of logRows) {
      const existing = latestByReport.get(row.reportId);
      if (!existing || (row.jobId ?? 0) > (existing.jobId ?? 0)) {
        latestByReport.set(row.reportId, row);
      }
    }

    return [...latestByReport.values()];
  }, [logRows]);

  const hasActiveReportJobs = useMemo(
    () =>
      latestLogRows.some((row) =>
        RUNNING_DISCOVERY_STATUSES.has(row.status.toUpperCase()),
      ),
    [latestLogRows],
  );

  const displayWorkerStatus = useMemo(
    () =>
      resolveReportsWorkerDisplayStatus(
        workerStatus,
        workerApiRunning,
        hasActiveReportJobs,
        { runWarmup },
      ),
    [workerStatus, workerApiRunning, hasActiveReportJobs, runWarmup],
  );

  const discoveryProgressByUpload = useMemo(() => {
    const map = new Map<
      number,
      { total: number; completed: number; running: number }
    >();

    for (const upload of uploads) {
      const itemCount = itemCountForRow(upload);
      if (itemCount > 0) {
        map.set(upload.id, {
          total: itemCount,
          completed: 0,
          running: 0,
        });
      }
    }

    for (const row of latestLogRows) {
      if (!row.uploadId) continue;
      const current = map.get(row.uploadId);
      if (!current) continue;
      const status = row.status.toUpperCase();
      if (TERMINAL_DISCOVERY_STATUSES.has(status)) {
        current.completed += 1;
      } else if (RUNNING_DISCOVERY_STATUSES.has(status)) {
        current.running += 1;
      }
      map.set(row.uploadId, current);
    }

    return map;
  }, [uploads, latestLogRows]);

  const filteredUploads = useMemo(
    () => uploads.filter((row) => uploadMatchesSearch(row, uploadSearchQuery)),
    [uploads, uploadSearchQuery],
  );

  const sortedUploads = useMemo(() => {
    if (!uploadSort) return filteredUploads;

    return sortByTableState(filteredUploads, uploadSort, (row, key) =>
      getUploadSortValue(
        row,
        key,
        discoveryProgressByUpload.get(row.id) ?? { completed: 0 },
      ),
    );
  }, [filteredUploads, uploadSort, discoveryProgressByUpload]);

  const uploadPager = usePagination({
    items: sortedUploads,
    pageSize: uploadPageSize,
    resetKey: `${uploadSearchQuery}|${uploadSort?.key ?? ""}|${uploadSort?.direction ?? ""}`,
  });

  const uploadPageRows = uploadPager.pageItems ?? [];

  const uploadRowMenuUpload = useMemo(
    () => uploads.find((row) => row.id === uploadRowMenuOpenId) ?? null,
    [uploads, uploadRowMenuOpenId],
  );

  const closeUploadRowMenu = useCallback(() => {
    setUploadRowMenuOpenId(null);
    setUploadRowMenuAnchor(null);
    setUploadRowMenuPosition(null);
  }, []);

  useLayoutEffect(() => {
    if (!uploadRowMenuOpenId || !uploadRowMenuAnchor || !uploadRowMenuRef.current) {
      setUploadRowMenuPosition(null);
      return;
    }

    const menu = uploadRowMenuRef.current;
    const margin = 8;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;

    let top = uploadRowMenuAnchor.bottom + 4;
    let left = uploadRowMenuAnchor.right - width;

    if (left < margin) left = margin;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }

    if (top + height > window.innerHeight - margin) {
      top = uploadRowMenuAnchor.top - height - 4;
    }
    if (top < margin) top = margin;

    setUploadRowMenuPosition({ top, left });
  }, [uploadRowMenuOpenId, uploadRowMenuAnchor]);

  useEffect(() => {
    if (uploadRowMenuOpenId == null) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const wrap = document.querySelector(
        `[data-etl-upload-row-menu="${uploadRowMenuOpenId}"]`,
      );
      const portal = document.querySelector(
        `[data-etl-upload-row-menu-portal="${uploadRowMenuOpenId}"]`,
      );
      if (wrap?.contains(target) || portal?.contains(target)) return;
      closeUploadRowMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeUploadRowMenu();
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [uploadRowMenuOpenId, closeUploadRowMenu]);

  const loadReportsLogs = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (silent) setLogsRefreshing(true);

    const result = await fetchReportsLogs();

    if (silent) setLogsRefreshing(false);

    if (!result.ok) {
      if (!silent) {
        toast.error(result.message, { autoClose: 3000 });
      }
      return;
    }

    setLogRows(result.logs);
  }, []);

  const loadUploads = useCallback(
    async (options?: { silent?: boolean; background?: boolean }) => {
    const silent = options?.silent ?? false;
    const background = options?.background ?? false;
    if (!background) {
      if (!silent) setUploadsLoading(true);
      else setUploadsRefreshing(true);
    }

    const result = await fetchEtlReportUploads();

    if (!background) {
      if (!silent) setUploadsLoading(false);
      else setUploadsRefreshing(false);
    }

    if (!result.ok) {
      toast.error(result.message, { autoClose: 3000 });
      return;
    }

    setUploads(result.uploads);
  },
  []);

  useEffect(() => {
    void loadUploads();
    void loadReportsLogs();
  }, [loadUploads, loadReportsLogs]);

  const hasExtractingUpload = useMemo(
    () =>
      actionId != null ||
      uploads.some((row) => row.status === "processing"),
    [actionId, uploads],
  );

  useEffect(() => {
    if (!hasExtractingUpload) return;

    const interval = window.setInterval(() => {
      void loadUploads({ background: true });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [hasExtractingUpload, loadUploads]);

  useEffect(() => {
    if (!runWarmup) return;
    const timer = window.setTimeout(() => setRunWarmup(false), 5000);
    return () => window.clearTimeout(timer);
  }, [runWarmup]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      loadUploads({ silent: true }),
      loadReportsLogs({ silent: true }),
    ]);
    toast.success("Report uploads refreshed.", { autoClose: 2000 });
  }, [loadUploads, loadReportsLogs]);

  async function handleUploadSubmit({
    suggestedName,
    file,
  }: {
    suggestedName: string;
    file: File;
  }) {
    setUploading(true);
    setUploadProgress(0);

    const onProgress = (percent: number) => setUploadProgress(percent);

    const result = reuploadTarget
      ? await reuploadEtlReportUpload(
          reuploadTarget.id,
          file,
          suggestedName,
          onProgress,
        )
      : await uploadEtlReports(file, suggestedName, onProgress);

    setUploading(false);
    setUploadProgress(null);

    if (result.ok) {
      setUploadDialogOpen(false);
      setReuploadTarget(null);
      if (reuploadTarget) {
        setUploadItemsById((prev) => {
          const next = { ...prev };
          delete next[reuploadTarget.id];
          return next;
        });
        if (expandedUploadId === reuploadTarget.id) {
          setExpandedUploadId(null);
        }
      } else {
        setUploadItemsById({});
      }
      toast.success(result.message, { autoClose: 2800 });
      void loadUploads({ silent: true });
      return;
    }

    toast.error(result.message, { autoClose: 3500 });
    void loadUploads({ silent: true });
  }

  async function handleExtractUpload(id: number) {
    const upload = uploads.find((row) => row.id === id);
    const uploadLabel =
      upload?.suggestedName?.trim() || upload?.fileName || `upload #${id}`;
    toast.info(`Extracting report URLs from ${uploadLabel}…`, {
      autoClose: 3000,
    });

    setActionId(id);
    try {
      const result = await extractEtlReportUpload(id);
      if (!result.ok) {
        toast.error(result.message, { autoClose: 4000 });
        return;
      }
      toast.success(result.message, { autoClose: 4500 });
      setUploadItemsById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void loadUploads({ silent: true });
      if (expandedUploadId === id) {
        void loadUploadItems(id);
      } else {
        setExpandedUploadId(id);
        void loadUploadItems(id);
      }
    } finally {
      setActionId(null);
    }
  }

  function openReuploadDialog(upload: EtlReportUploadRow) {
    setReuploadTarget({
      id: upload.id,
      suggestedName: upload.suggestedName,
    });
    setUploadDialogOpen(true);
  }

  async function handleArchiveUpload(id: number) {
    setActionId(id);
    const result = await archiveEtlReportUpload(id);
    setActionId(null);

    if (!result.ok) {
      toast.error(result.message, { autoClose: 3000 });
      return;
    }

    toast.success("Report upload archived.", { autoClose: 2500 });
    if (expandedUploadId === id) setExpandedUploadId(null);
    setUploadItemsById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    void loadUploads({ silent: true });
  }

  async function handleExportUpload(id: number) {
    setExportUploadId(id);
    const result = await exportEtlReportUploadItems(id);
    setExportUploadId(null);

    if (!result.ok) {
      toast.error(result.message, { autoClose: 3000 });
      return;
    }

    toast.success(`Exported ${result.fileName}.`, { autoClose: 2800 });
  }

  const loadUploadItems = useCallback(async (uploadId: number) => {
    setUploadItemsLoadingId(uploadId);
    const result = await fetchEtlReportUploadItems(uploadId);
    setUploadItemsLoadingId(null);

    if (!result.ok) {
      toast.error(result.message, { autoClose: 3000 });
      return;
    }

    setUploadItemsById((prev) => ({ ...prev, [uploadId]: result.items }));
  }, []);

  useEffect(() => {
    if (expandedUploadId == null) return;
    void loadUploadItems(expandedUploadId);
  }, [expandedUploadId, loadUploadItems]);

  useEffect(() => {
    for (const row of uploads) {
      if (row.status === "pending" || row.status === "processing") continue;
      if (uploadItemsById[row.id]) continue;
      void loadUploadItems(row.id);
    }
  }, [uploads, loadUploadItems, uploadItemsById]);

  function toggleUploadDetails(id: number) {
    setExpandedUploadId((prev) => (prev === id ? null : id));
  }

  return (
    <>
      <section className="adminPage__card" aria-labelledby={sid("title")}>
        <div className="adminPage__cardHead">
          <span className="settingsPage__cardIconWrap" aria-hidden>
            <Database size={20} strokeWidth={2} />
          </span>
          <div className="adminPage__cardHeadText">
            <h2 id={sid("title")} className="adminPage__cardTitle">
              ETL Reports Service
            </h2>
            <p className="adminPage__cardHint">
              Import AI Incident Database report records from a CSV or Excel file.
              Upload reports.csv (or .xlsx), extract report URLs from each saved
              file, then start the worker to queue and ingest selected URLs.
            </p>
          </div>
        </div>
        <ul className="adminPage__serviceList">
          <AdminServiceRow
            label="Reports Worker"
            status={displayWorkerStatus}
            apiRunning={workerApiRunning}
            allowStartWhileIdle
            onStart={() => setStartDialogOpen(true)}
            onStop={onWorkerStop}
          />
        </ul>
      </section>

      <section
        className="adminPage__rssWorkspace"
        aria-labelledby={sid("workspace-title")}
      >
        <h2
          id={sid("workspace-title")}
          className="adminPage__cardTitle adminPage__rssWorkspaceTitle"
        >
          Report uploads
        </h2>

        <AdminDataTable
          ariaLabel="Report uploads"
          wrapClassName="adminPage__tableWrap--links"
          filters={
            <div
              className="adminPage__dataTableToolbar"
              aria-label="Report uploads toolbar"
            >
              <div className="adminPage__dataTableToolbarActions">
                <button
                  type="button"
                  className="usersPage__inviteBtn adminPage__rssRefreshBtn"
                  onClick={() => void handleRefresh()}
                  disabled={
                    uploadsLoading || uploadsRefreshing || logsRefreshing
                  }
                  aria-busy={
                    uploadsLoading || uploadsRefreshing || logsRefreshing
                  }
                >
                  <RefreshCw
                    size={18}
                    strokeWidth={2}
                    className={
                      uploadsRefreshing || logsRefreshing
                        ? "pageHeader__refreshIcon--spin"
                        : undefined
                    }
                    aria-hidden
                  />
                  Refresh
                </button>
                <button
                  type="button"
                  className="usersPage__inviteBtn adminPage__rssIngestBtn"
                  onClick={() => {
                    setReuploadTarget(null);
                    setUploadDialogOpen(true);
                  }}
                  disabled={uploading}
                  aria-busy={uploading}
                >
                  <Plus size={18} strokeWidth={2} aria-hidden />
                  Upload file
                </button>
              </div>
              <div className="adminPage__dataTableToolbarSearch">
                <Search
                  className="adminPage__linksSearchIcon"
                  size={18}
                  strokeWidth={2}
                  aria-hidden
                />
                <input
                  id={sid("uploads-search")}
                  type="search"
                  className="adminPage__linksSearchInput"
                  placeholder="Search ID or suggested name…"
                  value={uploadSearchQuery}
                  onChange={(e) => setUploadSearchQuery(e.target.value)}
                  autoComplete="off"
                  enterKeyHint="search"
                  aria-label="Search by ID or suggested name"
                />
              </div>
            </div>
          }
          pagination={{
            page: uploadPager.page,
            pageCount: uploadPager.pageCount,
            total: uploadPager.total,
            pageSize: uploadPager.pageSize,
            from: uploadPager.from,
            to: uploadPager.to,
            onPageChange: uploadPager.setPage,
            onPageSizeChange: setUploadPageSize,
          }}
        >
              <table className="adminPage__table adminPage__table--links">
                <colgroup>
                  <col className="adminPage__colId" />
                  <col className="adminPage__colName" />
                  <col className="adminPage__colItems" />
                  <col className="adminPage__colDiscovery" />
                  <col className="adminPage__colAdded" />
                  <col className="adminPage__colExtraction" />
                  <col className="adminPage__colStatus" />
                  <col className="adminPage__colActions" />
                </colgroup>
                <thead>
                  <tr>
                    <AdminSortableTh
                      label="ID"
                      sortKey="id"
                      sort={uploadSort}
                      onSort={(key) =>
                        setUploadSort((current) => nextTableSort(current, key))
                      }
                      className="adminPage__th--center"
                    />
                    <AdminSortableTh
                      label="Suggested name"
                      sortKey="name"
                      sort={uploadSort}
                      onSort={(key) =>
                        setUploadSort((current) => nextTableSort(current, key))
                      }
                      className="adminPage__nameCol"
                    />
                    <AdminSortableTh
                      label="Items"
                      sortKey="items"
                      sort={uploadSort}
                      onSort={(key) =>
                        setUploadSort((current) => nextTableSort(current, key))
                      }
                      className="adminPage__th--center"
                    />
                    <AdminSortableTh
                      label="Progress"
                      sortKey="discovery"
                      sort={uploadSort}
                      onSort={(key) =>
                        setUploadSort((current) => nextTableSort(current, key))
                      }
                    />
                    <AdminSortableTh
                      label="Added"
                      sortKey="added"
                      sort={uploadSort}
                      onSort={(key) =>
                        setUploadSort((current) => nextTableSort(current, key))
                      }
                    />
                    <AdminSortableTh
                      label="Extraction"
                      sortKey="extraction"
                      sort={uploadSort}
                      onSort={(key) =>
                        setUploadSort((current) => nextTableSort(current, key))
                      }
                      className="adminPage__th--center"
                    />
                    <AdminSortableTh
                      label="Status"
                      sortKey="extractionStatus"
                      sort={uploadSort}
                      onSort={(key) =>
                        setUploadSort((current) => nextTableSort(current, key))
                      }
                      className="adminPage__th--center"
                    />
                    <th
                      scope="col"
                      className="adminPage__th adminPage__th--actions"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {uploadsLoading && filteredUploads.length === 0 ? (
                    <tr>
                      <td
                        className="adminPage__td adminPage__emptyCell"
                        colSpan={TABLE_COL_SPAN}
                      >
                        Loading report uploads…
                      </td>
                    </tr>
                  ) : filteredUploads.length === 0 ? (
                    <tr>
                      <td
                        className="adminPage__td adminPage__emptyCell"
                        colSpan={TABLE_COL_SPAN}
                      >
                        {uploadSearchQuery.trim()
                          ? "No uploads match your search."
                          : "No report uploads yet. Upload a CSV or Excel file to get started."}
                      </td>
                    </tr>
                  ) : (
                    uploadPageRows.map((row) => {
                      const busy = actionId === row.id;
                      const isExpanded = expandedUploadId === row.id;
                      const uploadItems = uploadItemsById[row.id] ?? [];
                      const displayItems = uploadItems;
                      const items = itemCountForRow(row, uploadItems);
                      const itemsLoading = uploadItemsLoadingId === row.id;
                      const progress = discoveryProgressByUpload.get(row.id) ?? {
                        total: 0,
                        completed: 0,
                        running: 0,
                      };
                      const completedPercent =
                        progress.total > 0
                          ? Math.round(
                              (progress.completed / progress.total) * 100,
                            )
                          : 0;
                      const isExtracting = isUploadExtracting(row, actionId);
                      const extractionEnd = extractionEndedAt(row);
                      const extractionDurationMs =
                        extractionEnd != null
                          ? new Date(extractionEnd).getTime() -
                            new Date(row.createdAt).getTime()
                          : null;
                      const extractionPercent = extractionProgressPercent(row);
                      const addedRelative = formatRelativeDate(row.createdAt);
                      const addedDate = formatDisplayDate(row.createdAt);

                      return (
                        <Fragment key={row.id}>
                          <tr>
                            <td className="adminPage__td adminPage__th--center">
                              <span
                                className="adminPage__id"
                                title={`Upload ID #${row.id}`}
                              >
                                #{row.id}
                              </span>
                            </td>
                            <td className="adminPage__td adminPage__cellMuted adminPage__nameCol">
                              {row.suggestedName?.trim() || "—"}
                            </td>
                            <td className="adminPage__td adminPage__th--center adminPage__itemsCell">
                              <div className="adminPage__itemsCellWrap">
                                <button
                                  type="button"
                                  className="adminPage__itemsBtn"
                                  onClick={() => toggleUploadDetails(row.id)}
                                  disabled={
                                    items === 0 &&
                                    uploadItems.length === 0 &&
                                    !isExpanded
                                  }
                                  aria-expanded={isExpanded}
                                  aria-label={
                                    items > 0
                                      ? `${items} report URLs`
                                      : "No report URLs"
                                  }
                                >
                                  {isExpanded ? (
                                    <ChevronDown
                                      size={14}
                                      strokeWidth={2}
                                      aria-hidden
                                    />
                                  ) : (
                                    <ChevronRight
                                      size={14}
                                      strokeWidth={2}
                                      aria-hidden
                                    />
                                  )}
                                  {items}
                                </button>
                              </div>
                            </td>
                            <td className="adminPage__td adminPage__discoveryProgressCell">
                              {progress.total > 0 ||
                              progress.completed > 0 ||
                              progress.running > 0 ? (
                                <div
                                  className="adminPage__discoveryProgress"
                                  aria-label={`${progress.completed} completed, ${progress.running} running, ${progress.total} total`}
                                >
                                  <div className="adminPage__discoveryProgressMeta">
                                    <span>
                                      {progress.completed}/{progress.total}{" "}
                                      completed
                                    </span>
                                    {progress.running > 0 ? (
                                      <span>{progress.running} running</span>
                                    ) : progress.completed === progress.total ? (
                                      <span>Complete</span>
                                    ) : null}
                                    {/* <span className="adminPage__cellMuted">Waiting</span> */}
                                  </div>
                                  <div
                                    className="adminPage__discoveryProgressTrack"
                                    role="progressbar"
                                    aria-valuemin={0}
                                    aria-valuemax={progress.total}
                                    aria-valuenow={progress.completed}
                                  >
                                    <span
                                      className="adminPage__discoveryProgressFill"
                                      style={{ width: `${completedPercent}%` }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <span className="adminPage__cellMuted">
                                  No discovery jobs
                                </span>
                              )}
                            </td>
                            <td className="adminPage__td adminPage__addedAtCell">
                              <div className="adminPage__addedAt">
                                <span>{addedRelative}</span>
                                {addedRelative !== addedDate ? (
                                  <span className="adminPage__cellMuted">
                                    {addedDate}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="adminPage__td adminPage__th--center adminPage__extractionTimesCell">
                              {isExtracting ? (
                                <div
                                  className="adminPage__extractionProgress"
                                  role="status"
                                  aria-live="polite"
                                  aria-label={
                                    row.totalRows > 0
                                      ? `Extracting report file, ${extractionPercent}% complete`
                                      : "Parsing report file"
                                  }
                                >
                                  <div className="adminPage__extractionProgressMeta adminPage__extractionProgressMeta--single">
                                    {row.totalRows > 0 ? (
                                      <span>{extractionPercent}%</span>
                                    ) : (
                                      <span>Parsing file…</span>
                                    )}
                                  </div>
                                  <div
                                    className={`adminPage__discoveryProgressTrack${
                                      row.totalRows > 0
                                        ? ""
                                        : " adminPage__discoveryProgressTrack--indeterminate"
                                    }`}
                                    role="progressbar"
                                    aria-valuemin={0}
                                    aria-valuemax={
                                      row.totalRows > 0 ? row.totalRows : undefined
                                    }
                                    aria-valuenow={
                                      row.totalRows > 0
                                        ? row.importedRows
                                        : undefined
                                    }
                                  >
                                    <span
                                      className={`adminPage__discoveryProgressFill${
                                        row.totalRows > 0
                                          ? ""
                                          : " adminPage__discoveryProgressFill--indeterminate"
                                      }`}
                                      style={
                                        row.totalRows > 0
                                          ? { width: `${extractionPercent}%` }
                                          : undefined
                                      }
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className="adminPage__extractionTimes">
                                  {extractionDurationMs != null ? (
                                    <span className="adminPage__cellMuted">
                                      {formatDurationMs(extractionDurationMs)}
                                    </span>
                                  ) : row.extractionStatus === "pending" ? (
                                    <span className="adminPage__cellMuted">
                                      Not extracted
                                    </span>
                                  ) : null}
                                </div>
                              )}
                            </td>
                            <td className="adminPage__td adminPage__th--center adminPage__extractionStatusCell">
                              <span
                                role="status"
                                className={`adminPage__extractionStatusPill ${extractionStatusPillClass(row.extractionStatus)}`}
                                title={
                                  row.errorMessage &&
                                  row.extractionStatus === "failed"
                                    ? row.errorMessage
                                    : undefined
                                }
                              >
                                {extractionStatusLabel(row.extractionStatus)}
                              </span>
                            </td>
                            <td className="adminPage__td adminPage__td--actionsSticky">
                              <div
                                className="adminPage__rowMenuWrap"
                                data-etl-upload-row-menu={row.id}
                              >
                                <button
                                  type="button"
                                  className="adminPage__kebabBtn"
                                  aria-haspopup="menu"
                                  aria-expanded={uploadRowMenuOpenId === row.id}
                                  aria-label={`Actions for upload #${row.id}`}
                                  disabled={busy || uploading}
                                  onClick={(e) => {
                                    const btn = e.currentTarget;
                                    if (uploadRowMenuOpenId === row.id) {
                                      closeUploadRowMenu();
                                      return;
                                    }
                                    const rect = btn.getBoundingClientRect();
                                    setUploadRowMenuPosition(null);
                                    setUploadRowMenuAnchor({
                                      top: rect.top,
                                      bottom: rect.bottom,
                                      left: rect.left,
                                      right: rect.right,
                                    });
                                    setUploadRowMenuOpenId(row.id);
                                  }}
                                >
                                  <MoreHorizontal
                                    size={18}
                                    strokeWidth={2}
                                    aria-hidden
                                  />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="adminPage__itemsExpandRow">
                              <td
                                className="adminPage__td"
                                colSpan={TABLE_COL_SPAN}
                              >
                                <div
                                  className="adminPage__itemsPanel"
                                  role="region"
                                  aria-label={`Report URLs for ${row.suggestedName?.trim() || row.fileName || `upload #${row.id}`}`}
                                >
                                  <p className="adminPage__itemsPanelTitle">
                                    {row.suggestedName?.trim() ||
                                      row.fileName ||
                                      `Upload #${row.id}`}
                                  </p>
                                  {itemsLoading ? (
                                    <p
                                      className="adminPage__itemsPanelEmpty"
                                      role="status"
                                    >
                                      Loading report URLs…
                                    </p>
                                  ) : displayItems.length === 0 ? (
                                    <p
                                      className="adminPage__itemsPanelEmpty"
                                      role="status"
                                    >
                                      {uploadItemsEmptyMessage(row)}
                                    </p>
                                  ) : (
                                    <table className="adminPage__itemsTable">
                                      <colgroup>
                                        <col className="adminPage__itemsColIndex" />
                                        <col />
                                      </colgroup>
                                      <thead>
                                        <tr>
                                          <th scope="col">#</th>
                                          <th scope="col">Report URL</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {displayItems.map((item, index) => (
                                            <tr key={item.id}>
                                              <td>
                                                <span
                                                  className="adminPage__id"
                                                  title={`Item ${index + 1}`}
                                                >
                                                  #{index + 1}
                                                </span>
                                              </td>
                                              <td>
                                                <a
                                                  href={item.url}
                                                  className="adminPage__cellUrl"
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  title={item.url}
                                                >
                                                  {item.url}
                                                </a>
                                              </td>
                                            </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
        </AdminDataTable>
      </section>

      <ReportsUploadDialog
        open={uploadDialogOpen}
        uploading={uploading}
        uploadProgress={uploadProgress}
        reuploadTarget={reuploadTarget}
        onClose={() => {
          if (uploading) return;
          setUploadDialogOpen(false);
          setReuploadTarget(null);
        }}
        onSubmit={(payload) => void handleUploadSubmit(payload)}
      />

      {uploadRowMenuOpenId != null &&
      uploadRowMenuAnchor &&
      uploadRowMenuUpload
        ? createPortal(
            <div
              ref={uploadRowMenuRef}
              className="adminPage__rowMenu adminPage__rowMenu--portal"
              role="menu"
              aria-orientation="vertical"
              data-etl-upload-row-menu-portal={uploadRowMenuOpenId}
              style={{
                top: uploadRowMenuPosition?.top ?? uploadRowMenuAnchor.bottom + 4,
                left: uploadRowMenuPosition?.left ?? uploadRowMenuAnchor.right,
                visibility: uploadRowMenuPosition ? "visible" : "hidden",
              }}
            >
              <button
                type="button"
                className="adminPage__rowMenuItem adminPage__rowMenuItem--extract"
                role="menuitem"
                disabled={uploadRowMenuUpload.status === "processing"}
                onClick={() => {
                  closeUploadRowMenu();
                  void handleExtractUpload(uploadRowMenuUpload.id);
                }}
              >
                <Zap size={14} strokeWidth={2} aria-hidden />
                Extract
              </button>
              <button
                type="button"
                className="adminPage__rowMenuItem"
                role="menuitem"
                disabled={
                  exportUploadId === uploadRowMenuUpload.id ||
                  uploadRowMenuUpload.status === "processing" ||
                  !canExportReportUpload(uploadRowMenuUpload)
                }
                aria-busy={exportUploadId === uploadRowMenuUpload.id}
                onClick={() => {
                  closeUploadRowMenu();
                  void handleExportUpload(uploadRowMenuUpload.id);
                }}
              >
                <Download size={14} strokeWidth={2} aria-hidden />
                {exportUploadId === uploadRowMenuUpload.id
                  ? "Exporting…"
                  : "Export"}
              </button>
              <button
                type="button"
                className="adminPage__rowMenuItem"
                role="menuitem"
                disabled={uploadRowMenuUpload.status === "processing"}
                onClick={() => {
                  closeUploadRowMenu();
                  openReuploadDialog(uploadRowMenuUpload);
                }}
              >
                <Upload size={14} strokeWidth={2} aria-hidden />
                Reupload
              </button>
              <button
                type="button"
                className="adminPage__rowMenuItem adminPage__rowMenuItem--danger"
                role="menuitem"
                onClick={() => {
                  closeUploadRowMenu();
                  void handleArchiveUpload(uploadRowMenuUpload.id);
                }}
              >
                <Archive size={14} strokeWidth={2} aria-hidden />
                Archive
              </button>
            </div>,
            document.body,
          )
        : null}
      <ReportsStartDialog
        open={startDialogOpen}
        uploads={uploads}
        uploadsLoading={uploadsLoading}
        starting={workerStatus === "starting"}
        onClose={() => setStartDialogOpen(false)}
        onStart={(selection) => {
          setStartDialogOpen(false);
          setRunWarmup(true);
          void loadReportsLogs({ silent: true });
          onReportsStart(selection);
        }}
      />
    </>
  );
}
