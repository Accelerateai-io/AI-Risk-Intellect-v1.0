import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Info, X } from "lucide-react";
import { formatDisplayDate } from "../../../utils/formatDate";
import type { HumanReviewInfo } from "../Risk/riskData";
import {
  canPromoteReviewToRisks,
  humanReviewStatusLabel,
  isExistingHumanReview,
  resolveReviewClassification,
  type ReviewClassification,
} from "../Risk/humanReviewHelpers";
import "../Users/usersPage.css";

export type { ReviewClassification };

export type ReviewDialogMode = "view" | "edit";

interface ReviewFeedbackDialogProps {
  open: boolean;
  mode: ReviewDialogMode;
  riskTitle: string;
  submitting: boolean;
  initialReview?: HumanReviewInfo | null;
  onClose: () => void;
  onSubmitRaw: (feedback: string) => void;
  onSubmitStructured: (feedback: string) => void;
  onUpdateFeedback: (feedback: string) => void;
  onMoveToRisks: (feedback: string, classification: ReviewClassification) => void;
}

const CLASSIFICATION_TABS: { id: ReviewClassification; label: string }[] = [
  { id: "raw", label: "Raw" },
  { id: "structured", label: "Structured" },
];

const FEEDBACK_PLACEHOLDERS: Record<ReviewClassification, string> = {
  raw: "Describe what needs improvement in this extraction…",
  structured: "Describe why this extraction is well structured…",
};

function seedFormFromReview(review: HumanReviewInfo | null | undefined) {
  if (!isExistingHumanReview(review ?? undefined)) {
    return {
      classification: null as ReviewClassification | null,
      feedback: "",
      moveToRisks: false,
    };
  }

  return {
    classification: resolveReviewClassification(review ?? undefined),
    feedback: review?.feedback?.trim() ?? "",
    moveToRisks: false,
  };
}

