import { ChartLine, Eye, PencilLine } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DataTablePagination } from "../../common/DataTablePagination";
import {
  formatArticleId,
  formatRiskDomain,
  formatRiskId,
  type RiskDetail,
} from "../Risk/riskData";
import {
  isExistingHumanReview,
  isPendingHumanReview,
} from "../Risk/humanReviewHelpers";

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
}

export function ReviewRecordsTable({
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
}: ReviewRecordsTableProps) {
  const navigate = useNavigate();

  return (
    <section className="riskPage__tableSection" aria-label="Review queue">
      <div className="riskPage__tableWrap">
        <div className="riskPage__tableScroll">
          <table className="riskPage__table">
            <thead>
              <tr>
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
                <th scope="col" className="riskPage__th riskPage__th--right">
                  QUALITY SCORE
                </th>
                <th scope="col" className="riskPage__th riskPage__th--center">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {loadState === "loading" ? (
                <tr>
                  <td className="riskPage__td riskPage__emptyCell" colSpan={11}>
                    Loading review queue…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="riskPage__td riskPage__emptyCell" colSpan={11}>
                    {loadState === "error"
                      ? "Could not load the review queue."
                      : (emptyMessage ??
                        "No items in the review queue.")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const pending = isPendingHumanReview(row.humanReview);
                  const hasReview = isExistingHumanReview(row.humanReview);
                  const isActing = actingId === row.id;

                  return (
                    <tr key={row.id}>
                      <td className="riskPage__td riskPage__td--sticky riskPage__td--stickyId">
                        <span className="riskPage__rowKey">{formatRiskId(row)}</span>
                      </td>
                      <td className="riskPage__td riskPage__td--title riskPage__td--sticky riskPage__td--stickyTitle">
                        {row.title}
                      </td>
                      <td className="riskPage__td riskPage__td--muted riskPage__td--domain">
                        <span className="riskPage__domain">
                          {formatRiskDomain(row.domain)}
                        </span>
                      </td>
                      <td className="riskPage__td riskPage__td--muted">
                        {formatArticleId(row.articleId)}
                      </td>
                      <td className="riskPage__td">{row.primaryRisk}</td>
                      <td className="riskPage__td riskPage__td--muted">
                        {row.secondaryRisk}
                      </td>
                      <td className="riskPage__td riskPage__td--muted">{row.sector}</td>
                      <td className="riskPage__td riskPage__td--muted">{row.industry}</td>
                      <td className="riskPage__td riskPage__td--muted">{row.intent}</td>
                      <td className="riskPage__td riskPage__td--right riskPage__td--score">
                        {row.qualityScore}
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
                              navigate(
                                `/risk/${encodeURIComponent(row.id)}?tab=analysis`,
                              )
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
                          <button
                            type="button"
                            className="riskPage__actionBtn riskPage__actionBtn--edit"
                            aria-label={
                              pending
                                ? `Review ${formatRiskId(row)}`
                                : `Edit review for ${formatRiskId(row)}`
                            }
                            data-tooltip={pending ? "Review" : "Edit"}
                            disabled={isActing}
                            aria-busy={isActing}
                            onClick={() => onEdit(row)}
                          >
                            <PencilLine size={16} strokeWidth={2} aria-hidden />
                          </button>
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
    </section>
  );
}
