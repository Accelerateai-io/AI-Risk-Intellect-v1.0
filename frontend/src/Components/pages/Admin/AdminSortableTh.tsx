import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { TableSortState } from "./adminTableSort";

interface AdminSortableThProps<K extends string = string> {
  label: string;
  sortKey: K;
  sort: TableSortState<K> | null;
  onSort: (key: K) => void;
  className?: string;
}

export function AdminSortableTh<K extends string = string>({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
}: AdminSortableThProps<K>) {
  const active = sort?.key === sortKey;
  const thClass = ["adminPage__th", "adminPage__th--sortable", className]
    .filter(Boolean)
    .join(" ");

  return (
    <th scope="col" className={thClass}>
      <button
        type="button"
        className={`adminPage__sortBtn${active ? " adminPage__sortBtn--active" : ""}`}
        onClick={() => onSort(sortKey)}
        aria-sort={
          active
            ? sort.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
      >
        <span>{label}</span>
        {active ? (
          sort.direction === "asc" ? (
            <ChevronUp size={14} strokeWidth={2} aria-hidden />
          ) : (
            <ChevronDown size={14} strokeWidth={2} aria-hidden />
          )
        ) : (
          <ChevronsUpDown size={14} strokeWidth={2} aria-hidden />
        )}
      </button>
    </th>
  );
}
