import { useCallback, useEffect, useMemo, useState } from "react";

type UsePaginationOptions<T> = {
  items: T[];
  pageSize: number;
  /** When this value changes, the current page resets to 0. */
  resetKey: string;
};

export function usePagination<T>({
  items,
  pageSize,
  resetKey,
}: UsePaginationOptions<T>) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [resetKey, pageSize]);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const safePage = Math.min(page, pageCount - 1);
  const startIdx = safePage * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);

  const pageItems = useMemo(
    () => items.slice(startIdx, startIdx + pageSize),
    [items, startIdx, pageSize],
  );

  const goFirst = useCallback(() => setPage(0), []);
  const goPrev = useCallback(() => setPage((p) => Math.max(0, p - 1)), []);
  const goNext = useCallback(
    () => setPage((p) => Math.min(pageCount - 1, p + 1)),
    [pageCount],
  );
  const goLast = useCallback(() => setPage(Math.max(0, pageCount - 1)), [pageCount]);

  return {
    page: safePage,
    pageCount,
    pageItems,
    setPage,
    goFirst,
    goPrev,
    goNext,
    goLast,
    pageSize,
    total,
    from: total === 0 ? 0 : startIdx + 1,
    to: endIdx,
  };
}
