import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChartLine, Eye, MessageSquareText, PencilLine, Tags } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { capitalizeDisplayName } from "../../../utils/reviewOpsApi";
import { buildReviewAnalysisState, buildReviewRiskPath } from "../../../utils/reviewNav";
import { DataTablePagination } from "../../common/DataTablePagination";
import {
  formatArticleId,
  formatDisplayValue,
  formatRiskDomain,
  formatRiskId,
  type RiskDetail,
} from "../Risk/riskData";
import { isExistingHumanReview } from "../Risk/humanReviewHelpers";
import { ReviewWhyPill } from "./ReviewWhyPill";

interface ReviewRecordsTableProps {
  rows: RiskDetail[];
  loadState: "idle" | "loading" | "error";
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  emptyMessage?: string;
  actingId: string | null;
  onView: (row: RiskDetail) => void;
  onEdit: (row: RiskDetail) => void;
  onFeedback: (row: RiskDetail) => void;
  onEditDomain: (row: RiskDetail) => void;
  selectedIds: Set<string>;
  allMatchingSelected: boolean;
  pageAllSelected: boolean;
  onToggleRow: (id: string) => void;
  onTogglePage: () => void;
  buildAnalysisState: (row: RiskDetail) => { returnTo: string };
  canEditFields?: boolean;
  focusedReviewKey?: string;
}

