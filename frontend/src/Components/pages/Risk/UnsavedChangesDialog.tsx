import { useId } from "react";
import { CircleX, X } from "lucide-react";
import { UNSAVED_CHANGES_MESSAGE } from "./riskEditDraft";
import "../Users/usersPage.css";

interface UnsavedChangesDialogProps {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}

export function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
}: UnsavedChangesDialogProps) {
  const baseId = useId();
  if (!open) return null;

  return (
    <div
      className="usersPage__overlay"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onStay();
      }}
    >
      <div
        className="usersPage__dialog riskDetail__confirmDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
        aria-describedby={`${baseId}-desc`}
      >
        <div className="usersPage__dialogHead">
          <h2 id={`${baseId}-title`} className="usersPage__dialogTitle">
            Unsaved changes
          </h2>
          <button
            type="button"
            className="usersPage__dialogClose"
            onClick={onStay}
            aria-label="Stay on this page"
          >
            <X size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="usersPage__dialogBody">
          <p id={`${baseId}-desc`} className="usersPage__dialogCopy">
            {UNSAVED_CHANGES_MESSAGE}
          </p>
        </div>
        <div className="usersPage__dialogActions">
          <button type="button" className="usersPage__btn" onClick={onStay}>
            Stay
          </button>
          <button type="button" className="usersPage__btn usersPage__btn--primary" onClick={onLeave}>
            <CircleX size={16} strokeWidth={1.75} aria-hidden />
            Leave without saving
          </button>
        </div>
      </div>
    </div>
  );
}
