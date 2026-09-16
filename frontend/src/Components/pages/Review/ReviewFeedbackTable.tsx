import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { ArrowRightToLine, ExternalLink } from "lucide-react";
import { capitalizeDisplayName } from "../../../utils/reviewOpsApi";
import { formatDisplayValue, formatRiskDomain } from "../Risk/riskData";
import {
  canPromoteFeedbackToRisks,
  isFeedbackOnRisks,
  type ReviewFeedbackSample,
} from "./reviewFeedbackData";

interface ReviewFeedbackTableProps {
  items: ReviewFeedbackSample[];
  loadState: "idle" | "loading" | "error";
  emptyMessage: string;
  promotingId: string | null;
  onMoveToRisks: (item: ReviewFeedbackSample) => void;
}

type FeedbackActionTooltipProps = {
  label: string;
  children: ReactElement;
};

function FeedbackActionTooltip({ label, children }: FeedbackActionTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPosition({
      top: rect.top + rect.height / 2,
      left: rect.left - 8,
    });
  }, []);

  const showTooltip = useCallback(() => {
    updatePosition();
    setVisible(true);
  }, [updatePosition]);

  const hideTooltip = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;

    const scrollRoot = anchorRef.current?.closest(".riskPage__tableScroll");
    const onScroll = () => setVisible(false);

    scrollRoot?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);

    return () => {
      scrollRoot?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [visible]);

  return (
    <>
      <span
        ref={anchorRef}
        className="reviewPage__feedbackActionAnchor"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        {children}
      </span>
      {visible
        ? createPortal(
            <span
              className="reviewPage__feedbackTooltipPortal"
              style={{
                top: `${position.top}px`,
                left: `${position.left}px`,
              }}
              role="tooltip"
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

export const ReviewFeedbackTable = memo(function ReviewFeedbackTable({
  items,
  loadState,
  emptyMessage,
  promotingId,
  onMoveToRisks,
}: ReviewFeedbackTableProps) {
  return (
    <section className="riskPage__tableSection" aria-label="Review feedback">
      <div className="riskPage__tableWrap">
        <div className="riskPage__tableScroll">
          <table className="riskPage__table reviewPage__feedbackTable">
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
                  PRIMARY RISK
                </th>
                <th
                  scope="col"
                  className="riskPage__th riskPage__th--left reviewPage__feedbackCol"
                >
                  FEEDBACK
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  REVIEWED BY
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  REVIEWED AT
                </th>
                <th scope="col" className="riskPage__th riskPage__th--left">
                  STATUS
                </th>
                <th scope="col" className="riskPage__th riskPage__th--center">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {loadState === "loading" ? (
                <tr>
                  <td className="riskPage__td riskPage__emptyCell" colSpan={9}>
                    Loading feedback…
                  </td>
                </tr>
              ) : loadState === "error" ? (
                <tr>
                  <td className="riskPage__td riskPage__emptyCell" colSpan={9}>
                    Could not load feedback samples.
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="riskPage__td riskPage__emptyCell" colSpan={9}>
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isPromoting = promotingId === item.id;
                  const onRisks = isFeedbackOnRisks(item);
                  const canMove =
                    item.canMoveToRisks || canPromoteFeedbackToRisks(item);

                  return (
                    <tr key={item.id}>
                      <td className="riskPage__td riskPage__td--sticky riskPage__td--stickyId">
                        <span className="riskPage__rowKey">{item.displayId}</span>
                      </td>
                      <td className="riskPage__td riskPage__td--title riskPage__td--sticky riskPage__td--stickyTitle">
                        {formatDisplayValue(item.title)}
                      </td>
                      <td className="riskPage__td riskPage__td--muted riskPage__td--domain">
                        <span className="riskPage__domain">{formatRiskDomain(item.domain)}</span>
                      </td>
                      <td className="riskPage__td">{formatDisplayValue(item.primaryRisk)}</td>
                      <td className="riskPage__td reviewPage__feedbackCol reviewPage__feedbackCell">
                        {item.feedback ?? "—"}
                      </td>
                      <td className="riskPage__td riskPage__td--muted">
                        {item.reviewedBy ? capitalizeDisplayName(item.reviewedBy) : "—"}
                      </td>
                      <td className="riskPage__td riskPage__td--muted">
                        {item.reviewedAtDisplay}
                      </td>
                      <td className="riskPage__td">
                        {onRisks ? (
                          <span className="reviewPage__pill reviewPage__pill--onRisks">
                            On Risks
                          </span>
                        ) : canMove ? (
                          <span className="reviewPage__pill reviewPage__pill--awaitingMove">
                            Pending
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="riskPage__td riskPage__td--center riskPage__td--actions">
                        <div className="reviewPage__feedbackActions">
                          {canMove ? (
                            <FeedbackActionTooltip
                              label={isPromoting ? "Moving…" : "Move to Risks"}
                            >
                              <button
                                type="button"
                                className="reviewPage__feedbackActionBtn reviewPage__feedbackActionBtn--move"
                                disabled={isPromoting}
                                aria-busy={isPromoting}
                                aria-label={
                                  isPromoting
                                    ? `Moving ${item.displayId} to Risks`
                                    : `Move ${item.displayId} to Risks`
                                }
                                onClick={() => onMoveToRisks(item)}
                              >
                                <ArrowRightToLine
                                  size={16}
                                  strokeWidth={2}
                                  aria-hidden
                                />
                              </button>
                            </FeedbackActionTooltip>
                          ) : (
                            <span
                              className="reviewPage__feedbackActionSlot"
                              aria-hidden
                            />
                          )}
                          {item.articleUrl ? (
                            <FeedbackActionTooltip label="Source article">
                              <a
                                className="reviewPage__feedbackActionBtn reviewPage__feedbackActionBtn--link"
                                href={item.articleUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open source article for ${item.displayId}`}
                              >
                                <ExternalLink
                                  size={16}
                                  strokeWidth={2}
                                  aria-hidden
                                />
                              </a>
                            </FeedbackActionTooltip>
                          ) : (
                            <span
                              className="reviewPage__feedbackActionSlot"
                              aria-hidden
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
});
