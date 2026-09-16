import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CircleX, Info, Pencil, Save, X } from "lucide-react";
import { formatDisplayDate } from "../../../utils/formatDate";
import { formatDisplayValue, formatRiskDomain, type HumanReviewInfo, type RiskDetail } from "../Risk/riskData";
import { capitalizeDisplayName } from "../../../utils/reviewOpsApi";
import {
  canPromoteReviewToRisks,
  humanReviewStatusLabel,
  isExistingHumanReview,
  resolveReviewClassification,
  type ReviewClassification,
} from "../Risk/humanReviewHelpers";
import "../Users/usersPage.css";
import "./reviewPage.css";

export type { ReviewClassification };

export type ReviewDialogMode = "view" | "edit";

interface ReviewFeedbackDialogProps {
  open: boolean;
  mode: ReviewDialogMode;
  riskTitle: string;
  reviewWhy?: string;
  reviewReason?: string;
  currentDomain?: string;
  taxonomyDomains?: string[];
  submitting: boolean;
  initialReview?: HumanReviewInfo | null;
  /** When present (edit mode), enables the allow-listed field editor. */
  editableRisk?: RiskDetail | null;
  /** Admin-only: Overview field edits and domain remap. */
  canEditFields?: boolean;
  savingFields?: boolean;
  onSaveFields?: (fields: Record<string, unknown>, reason: string) => void;
  onOpenAnalysis?: () => void;
  /** Close the popup and open Overview in edit mode. */
  onEditFields?: () => void;
  onClose: () => void;
  onSubmitRaw: (feedback: string) => void;
  onSubmitStructured: (feedback: string) => void;
  onUpdateFeedback: (feedback: string) => void;
  onMoveToRisks: (
    feedback: string,
    classification: ReviewClassification,
    domain?: string,
  ) => void;
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
  reviewWhy,
  reviewReason,
  currentDomain = "",
  taxonomyDomains = [],
  submitting,
  initialReview,
  canEditFields = false,
  onOpenAnalysis,
  onEditFields,
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
  const [selectedDomain, setSelectedDomain] = useState("");
  const needsDomainRemap = reviewWhy === "Domain";

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
    setSelectedDomain("");
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
    if (!classification || !feedback.trim() || (needsDomainRemap && !selectedDomain)) {
      setMoveToRisks(false);
    }
  }, [classification, feedback, needsDomainRemap, selectedDomain]);

  if (!open) return null;

  const hasClassification = classification != null;
  const hasFeedback = feedback.trim().length >= 3;
  const hasMappedDomain = !needsDomainRemap || Boolean(selectedDomain);
  const canUseMoveToggle =
    mode === "edit" &&
    !isOnRisks &&
    hasClassification &&
    hasFeedback &&
    hasMappedDomain &&
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
  const canMoveToRisks =
    moveToRisks &&
    canUseMoveToggle &&
    (!needsDomainRemap || Boolean(selectedDomain));
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
      onMoveToRisks(
        trimmedFeedback,
        classification,
        selectedDomain || undefined,
      );
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
            <p className="reviewFeedbackDialog__subtitle" title={formatDisplayValue(riskTitle)}>
              {formatDisplayValue(riskTitle)}
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
          {reviewWhy || reviewReason ? (
            <section className="reviewFeedbackDialog__why" aria-label="Why this item is in review">
              <p className="reviewFeedbackDialog__whyLabel">Why it is in review</p>
              <p className="reviewFeedbackDialog__whyBody">
                {reviewWhy ? (
                  <span
                    className={`reviewPage__pill reviewPage__pill--why reviewPage__pill--why${reviewWhy}`}
                  >
                    {reviewWhy}
                  </span>
                ) : null}
                {reviewReason ? (
                  <span className="reviewFeedbackDialog__whyReason">{reviewReason}</span>
                ) : null}
              </p>
            </section>
          ) : null}
          {onOpenAnalysis || onEditFields ? (
            <div className="reviewFeedbackDialog__analysisActions">
              {onOpenAnalysis ? (
                <button
                  type="button"
                  className="usersPage__btn"
                  onClick={onOpenAnalysis}
                >
                  Open Analysis
                </button>
              ) : null}
              {onEditFields && !isViewMode ? (
                <button
                  type="button"
                  className="usersPage__btn usersPage__btn--primary"
                  onClick={onEditFields}
                >
                  <Pencil size={16} strokeWidth={2} aria-hidden />
                  Edit
                </button>
              ) : null}
            </div>
          ) : null}
          {needsDomainRemap && !isViewMode && canEditFields ? (
            <section className="reviewFeedbackDialog__domainMap" aria-label="Map domain">
              <label htmlFor={`${baseId}-domain`} className="reviewFeedbackDialog__label">
                Move to taxonomy domain
              </label>
              <p className="reviewFeedbackDialog__moveDesc">
                Current domain is not in the 7 taxonomy domains
                {currentDomain ? `: ${formatRiskDomain(currentDomain)}` : ""}.
              </p>
              <select
                id={`${baseId}-domain`}
                className="reviewFeedbackDialog__domainSelect"
                value={selectedDomain}
                disabled={submitting || isOnRisks}
                onChange={(e) => setSelectedDomain(e.target.value)}
              >
                <option value="">Select a taxonomy domain…</option>
                {taxonomyDomains.map((domain) => (
                  <option key={domain} value={domain}>
                    {domain}
                  </option>
                ))}
              </select>
            </section>
          ) : null}
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
                  <dd>{capitalizeDisplayName(initialReview.reviewedBy)}</dd>
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
              {feedbackEditable && feedback.trim().length > 0 && feedback.trim().length < 3 ? (
                <p className="usersPage__fieldError" role="alert">
                  Feedback must be at least 3 characters.
                </p>
              ) : null}

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
                        : needsDomainRemap && !selectedDomain
                          ? "Select a taxonomy domain above to enable this option."
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
            {isReadOnly ? (
              <>
                <X size={16} strokeWidth={1.75} aria-hidden />
                Close
              </>
            ) : (
              <>
                <CircleX size={16} strokeWidth={1.75} aria-hidden />
                Cancel
              </>
            )}
          </button>
          {!isViewMode && !isOnRisks ? (
            <button
              type="button"
              className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
              disabled={submitting || !canSubmit}
              aria-busy={submitting}
              onClick={handleSubmit}
            >
              <Save size={16} strokeWidth={2} aria-hidden />
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
                This will promote <strong>{formatDisplayValue(riskTitle)}</strong> to the Risks
                page as <strong>{classification === "raw" ? "Raw" : "Structured"}</strong>
                {selectedDomain ? (
                  <>
                    {" "}
                    under <strong>{selectedDomain}</strong>
                  </>
                ) : null}
                . Your feedback will be saved.
              </p>
            </div>
            <div className="usersPage__dialogActions reviewFeedbackDialog__actions">
              <button
                type="button"
                className="usersPage__btn usersPage__btn--logoutTone"
                onClick={() => setMoveConfirmOpen(false)}
              >
                <CircleX size={16} strokeWidth={1.75} aria-hidden />
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
