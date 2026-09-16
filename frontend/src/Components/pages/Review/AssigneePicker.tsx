import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import { userDisplayName, type AiriUser } from "../../../utils/reviewOpsApi";

export type AssigneePickerMode = "filter" | "assign";

type AssigneePickerProps = {
  users: AiriUser[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  mode: AssigneePickerMode;
  disabled?: boolean;
  className?: string;
};

const FILTER_PINNED = [
  { value: "all", label: "All assignees" },
  { value: "unassigned", label: "Unassigned" },
  { value: "me", label: "Assigned to me" },
] as const;

function matchesQuery(label: string, extra: string[], query: string): boolean {
  if (!query) return true;
  const hay = [label, ...extra].join(" ").toLowerCase();
  return hay.includes(query);
}

export function AssigneePicker({
  users,
  value,
  onChange,
  ariaLabel,
  mode,
  disabled = false,
  className,
}: AssigneePickerProps) {
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateCoords = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, 256);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 280 && rect.top > spaceBelow;
    setCoords({
      top: openUp ? Math.max(8, rect.top - 4) : rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - width - 8),
      width,
    });
  };

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    updateCoords();
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateCoords);
    window.addEventListener("scroll", updateCoords, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateCoords);
      window.removeEventListener("scroll", updateCoords, true);
    };
  }, [open]);

  const selectedLabel = useMemo(() => {
    if (mode === "filter") {
      const pinned = FILTER_PINNED.find((item) => item.value === value);
      if (pinned) return pinned.label;
    }
    if (!value) return mode === "assign" ? "Assign to…" : "All assignees";
    const user = users.find((u) => u.id === value);
    return user ? userDisplayName(user) : "Assign to…";
  }, [mode, value, users]);

  const q = query.trim().toLowerCase();

  const pinnedOptions = useMemo(() => {
    if (mode !== "filter") return [];
    return FILTER_PINNED.filter((item) => matchesQuery(item.label, [], q));
  }, [mode, q]);

  const userOptions = useMemo(() => {
    return users.filter((u) =>
      matchesQuery(userDisplayName(u), [u.username, u.email], q),
    );
  }, [users, q]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const spaceBelow = coords ? window.innerHeight - coords.top : 0;
  const openUp = Boolean(coords && spaceBelow < 280 && (rootRef.current?.getBoundingClientRect().top ?? 0) > spaceBelow);

  const panel = open && coords ? (
    <div
      ref={panelRef}
      className={`assigneePicker__panel${openUp ? " assigneePicker__panel--up" : ""}`}
      id={`${baseId}-list`}
      role="listbox"
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        top: openUp ? undefined : coords.top,
        bottom: openUp ? window.innerHeight - (rootRef.current?.getBoundingClientRect().top ?? 0) + 4 : undefined,
        left: coords.left,
        width: coords.width,
      }}
    >
      <label className="assigneePicker__search">
        <Search size={14} strokeWidth={2} aria-hidden />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search reviewers…"
          aria-label="Search reviewers"
        />
      </label>
      <ul className="assigneePicker__options">
        {mode === "assign" ? (
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              className={`assigneePicker__option${value === "" ? " assigneePicker__option--selected" : ""}`}
              onClick={() => choose("")}
            >
              Assign to…
            </button>
          </li>
        ) : null}
        {pinnedOptions.map((item) => (
          <li key={item.value}>
            <button
              type="button"
              role="option"
              aria-selected={value === item.value}
              className={`assigneePicker__option${value === item.value ? " assigneePicker__option--selected" : ""}`}
              onClick={() => choose(item.value)}
            >
              {item.label}
            </button>
          </li>
        ))}
        {userOptions.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              role="option"
              aria-selected={value === u.id}
              className={`assigneePicker__option${value === u.id ? " assigneePicker__option--selected" : ""}`}
              onClick={() => choose(u.id)}
            >
              {userDisplayName(u)}
            </button>
          </li>
        ))}
        {pinnedOptions.length === 0 && userOptions.length === 0 ? (
          <li className="assigneePicker__empty">No reviewers match.</li>
        ) : null}
      </ul>
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`assigneePicker${open ? " assigneePicker--open" : ""}${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        className="assigneePicker__trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${baseId}-list`}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="assigneePicker__value">{selectedLabel}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden />
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
