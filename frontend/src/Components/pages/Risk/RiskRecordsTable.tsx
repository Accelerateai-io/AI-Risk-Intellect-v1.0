import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChartLine, Info } from "lucide-react";
import { DataTablePagination } from "../../common/DataTablePagination";
import {
  formatArticleId,
  formatDisplayValue,
  formatProductCell,
  formatRiskDomain,
  formatRiskId,
  formatSeverityCell,
  type RiskDetail,
} from "./riskData";
import { getHumanReviewMoveDetails } from "./humanReviewHelpers";
import { RiskMoveInfoDialog } from "./RiskMoveInfoDialog";

interface RiskRecordsTableProps {
  rows: RiskDetail[];
  loadState: "idle" | "loading" | "error";
  tableBusy?: boolean;
  searchQuery: string;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  emptyMessage?: string;
  analysisTab?: "overview" | "analysis";
}

const RiskRecordRow = memo(function RiskRecordRow({
  row,
  analysisTab,
  onOpenMoveInfo,
}: {
  row: RiskDetail;
  analysisTab: "overview" | "analysis";
  onOpenMoveInfo: (row: RiskDetail) => void;
}) {
  const navigate = useNavigate();
  const showMoveInfo = row.humanReview?.status === "approved";

  return (
    <tr>
      <td className="riskPage__td riskPage__td--sticky riskPage__td--stickyId">
        <span className="riskPage__rowKey">{formatRiskId(row)}</span>
      </td>
      <td className="riskPage__td riskPage__td--title">
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
      <td className="riskPage__td riskPage__td--muted">
        {formatProductCell(row.product)}
      </td>
      <td className="riskPage__td riskPage__td--muted">{formatDisplayValue(row.intent)}</td>
      <td className="riskPage__td riskPage__td--muted">
        {formatSeverityCell(row.riskScoring)}
      </td>
      <td className="riskPage__td riskPage__td--right riskPage__td--score riskPage__td--sticky riskPage__td--stickyRight riskPage__td--stickyScore">
        {row.qualityScore}
      </td>
      <td className="riskPage__td riskPage__td--center riskPage__td--actions riskPage__td--sticky riskPage__td--stickyRight riskPage__td--stickyActions">
        <div className="riskPage__actions">
          <button
            type="button"
            className="riskPage__actionBtn riskPage__actionBtn--analysis"
            aria-label={`View analysis for ${formatRiskId(row)}`}
            data-tooltip="Analysis"
            onClick={() =>
              navigate(
                `/risk/${encodeURIComponent(row.id)}?tab=${analysisTab}`,
              )
            }
          >
            <ChartLine size={16} strokeWidth={2} aria-hidden />
          </button>
          {showMoveInfo ? (
            <button
              type="button"
              className="riskPage__actionBtn riskPage__actionBtn--reviewInfo riskPage__actionBtn--reviewInfo-approved"
              aria-label={`Why ${formatRiskId(row)} was moved to Risks`}
              data-tooltip="Why moved to Risks"
              onClick={() => onOpenMoveInfo(row)}
            >
              <Info size={16} strokeWidth={2} aria-hidden />
            </button>
          ) : (
            <span className="riskPage__actionSlot" aria-hidden />
          )}
        </div>
      </td>
    </tr>
  );
});

export const RiskRecordsTable = memo(function RiskRecordsTable({
  rows,
  loadState,
  tableBusy = false,
  searchQuery,
  page,
  pageCount,
  total,
  pageSize,
  from,
  to,
  onPageChange,
  onPageSizeChange,
  emptyMessage,
  analysisTab = "overview",
}: RiskRecordsTableProps) {
  const [moveInfoTarget, setMoveInfoTarget] = useState<RiskDetail | null>(null);
  const moveInfoDetails = getHumanReviewMoveDetails(moveInfoTarget?.humanReview);
  const showInitialLoading = loadState === "loading" && rows.length === 0;

  return (
    <section className="riskPage__tableSection" aria-label="Risk records">
      <div className="riskPage__tableWrap" aria-busy={tableBusy || loadState === "loading"}>
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
                  className="riskPage__th riskPage__th--left"
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
                  AI PRODUCT
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  INTENT
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  SEVERITY
                </th>
                <th
                  scope="col"
                  className="riskPage__th riskPage__th--right riskPage__th--sticky riskPage__th--stickyRight riskPage__th--stickyScore"
                >
                  QUALITY SCORE
                </th>
                <th
                  scope="col"
                  className="riskPage__th riskPage__th--center riskPage__th--sticky riskPage__th--stickyRight riskPage__th--stickyActions"
                >
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {showInitialLoading ? (
                <tr>
                  <td className="riskPage__td riskPage__emptyCell" colSpan={13}>
                    Loading risks…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="riskPage__td riskPage__emptyCell" colSpan={13}>
                    {searchQuery.trim()
                      ? "No risks match your filters or search."
                      : loadState === "error"
                        ? "Could not load risks."
                        : (emptyMessage ??
                          "No risks yet. Enqueue a URL and wait for a DONE job.")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <RiskRecordRow
                    key={row.id}
                    row={row}
                    analysisTab={analysisTab}
                    onOpenMoveInfo={setMoveInfoTarget}
                  />
                ))
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

      <RiskMoveInfoDialog
        open={moveInfoTarget != null}
        displayId={moveInfoTarget ? formatRiskId(moveInfoTarget) : "R-?"}
        riskTitle={moveInfoTarget?.title ?? "Untitled risk"}
        details={moveInfoDetails}
        onClose={() => setMoveInfoTarget(null)}
      />
    </section>
  );
});
