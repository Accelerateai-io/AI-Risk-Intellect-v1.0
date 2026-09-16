import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, CircleX, X } from "lucide-react";
import "../Users/usersPage.css";
import "./riskDetailDialog.css";

export type FieldEditControl =
  | {
      key: string;
      label?: string;
      value: string;
      control: "textarea";
      rows?: number;
    }
  | {
      key: string;
      label?: string;
      value: string;
      control: "select";
      options: { value: string; label: string }[];
    };

export type FieldEditSpec = {
  key: string;
  title: string;
  fields: FieldEditControl[];
};

interface FieldEditDialogProps {
  spec: FieldEditSpec;
  onClose: () => void;
  onApply: (values: Record<string, string>) => void;
}

function seed(fields: FieldEditControl[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, field.value]));
}

function AutoTextarea({
  id,
  value,
  rows = 8,
  autoFocus,
  onChange,
}: {
  id: string;
  value: string;
  rows?: number;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const cap = Math.round(window.innerHeight * 0.5);
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 160), cap)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      id={id}
      className="usersPage__textarea riskDetail__fieldEditTextarea"
      rows={rows}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function FieldEditDialog({ spec, onClose, onApply }: FieldEditDialogProps) {
  const baseId = useId();
  const [values, setValues] = useState(() => seed(spec.fields));
  const showLabels = spec.fields.length > 1 || spec.fields.some((field) => field.label);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="usersPage__overlay"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="usersPage__dialog riskDetail__confirmDialog riskDetail__fieldEditDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
      >
        <div className="usersPage__dialogHead">
          <h2 id={`${baseId}-title`} className="usersPage__dialogTitle">
            Edit {spec.title}
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
          {spec.fields.map((field, index) => {
            const fieldId = `${baseId}-${field.key}`;
            const label = field.label ?? spec.title;
            return (
              <div key={field.key} className="riskDetail__fieldEditGroup">
                {showLabels ? (
                  <label htmlFor={fieldId} className="usersPage__label">
                    {label}
                  </label>
                ) : (
                  <label htmlFor={fieldId} className="usersPage__visuallyHidden">
                    {label}
                  </label>
                )}
                {field.control === "select" ? (
                  <select
                    id={fieldId}
                    className="usersPage__input usersPage__select"
                    value={values[field.key] ?? ""}
                    autoFocus={index === 0}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  >
                    {field.options.map((option) => (
                      <option key={`${option.value}:${option.label}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <AutoTextarea
                    id={fieldId}
                    value={values[field.key] ?? ""}
                    rows={field.rows}
                    autoFocus={index === 0}
                    onChange={(next) =>
                      setValues((prev) => ({ ...prev, [field.key]: next }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="usersPage__dialogActions">
          <button type="button" className="usersPage__btn usersPage__btn--ghost" onClick={onClose}>
            <CircleX size={16} strokeWidth={1.75} aria-hidden />
            Cancel
          </button>
          <button
            type="button"
            className="usersPage__btn usersPage__btn--primary"
            onClick={() => onApply(values)}
          >
            <Check size={16} strokeWidth={2} aria-hidden />
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
