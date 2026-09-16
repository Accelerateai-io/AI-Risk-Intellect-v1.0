import { useEffect, useId, useState } from "react";
import { CircleX, Save, X } from "lucide-react";
import { formatDisplayValue, formatRiskDomain } from "../Risk/riskData";
import "../Users/usersPage.css";

interface DomainRemapDialogProps {
  open: boolean;
  riskTitle: string;
  currentDomain: string;
  taxonomyDomains: string[];
  submitting: boolean;
  onClose: () => void;
  onSave: (domain: string) => void;
}

export function DomainRemapDialog({
  open,
  riskTitle,
  currentDomain,
  taxonomyDomains,
  submitting,
  onClose,
  onSave,
}: DomainRemapDialogProps) {
  const baseId = useId();
  const [selectedDomain, setSelectedDomain] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedDomain("");
  }, [open, currentDomain]);

  if (!open) return null;

  const canSave = Boolean(selectedDomain) && !submitting;

  return (
    <div
      className="usersPage__overlay reviewFeedbackDialog__overlay"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="usersPage__dialog usersPage__dialog--wide reviewFeedbackDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
      >
        <div className="usersPage__dialogHead reviewFeedbackDialog__head">
          <div className="reviewFeedbackDialog__headText">
            <h2 id={`${baseId}-title`} className="usersPage__dialogTitle">
              Edit domain
            </h2>
            <p className="reviewFeedbackDialog__subtitle" title={formatDisplayValue(riskTitle)}>
              {formatDisplayValue(riskTitle)}
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
        <div className="usersPage__dialogBody reviewFeedbackDialog__body">
          <section className="reviewFeedbackDialog__why" aria-label="Current domain">
            <p className="reviewFeedbackDialog__whyLabel">Extracted domain</p>
            <p className="reviewFeedbackDialog__whyReason">
              {formatRiskDomain(currentDomain)} is not one of the 7 taxonomy
              domains. Choose a matching domain below.
            </p>
          </section>
          <label htmlFor={`${baseId}-domain`} className="reviewFeedbackDialog__label">
            Move to domain
          </label>
          <select
            id={`${baseId}-domain`}
            className="reviewFeedbackDialog__domainSelect"
            value={selectedDomain}
            disabled={submitting}
            onChange={(e) => setSelectedDomain(e.target.value)}
          >
            <option value="">Select a taxonomy domain…</option>
            {taxonomyDomains.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </div>
        <div className="usersPage__dialogActions reviewFeedbackDialog__actions">
          <button
            type="button"
            className="usersPage__btn usersPage__btn--logoutTone"
            onClick={onClose}
            disabled={submitting}
          >
            <CircleX size={16} strokeWidth={1.75} aria-hidden />
            Cancel
          </button>
          <button
            type="button"
            className="usersPage__btn usersPage__btn--primary usersPage__btn--inviteSend"
            disabled={!canSave}
            aria-busy={submitting}
            onClick={() => onSave(selectedDomain)}
          >
            <Save size={16} strokeWidth={2} aria-hidden />
            {submitting ? "Saving…" : "Save domain"}
          </button>
        </div>
      </div>
    </div>
  );
}