export function ReviewFeedbackDialog({
  open,
  mode,
  riskTitle,
  submitting,
  initialReview,
  onClose,
  onSubmitRaw,
  onSubmitStructured,
  onUpdateFeedback: _onUpdateFeedback,
  onMoveToRisks,
}: ReviewFeedbackDialogProps) {
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const [classification, setClassification] =
    useState<ReviewClassification | null>(null);
  const [moveToRisks, setMoveToRisks] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [moveConfirmOpen, setMoveConfirmOpen] = useState(false);

  const isExisting = isExistingHumanReview(initialReview ?? undefined);
  const isViewMode = mode === "view";
  const isOnRisks = initialReview?.status === "approved";
  const hasProvidedFeedback = Boolean(initialReview?.feedback?.trim());
  const isReadOnly = isViewMode || isOnRisks;
  const feedbackEditable =
    mode === "edit" && !isOnRisks && !(isExisting && hasProvidedFeedback);
  const showFeedbackLockedInfo =
    !feedbackEditable && (hasProvidedFeedback || feedback.trim().length > 0);
  const statusLabel = humanReviewStatusLabel(initialReview ?? undefined);
  const reviewedAtDisplay = initialReview?.reviewedAt
    ? formatDisplayDate(initialReview.reviewedAt)
    : null;

  const resetForm = useCallback(() => {
    const seeded = seedFormFromReview(initialReview);
    setClassification(seeded.classification);
    setMoveToRisks(seeded.moveToRisks);
    setFeedback(seeded.feedback);
  }, [initialReview]);

  const close = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  useEffect(() => {
    if (!open) return;
    resetForm();
    setMoveConfirmOpen(false);
  }, [open, resetForm]);

  useEffect(() => {
    if (!open || !classification || !feedbackEditable) return;
    const focusTimer = window.setTimeout(() => feedbackRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [open, classification, feedbackEditable]);

  useEffect(() => {
    if (!classification || !feedback.trim()) {
      setMoveToRisks(false);
    }
  }, [classification, feedback]);

  if (!open) return null;

  const hasClassification = classification != null;
  const hasFeedback = feedback.trim().length > 0;
  const canUseMoveToggle =
    mode === "edit" &&
    !isOnRisks &&
    hasClassification &&
    hasFeedback &&
    !submitting &&
    (!isExisting || canPromoteReviewToRisks(initialReview ?? undefined));
  const showMoveToRisksRow = hasClassification;
  const moveToggleOn = isOnRisks || moveToRisks;
  const moveToggleDisabled = isReadOnly || !canUseMoveToggle;

  const canSubmitRaw =
    feedbackEditable &&
    !isExisting &&
    classification === "raw" &&
    !moveToRisks &&
    hasFeedback;
  const canSubmitStructured =
    feedbackEditable &&
    !isExisting &&
    classification === "structured" &&
    !moveToRisks &&
    hasFeedback;
  const canMoveToRisks = moveToRisks && canUseMoveToggle;
  const canSubmit =
    canSubmitRaw || canSubmitStructured || canMoveToRisks;

  function handleClassificationSelect(id: ReviewClassification) {
    if (isExisting || isViewMode) return;
    setClassification(id);
    setMoveToRisks(false);
  }

  function handleMoveToggleClick() {
    if (!canUseMoveToggle) return;
    if (moveToRisks) {
      setMoveToRisks(false);
      return;
    }
    setMoveConfirmOpen(true);
  }

  function handleConfirmMove() {
    setMoveToRisks(true);
    setMoveConfirmOpen(false);
  }

  function handleSubmit() {
    const trimmedFeedback = feedback.trim();
    if (moveToRisks && classification) {
      onMoveToRisks(trimmedFeedback, classification);
      return;
    }
    if (classification === "raw") {
      onSubmitRaw(trimmedFeedback);
      return;
    }
    onSubmitStructured(trimmedFeedback);
  }

  const submitLabel = !hasClassification
    ? "Save review"
    : moveToRisks
      ? submitting
        ? "Moving…"
        : "Save & Move to Risks"
      : classification === "raw"
        ? submitting
          ? "Saving…"
          : "Submit feedback"
        : submitting
          ? "Saving…"
          : "Save as Structured";

  const dialogTitle = isViewMode
    ? "View review"
    : isExisting
      ? "Edit review"
      : "Review extraction";

  return (
    <div
      className="usersPage__overlay reviewFeedbackDialog__overlay"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="usersPage__dialog usersPage__dialog--wide reviewFeedbackDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
      >
        <div className="usersPage__dialogHead reviewFeedbackDialog__head">
          <div className="reviewFeedbackDialog__headText">
            <h2 id={`${baseId}-title`} className="usersPage__dialogTitle">
              {dialogTitle}
            </h2>
            <p className="reviewFeedbackDialog__subtitle" title={riskTitle}>
              {riskTitle}
            </p>
          </div>
          <button
            type="button"
            className="usersPage__dialogClose"
            onClick={close}
            disabled={submitting}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="usersPage__dialogBody reviewFeedbackDialog__body">
          {isExisting ? (
            <dl className="reviewFeedbackDialog__meta">
              {statusLabel ? (
                <div className="reviewFeedbackDialog__metaRow">
                  <dt>Status</dt>
                  <dd>{statusLabel}</dd>
                </div>
              ) : null}
              {initialReview?.reviewedBy ? (
                <div className="reviewFeedbackDialog__metaRow">
                  <dt>Reviewed by</dt>
                  <dd>{initialReview.reviewedBy}</dd>
                </div>
              ) : null}
              {reviewedAtDisplay ? (
                <div className="reviewFeedbackDialog__metaRow">
                  <dt>Date</dt>
                  <dd>{reviewedAtDisplay}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="reviewFeedbackDialog__hint">
              Choose <strong>Raw</strong> or <strong>Structured</strong>, enter
              feedback, then optionally enable <strong>Move to Risks</strong>.
            </p>
          )}

          <div
            className="reviewFeedbackDialog__tabs"
            role="tablist"
            aria-label="Classification"
          >
            {CLASSIFICATION_TABS.map(({ id, label }) => {
              const selected = classification === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${id}`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel-${id}`}
                  tabIndex={selected ? 0 : -1}
                  className={`reviewFeedbackDialog__tab${selected ? " reviewFeedbackDialog__tab--selected" : ""}`}
                  disabled={submitting || isExisting || isViewMode}
                  onClick={() => handleClassificationSelect(id)}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {hasClassification ? (
            <section
              className="reviewFeedbackDialog__tabPanel"
              role="tabpanel"
              id={`${baseId}-panel-${classification}`}
              aria-labelledby={`${baseId}-tab-${classification}`}
            >
              <label
                htmlFor={`${baseId}-feedback`}
                className="reviewFeedbackDialog__label"
              >
                Feedback
              </label>
              {showFeedbackLockedInfo ? (
                <p
                  className="reviewFeedbackDialog__panelHint reviewFeedbackDialog__panelHint--info"
                  role="status"
                >
                  <Info size={14} strokeWidth={2} aria-hidden />
                  Feedback has been provided so it can&apos;t be edited.
                </p>
              ) : null}
              <textarea
                id={`${baseId}-feedback`}
                ref={feedbackRef}
                className="reviewFeedbackDialog__textarea"
                rows={isExisting ? 3 : 4}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={FEEDBACK_PLACEHOLDERS[classification]}
                disabled={submitting || !feedbackEditable}
                readOnly={!feedbackEditable}
              />

              {showMoveToRisksRow ? (
                <div
                  className={`reviewFeedbackDialog__moveRow${moveToggleDisabled && !isOnRisks ? " reviewFeedbackDialog__moveRow--disabled" : ""}${isOnRisks ? " reviewFeedbackDialog__moveRow--onRisks" : ""}`}
                >
                  <div className="reviewFeedbackDialog__moveText">
                    <span
                      className="reviewFeedbackDialog__moveLabel"
                      id={`${baseId}-move-label`}
                    >
                      Move to Risks
                    </span>
                    <p
                      className="reviewFeedbackDialog__moveDesc"
                      id={`${baseId}-move-desc`}
                    >
                      {isOnRisks
                        ? "This item is on the Risks page."
                        : hasFeedback
                          ? "Promote this item to the Risks page."
                          : "Enter feedback above to enable this option."}
                    </p>
                  </div>
                  <button
                    type="button"
                    id={`${baseId}-move-toggle`}
                    role="switch"
                    aria-checked={moveToggleOn}
                    aria-labelledby={`${baseId}-move-label`}
                    aria-describedby={`${baseId}-move-desc`}
                    className={`reviewFeedbackDialog__switch${moveToggleOn ? " reviewFeedbackDialog__switch--on" : ""}`}
                    disabled={moveToggleDisabled}
                    onClick={handleMoveToggleClick}
                  >
                    <span
                      className="reviewFeedbackDialog__switchThumb"
                      aria-hidden
                    />
                  </button>
                </div>
              ) : null}

              {moveToRisks && classification && !isOnRisks ? (
                <p className="reviewFeedbackDialog__panelHint reviewFeedbackDialog__panelHint--move">
                  This will move the item to the Risks page.
                </p>
              ) : null}
            </section>
          ) : (
            <p className="reviewFeedbackDialog__panelHint">
              {isExisting
                ? "Classification not recorded for this review."
                : "Choose Raw or Structured above."}
            </p>
          )}
        </div>
        <div className="usersPage__dialogActions reviewFeedbackDialog__actions">
          <button
            type="button"
            className="usersPage__btn usersPage__btn--logoutTone"
            onClick={close}
            disabled={submitting}
          >
            {isReadOnly ? "Close" : "Cancel"}
          </button>
          {!isViewMode && !isOnRisks ? (
            <button
              type="button"
              className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
              disabled={submitting || !canSubmit}
              aria-busy={submitting}
              onClick={handleSubmit}
            >
              {submitLabel}
            </button>
          ) : null}
        </div>
      </div>

      {moveConfirmOpen ? (
        <div
          className="reviewFeedbackDialog__confirmOverlay"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) setMoveConfirmOpen(false);
          }}
        >
          <div
            className="usersPage__dialog reviewFeedbackDialog__confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${baseId}-confirm-title`}
            aria-describedby={`${baseId}-confirm-desc`}
          >
            <div className="usersPage__dialogHead reviewFeedbackDialog__head">
              <h2
                id={`${baseId}-confirm-title`}
                className="usersPage__dialogTitle"
              >
                Move to Risks?
              </h2>
            </div>
            <div className="usersPage__dialogBody reviewFeedbackDialog__body">
              <p
                id={`${baseId}-confirm-desc`}
                className="reviewFeedbackDialog__confirmText"
              >
                This will promote <strong>{riskTitle}</strong> to the Risks
                page as <strong>{classification === "raw" ? "Raw" : "Structured"}</strong>.
                Your feedback will be saved.
              </p>
            </div>
            <div className="usersPage__dialogActions reviewFeedbackDialog__actions">
              <button
                type="button"
                className="usersPage__btn usersPage__btn--logoutTone"
                onClick={() => setMoveConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
                onClick={handleConfirmMove}
              >
                Yes, move to Risks
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
