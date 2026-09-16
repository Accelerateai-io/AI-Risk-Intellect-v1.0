import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight, CircleX, Loader2, Play, X } from "lucide-react";
import {
  ETL_REPORT_ITEMS_PAGE_SIZE,
  etlUploadItemReportId,
  fetchEtlReportUploadItems,
  type EtlReportRunSelection,
  type EtlReportUploadItemRow,
  type EtlReportUploadRow,
} from "../../../../../utils/etlReportsApi";
import "../../../Users/usersPage.css";
import "../../adminRssFeeds.css";

export type ReportsStartDialogProps = {
  open: boolean;
  uploads: EtlReportUploadRow[];
  uploadsLoading?: boolean;
  starting?: boolean;
  title?: string;
  hint?: string;
  confirmLabel?: string;
  confirmingLabel?: string;
  onClose: () => void;
  onStart: (selection: EtlReportRunSelection) => void;
};

type UploadItemsPageState = {
  items: EtlReportUploadItemRow[];
  total: number;
  hasMore: boolean;
  loading: boolean;
};

function itemCountForUpload(row: EtlReportUploadRow): number {
  return row.importedRows;
}

function reportIdsFromItems(items: EtlReportUploadItemRow[]): number[] {
  return items
    .map((item) => etlUploadItemReportId(item))
    .filter((id): id is number => id != null);
}

