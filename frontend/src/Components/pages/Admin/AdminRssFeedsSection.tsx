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
  ArchiveRestore,
  CircleX,
  ChevronDown,
  ChevronRight,
  Download,
  FilterX,
  Link2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Tag,
  X,
  Zap,
} from "lucide-react";
import { AdminServiceRow } from "./AdminServiceRow";
import type { ServiceState } from "./adminServices";
import {
  fetchDiscoveryLogs,
  type DiscoveryLogRow,
} from "../../../utils/discoveryLogsApi";
import {
  archiveIngestLink,
  canExportIngestLink,
  extractIngestLink,
  exportIngestLinkItems,
  fetchIngestLinkItems,
  fetchIngestLinks,
  restoreIngestLink,
  updateIngestLink,
  type IngestLinkItemRow,
  type IngestLinkRow,
} from "../../../utils/ingestLinksApi";
import {
  formatDurationMs,
  formatJobExecutedAt,
  formatRelativeDate,
} from "../../../utils/formatDate";
import { usePagination } from "../../../utils/usePagination";
import { DiscoveryStartDialog } from "./DiscoveryStartDialog";
import { UrlIngestionDialog } from "../../common/UrlIngestionDialog";
import { AdminDataTable } from "./AdminDataTable";
import { AdminSortableTh } from "./AdminSortableTh";
import {
  nextTableSort,
  sortByTableState,
  type TableSortState,
} from "./adminTableSort";
import "../Users/usersPage.css";
import "./adminRssFeeds.css";

type RssSubTab = "links" | "logs";
const TERMINAL_DISCOVERY_STATUSES = new Set(["EXECUTED", "SKIPPED", "FAILED"]);
const RUNNING_DISCOVERY_STATUSES = new Set(["PENDING", "RUNNING"]);

function discoveryLogStatusClass(status: string): string {
  switch (status.toUpperCase()) {
    case "EXECUTED":
      return "adminPage__statusPill--done";
    case "FAILED":
      return "adminPage__statusPill--error";
    case "SKIPPED":
      return "adminPage__statusPill--skipped";
    case "PENDING":
    case "RUNNING":
      return "adminPage__statusPill--pending";
    default:
      return "adminPage__statusPill--not-processed";
  }
}