export const ReviewRecordsTable = memo(function ReviewRecordsTable({
  rows,
  loadState,
  page,
  pageCount,
  total,
  pageSize,
  from,
  to,
  onPageChange,
  onPageSizeChange,
  emptyMessage,
  actingId,
  onView,
  onEdit,
  onFeedback,
  onEditDomain,
  selectedIds,
  allMatchingSelected,
  pageAllSelected,
  onToggleRow,
  onTogglePage,
  buildAnalysisState,
  canEditFields = false,
  focusedReviewKey,
}: ReviewRecordsTableProps) {
  const navigate = useNavigate();
  const COL_SPAN = 14;
  const focusRef = useRef<HTMLTableRowElement | null>(null);
  const [editMenuOpenId, setEditMenuOpenId] = useState<string | null>(null);
  const [editMenuAnchor, setEditMenuAnchor] = useState<{
    top: number;
    right: number;
  } | null>(null);

  const closeEditMenu = useCallback(() => {
    setEditMenuOpenId(null);
    setEditMenuAnchor(null);
  }, []);

  const editMenuRow = useMemo(() => {
    if (!editMenuOpenId) return null;
    return rows.find((r) => r.id === editMenuOpenId) ?? null;
  }, [editMenuOpenId, rows]);

  useEffect(() => {
    if (!focusedReviewKey || !focusRef.current) return;
    focusRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedReviewKey, rows]);

  useEffect(() => {
    closeEditMenu();
  }, [page, pageSize, closeEditMenu]);

  useEffect(() => {
    if (editMenuOpenId && !editMenuRow) closeEditMenu();
  }, [editMenuOpenId, editMenuRow, closeEditMenu]);

  useEffect(() => {
    if (!editMenuOpenId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      const wrap = document.querySelector(`[data-review-edit-menu="${editMenuOpenId}"]`);
      const portal = document.querySelector(
        `[data-review-edit-menu-portal="${editMenuOpenId}"]`,
      );
      if (wrap?.contains(t) || portal?.contains(t)) return;
      closeEditMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeEditMenu();
    };
    const onScrollOrResize = () => closeEditMenu();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [editMenuOpenId, closeEditMenu]);

  return (
    <section className="riskPage__tableSection" aria-label="Review queue">
      <div className="riskPage__tableWrap">
        <div className="riskPage__tableScroll">
          <table className="riskPage__table">
            <thead>
              <tr>
                <th scope="col" className="riskPage__th riskPage__th--center riskPage__th--select">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={pageAllSelected || allMatchingSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !pageAllSelected && selectedIds.size > 0 && !allMatchingSelected;
                    }}
                    onChange={onTogglePage}
                  />
                </th>
                <th
                  scope="col"
                  className="riskPage__th riskPage__th--left riskPage__th--sticky riskPage__th--stickyId"
                >
                  RISK ID
                </th>
                <th
                  scope="col"
                  className="riskPage__th riskPage__th--left riskPage__th--sticky riskPage__th--stickyTitle"
                >
                  TITLE
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  DOMAIN
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  ARTICLE ID
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  PRIMARY RISK
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  SECONDARY RISK
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  SECTOR
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  INDUSTRY
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  INTENT
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  WHY
                </th>
                <th scope="col" className="riskPage__th riskPage__th--center">
                  QUALITY SCORE
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  ASSIGNEE
                </th>
                <th scope="col" className="riskPage__th riskPage__th--center">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {loadState === "loading" ? (
                <tr>
                  <td className="riskPage__td riskPage__emptyCell" colSpan={COL_SPAN}>
                    Loading review queue…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="riskPage__td riskPage__emptyCell" colSpan={COL_SPAN}>
                    {loadState === "error"
                      ? "Could not load the review queue."
                      : (emptyMessage ??
                        "No items in the review queue.")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const hasReview = isExistingHumanReview(row.humanReview);
                  const isActing = actingId === row.id;

                  const selected = allMatchingSelected || selectedIds.has(row.id);
                  const focused =
                    Boolean(focusedReviewKey) &&
                    (row.id === focusedReviewKey || row.displayId === focusedReviewKey);
                  return (
                    <tr
                      key={row.id}
                      ref={focused ? focusRef : undefined}
                      className={
                        [
                          selected || focused ? "riskPage__row--selected" : "",
                          focused ? "riskPage__row--focus" : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                    >
                      <td className="riskPage__td riskPage__td--center riskPage__td--select">
                        <input
                          type="checkbox"
                          aria-label={`Select ${formatRiskId(row)}`}
                          checked={selected}
                          disabled={allMatchingSelected}
                          onChange={() => onToggleRow(row.id)}
                        />
                      </td>
                      <td className="riskPage__td riskPage__td--sticky riskPage__td--stickyId">
                        <span className="riskPage__rowKey">{formatRiskId(row)}</span>
                      </td>
                      <td className="riskPage__td riskPage__td--title riskPage__td--sticky riskPage__td--stickyTitle">
                        {formatDisplayValue(row.title)}
                      </td>
                      <td className="riskPage__td riskPage__td--muted riskPage__td--domain">
                        <span className="riskPage__domain">
                          {formatRiskDomain(row.domain)}
                        </span>
                      </td>
                      <td className="riskPage__td riskPage__td--muted">
                        {formatArticleId(row.articleId)}
                      </td>
                      <td className="riskPage__td">{formatDisplayValue(row.primaryRisk)}</td>
                      <td className="riskPage__td riskPage__td--muted">
                        {formatDisplayValue(row.secondaryRisk)}
                      </td>
                      <td className="riskPage__td riskPage__td--muted">{formatDisplayValue(row.sector)}</td>
                      <td className="riskPage__td riskPage__td--muted">{formatDisplayValue(row.industry)}</td>
                      <td className="riskPage__td riskPage__td--muted">{formatDisplayValue(row.intent)}</td>
                      <td className="riskPage__td reviewPage__td--why">
                        <ReviewWhyPill
                          label={row.reviewWhy}
                          reason={row.reviewReason}
                        />
                      </td>
                      <td className="riskPage__td riskPage__td--center riskPage__td--score">
                        {row.qualityScore}
                      </td>
                      <td className="riskPage__td riskPage__td--muted">
                        {row.assignment?.assigneeName ? (
                          capitalizeDisplayName(row.assignment.assigneeName)
                        ) : (
                          <span className="reviewPage__unassigned">Unassigned</span>
                        )}
                      </td>
                      <td className="riskPage__td riskPage__td--center riskPage__td--actions">
                        <div
                          className={`riskPage__actions riskPage__actions--review${
                            hasReview
                              ? ""
                              : " riskPage__actions--reviewCompact"
                          }`}
                        >
                          <button
                            type="button"
                            className="riskPage__actionBtn riskPage__actionBtn--analysis"
                            aria-label={`View analysis for ${formatRiskId(row)}`}
                            data-tooltip="Analysis"
                            onClick={() =>
                              navigate(buildReviewRiskPath(row.id), {
                                state: buildReviewAnalysisState(buildAnalysisState(row).returnTo),
                              })
                            }
                          >
                            <ChartLine size={16} strokeWidth={2} aria-hidden />
                          </button>
                          {hasReview ? (
                            <button
                              type="button"
                              className="riskPage__actionBtn riskPage__actionBtn--view"
                              aria-label={`View review for ${formatRiskId(row)}`}
                              data-tooltip="View"
                              disabled={isActing}
                              onClick={() => onView(row)}
                            >
                              <Eye size={16} strokeWidth={2} aria-hidden />
                            </button>
                          ) : null}
                          {canEditFields && row.reviewWhy === "Domain" ? (
                            <button
                              type="button"
                              className="riskPage__actionBtn riskPage__actionBtn--edit"
                              aria-label={`Edit domain for ${formatRiskId(row)}`}
                              data-tooltip="Edit domain"
                              disabled={isActing}
                              onClick={() => onEditDomain(row)}
                            >
                              <Tags size={16} strokeWidth={2} aria-hidden />
                            </button>
                          ) : null}
                          <div
                            className="reviewPage__editMenuWrap"
                            data-review-edit-menu={row.id}
                          >
                            <button
                              type="button"
                              className="riskPage__actionBtn riskPage__actionBtn--edit"
                              aria-label={`Edit ${formatRiskId(row)}`}
                              aria-haspopup="menu"
                              aria-expanded={editMenuOpenId === row.id}
                              data-tooltip={editMenuOpenId === row.id ? undefined : "Edit"}
                              disabled={isActing}
                              aria-busy={isActing}
                              onClick={(e) => {
                                const btn = e.currentTarget;
                                if (editMenuOpenId === row.id) {
                                  closeEditMenu();
                                  return;
                                }
                                const rect = btn.getBoundingClientRect();
                                setEditMenuAnchor({
                                  top: rect.bottom,
                                  right: rect.right,
                                });
                                setEditMenuOpenId(row.id);
                              }}
                            >
                              <PencilLine size={16} strokeWidth={2} aria-hidden />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <DataTablePagination
          className="riskPage__pager"
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          from={from}
          to={to}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </div>
      {editMenuOpenId && editMenuAnchor && editMenuRow
        ? createPortal(
            <div
              className="reviewPage__editMenu reviewPage__editMenu--portal"
              role="menu"
              aria-orientation="vertical"
              data-review-edit-menu-portal={editMenuOpenId}
              style={{
                top: Math.min(
                  editMenuAnchor.top + 4,
                  Math.max(8, window.innerHeight - 120 - 8),
                ),
                left: editMenuAnchor.right,
              }}
            >
              <button
                type="button"
                className="reviewPage__editMenuItem"
                role="menuitem"
                disabled={actingId === editMenuRow.id}
                onClick={() => {
                  closeEditMenu();
                  onEdit(editMenuRow);
                }}
              >
                <PencilLine size={16} strokeWidth={2} aria-hidden />
                Edit analysis
              </button>
              <button
                type="button"
                className="reviewPage__editMenuItem"
                role="menuitem"
                disabled={actingId === editMenuRow.id}
                onClick={() => {
                  closeEditMenu();
                  onFeedback(editMenuRow);
                }}
              >
                <MessageSquareText size={16} strokeWidth={2} aria-hidden />
                Move feedback
              </button>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
});
