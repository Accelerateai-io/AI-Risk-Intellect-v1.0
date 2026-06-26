import { useId } from "react";
import { X } from "lucide-react";
import "../Users/usersPage.css";
import "./riskPage.css";
import type { HumanReviewMoveDetails } from "./humanReviewHelpers";

interface RiskMoveInfoDialogProps {
  open: boolean;
  displayId: string;
  riskTitle: string;
  details: HumanReviewMoveDetails | null;
  onClose: () => void;
}

export function RiskMoveInfoDialog({
  open,
  displayId,
  riskTitle,
  details,
  onClose,
}: RiskMoveInfoDialogProps) {
  const baseId = useId();

  if (!open || !details) return null;

  return (
    <div
      className="usersPage__overlay"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="usersPage__dialog riskMoveInfoDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
      >
        <div className="usersPage__dialogHead">
          <h2 id={`${baseId}-title`} className="usersPage__dialogTitle">
            Moved to Risks
          </h2>
          <button
            type="button"
            className="usersPage__dialogClose"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="usersPage__dialogBody">
          <p className="riskMoveInfoDialog__lead">
            <strong>{displayId}</strong> — {riskTitle}
          </p>
          <dl className="riskMoveInfoDialog__details">
            <div className="riskMoveInfoDialog__row">
              <dt>Moved by</dt>
              <dd>{details.reviewer}</dd>
            </div>
            <div className="riskMoveInfoDialog__row">
              <dt>Date</dt>
              <dd>{details.reviewedAtDisplay}</dd>
            </div>
            <div className="riskMoveInfoDialog__row">
              <dt>Classification</dt>
              <dd>{details.classificationLabel}</dd>
            </div>
            <div className="riskMoveInfoDialog__row">
              <dt>Feedback</dt>
              <dd>
                {details.feedback ? (
                  <p className="riskMoveInfoDialog__feedback">{details.feedback}</p>
                ) : (
                  <span className="riskMoveInfoDialog__muted">No feedback provided.</span>
                )}
              </dd>
            </div>
          </dl>
        </div>
        <div className="usersPage__dialogActions">
          <button
            type="button"
            className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
