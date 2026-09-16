import { useEffect, useId, useState } from "react";
import { CircleX, UserPlus, X } from "lucide-react";
import {
  formatDisplayValue,
  formatRiskId,
  type RiskDetail,
} from "../Risk/riskData";
import { capitalizeDisplayName, type AiriUser } from "../../../utils/reviewOpsApi";
import { AssigneePicker } from "./AssigneePicker";
import "../Users/usersPage.css";

interface AssignReviewsDialogProps {
  open: boolean;
  rows: RiskDetail[];
  users: AiriUser[];
  submitting: boolean;
  onClose: () => void;
  onAssign: (assigneeId: string, reviewIds: string[]) => void;
  onOpenReview: (row: RiskDetail) => void;
}

export function AssignReviewsDialog({
  open,
  rows,
  users,
  submitting,
  onClose,
  onAssign,
  onOpenReview,
}: AssignReviewsDialogProps) {
  const baseId = useId();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigneeId, setAssigneeId] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setAssigneeId("");
  }, [open]);

  if (!open) return null;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const selectedIds = [...selected];
  const selectedCount = selectedIds.length;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  return (
    <div
      className="usersPage__overlay"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="usersPage__dialog assignReviewsDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
      >
        <div className="usersPage__dialogHead">
          <div className="assignReviewsDialog__headText">
            <h2 id={`${baseId}-title`} className="usersPage__dialogTitle">
              Assign reviews
            </h2>
            <p className="assignReviewsDialog__subtitle">
              {rows.length} in queue
              {selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
            </p>
          </div>
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

        <div className="usersPage__dialogBody assignReviewsDialog__body">
          {rows.length === 0 ? (
            <p className="usersPage__dialogCopy">No reviews are available to assign.</p>
          ) : (
            <div className="assignReviewsDialog__panel">
              <label className="assignReviewsDialog__toolbar">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all reviews"
                />
                <span>Select all</span>
              </label>
              <ul className="assignReviewsDialog__list">
                {rows.map((row) => {
                  const checked = selected.has(row.id);
                  const assignee = row.assignment?.assigneeName
                    ? capitalizeDisplayName(row.assignment.assigneeName)
                    : "Unassigned";
                  return (
                    <li
                      key={row.id}
                      className={`assignReviewsDialog__item${checked ? " assignReviewsDialog__item--selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          });
                        }}
                        aria-label={`Select ${formatRiskId(row)}`}
                      />
                      <button
                        type="button"
                        className="assignReviewsDialog__link"
                        onClick={() => onOpenReview(row)}
                      >
                        <span className="assignReviewsDialog__id">{formatRiskId(row)}</span>
                        <span className="assignReviewsDialog__title">{formatDisplayValue(row.title)}</span>
                      </button>
                      <span
                        className={`assignReviewsDialog__assignee${
                          row.assignment?.assigneeName ? "" : " assignReviewsDialog__assignee--empty"
                        }`}
                      >
                        {assignee}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="assignReviewsDialog__footer">
          <AssigneePicker
            className="assignReviewsDialog__picker"
            mode="assign"
            users={users}
            value={assigneeId}
            onChange={setAssigneeId}
            ariaLabel="Choose reviewer to assign to"
            disabled={submitting || rows.length === 0}
          />
          <div className="assignReviewsDialog__footerBtns">
            <button
              type="button"
              className="usersPage__btn"
              disabled={submitting}
              onClick={onClose}
            >
              <CircleX size={16} strokeWidth={1.75} aria-hidden />
              Cancel
            </button>
            <button
              type="button"
              className="usersPage__btn usersPage__btn--primary"
              disabled={submitting || !assigneeId || selectedCount === 0}
              onClick={() => onAssign(assigneeId, selectedIds)}
            >
              <UserPlus size={16} strokeWidth={2} aria-hidden />
              {submitting ? "Assigning…" : "Assign"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