function logMatchesFilters(
  row: DiscoveryLogRow,
  status: string,
  feedId: string,
  search: string,
): boolean {
  if (status !== "all" && row.status.toLowerCase() !== status) {
    return false;
  }
  if (feedId !== "all" && String(row.ingestLinkId) !== feedId) {
    return false;
  }
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.ingestLinkId,
    row.ingestLinkItemId,
    row.extractedUrl,
    row.status,
    row.reason ?? "",
    row.jobId ?? "",
    row.extractedAt ?? "",
    row.executedAt ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

type LinkSortKey =
  | "id"
  | "name"
  | "url"
  | "items"
  | "discovery"
  | "status"
  | "added";

function getLinkSortValue(
  row: IngestLinkRow,
  key: LinkSortKey,
  progress: { completed: number },
): string | number | null {
  switch (key) {
    case "id":
      return row.id;
    case "name":
      return row.suggestedName?.trim() || "";
    case "url":
      return row.url;
    case "items":
      return row.itemCount;
    case "discovery":
      return progress.completed;
    case "status":
      return row.archived ? 1 : 0;
    case "added":
      return row.createdAt;
    default:
      return null;
  }
}

function linkMatchesFilters(
  row: IngestLinkRow,
  status: string,
  items: string,
  feedId: string,
  search: string,
): boolean {
  if (status === "active" && row.archived) {
    return false;
  }
  if (status === "archived" && !row.archived) {
    return false;
  }
  if (items === "with" && row.itemCount <= 0) {
    return false;
  }
  if (items === "without" && row.itemCount > 0) {
    return false;
  }
  if (feedId !== "all" && String(row.id) !== feedId) {
    return false;
  }
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.id,
    row.url,
    row.suggestedName ?? "",
    row.itemCount,
    row.archived ? "archived" : "active",
    formatRelativeDate(row.createdAt),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export type AdminRssFeedsSectionProps = {
  idPrefix: string;
  discoveryStatus: ServiceState;
  discoveryApiRunning: boolean;
  rssTab?: RssSubTab;
  onRssTabChange?: (tab: RssSubTab) => void;
  onDiscoveryStart: (selection: {
    ingestLinkIds: number[];
    ingestLinkItemIds: number[];
  }) => void;
  onDiscoveryStop: () => void;
};

export function AdminRssFeedsSection({
  idPrefix,
  discoveryStatus,
  discoveryApiRunning,
  rssTab: rssTabProp,
  onRssTabChange,
  onDiscoveryStart,
  onDiscoveryStop,
}: AdminRssFeedsSectionProps) {
  const localId = useId();
  const sid = (name: string) => `${idPrefix}-${localId}-${name}`;

  const [internalRssTab, setInternalRssTab] = useState<RssSubTab>("links");
  const rssTab = rssTabProp ?? internalRssTab;
  const setRssTab = onRssTabChange ?? setInternalRssTab;
  const [ingestDialogOpen, setIngestDialogOpen] = useState(false);
  const [linkRows, setLinkRows] = useState<IngestLinkRow[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linkActionId, setLinkActionId] = useState<number | null>(null);
  const [exportLinkId, setExportLinkId] = useState<number | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editSuggestedName, setEditSuggestedName] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [expandedLinkId, setExpandedLinkId] = useState<number | null>(null);
  const [linkItemsFilter, setLinkItemsFilter] = useState("all");
  const [linkStatusFilter, setLinkStatusFilter] = useState("all");
  const [linkFeedFilter, setLinkFeedFilter] = useState("all");
  const [linkSearchQuery, setLinkSearchQuery] = useState("");
  const [linkPageSize, setLinkPageSize] = useState(10);
  const [linkSort, setLinkSort] = useState<TableSortState<LinkSortKey> | null>(
    null,
  );
  const [linkRowMenuOpenId, setLinkRowMenuOpenId] = useState<number | null>(
    null,
  );
  const [linkRowMenuAnchor, setLinkRowMenuAnchor] = useState<{
    top: number;
    bottom: number;
    left: number;
    right: number;
  } | null>(null);
  const [linkRowMenuPosition, setLinkRowMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const linkRowMenuRef = useRef<HTMLDivElement>(null);
  const [feedItems, setFeedItems] = useState<IngestLinkItemRow[]>([]);
  const [feedItemsLoading, setFeedItemsLoading] = useState(false);
  const [discoveryDialogOpen, setDiscoveryDialogOpen] = useState(false);

  const [logRows, setLogRows] = useState<DiscoveryLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [logStatusFilter, setLogStatusFilter] = useState("all");
  const [logFeedFilter, setLogFeedFilter] = useState("all");
  const [logSearchQuery, setLogSearchQuery] = useState("");
  const [logPageSize, setLogPageSize] = useState(10);

  const loadRssLogs = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setLogsLoading(true);
    else setLogsRefreshing(true);

    try {
      const result = await fetchDiscoveryLogs();
      if (!result.ok) {
        if (!silent) {
          toast.error(result.message, { autoClose: 3000 });
        }
        return;
      }
      setLogRows(result.logs);
    } catch {
      if (!silent) {
        toast.error("Network error while loading discovery logs.", {
          autoClose: 3000,
        });
      }
    } finally {
      setLogsLoading(false);
      setLogsRefreshing(false);
    }
  }, []);

  const loadIngestLinks = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      setLinkRows([]);
      return;
    }

    setLinksLoading(true);
    try {
      const result = await fetchIngestLinks();
      if (!result.ok) {
        toast.error(result.message, { autoClose: 3000 });
        return;
      }
      setLinkRows(result.links ?? []);
    } finally {
      setLinksLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIngestLinks();
  }, [loadIngestLinks]);

  const closeLinkRowMenu = useCallback(() => {
    setLinkRowMenuOpenId(null);
    setLinkRowMenuAnchor(null);
    setLinkRowMenuPosition(null);
  }, []);

  useLayoutEffect(() => {
    if (!linkRowMenuOpenId || !linkRowMenuAnchor || !linkRowMenuRef.current) {
      setLinkRowMenuPosition(null);
      return;
    }

    const menu = linkRowMenuRef.current;
    const margin = 8;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;

    let top = linkRowMenuAnchor.bottom + 4;
    let left = linkRowMenuAnchor.right - width;

    if (left < margin) left = margin;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }

    if (top + height > window.innerHeight - margin) {
      top = linkRowMenuAnchor.top - height - 4;
    }
    if (top < margin) top = margin;

    setLinkRowMenuPosition({ top, left });
  }, [linkRowMenuOpenId, linkRowMenuAnchor]);

  useEffect(() => {
    if (linkRowMenuOpenId == null) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const wrap = document.querySelector(
        `[data-rss-feed-row-menu="${linkRowMenuOpenId}"]`,
      );
      const portal = document.querySelector(
        `[data-rss-feed-row-menu-portal="${linkRowMenuOpenId}"]`,
      );
      if (wrap?.contains(target) || portal?.contains(target)) return;
      closeLinkRowMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLinkRowMenu();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [linkRowMenuOpenId, closeLinkRowMenu]);

  useEffect(() => {
    if (linkRowMenuOpenId == null) return;
    const onScrollOrResize = () => closeLinkRowMenu();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [linkRowMenuOpenId, closeLinkRowMenu]);

  useEffect(() => {
    if (rssTab !== "logs") return;
    void loadRssLogs();
  }, [rssTab, loadRssLogs]);

  useEffect(() => {
    if (rssTab !== "links") return;
    void loadRssLogs({ silent: true });
  }, [rssTab, loadRssLogs]);

  useEffect(() => {
    if (rssTab !== "links") return;
    if (discoveryStatus !== "starting" && discoveryStatus !== "running") return;
    const timer = window.setInterval(() => {
      void loadRssLogs({ silent: true });
    }, 7000);
    return () => window.clearInterval(timer);
  }, [discoveryStatus, rssTab, loadRssLogs]);

  useEffect(() => {
    if (!discoveryDialogOpen) return;
    void loadIngestLinks();
  }, [discoveryDialogOpen, loadIngestLinks]);

  useEffect(() => {
    if (discoveryStatus === "starting" || discoveryStatus === "running") return;
    if (rssTab !== "logs") return;
    void loadRssLogs({ silent: true });
  }, [discoveryStatus, rssTab, loadRssLogs]);

  const startEditLink = (row: IngestLinkRow) => {
    setEditTargetId(row.id);
    setEditUrl(row.url);
    setEditSuggestedName(row.suggestedName ?? "");
    setEditDialogOpen(true);
  };

  const closeEditDialog = () => {
    if (editSaving) return;
    setEditDialogOpen(false);
    setEditTargetId(null);
    setEditUrl("");
    setEditSuggestedName("");
  };

  const handleSaveLink = async () => {
    if (editTargetId == null) return;
    const url = editUrl.trim();
    if (!url) {
      toast.error("Enter a URL.", { autoClose: 2500 });
      return;
    }

    setEditSaving(true);
    try {
      const result = await updateIngestLink(
        editTargetId,
        url,
        editSuggestedName,
      );
      if (!result.ok) {
        toast.error(result.message, { autoClose: 4000 });
        return;
      }
      toast.success(result.message, { autoClose: 2800 });
      closeEditDialog();
      void loadIngestLinks();
    } finally {
      setEditSaving(false);
    }
  };

  const loadFeedItems = useCallback(async (ingestLinkId: number) => {
    setFeedItemsLoading(true);
    try {
      const result = await fetchIngestLinkItems(ingestLinkId);
      if (!result.ok) {
        toast.error(result.message, { autoClose: 3000 });
        setFeedItems([]);
        return;
      }
      setFeedItems(result.items);
    } finally {
      setFeedItemsLoading(false);
    }
  }, []);

  const toggleFeedItems = (ingestLinkId: number) => {
    if (expandedLinkId === ingestLinkId) {
      setExpandedLinkId(null);
      setFeedItems([]);
      return;
    }
    setExpandedLinkId(ingestLinkId);
    void loadFeedItems(ingestLinkId);
  };

  const handleExtractLink = async (id: number) => {
    const feed = linkRows.find((row) => row.id === id);
    const feedLabel =
      feed?.suggestedName?.trim() || feed?.url || `feed #${id}`;
    toast.info(`Extracting links from ${feedLabel}…`, { autoClose: 3000 });

    setLinkActionId(id);
    try {
      const result = await extractIngestLink(id);
      if (!result.ok) {
        toast.error(result.message, { autoClose: 4000 });
        return;
      }
      toast.success(result.message, { autoClose: 4500 });
      void loadIngestLinks();
      if (expandedLinkId === id) {
        void loadFeedItems(id);
      } else {
        setExpandedLinkId(id);
        void loadFeedItems(id);
      }
    } finally {
      setLinkActionId(null);
    }
  };

  async function handleExportLink(id: number) {
    setExportLinkId(id);
    const result = await exportIngestLinkItems(id);
    setExportLinkId(null);

    if (!result.ok) {
      toast.error(result.message, { autoClose: 3000 });
      return;
    }

    toast.success(`Exported ${result.fileName}.`, { autoClose: 2800 });
  }

  const handleArchiveLink = async (id: number) => {
    setLinkActionId(id);
    try {
      const result = await archiveIngestLink(id);
      if (!result.ok) {
        toast.error(result.message, { autoClose: 4000 });
        return;
      }
      toast.success(result.message, { autoClose: 2800 });
      if (editTargetId === id) closeEditDialog();
      if (expandedLinkId === id) {
        setExpandedLinkId(null);
        setFeedItems([]);
      }
      void loadIngestLinks();
    } finally {
      setLinkActionId(null);
    }
  };

  const handleRestoreLink = async (id: number) => {
    setLinkActionId(id);
    try {
      const result = await restoreIngestLink(id);
      if (!result.ok) {
        toast.error(result.message, { autoClose: 4000 });
        return;
      }
      toast.success(result.message, { autoClose: 2800 });
      setLinkRows((prev) =>
        prev.map((row) => (row.id === id ? result.link : row)),
      );
      void loadIngestLinks();
    } finally {
      setLinkActionId(null);
    }
  };

  const activeLinkRows = useMemo(
    () => linkRows.filter((row) => !row.archived),
    [linkRows],
  );
  const activeLinkIds = useMemo(
    () => new Set(activeLinkRows.map((row) => row.id)),
    [activeLinkRows],
  );

  const linksColSpan = 8;
  const logsColSpan = 7;
  const linkFeedOptions = useMemo(
    () =>
      [...new Set(linkRows.map((row) => row.id))]
        .sort((a, b) => a - b)
        .map(String),
    [linkRows],
  );
  const filteredLinkRows = useMemo(
    () =>
      (linkRows ?? []).filter((row) =>
        linkMatchesFilters(
          row,
          linkStatusFilter,
          linkItemsFilter,
          linkFeedFilter,
          linkSearchQuery,
        ),
      ),
    [linkRows, linkStatusFilter, linkItemsFilter, linkFeedFilter, linkSearchQuery],
  );

  const linkRowMenuFeed = useMemo(() => {
    if (linkRowMenuOpenId == null) return null;
    return linkRows.find((row) => row.id === linkRowMenuOpenId) ?? null;
  }, [linkRowMenuOpenId, linkRows]);

  useEffect(() => {
    if (linkRowMenuOpenId != null && !linkRowMenuFeed) {
      closeLinkRowMenu();
    }
  }, [linkRowMenuOpenId, linkRowMenuFeed, closeLinkRowMenu]);

  const discoveryProgressByFeed = useMemo(() => {
    const map = new Map<
      number,
      { total: number; completed: number; running: number }
    >();

    for (const link of linkRows) {
      if (!activeLinkIds.has(link.id)) continue;
      map.set(link.id, {
        total: link.itemCount,
        completed: 0,
        running: 0,
      });
    }

    const latestByItem = new Map<string, DiscoveryLogRow>();
    for (const row of logRows) {
      if (!row.ingestLinkId || !activeLinkIds.has(row.ingestLinkId)) continue;
      const key =
        row.ingestLinkItemId > 0
          ? `${row.ingestLinkId}:${row.ingestLinkItemId}`
          : `${row.ingestLinkId}:${row.extractedUrl}`;
      const existing = latestByItem.get(key);
      if (!existing || (row.jobId ?? 0) > (existing.jobId ?? 0)) {
        latestByItem.set(key, row);
      }
    }

    for (const row of latestByItem.values()) {
      const current = map.get(row.ingestLinkId);
      if (!current) continue;
      const status = row.status.toUpperCase();
      if (TERMINAL_DISCOVERY_STATUSES.has(status)) {
        current.completed += 1;
      } else if (RUNNING_DISCOVERY_STATUSES.has(status)) {
        current.running += 1;
      }
      map.set(row.ingestLinkId, current);
    }

    return map;
  }, [logRows, activeLinkIds, linkRows]);

  const sortedLinkRows = useMemo(() => {
    if (!linkSort) return filteredLinkRows;

    return sortByTableState(filteredLinkRows, linkSort, (row, key) =>
      getLinkSortValue(
        row,
        key,
        discoveryProgressByFeed.get(row.id) ?? { completed: 0 },
      ),
    );
  }, [filteredLinkRows, linkSort, discoveryProgressByFeed]);

  const linkPager = usePagination({
    items: sortedLinkRows,
    pageSize: linkPageSize,
    resetKey: `${linkStatusFilter}|${linkItemsFilter}|${linkFeedFilter}|${linkSearchQuery}|${linkSort?.key ?? ""}|${linkSort?.direction ?? ""}`,
  });
  const linkPageRows = linkPager.pageItems ?? [];

  useEffect(() => {
    closeLinkRowMenu();
  }, [linkPager.page, closeLinkRowMenu]);

  const logsPerFeedIndex = useMemo(() => {
    const byFeed = new Map<number, DiscoveryLogRow[]>();
    for (const row of logRows) {
      if (!row.ingestLinkId || !activeLinkIds.has(row.ingestLinkId)) continue;
      const bucket = byFeed.get(row.ingestLinkId) ?? [];
      bucket.push(row);
      byFeed.set(row.ingestLinkId, bucket);
    }

    const indexByItemId = new Map<number, number>();
    for (const feedRows of byFeed.values()) {
      const sorted = [...feedRows].sort(
        (a, b) => (a.jobId ?? 0) - (b.jobId ?? 0),
      );
      sorted.forEach((row, index) => {
        if (row.ingestLinkItemId > 0) {
          indexByItemId.set(row.ingestLinkItemId, index + 1);
        }
      });
    }
    return indexByItemId;
  }, [logRows, activeLinkIds]);
  const logFeedOptions = useMemo(
    () =>
      [...new Set(
        logRows
          .map((row) => row.ingestLinkId)
          .filter((id) => activeLinkIds.has(id)),
      )]
        .sort((a, b) => a - b)
        .map(String),
    [logRows, activeLinkIds],
  );
  const filteredLogRows = useMemo(
    () =>
      logRows.filter(
        (row) =>
          activeLinkIds.has(row.ingestLinkId) &&
          logMatchesFilters(row, logStatusFilter, logFeedFilter, logSearchQuery),
      ),
    [logRows, activeLinkIds, logStatusFilter, logFeedFilter, logSearchQuery],
  );
  const logPager = usePagination({
    items: filteredLogRows,
    pageSize: logPageSize,
    resetKey: `${logStatusFilter}|${logFeedFilter}|${logSearchQuery}`,
  });

  return (
    <div className="adminPage__rssPanel">
      {editDialogOpen ? (
        <div
          className="usersPage__overlay"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) closeEditDialog();
          }}
        >
          <div className="usersPage__dialog" role="dialog" aria-modal="true">
            <div className="usersPage__dialogHead">
              <h2 className="usersPage__dialogTitle">Modify feed</h2>
              <button
                type="button"
                className="usersPage__dialogClose"
                onClick={closeEditDialog}
                disabled={editSaving}
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
            <div className="usersPage__dialogBody">
              <label className="usersPage__label usersPage__label--withIcon">
                <Tag
                  className="usersPage__labelIcon"
                  size={16}
                  strokeWidth={2}
                  aria-hidden
                />
                <span>URL Name</span>
              </label>
              <input
                type="text"
                className="usersPage__input"
                placeholder="URL Name"
                value={editSuggestedName}
                onChange={(e) => setEditSuggestedName(e.target.value)}
                autoComplete="off"
                maxLength={256}
                disabled={editSaving}
              />
              <label className="usersPage__label usersPage__label--withIcon">
                <Link2
                  className="usersPage__labelIcon"
                  size={16}
                  strokeWidth={2}
                  aria-hidden
                />
                <span>URL Link</span>
              </label>
              <input
                type="url"
                className="usersPage__input"
                placeholder="https://feeds.example.com/rss.xml"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                autoComplete="off"
                disabled={editSaving}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSaveLink();
                  }
                }}
              />
              <div className="usersPage__dialogActions">
                <button
                  type="button"
                  className="usersPage__btn usersPage__btn--logoutTone"
                  onClick={closeEditDialog}
                  disabled={editSaving}
                >
                  <CircleX size={16} strokeWidth={1.75} aria-hidden />
                  Cancel
                </button>
                <button
                  type="button"
                  className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
                  onClick={() => void handleSaveLink()}
                  disabled={editSaving}
                >
                  <Play size={16} strokeWidth={2} aria-hidden />
                  {editSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <UrlIngestionDialog
        open={ingestDialogOpen}
        onClose={() => setIngestDialogOpen(false)}
        onEnqueued={() => void loadIngestLinks()}
      />
      <DiscoveryStartDialog
        open={discoveryDialogOpen}
        links={activeLinkRows}
        logs={logRows}
        linksLoading={linksLoading}
        starting={discoveryStatus === "starting"}
        onClose={() => setDiscoveryDialogOpen(false)}
        onStart={(selection) => {
          setDiscoveryDialogOpen(false);
          onDiscoveryStart(selection);
        }}
      />
      <section
        className="adminPage__card"
        aria-labelledby={sid("discovery-title")}
      >
        <div className="adminPage__cardHead">
          <span className="settingsPage__cardIconWrap" aria-hidden>
            <Rss size={20} strokeWidth={2} />
          </span>
          <div className="adminPage__cardHeadText">
            <h2 id={sid("discovery-title")} className="adminPage__cardTitle">
             RSS Discovery service
            </h2>
            <p className="adminPage__cardHint">
              Enqueues ingest jobs for extracted article URLs on selected feeds.
              Manual runs and cron schedules use the same logs below. Run Extract
              on each feed before starting discovery.
            </p>
          </div>
        </div>
        <ul className="adminPage__serviceList">
          <AdminServiceRow
            label="RSS Discovery Service"
            status={discoveryStatus}
            apiRunning={discoveryApiRunning}
            onStart={() => setDiscoveryDialogOpen(true)}
            onStop={onDiscoveryStop}
          />
        </ul>
      </section>

      <section
        className="adminPage__rssWorkspace"
        aria-labelledby={sid("rss-workspace-title")}
      >
        <div className="adminPage__rssWorkspaceHead">
          <div className="adminPage__rssWorkspaceTopRow">
            <div
              className="adminPage__tabs adminPage__tabs--sub"
              role="tablist"
              aria-label="RSS feeds sections"
            >
              <button
                type="button"
                role="tab"
                aria-selected={rssTab === "links"}
                className={`adminPage__tab${rssTab === "links" ? " adminPage__tab--selected" : ""}`}
                onClick={() => setRssTab("links")}
              >
                Links
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rssTab === "logs"}
                className={`adminPage__tab${rssTab === "logs" ? " adminPage__tab--selected" : ""}`}
                onClick={() => setRssTab("logs")}
              >
                Logs
              </button>
            </div>
            {rssTab === "links" ? (
              <button
                type="button"
                className="usersPage__inviteBtn adminPage__rssIngestBtn"
                onClick={() => setIngestDialogOpen(true)}
              >
                <Plus size={18} strokeWidth={2} aria-hidden />
                Ingest
              </button>
            ) : rssTab === "logs" ? (
              <button
                type="button"
                className="usersPage__inviteBtn adminPage__rssRefreshBtn"
                onClick={() => void loadRssLogs({ silent: true })}
                disabled={logsLoading || logsRefreshing}
                aria-busy={logsLoading || logsRefreshing}
              >
                <RefreshCw
                  size={16}
                  strokeWidth={2}
                  className={
                    logsRefreshing ? "pageHeader__refreshIcon--spin" : undefined
                  }
                  aria-hidden
                />
                Refresh
              </button>
            ) : null}
          </div>
        </div>

        {rssTab === "links" && (
            <AdminDataTable
              ariaLabel="Feed URLs"
              wrapClassName="adminPage__tableWrap--links"
              filters={
            <section
              className="adminPage__dataFilters"
              aria-label="Filter feeds"
            >
              <div className="adminPage__linksFilter">
                <label htmlFor={sid("links-filter-status")}>STATUS</label>
                <select
                  id={sid("links-filter-status")}
                  value={linkStatusFilter}
                  onChange={(e) => setLinkStatusFilter(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All</option>
                </select>
              </div>
              <div className="adminPage__linksFilter">
                <label htmlFor={sid("links-filter-items")}>ITEMS</label>
                <select
                  id={sid("links-filter-items")}
                  value={linkItemsFilter}
                  onChange={(e) => setLinkItemsFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="with">With extracted links</option>
                  <option value="without">Without extracted links</option>
                </select>
              </div>
              <div className="adminPage__linksFilter">
                <label htmlFor={sid("links-filter-feed")}>FEED</label>
                <select
                  id={sid("links-filter-feed")}
                  value={linkFeedFilter}
                  onChange={(e) => setLinkFeedFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  {linkFeedOptions.map((id) => (
                    <option key={id} value={id}>
                      #{id}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="adminPage__linksClearBtn"
                onClick={() => {
                  setLinkStatusFilter("all");
                  setLinkItemsFilter("all");
                  setLinkFeedFilter("all");
                  setLinkSearchQuery("");
                }}
                aria-label="Clear filters"
                data-tooltip="Clear filters"
              >
                <FilterX size={18} strokeWidth={2} aria-hidden />
              </button>
              <div className="adminPage__linksSearchWrap">
                <Search
                  className="adminPage__linksSearchIcon"
                  size={18}
                  strokeWidth={2}
                  aria-hidden
                />
                <input
                  id={sid("links-filter-search")}
                  type="search"
                  className="adminPage__linksSearchInput"
                  placeholder="Search feed ID, URL, name…"
                  value={linkSearchQuery}
                  onChange={(e) => setLinkSearchQuery(e.target.value)}
                  autoComplete="off"
                  enterKeyHint="search"
                  aria-label="Search feeds"
                />
              </div>
            </section>
              }
              pagination={{
                page: linkPager.page,
                pageCount: linkPager.pageCount,
                total: linkPager.total,
                pageSize: linkPager.pageSize,
                from: linkPager.from,
                to: linkPager.to,
                onPageChange: linkPager.setPage,
                onPageSizeChange: setLinkPageSize,
              }}
            >
                  <table className="adminPage__table adminPage__table--links">
                    <colgroup>
                      <col className="adminPage__colId" />
                      <col className="adminPage__colName" />
                      <col className="adminPage__colUrl" />
                      <col className="adminPage__colItems" />
                      <col className="adminPage__colDiscovery" />
                      <col className="adminPage__colStatus" />
                      <col className="adminPage__colAdded" />
                      <col className="adminPage__colActions" />
                    </colgroup>
                    <thead>
                      <tr>
                        <AdminSortableTh
                          label="ID"
                          sortKey="id"
                          sort={linkSort}
                          onSort={(key) =>
                            setLinkSort((current) => nextTableSort(current, key))
                          }
                          className="adminPage__th--center"
                        />
                        <AdminSortableTh
                          label="Suggested name"
                          sortKey="name"
                          sort={linkSort}
                          onSort={(key) =>
                            setLinkSort((current) => nextTableSort(current, key))
                          }
                          className="adminPage__nameCol"
                        />
                        <AdminSortableTh
                          label="Feed URL"
                          sortKey="url"
                          sort={linkSort}
                          onSort={(key) =>
                            setLinkSort((current) => nextTableSort(current, key))
                          }
                          className="adminPage__feedUrlCol"
                        />
                        <AdminSortableTh
                          label="Items"
                          sortKey="items"
                          sort={linkSort}
                          onSort={(key) =>
                            setLinkSort((current) => nextTableSort(current, key))
                          }
                          className="adminPage__th--center"
                        />
                        <AdminSortableTh
                          label="RSS Discovery progress"
                          sortKey="discovery"
                          sort={linkSort}
                          onSort={(key) =>
                            setLinkSort((current) => nextTableSort(current, key))
                          }
                          className="adminPage__th--discovery"
                        />
                        <AdminSortableTh
                          label="Status"
                          sortKey="status"
                          sort={linkSort}
                          onSort={(key) =>
                            setLinkSort((current) => nextTableSort(current, key))
                          }
                          className="adminPage__th--center"
                        />
                        <AdminSortableTh
                          label="Added"
                          sortKey="added"
                          sort={linkSort}
                          onSort={(key) =>
                            setLinkSort((current) => nextTableSort(current, key))
                          }
                        />
                        <th
                          scope="col"
                          className="adminPage__th adminPage__th--actions adminPage__th--actionsSticky"
                        >
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {linksLoading && filteredLinkRows.length === 0 ? (
                        <tr>
                          <td
                            className="adminPage__td adminPage__emptyCell"
                            colSpan={linksColSpan}
                          >
                            Loading feeds…
                          </td>
                        </tr>
                      ) : filteredLinkRows.length === 0 ? (
                        <tr>
                          <td
                            className="adminPage__td adminPage__emptyCell"
                            colSpan={linksColSpan}
                          >
                            {linkSearchQuery.trim() ||
                            linkStatusFilter !== "all" ||
                            linkItemsFilter !== "all" ||
                            linkFeedFilter !== "all"
                              ? "No feeds match your filters."
                              : "No feeds yet. Add an RSS or Atom feed URL above."}
                          </td>
                        </tr>
                      ) : (
                        linkPageRows.map((row) => {
                          const busy = linkActionId === row.id;
                          const isExpanded = expandedLinkId === row.id;
                          const isArchived = row.archived;
                          const progress = discoveryProgressByFeed.get(
                            row.id,
                          ) ?? {
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

                          return (
                            <Fragment key={row.id}>
                              <tr
                                className={
                                  isArchived
                                    ? "adminPage__tableRow--archived"
                                    : undefined
                                }
                              >
                                <td className="adminPage__td adminPage__th--center">
                                  <span
                                    className="adminPage__id"
                                    title={`Feed ID #${row.id}`}
                                  >
                                    #{row.id}
                                  </span>
                                </td>
                                <td className="adminPage__td adminPage__cellMuted adminPage__nameCol">
                                  {row.suggestedName?.trim() || "—"}
                                </td>
                                <td className="adminPage__td adminPage__feedUrlCol">
                                  <a
                                    href={row.url}
                                    className="adminPage__cellUrl"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={row.url}
                                  >
                                    {row.url}
                                  </a>
                                </td>
                                <td className="adminPage__td adminPage__th--center adminPage__itemsCell">
                                  <div className="adminPage__itemsCellWrap">
                                    <button
                                      type="button"
                                      className="adminPage__itemsBtn"
                                      onClick={() => toggleFeedItems(row.id)}
                                      disabled={
                                        row.itemCount === 0 && !isExpanded
                                      }
                                      aria-expanded={isExpanded}
                                      aria-label={
                                        row.itemCount > 0
                                          ? `${row.itemCount} extracted links`
                                          : "No extracted links"
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
                                      {row.itemCount}
                                    </button>
                                  </div>
                                </td>
                                <td className="adminPage__td adminPage__discoveryProgressCell">
                                  {progress.total > 0 || progress.completed > 0 || progress.running > 0 ? (
                                    <div
                                      className="adminPage__discoveryProgress"
                                      aria-label={`${progress.completed} completed, ${progress.running} running, ${progress.total} total`}
                                    >
                                      <div className="adminPage__discoveryProgressMeta">
                                        <span>
                                          {progress.completed}/{progress.total}{" "}
                                          completed
                                        </span>
                                        <span>{progress.running} running</span>
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
                                          style={{
                                            width: `${completedPercent}%`,
                                          }}
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="adminPage__cellMuted">
                                      No discovery jobs
                                    </span>
                                  )}
                                </td>
                                <td className="adminPage__td adminPage__td--center adminPage__feedStatusCell">
                                  <span
                                    className={`adminPage__statusPill adminPage__feedStatusPill ${
                                      isArchived
                                        ? "adminPage__statusPill--archived"
                                        : "adminPage__statusPill--done"
                                    }`}
                                  >
                                    {isArchived ? "Archived" : "Active"}
                                  </span>
                                </td>
                                <td className="adminPage__td adminPage__cellMuted">
                                  {formatRelativeDate(row.createdAt)}
                                </td>
                                <td className="adminPage__td adminPage__td--actionsSticky">
                                  <div
                                    className="adminPage__rowMenuWrap"
                                    data-rss-feed-row-menu={row.id}
                                  >
                                    <button
                                      type="button"
                                      className="adminPage__kebabBtn"
                                      aria-haspopup="menu"
                                      aria-expanded={linkRowMenuOpenId === row.id}
                                      aria-label={`Actions for feed #${row.id}`}
                                      disabled={busy || editSaving}
                                      onClick={(e) => {
                                        const btn = e.currentTarget;
                                        if (linkRowMenuOpenId === row.id) {
                                          closeLinkRowMenu();
                                          return;
                                        }
                                        const rect = btn.getBoundingClientRect();
                                        setLinkRowMenuPosition(null);
                                        setLinkRowMenuAnchor({
                                          top: rect.top,
                                          bottom: rect.bottom,
                                          left: rect.left,
                                          right: rect.right,
                                        });
                                        setLinkRowMenuOpenId(row.id);
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
                                    colSpan={linksColSpan}
                                  >
                                    <div
                                      className="adminPage__itemsPanel"
                                      role="region"
                                      aria-label={`Extracted links for feed #${row.id}`}
                                    >
                                      <p className="adminPage__itemsPanelTitle">
                                        {row.suggestedName?.trim() ||
                                          `Feed #${row.id}`}
                                      </p>
                                      {feedItemsLoading ? (
                                        <p
                                          className="adminPage__itemsPanelEmpty"
                                          role="status"
                                        >
                                          Loading item links…
                                        </p>
                                      ) : feedItems.length === 0 ? (
                                        <p
                                          className="adminPage__itemsPanelEmpty"
                                          role="status"
                                        >
                                          No links stored yet. Use Extract on
                                          this feed.
                                        </p>
                                      ) : (
                                        <table className="adminPage__itemsTable">
                                          <thead>
                                            <tr>
                                              <th scope="col">#</th>
                                              <th scope="col">Article URL</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {feedItems.map((item, index) => (
                                              <tr key={item.id}>
                                                <td>
                                                  <span
                                                    className="adminPage__id"
                                                    title={`Item ID #${item.id}`}
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
        )}

        {rssTab === "logs" && (
            <AdminDataTable
              ariaLabel="Discovery logs"
              wrapClassName="adminPage__tableWrap--logs"
              filters={
            <section
              className="adminPage__dataFilters"
              aria-label="Filter logs"
            >
              <div className="adminPage__logsFilter">
                <label htmlFor={sid("logs-filter-status")}>STATUS</label>
                <select
                  id={sid("logs-filter-status")}
                  value={logStatusFilter}
                  onChange={(e) => setLogStatusFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="running">Running</option>
                  <option value="executed">Executed</option>
                  <option value="skipped">Skipped</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <div className="adminPage__logsFilter">
                <label htmlFor={sid("logs-filter-feed")}>FEED</label>
                <select
                  id={sid("logs-filter-feed")}
                  value={logFeedFilter}
                  onChange={(e) => setLogFeedFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  {logFeedOptions.map((id) => (
                    <option key={id} value={id}>
                      #{id}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="adminPage__logsClearBtn"
                onClick={() => {
                  setLogStatusFilter("all");
                  setLogFeedFilter("all");
                  setLogSearchQuery("");
                }}
                aria-label="Clear filters"
                data-tooltip="Clear filters"
              >
                <FilterX size={18} strokeWidth={2} aria-hidden />
              </button>
              <div className="adminPage__logsSearchWrap">
                <Search
                  className="adminPage__logsSearchIcon"
                  size={18}
                  strokeWidth={2}
                  aria-hidden
                />
                <input
                  id={sid("logs-filter-search")}
                  type="search"
                  className="adminPage__logsSearchInput"
                  placeholder="Search URL, feed, extracted, reason…"
                  value={logSearchQuery}
                  onChange={(e) => setLogSearchQuery(e.target.value)}
                  autoComplete="off"
                  enterKeyHint="search"
                  aria-label="Search RSS logs"
                />
              </div>
            </section>
              }
              pagination={{
                page: logPager.page,
                pageCount: logPager.pageCount,
                total: logPager.total,
                pageSize: logPager.pageSize,
                from: logPager.from,
                to: logPager.to,
                onPageChange: logPager.setPage,
                onPageSizeChange: setLogPageSize,
              }}
            >
                  <table className="adminPage__table adminPage__table--logs">
                    <colgroup>
                      <col className="adminPage__colLogFeedId" />
                      <col className="adminPage__colLogExtracted" />
                      <col className="adminPage__colLogJob" />
                      <col className="adminPage__colLogUrl" />
                      <col className="adminPage__colLogReason" />
                      <col className="adminPage__colLogStatus" />
                      <col className="adminPage__colLogExecution" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          className="adminPage__th adminPage__th--center"
                        >
                          Feed ID
                        </th>
                        <th
                          scope="col"
                          className="adminPage__th adminPage__th--center"
                        >
                          Extracted
                        </th>
                        <th
                          scope="col"
                          className="adminPage__th adminPage__th--center"
                        >
                          Job
                        </th>
                        <th scope="col" className="adminPage__th">
                          Extracted link
                        </th>
                        <th scope="col" className="adminPage__th">
                          Reason
                        </th>
                        <th
                          scope="col"
                          className="adminPage__th adminPage__th--center"
                        >
                          Status
                        </th>
                        <th scope="col" className="adminPage__th">
                          Execution time
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {logsLoading && filteredLogRows.length === 0 ? (
                        <tr>
                          <td
                            className="adminPage__td adminPage__emptyCell"
                            colSpan={logsColSpan}
                          >
                            Loading discovery logs…
                          </td>
                        </tr>
                      ) : filteredLogRows.length === 0 ? (
                        <tr>
                          <td
                            className="adminPage__td adminPage__emptyCell"
                            colSpan={logsColSpan}
                          >
                            {logSearchQuery.trim() ||
                            logStatusFilter !== "all" ||
                            logFeedFilter !== "all"
                              ? "No logs match your filters."
                              : "No discovery runs yet. Start discovery manually or save a cron schedule to queue URLs."}
                          </td>
                        </tr>
                      ) : (
                        logPager.pageItems.map((row) => (
                          <tr
                            key={`${row.ingestLinkItemId}-${row.jobId ?? "none"}`}
                          >
                            <td className="adminPage__td adminPage__td--center">
                              <span className="adminPage__id">
                                #{row.ingestLinkId}
                              </span>
                            </td>
                            <td className="adminPage__td adminPage__td--center">
                              <span
                                className="adminPage__id"
                                title={`Extracted item ID #${row.ingestLinkItemId}`}
                              >
                                #
                                {logsPerFeedIndex.get(row.ingestLinkItemId) ??
                                  1}
                              </span>
                            </td>
                            <td className="adminPage__td adminPage__td--center">
                              {row.jobId != null ? (
                                <span className="adminPage__id">
                                  #{row.jobId}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="adminPage__td">
                              <a
                                href={row.extractedUrl}
                                className="adminPage__cellUrl"
                                target="_blank"
                                rel="noopener noreferrer"
                                title={row.extractedUrl}
                              >
                                {row.extractedUrl}
                              </a>
                            </td>
                            <td className="adminPage__td adminPage__cellMuted adminPage__reasonCell">
                              {row.reason || "—"}
                            </td>
                            <td className="adminPage__td adminPage__td--center">
                              <span
                                className={`adminPage__statusPill ${discoveryLogStatusClass(row.status)}`}
                              >
                                {row.status}
                              </span>
                            </td>

                            <td className="adminPage__td adminPage__executionTimeCell">
                              <div className="adminPage__executionCell">
                                <span className="adminPage__executionDuration">
                                  {formatDurationMs(row.executionMs)}
                                </span>
                                <span className="adminPage__executionAt">
                                  {formatJobExecutedAt(row.executedAt)}
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
            </AdminDataTable>
        )}
      </section>

      {linkRowMenuOpenId != null &&
      linkRowMenuAnchor &&
      linkRowMenuFeed
        ? createPortal(
            <div
              ref={linkRowMenuRef}
              className="adminPage__rowMenu adminPage__rowMenu--portal"
              role="menu"
              aria-orientation="vertical"
              data-rss-feed-row-menu-portal={linkRowMenuOpenId}
              style={{
                top: linkRowMenuPosition?.top ?? linkRowMenuAnchor.bottom + 4,
                left: linkRowMenuPosition?.left ?? linkRowMenuAnchor.right,
                visibility: linkRowMenuPosition ? "visible" : "hidden",
              }}
            >
              {linkRowMenuFeed.archived ? (
                <>
                  <button
                    type="button"
                    className="adminPage__rowMenuItem"
                    role="menuitem"
                    disabled={
                      exportLinkId === linkRowMenuFeed.id ||
                      !canExportIngestLink(linkRowMenuFeed)
                    }
                    aria-busy={exportLinkId === linkRowMenuFeed.id}
                    onClick={() => {
                      closeLinkRowMenu();
                      void handleExportLink(linkRowMenuFeed.id);
                    }}
                  >
                    <Download size={14} strokeWidth={2} aria-hidden />
                    {exportLinkId === linkRowMenuFeed.id
                      ? "Exporting…"
                      : "Export"}
                  </button>
                  <button
                    type="button"
                    className="adminPage__rowMenuItem adminPage__rowMenuItem--restore"
                    role="menuitem"
                    onClick={() => {
                      closeLinkRowMenu();
                      void handleRestoreLink(linkRowMenuFeed.id);
                    }}
                  >
                    <ArchiveRestore size={14} strokeWidth={2} aria-hidden />
                    Restore
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="adminPage__rowMenuItem adminPage__rowMenuItem--extract"
                    role="menuitem"
                    onClick={() => {
                      closeLinkRowMenu();
                      void handleExtractLink(linkRowMenuFeed.id);
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
                      exportLinkId === linkRowMenuFeed.id ||
                      !canExportIngestLink(linkRowMenuFeed)
                    }
                    aria-busy={exportLinkId === linkRowMenuFeed.id}
                    onClick={() => {
                      closeLinkRowMenu();
                      void handleExportLink(linkRowMenuFeed.id);
                    }}
                  >
                    <Download size={14} strokeWidth={2} aria-hidden />
                    {exportLinkId === linkRowMenuFeed.id
                      ? "Exporting…"
                      : "Export"}
                  </button>
                  <button
                    type="button"
                    className="adminPage__rowMenuItem"
                    role="menuitem"
                    onClick={() => {
                      closeLinkRowMenu();
                      startEditLink(linkRowMenuFeed);
                    }}
                  >
                    <Pencil size={14} strokeWidth={2} aria-hidden />
                    Modify
                  </button>
                  <button
                    type="button"
                    className="adminPage__rowMenuItem adminPage__rowMenuItem--danger"
                    role="menuitem"
                    onClick={() => {
                      closeLinkRowMenu();
                      void handleArchiveLink(linkRowMenuFeed.id);
                    }}
                  >
                    <Archive size={14} strokeWidth={2} aria-hidden />
                    Archive
                  </button>
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