export function ReportsStartDialog({
  open,
  uploads,
  uploadsLoading = false,
  starting = false,
  title = "Start reports worker",
  hint = "Choose report URLs to ingest. Selected URLs will be queued as jobs and the worker service will start to process them.",
  confirmLabel = "Start worker",
  confirmingLabel = "Starting…",
  onClose,
  onStart,
}: ReportsStartDialogProps) {
  const baseId = useId();
  const inFlightPagesRef = useRef<Set<string>>(new Set());
  const itemsByUploadIdRef = useRef<Record<number, UploadItemsPageState>>({});
  const [selectedUploadIds, setSelectedUploadIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [deselectedReportIds, setDeselectedReportIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [extraReportIds, setExtraReportIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [itemsByUploadId, setItemsByUploadId] = useState<
    Record<number, UploadItemsPageState>
  >({});
  const [expandedUploadIds, setExpandedUploadIds] = useState<Set<number>>(
    () => new Set(),
  );

  itemsByUploadIdRef.current = itemsByUploadId;

  const eligibleUploads = useMemo(
    () =>
      uploads.filter(
        (upload) =>
          upload.status === "completed" && itemCountForUpload(upload) > 0,
      ),
    [uploads],
  );
  const eligibleUploadIds = useMemo(
    () => eligibleUploads.map((upload) => upload.id),
    [eligibleUploads],
  );
  const eligibleUploadKey = eligibleUploadIds.join(",");

  const loadItemsPage = useCallback(
    async (uploadId: number, offset: number, afterId?: number) => {
      const key = `${uploadId}:${afterId ?? offset}`;
      if (inFlightPagesRef.current.has(key)) return;
      inFlightPagesRef.current.add(key);

      setItemsByUploadId((prev) => {
        const current = prev[uploadId];
        return {
          ...prev,
          [uploadId]: {
            items: current?.items ?? [],
            total: current?.total ?? 0,
            hasMore: current?.hasMore ?? true,
            loading: true,
          },
        };
      });

      const result = await fetchEtlReportUploadItems(uploadId, {
        limit: ETL_REPORT_ITEMS_PAGE_SIZE,
        offset,
        afterId,
      });

      inFlightPagesRef.current.delete(key);

      setItemsByUploadId((prev) => {
        const current = prev[uploadId];
        const existingItems = current?.items ?? [];
        if (!result.ok) {
          return {
            ...prev,
            [uploadId]: {
              items: existingItems,
              total: current?.total ?? existingItems.length,
              hasMore: false,
              loading: false,
            },
          };
        }

        const seen = new Set(existingItems.map((item) => item.id));
        const appended = result.items.filter((item) => !seen.has(item.id));
        const items =
          offset === 0 ? result.items : [...existingItems, ...appended];
        return {
          ...prev,
          [uploadId]: {
            items,
            total: result.total,
            hasMore: result.hasMore,
            loading: false,
          },
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (!open || uploadsLoading) return;
    inFlightPagesRef.current.clear();
    setItemsByUploadId({});
    setDeselectedReportIds(new Set());
    setExtraReportIds(new Set());
    setExpandedUploadIds(new Set());
    setSelectedUploadIds(
      new Set(
        eligibleUploadKey
          .split(",")
          .filter(Boolean)
          .map((id) => Number(id)),
      ),
    );
  }, [open, uploadsLoading, eligibleUploadKey]);

  const selectedCount = useMemo(() => {
    let count = 0;
    for (const upload of eligibleUploads) {
      if (selectedUploadIds.has(upload.id)) {
        count += Math.max(0, itemCountForUpload(upload));
      }
    }
    count -= deselectedReportIds.size;
    for (const reportId of extraReportIds) {
      if (!deselectedReportIds.has(reportId)) count += 1;
    }
    return Math.max(0, count);
  }, [
    eligibleUploads,
    selectedUploadIds,
    deselectedReportIds,
    extraReportIds,
  ]);

  const totalRunnable = useMemo(
    () =>
      eligibleUploads.reduce(
        (sum, upload) => sum + itemCountForUpload(upload),
        0,
      ),
    [eligibleUploads],
  );

  const allSelected =
    eligibleUploads.length > 0 &&
    eligibleUploadIds.every((id) => selectedUploadIds.has(id)) &&
    deselectedReportIds.size === 0 &&
    extraReportIds.size === 0;
  const someSelected = selectedCount > 0;
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const isReportSelected = useCallback(
    (uploadId: number, reportId: number) => {
      if (deselectedReportIds.has(reportId)) return false;
      if (selectedUploadIds.has(uploadId)) return true;
      return extraReportIds.has(reportId);
    },
    [deselectedReportIds, extraReportIds, selectedUploadIds],
  );

  const close = useCallback(() => {
    if (starting) return;
    onClose();
  }, [onClose, starting]);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setDeselectedReportIds(new Set());
      setExtraReportIds(new Set());
      setSelectedUploadIds(checked ? new Set(eligibleUploadIds) : new Set());
    },
    [eligibleUploadIds],
  );

  const toggleOne = useCallback((uploadId: number, reportId: number, checked: boolean) => {
    if (checked) {
      setDeselectedReportIds((prev) => {
        if (!prev.has(reportId)) return prev;
        const next = new Set(prev);
        next.delete(reportId);
        return next;
      });
      setSelectedUploadIds((selected) => {
        if (selected.has(uploadId)) return selected;
        setExtraReportIds((prev) => {
          const next = new Set(prev);
          next.add(reportId);
          return next;
        });
        return selected;
      });
      return;
    }

    setExtraReportIds((prev) => {
      if (!prev.has(reportId)) return prev;
      const next = new Set(prev);
      next.delete(reportId);
      return next;
    });
    setSelectedUploadIds((selected) => {
      if (!selected.has(uploadId)) return selected;
      setDeselectedReportIds((prev) => {
        const next = new Set(prev);
        next.add(reportId);
        return next;
      });
      return selected;
    });
  }, []);

  const toggleOneRef = useRef(toggleOne);
  toggleOneRef.current = toggleOne;
  const handleToggleOne = useCallback(
    (uploadId: number, reportId: number, checked: boolean) => {
      toggleOneRef.current(uploadId, reportId, checked);
    },
    [],
  );

  const toggleUpload = useCallback((uploadId: number, checked: boolean) => {
    const loadedIds = reportIdsFromItems(
      itemsByUploadIdRef.current[uploadId]?.items ?? [],
    );
    setSelectedUploadIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(uploadId);
      else next.delete(uploadId);
      return next;
    });
    if (loadedIds.length === 0) return;
    setDeselectedReportIds((prev) => {
      const next = new Set(prev);
      for (const id of loadedIds) next.delete(id);
      return next;
    });
    setExtraReportIds((prev) => {
      const next = new Set(prev);
      for (const id of loadedIds) next.delete(id);
      return next;
    });
  }, []);

  const toggleUploadExpanded = useCallback(
    (uploadId: number) => {
      setExpandedUploadIds((prev) => {
        const next = new Set(prev);
        const expanding = !next.has(uploadId);
        if (expanding) next.add(uploadId);
        else next.delete(uploadId);
        if (expanding) {
          const state = itemsByUploadIdRef.current[uploadId];
          if (!state || (state.items.length === 0 && !state.loading)) {
            void loadItemsPage(uploadId, 0);
          }
        }
        return next;
      });
    },
    [loadItemsPage],
  );

  const loadMoreForUpload = useCallback(
    (uploadId: number) => {
      const state = itemsByUploadIdRef.current[uploadId];
      if (!state || state.loading || !state.hasMore) return;
      const lastId = state.items[state.items.length - 1]?.id;
      void loadItemsPage(uploadId, state.items.length, lastId);
    },
    [loadItemsPage],
  );

  const handleStart = useCallback(() => {
    if (selectedCount === 0) return;
    const uploadIds = [...selectedUploadIds];
    const extraIds = [...extraReportIds].filter(
      (id) => !deselectedReportIds.has(id),
    );
    const excludeReportIds = [...deselectedReportIds];
    onStart({
      uploadIds,
      reportIds: extraIds,
      excludeReportIds:
        excludeReportIds.length > 0 ? excludeReportIds : undefined,
      selectedReportCount: selectedCount,
    });
  }, [
    deselectedReportIds,
    extraReportIds,
    onStart,
    selectedCount,
    selectedUploadIds,
  ]);

  if (!open) return null;

  const titleId = `${baseId}-reports-start-title`;

  return (
    <div
      className="usersPage__overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="usersPage__dialog adminPage__discoveryDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="usersPage__dialogHead">
          <h2 id={titleId} className="usersPage__dialogTitle">
            {title}
          </h2>
          <button
            type="button"
            className="usersPage__dialogClose"
            onClick={close}
            disabled={starting}
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="usersPage__dialogBody">
          <p className="adminPage__discoveryDialogHint">{hint}</p>

          {uploadsLoading ? (
            <p className="adminPage__discoveryDialogEmpty" role="status">
              Loading report uploads…
            </p>
          ) : eligibleUploads.length === 0 ? (
            <p className="adminPage__discoveryDialogEmpty" role="status">
              No completed uploads with report URLs found. Upload and import a
              CSV first.
            </p>
          ) : (
            <div className="adminPage__discoveryFeedListWrap">
              <label className="adminPage__discoveryFeedRow adminPage__discoveryFeedRow--all">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={starting}
                />
                <span className="adminPage__discoveryFeedAllLabel">
                  All report URLs
                </span>
                <span className="adminPage__discoveryFeedCount">
                  {selectedCount} of {totalRunnable} selected
                </span>
              </label>
              <ul className="adminPage__discoveryFeedList" role="list">
                {eligibleUploads.map((upload) => {
                  const pageState = itemsByUploadId[upload.id];
                  const uploadItems = pageState?.items ?? [];
                  const uploadTotal = itemCountForUpload(upload);
                  const selectedInUpload = selectedUploadIds.has(upload.id)
                    ? Math.max(0, uploadTotal - countDeselectedIn(uploadItems, deselectedReportIds))
                    : countSelectedExtras(uploadItems, extraReportIds);
                  const uploadChecked =
                    selectedUploadIds.has(upload.id) &&
                    countDeselectedIn(uploadItems, deselectedReportIds) === 0;

                  return (
                    <UploadGroupRow
                      key={upload.id}
                      baseId={baseId}
                      upload={upload}
                      label={
                        upload.suggestedName?.trim() ||
                        upload.fileName ||
                        `Upload #${upload.id}`
                      }
                      uploadTotal={uploadTotal}
                      selectedInUpload={selectedInUpload}
                      uploadChecked={uploadChecked}
                      expanded={expandedUploadIds.has(upload.id)}
                      items={uploadItems}
                      hasMore={Boolean(pageState?.hasMore)}
                      loading={Boolean(pageState?.loading)}
                      starting={starting}
                      isReportSelected={isReportSelected}
                      onToggleUpload={toggleUpload}
                      onToggleExpanded={toggleUploadExpanded}
                      onToggleOne={handleToggleOne}
                      onLoadMore={loadMoreForUpload}
                    />
                  );
                })}
              </ul>
            </div>
          )}

          <div className="usersPage__dialogActions">
            <button
              type="button"
              className="usersPage__btn usersPage__btn--logoutTone"
              onClick={close}
              disabled={starting}
            >
              <CircleX size={16} strokeWidth={1.75} aria-hidden />
              Cancel
            </button>
            <button
              type="button"
              className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
              onClick={handleStart}
              disabled={
                starting ||
                uploadsLoading ||
                eligibleUploads.length === 0 ||
                selectedCount === 0
              }
            >
              <Play size={16} strokeWidth={2} aria-hidden />
              {starting ? confirmingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function countDeselectedIn(
  items: EtlReportUploadItemRow[],
  deselectedReportIds: Set<number>,
): number {
  if (deselectedReportIds.size === 0) return 0;
  let count = 0;
  for (const item of items) {
    const reportId = etlUploadItemReportId(item);
    if (reportId != null && deselectedReportIds.has(reportId)) count += 1;
  }
  return count;
}

function countSelectedExtras(
  items: EtlReportUploadItemRow[],
  extraReportIds: Set<number>,
): number {
  if (extraReportIds.size === 0) return 0;
  let count = 0;
  for (const item of items) {
    const reportId = etlUploadItemReportId(item);
    if (reportId != null && extraReportIds.has(reportId)) count += 1;
  }
  return count;
}

const UploadGroupRow = memo(function UploadGroupRow({
  baseId,
  upload,
  label,
  uploadTotal,
  selectedInUpload,
  uploadChecked,
  expanded,
  items,
  hasMore,
  loading,
  starting,
  isReportSelected,
  onToggleUpload,
  onToggleExpanded,
  onToggleOne,
  onLoadMore,
}: {
  baseId: string;
  upload: EtlReportUploadRow;
  label: string;
  uploadTotal: number;
  selectedInUpload: number;
  uploadChecked: boolean;
  expanded: boolean;
  items: EtlReportUploadItemRow[];
  hasMore: boolean;
  loading: boolean;
  starting: boolean;
  isReportSelected: (uploadId: number, reportId: number) => boolean;
  onToggleUpload: (uploadId: number, checked: boolean) => void;
  onToggleExpanded: (uploadId: number) => void;
  onToggleOne: (uploadId: number, reportId: number, checked: boolean) => void;
  onLoadMore: (uploadId: number) => void;
}) {
  const uploadInputId = `${baseId}-upload-${upload.id}`;
  const canExpand = uploadTotal > 0 || items.length > 0;

  return (
    <li>
      <div className="adminPage__discoveryFeedRowWrap">
        <label className="adminPage__discoveryFeedRow" htmlFor={uploadInputId}>
          <input
            id={uploadInputId}
            type="checkbox"
            checked={uploadChecked}
            onChange={(e) => onToggleUpload(upload.id, e.target.checked)}
            disabled={starting || uploadTotal === 0}
          />
          <span className="adminPage__id">#{upload.id}</span>
          <span className="adminPage__discoveryFeedUrl" title={label}>
            {label}
          </span>
          <span className="adminPage__discoveryFeedCount">
            {selectedInUpload}/{uploadTotal}
          </span>
        </label>
        <button
          type="button"
          className="adminPage__discoveryFeedExpandBtn"
          onClick={() => onToggleExpanded(upload.id)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `Collapse report URLs for upload #${upload.id}`
              : `Expand report URLs for upload #${upload.id}`
          }
          disabled={!canExpand}
        >
          {expanded ? (
            <ChevronDown size={14} strokeWidth={2} aria-hidden />
          ) : (
            <ChevronRight size={14} strokeWidth={2} aria-hidden />
          )}
        </button>
      </div>
      {expanded ? (
        <UrlBatchList
          baseId={baseId}
          uploadId={upload.id}
          items={items}
          hasMore={hasMore}
          loading={loading}
          starting={starting}
          total={uploadTotal}
          isReportSelected={isReportSelected}
          onToggleOne={onToggleOne}
          onLoadMore={onLoadMore}
        />
      ) : null}
    </li>
  );
});

const UrlBatchList = memo(function UrlBatchList({
  baseId,
  uploadId,
  items,
  hasMore,
  loading,
  starting,
  total,
  isReportSelected,
  onToggleOne,
  onLoadMore,
}: {
  baseId: string;
  uploadId: number;
  items: EtlReportUploadItemRow[];
  hasMore: boolean;
  loading: boolean;
  starting: boolean;
  total: number;
  isReportSelected: (uploadId: number, reportId: number) => boolean;
  onToggleOne: (uploadId: number, reportId: number, checked: boolean) => void;
  onLoadMore: (uploadId: number) => void;
}) {
  const [listEl, setListEl] = useState<HTMLUListElement | null>(null);

  return (
    <ul ref={setListEl} className="adminPage__discoveryItemList">
      {items.length === 0 && loading ? (
        <li>
          <UrlListStatus>
            Loading report URLs…
          </UrlListStatus>
        </li>
      ) : items.length === 0 ? (
        <li>
          <p className="adminPage__discoveryItemsStatus" role="status">
            No report URLs found in this upload.
          </p>
        </li>
      ) : (
        <>
          {items.map((item) => {
            const reportId = etlUploadItemReportId(item);
            return (
              <ReportUrlRow
                key={item.id}
                item={item}
                inputId={`${baseId}-item-${item.id}`}
                selected={
                  reportId != null && isReportSelected(uploadId, reportId)
                }
                disabled={starting || reportId == null}
                onToggle={onToggleOne}
              />
            );
          })}
          {hasMore ? (
            <li>
              <UrlListSentinel
                root={listEl}
                loading={loading}
                onVisible={() => onLoadMore(uploadId)}
              />
            </li>
          ) : null}
          {loading ? (
            <li>
              <UrlListStatus>
                Loading more URLs… {items.length} of {total || items.length}
              </UrlListStatus>
            </li>
          ) : hasMore ? (
            <li>
              <p className="adminPage__discoveryItemsStatus" role="status">
                Showing {items.length} of {total || items.length}. Scroll for more.
              </p>
            </li>
          ) : null}
        </>
      )}
    </ul>
  );
});

const ReportUrlRow = memo(function ReportUrlRow({
  item,
  inputId,
  selected,
  disabled,
  onToggle,
}: {
  item: EtlReportUploadItemRow;
  inputId: string;
  selected: boolean;
  disabled: boolean;
  onToggle: (uploadId: number, reportId: number, checked: boolean) => void;
}) {
  const reportId = etlUploadItemReportId(item);
  const runnable = reportId != null;

  return (
    <li>
      <label className="adminPage__discoveryItemRow" htmlFor={inputId}>
        <input
          id={inputId}
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            if (reportId == null) return;
            onToggle(item.uploadId, reportId, e.target.checked);
          }}
          disabled={disabled || !runnable}
        />
        <span
          className="adminPage__id"
          title={`Report URL ${item.rowOrder}`}
        >
          #{item.rowOrder}
        </span>
        <span className="adminPage__discoveryItemUrl" title={item.url}>
          {item.url}
        </span>
      </label>
    </li>
  );
});

function UrlListStatus({ children }: { children: ReactNode }) {
  return (
    <p className="adminPage__discoveryItemsStatus adminPage__discoveryItemsStatus--loading" role="status">
      <Loader2 size={14} strokeWidth={2} className="adminPage__discoveryItemsSpinner" aria-hidden />
      {children}
    </p>
  );
}

function UrlListSentinel({
  root,
  loading,
  onVisible,
}: {
  root: HTMLElement | null;
  loading: boolean;
  onVisible: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    if (loading || !root) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onVisibleRef.current();
        }
      },
      { root, rootMargin: "48px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, root]);

  return <div ref={ref} className="adminPage__discoveryItemSentinel" aria-hidden />;
}
