import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export type LlmModelOption = {
  id: string;
  label: string;
  backend: string;
};

type LlmModelPickerProps = {
  idPrefix: string;
  options: LlmModelOption[];
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  loading?: boolean;
};

export function LlmModelPicker({
  idPrefix,
  options,
  value,
  onChange,
  disabled = false,
  loading = false,
}: LlmModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const triggerId = `${idPrefix}-trigger`;
  const searchId = `${idPrefix}-search`;
  const listId = `${idPrefix}-list`;

  const selected = options.find((option) => option.id === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.id.toLowerCase().includes(needle),
    );
  }, [options, query]);

  const inactive = disabled || loading;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
        setQuery("");
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
    setQuery("");
  };

  const triggerLabel = loading
    ? "Loading models…"
    : options.length === 0
      ? "No models available"
      : selected?.label ?? (value ? value : "Select a model…");

  useEffect(() => {
    if (inactive && open) {
      setOpen(false);
      setQuery("");
    }
  }, [inactive, open]);

  return (
    <div
      ref={rootRef}
      className={`adminPage__modelPicker${open ? " adminPage__modelPicker--open" : ""}`}
    >
      <button
        id={triggerId}
        type="button"
        className="adminPage__modelTrigger"
        onClick={() => {
          if (inactive) return;
          setOpen((prev) => {
            if (prev) setQuery("");
            return !prev;
          });
        }}
        disabled={inactive}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <span className="adminPage__modelTriggerText">{triggerLabel}</span>
        <ChevronDown
          size={18}
          strokeWidth={2}
          className="adminPage__modelTriggerIcon"
          aria-hidden
        />
      </button>

      {open ? (
        <div className="adminPage__modelMenu">
          <div className="adminPage__modelSearchWrap">
            <Search
              size={16}
              strokeWidth={2}
              className="adminPage__modelSearchIcon"
              aria-hidden
            />
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              className="adminPage__modelSearchInput"
              placeholder="Search models…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-controls={listId}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          <ul
            id={listId}
            className="adminPage__modelList"
            role="listbox"
            aria-label="LLM models"
          >
            {filtered.length === 0 ? (
              <li className="adminPage__modelListEmpty" role="presentation">
                No models match your search.
              </li>
            ) : (
              filtered.map((option) => {
                const isSelected = option.id === value;
                return (
                  <li key={option.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      title={option.id}
                      className={`adminPage__modelOption${isSelected ? " adminPage__modelOption--selected" : ""}`}
                      onClick={() => handleSelect(option.id)}
                    >
                      <span className="adminPage__modelOptionLabel">{option.label}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
