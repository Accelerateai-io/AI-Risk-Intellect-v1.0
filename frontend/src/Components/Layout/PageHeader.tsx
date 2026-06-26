import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import { getSidebarNavItem } from "./sidebarNav";
import "./pageHeader.css";

export type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** When set, shown instead of the sidebar icon for the current route. */
  pageIcon?: LucideIcon;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  titleId?: string;
  actions?: ReactNode;
};

/** Page title row: icon in rounded tile + heading + optional subtitle (matches app reference layout). */
export function PageHeader({
  title,
  subtitle,
  pageIcon,
  className,
  titleClassName,
  subtitleClassName,
  titleId,
  actions,
}: PageHeaderProps) {
  const { pathname } = useLocation();
  const Icon = pageIcon ?? getSidebarNavItem(pathname)?.icon;

  const headerClass = ["pageHeader", className].filter(Boolean).join(" ");
  const titleClass = ["pageHeader__title", titleClassName].filter(Boolean).join(" ");
  const subtitleClass = ["pageHeader__subtitle", subtitleClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClass}>
      <div className="pageHeader__lead">
        {Icon ? (
          <span className="pageHeader__iconWrap" aria-hidden>
            <Icon size={22} strokeWidth={1.75} className="pageHeader__icon" />
          </span>
        ) : null}
        <div className="pageHeader__text">
          <h1 id={titleId} className={titleClass}>
            {title}
          </h1>
          {subtitle != null && subtitle !== "" ? (
            <p className={subtitleClass}>{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="pageHeader__actions">{actions}</div> : null}
    </header>
  );
}
