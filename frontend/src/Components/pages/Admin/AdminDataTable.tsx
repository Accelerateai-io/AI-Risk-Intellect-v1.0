import type { ReactNode } from "react";
import {
  DataTablePagination,
  type DataTablePaginationProps,
} from "../../common/DataTablePagination";

export type AdminDataTableProps = {
  ariaLabel: string;
  filters?: ReactNode;
  children: ReactNode;
  pagination?: DataTablePaginationProps | null;
  wrapClassName?: string;
};

export function AdminDataTable({
  ariaLabel,
  filters,
  children,
  pagination,
  wrapClassName = "",
}: AdminDataTableProps) {
  const wrapClasses = [
    "adminPage__tableWrap",
    "adminPage__dataTableWrap",
    wrapClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="adminPage__dataTableSection" aria-label={ariaLabel}>
      {filters ? (
        <div
          className="adminPage__dataTableHead"
          aria-label={`${ariaLabel} filters`}
        >
          {filters}
        </div>
      ) : null}
      <div className={wrapClasses}>
        <div className="adminPage__tableScroll">{children}</div>
        {pagination ? (
          <DataTablePagination
            className="usersPage__pager adminPage__dataTablePager"
            {...pagination}
          />
        ) : null}
      </div>
    </section>
  );
}
