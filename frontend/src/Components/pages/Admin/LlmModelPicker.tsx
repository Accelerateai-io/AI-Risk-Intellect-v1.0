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
  selectedLabel?: string;
  inferenceProfiles?: boolean;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  loading?: boolean;
};

function findSelectedOption(
  options: LlmModelOption[],
  value: string,
): LlmModelOption | undefined {
  if (!value) return undefined;
  const exact = options.find((option) => option.id === value);
  if (exact) return exact;
  const lower = value.toLowerCase();
  return options.find(
    (option) =>
      option.id.toLowerCase() === lower ||
      option.label.toLowerCase() === lower,
  );
}

export function LlmModelPicker({
  idPrefix,
  options,
  value,
  selectedLabel,
  inferenceProfiles = false,
  onChange,
  disabled = false,
  loading = false,
}: LlmModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [lastSelectedLabel, setLastSelectedLabel] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const triggerId = `${idPrefix}-trigger`;
  const searchId = `${idPrefix}-search`;
  const listId = `${idPrefix}-list`;

  const selected = findSelectedOption(options, value);

  useEffect(() => {
    const label = selected?.label ?? selectedLabel?.trim();
    if (label) setLastSelectedLabel(label);
  }, [selected?.label, selectedLabel]);

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
    const option = findSelectedOption(options, modelId);
    if (option?.label) setLastSelectedLabel(option.label);
    onChange(modelId);
    setOpen(false);
    setQuery("");
  };

  const resolvedLabel =
    selected?.label ?? selectedLabel?.trim() ?? lastSelectedLabel.trim();

  const itemNoun = inferenceProfiles ? "profile" : "model";
  const itemNounPlural = inferenceProfiles ? "profiles" : "models";
  const totalCount = options.length;
  const isFiltering = query.trim().length > 0;
  const countLabel = isFiltering
    ? `${filtered.length} / ${totalCount}`
  : `${totalCount} ${totalCount === 1 ? itemNoun : itemNounPlural}`;

  const triggerLabel = loading
    ? `Loading ${itemNounPlural}…`
    : options.length === 0
      ? `No ${itemNounPlural} available`
      : resolvedLabel ||
        (value ? value : `Select a ${itemNoun}…`);

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
        title={value || undefined}
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
              placeholder={`Search ${itemNounPlural}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-controls={listId}
              aria-describedby={`${idPrefix}-count`}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span
              id={`${idPrefix}-count`}
              className="adminPage__modelSearchCount"
              aria-live="polite"
            >
              {countLabel}
            </span>
          </div>
          <ul
            id={listId}
            className="adminPage__modelList"
            role="listbox"
            aria-label="LLM models"
          >
            {filtered.length === 0 ? (
              <li className="adminPage__modelListEmpty" role="presentation">
                No {itemNounPlural} match your search.
              </li>
            ) : (
              filtered.map((option) => {
                const isSelected = selected?.id === option.id;
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
