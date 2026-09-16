import { useEffect, useId, useState } from "react";
import { CircleX, Save, X } from "lucide-react";
import "../Users/usersPage.css";

interface SaveReasonDialogProps {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export function SaveReasonDialog({
  open,
  submitting,
  onClose,
  onConfirm,
}: SaveReasonDialogProps) {
  const baseId = useId();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("");
  }, [open]);

  if (!open) return null;

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 3;

  return (
    <div
      className="usersPage__overlay"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="usersPage__dialog riskDetail__confirmDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
      >
        <div className="usersPage__dialogHead">
          <h2 id={`${baseId}-title`} className="usersPage__dialogTitle">
            Reason for change
          </h2>
          <button
            type="button"
            className="usersPage__dialogClose"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="usersPage__dialogBody">
          <p className="usersPage__dialogCopy">
            Describe why these fields are being corrected. This reason is stored
            with the audit trail.
          </p>
          <label htmlFor={`${baseId}-reason`} className="usersPage__label">
            Reason
          </label>
          <textarea
            id={`${baseId}-reason`}
            className="usersPage__textarea"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            placeholder="e.g. corrected mislabeled domain"
          />
          {trimmed.length > 0 && trimmed.length < 3 ? (
            <p className="usersPage__fieldError" role="alert">
              Reason must be at least 3 characters.
            </p>
          ) : null}
        </div>
        <div className="usersPage__dialogActions">
          <button type="button" className="usersPage__btn" disabled={submitting} onClick={onClose}>
            <CircleX size={16} strokeWidth={1.75} aria-hidden />
            Cancel
          </button>
          <button
            type="button"
            className="usersPage__btn usersPage__btn--primary"
            disabled={submitting || !canSubmit}
            onClick={() => onConfirm(trimmed)}
          >
            <Save size={16} strokeWidth={2} aria-hidden />
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
