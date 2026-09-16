import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleX, Play, X } from "lucide-react";
import {
  fetchIngestLinkItems,
  type IngestLinkItemRow,
  type IngestLinkRow,
} from "../../../utils/ingestLinksApi";
import type { DiscoveryLogRow } from "../../../utils/discoveryLogsApi";
import "../Users/usersPage.css";
import "./adminRssFeeds.css";

const COMPLETED_DISCOVERY_STATUSES = new Set(["EXECUTED", "SKIPPED", "FAILED"]);

function buildLatestLogStatusByItemId(
  logs: DiscoveryLogRow[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of logs) {
    if (!row.ingestLinkItemId || map.has(row.ingestLinkItemId)) continue;
    map.set(row.ingestLinkItemId, row.status.toUpperCase());
  }
  return map;
}

function notCompletedItemIds(
  items: IngestLinkItemRow[],
  statusByItemId: Map<number, string>,
): Set<number> {
  const selected = new Set<number>();
  for (const item of items) {
    const status = statusByItemId.get(item.id);
    const isCompleted = status
      ? COMPLETED_DISCOVERY_STATUSES.has(status)
      : false;
    if (!isCompleted) selected.add(item.id);
  }
  return selected;
}

export type DiscoveryStartDialogProps = {
  open: boolean;
  links: IngestLinkRow[];
  logs: DiscoveryLogRow[];
  linksLoading?: boolean;
  starting?: boolean;
  title?: string;
  hint?: string;
  confirmLabel?: string;
  confirmingLabel?: string;
  onClose: () => void;
  onStart: (selection: {
    ingestLinkIds: number[];
    ingestLinkItemIds: number[];
  }) => void;
};

