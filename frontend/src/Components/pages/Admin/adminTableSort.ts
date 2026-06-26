export type SortDirection = "asc" | "desc";

export type TableSortState<K extends string = string> = {
  key: K;
  direction: SortDirection;
};

export function nextTableSort<K extends string>(
  current: TableSortState<K> | null,
  key: K,
): TableSortState<K> {
  if (current?.key === key) {
    return {
      key,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  return { key, direction: "asc" };
}

export function compareSortValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: SortDirection,
): number {
  const dir = direction === "asc" ? 1 : -1;
  const aMissing = a == null || (typeof a === "string" && a.trim() === "");
  const bMissing = b == null || (typeof b === "string" && b.trim() === "");

  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * dir;
  }

  return (
    String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    }) * dir
  );
}

export function sortByTableState<T, K extends string>(
  rows: T[],
  sort: TableSortState<K> | null,
  getValue: (row: T, key: K) => string | number | null | undefined,
): T[] {
  if (!sort) return rows;

  return [...rows].sort((a, b) =>
    compareSortValues(getValue(a, sort.key), getValue(b, sort.key), sort.direction),
  );
}
