import { useEffect, useId, useMemo, useState } from "react";
import {
  type ReviewFeedbackClassification,
  type ReviewFeedbackCounts,
  type ReviewFeedbackSample,
  filterReviewFeedbackSamples,
} from "./reviewFeedbackData";
import { ReviewFeedbackTable } from "./ReviewFeedbackTable";

interface ReviewFeedbackPanelProps {
  idPrefix: string;
  samples: ReviewFeedbackSample[];
  counts: ReviewFeedbackCounts;
  loadState: "idle" | "loading" | "error";
  searchQuery: string;
  promotingId: string | null;
  onMoveToRisks: (item: ReviewFeedbackSample) => void;
}

const FEEDBACK_TAB_METAS: {
  id: ReviewFeedbackClassification;
  label: string;
}[] = [
  { id: "raw", label: "Raw" },
  { id: "structured", label: "Structured" },
];

function buildEmptyMessage(
  label: string,
  id: ReviewFeedbackClassification,
  searchQuery: string,
  counts: ReviewFeedbackCounts,
  otherTabCount: number,
): string {
  if (searchQuery.trim()) {
    return `No ${label.toLowerCase()} feedback matches your search. Clear the search box to see all items.`;
  }
  if (counts[id] === 0) {
    if (id === "raw") {
      return otherTabCount > 0
        ? `No raw feedback yet. Switch to the Structured tab — ${otherTabCount} item${otherTabCount === 1 ? "" : "s"} there.`
        : "No raw feedback yet. Submit Raw feedback from the Review Queue — it will appear here.";
    }
    return otherTabCount > 0
      ? `No structured feedback yet. Switch to the Raw tab — ${otherTabCount} item${otherTabCount === 1 ? "" : "s"} there.`
      : "No structured feedback yet. Submit Structured feedback from the Review Queue — it will appear here.";
  }
  return `No ${label.toLowerCase()} feedback in this tab.`;
}

export function ReviewFeedbackPanel({
  idPrefix,
  samples,
  counts,
  loadState,
  searchQuery,
  promotingId,
  onMoveToRisks,
}: ReviewFeedbackPanelProps) {
  const baseId = useId();
  const [view, setView] = useState<ReviewFeedbackClassification>("raw");

  const fid = (name: string) => `${idPrefix}-${baseId}-${name}`;

  useEffect(() => {
    if (view === "raw" && counts.raw === 0 && counts.structured > 0) {
      setView("structured");
      return;
    }
    if (view === "structured" && counts.structured === 0 && counts.raw > 0) {
      setView("raw");
    }
  }, [counts.raw, counts.structured, view]);

  const filteredItems = useMemo(
    () => filterReviewFeedbackSamples(samples, view, searchQuery),
    [samples, view, searchQuery],
  );

  const tabCounts: Record<ReviewFeedbackClassification, number> = {
    raw: counts.raw,
    structured: counts.structured,
  };

  const otherTab: ReviewFeedbackClassification =
    view === "raw" ? "structured" : "raw";
  const otherTabCount = tabCounts[otherTab];

  return (
    <div className="reviewPage__feedbackPanel">
      <div
        className="reviewPage__feedbackTabs"
        role="tablist"
        aria-label="Feedback classification"
      >
        {FEEDBACK_TAB_METAS.map(({ id, label }) => {
          const selected = view === id;
          const count = tabCounts[id];

          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={fid(`feedback-tab-${id}`)}
              aria-selected={selected}
              aria-controls={fid(`feedback-panel-${id}`)}
              tabIndex={selected ? 0 : -1}
              className={`reviewPage__feedbackTab${selected ? " reviewPage__feedbackTab--selected" : ""}`}
              onClick={() => setView(id)}
            >
              {label}
              <span className="reviewPage__feedbackTabCount" aria-hidden>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {FEEDBACK_TAB_METAS.map(({ id, label }) => {
        if (view !== id) return null;

        return (
          <section
            key={id}
            className="reviewPage__feedbackTabPanel"
            role="tabpanel"
            id={fid(`feedback-panel-${id}`)}
            aria-labelledby={fid(`feedback-tab-${id}`)}
          >
            <ReviewFeedbackTable
              items={filteredItems}
              loadState={loadState}
              emptyMessage={buildEmptyMessage(
                label,
                id,
                searchQuery,
                counts,
                otherTabCount,
              )}
              promotingId={promotingId}
              onMoveToRisks={onMoveToRisks}
            />
          </section>
        );
      })}
    </div>
  );
}
