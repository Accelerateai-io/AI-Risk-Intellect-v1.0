import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "./PageHeader";

export type PageHeadingProps = Omit<
  ComponentPropsWithoutRef<"h1">,
  "children"
> & {
  children: ReactNode;
  pageIcon?: LucideIcon;
  subtitle?: ReactNode;
};

/** @deprecated Prefer `PageHeader` for title + subtitle + icon layout. */
export function PageHeading({
  children,
  className,
  pageIcon,
  subtitle,
  ...rest
}: PageHeadingProps) {
  return (
    <PageHeader
      title={children}
      subtitle={subtitle}
      pageIcon={pageIcon}
      titleClassName={className}
      titleId={rest.id}
    />
  );
}