export function DiscoveryStartDialog({
  open,
  links,
  logs,
  linksLoading = false,
  starting = false,
  title = "Start discovery service",
  hint = "Choose extracted URLs to run. Discovery will enqueue ingest jobs only for the selected URLs (run Extract on the Links tab first).",
  confirmLabel = "Start discovery",
  confirmingLabel = "Starting…",
  onClose,
  onStart,
}: DiscoveryStartDialogProps) {
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsByLinkId, setItemsByLinkId] = useState<Record<number, IngestLinkItemRow[]>>({});
  const [expandedFeedIds, setExpandedFeedIds] = useState<Set<number>>(
    () => new Set(),
  );

  const allItems = useMemo(
    () => Object.values(itemsByLinkId).flat(),
    [itemsByLinkId],
  );
  const allIds = useMemo(() => allItems.map((item) => item.id), [allItems]);
  const itemLinkById = useMemo(
    () => new Map(allItems.map((item) => [item.id, item.ingestLinkId])),
    [allItems],
  );
  const latestLogStatusByItemId = useMemo(
    () => buildLatestLogStatusByItemId(logs),
    [logs],
  );
  const allSelected =
    allIds.length > 0 && allIds.every((id) => selectedItemIds.has(id));
  const someSelected = allIds.some((id) => selectedItemIds.has(id));
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || linksLoading) return;
    let cancelled = false;
    setItemsLoading(true);
    setItemsByLinkId({});
    setSelectedItemIds(new Set());
    setExpandedFeedIds(new Set());

    const withExtractedItems = links.filter((link) => link.itemCount > 0);
    if (withExtractedItems.length === 0) {
      setItemsLoading(false);
      return;
    }

    void Promise.all(
      withExtractedItems.map(async (link) => {
        const result = await fetchIngestLinkItems(link.id);
        return {
          linkId: link.id,
          items: result.ok ? result.items : [],
        };
      }),
    )
      .then((rows) => {
        if (cancelled) return;
        const next: Record<number, IngestLinkItemRow[]> = {};
        const fetchedItems: IngestLinkItemRow[] = [];
        for (const row of rows) {
          next[row.linkId] = row.items;
          fetchedItems.push(...row.items);
        }
        const statusByItemId = buildLatestLogStatusByItemId(logs);
        setItemsByLinkId(next);
        setSelectedItemIds(notCompletedItemIds(fetchedItems, statusByItemId));
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, links, linksLoading, logs]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const close = useCallback(() => {
    if (starting) return;
    onClose();
  }, [onClose, starting]);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelectedItemIds(checked ? new Set(allIds) : new Set());
    },
    [allIds],
  );

  const toggleOne = useCallback((id: number, checked: boolean) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const toggleFeed = useCallback(
    (linkId: number, checked: boolean) => {
      const feedItems = itemsByLinkId[linkId] ?? [];
      const feedItemIds = feedItems.map((item) => item.id);
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        for (const id of feedItemIds) {
          if (checked) {
            next.add(id);
          } else {
            next.delete(id);
          }
        }
        return next;
      });
    },
    [itemsByLinkId],
  );

  const toggleFeedExpanded = useCallback((linkId: number) => {
    setExpandedFeedIds((prev) => {
      const next = new Set(prev);
      if (next.has(linkId)) next.delete(linkId);
      else next.add(linkId);
      return next;
    });
  }, []);

  const selectNotCompletedOnly = useCallback(() => {
    const selectedFeedIds = new Set<number>();
    for (const itemId of selectedItemIds) {
      const feedId = itemLinkById.get(itemId);
      if (typeof feedId === "number") selectedFeedIds.add(feedId);
    }

    const targetItems =
      selectedFeedIds.size > 0
        ? allItems.filter((item) => selectedFeedIds.has(item.ingestLinkId))
        : allItems;

    setSelectedItemIds(
      notCompletedItemIds(targetItems, latestLogStatusByItemId),
    );
  }, [allItems, itemLinkById, latestLogStatusByItemId, selectedItemIds]);

  const handleStart = useCallback(() => {
    if (selectedItemIds.size === 0) return;
    const ingestLinkItemIds = [...selectedItemIds];
    const ingestLinkIds = [
      ...new Set(
        ingestLinkItemIds
          .map((id) => itemLinkById.get(id))
          .filter((id): id is number => typeof id === "number"),
      ),
    ];
    onStart({ ingestLinkIds, ingestLinkItemIds });
  }, [onStart, selectedItemIds, itemLinkById]);

  if (!open) return null;

  const titleId = `${baseId}-discovery-start-title`;

  return (
    <div
      className="usersPage__overlay"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
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
          <p className="adminPage__discoveryDialogHint">
            {hint}
          </p>

          {linksLoading || itemsLoading ? (
            <p className="adminPage__discoveryDialogEmpty" role="status">
              Loading extracted URLs…
            </p>
          ) : links.length === 0 ? (
            <p className="adminPage__discoveryDialogEmpty" role="status">
              No feeds available. Add feed URLs on the Links tab first.
            </p>
          ) : allItems.length === 0 ? (
            <p className="adminPage__discoveryDialogEmpty" role="status">
              No extracted URLs found. Run Extract on one or more feeds first.
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
                  All extracted URLs
                </span>
                <span className="adminPage__discoveryFeedCount">
                  {selectedItemIds.size} of {allItems.length} selected
                </span>
                <div className="adminPage__discoveryPresetActions">
                  <button
                    type="button"
                    className="adminPage__discoveryPresetBtn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      selectNotCompletedOnly();
                    }}
                    disabled={starting}
                  >
                    Not completed
                  </button>
                </div>
              </label>
              <ul className="adminPage__discoveryFeedList" role="list">
                {links.map((link) => {
                  const feedItems = itemsByLinkId[link.id] ?? [];
                  const selectedInFeed = feedItems.filter((item) =>
                    selectedItemIds.has(item.id),
                  ).length;
                  const feedChecked =
                    feedItems.length > 0 && selectedInFeed === feedItems.length;
                  const feedInputId = `${baseId}-feed-${link.id}`;
                  const expanded = expandedFeedIds.has(link.id);
                  return (
                    <li key={link.id}>
                      <div className="adminPage__discoveryFeedRowWrap">
                        <label className="adminPage__discoveryFeedRow" htmlFor={feedInputId}>
                          <input
                            id={feedInputId}
                            type="checkbox"
                            checked={feedChecked}
                            onChange={(e) => toggleFeed(link.id, e.target.checked)}
                            disabled={starting || feedItems.length === 0}
                          />
                          <span className="adminPage__id">#{link.id}</span>
                          <span className="adminPage__discoveryFeedUrl" title={link.url}>
                            {link.url}
                          </span>
                          <span className="adminPage__discoveryFeedCount">
                            {selectedInFeed}/{feedItems.length}
                          </span>
                        </label>
                        <button
                          type="button"
                          className="adminPage__discoveryFeedExpandBtn"
                          onClick={() => toggleFeedExpanded(link.id)}
                          aria-expanded={expanded}
                          aria-label={
                            expanded
                              ? `Collapse extracted URLs for feed #${link.id}`
                              : `Expand extracted URLs for feed #${link.id}`
                          }
                          disabled={feedItems.length === 0}
                        >
                          {expanded ? (
                            <ChevronDown size={14} strokeWidth={2} aria-hidden />
                          ) : (
                            <ChevronRight size={14} strokeWidth={2} aria-hidden />
                          )}
                        </button>
                      </div>
                      {feedItems.length > 0 && expanded ? (
                        <ul className="adminPage__discoveryItemList">
                          {feedItems.map((item) => {
                            const itemInputId = `${baseId}-item-${item.id}`;
                            return (
                              <li key={item.id}>
                                <label
                                  className="adminPage__discoveryItemRow"
                                  htmlFor={itemInputId}
                                >
                                  <input
                                    id={itemInputId}
                                    type="checkbox"
                                    checked={selectedItemIds.has(item.id)}
                                    onChange={(e) =>
                                      toggleOne(item.id, e.target.checked)
                                    }
                                    disabled={starting}
                                  />
                                  <span className="adminPage__id">#{item.id}</span>
                                  <span
                                    className="adminPage__discoveryItemUrl"
                                    title={item.url}
                                  >
                                    {item.url}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
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
                linksLoading ||
                itemsLoading ||
                links.length === 0 ||
                selectedItemIds.size === 0
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
