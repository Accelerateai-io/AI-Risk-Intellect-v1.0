import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import "./dataTablePagination.css";

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;

export type DataTablePaginationProps = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  /** When true, omit the “Showing X–Y of Z” line (e.g. when shown in a toolbar above). */
  hideRange?: boolean;
  /** Extra class on the root (e.g. BEM block for the page). */
  className?: string;
};

export function DataTablePagination({
  page,
  pageCount,
  total,
  pageSize,
  from,
  to,
  onPageChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  onPageSizeChange,
  hideRange = false,
  className = "",
}: DataTablePaginationProps) {
  if (total === 0) {
    return null;
  }

  const rootClass = ["dtPagination", hideRange ? "dtPagination--noRange" : "", className]
    .filter(Boolean)
    .join(" ");
  const atFirst = page <= 0;
  const atLast = page >= pageCount - 1;

  return (
    <nav className={rootClass} aria-label="Table pagination">
      {hideRange ? null : (
        <p className="dtPagination__range">
          Showing <strong>{from}</strong>–<strong>{to}</strong> of{" "}
          <strong>{total}</strong>
        </p>
      )}
      <div className="dtPagination__controls">
        {onPageSizeChange ? (
          <label className="dtPagination__sizeLabel">
            <span className="dtPagination__sizeText">Rows per page</span>
            <select
              className="dtPagination__sizeSelect"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="dtPagination__nav">
          <button
            type="button"
            className="dtPagination__btn"
            onClick={() => onPageChange(0)}
            disabled={atFirst}
            aria-label="First page"
          >
            <ChevronsLeft size={16} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="dtPagination__btn"
            onClick={() => onPageChange(page - 1)}
            disabled={atFirst}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          </button>
          <span className="dtPagination__pageLabel" aria-live="polite">
            Page {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            className="dtPagination__btn"
            onClick={() => onPageChange(page + 1)}
            disabled={atLast}
            aria-label="Next page"
          >
            <ChevronRight size={16} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="dtPagination__btn"
            onClick={() => onPageChange(pageCount - 1)}
            disabled={atLast}
            aria-label="Last page"
          >
            <ChevronsRight size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>
    </nav>
  );
}
