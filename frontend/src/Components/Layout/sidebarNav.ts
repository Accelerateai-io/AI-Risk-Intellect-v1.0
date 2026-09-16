import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Briefcase,
  ClipboardCheck,
  FileText,
  KeyRound,
  LayoutDashboard,
  // Settings,
  Settings2,
  Users,
} from "lucide-react";

export type SidebarNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

/** Single source of truth for sidebar routes and icons */
export const SIDEBAR_NAV: readonly SidebarNavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/risk", label: "Risks", icon: AlertTriangle },
  { to: "/articles", label: "Articles", icon: FileText },
  { to: "/controls", label: "Controls", icon: Settings2 },
  { to: "/review", label: "Review", icon: ClipboardCheck },
  // { to: "/admin", label: "Admin", icon: Shield },
  { to: "/observability", label: "Observability", icon: Activity },
  // { to: "/settings", label: "Settings", icon: Settings },
  { to: "/api-keys", label: "API Keys", icon: KeyRound },
  { to: "/users", label: "Users", icon: Users },
];

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

/** Nav roots that stay highlighted on child routes (e.g. /risk/:riskId). */
const NESTED_NAV_ROOTS = new Set(["/risk"]);

export type SidebarNavContext = {
  /** Risk detail opened from Human Review — keep Review highlighted for every user. */
  fromReview?: boolean;
};

export function isSidebarNavItemActive(
  pathname: string,
  itemTo: string,
  context?: SidebarNavContext,
): boolean {
  const normalized = normalizePathname(pathname);
  if (context?.fromReview && normalized.startsWith("/risk/")) {
    return itemTo === "/review";
  }
  if (itemTo === normalized) return true;
  if (NESTED_NAV_ROOTS.has(itemTo) && normalized.startsWith(`${itemTo}/`)) {
    return true;
  }
  return false;
}

export function getSidebarNavItem(
  pathname: string,
  context?: SidebarNavContext,
): SidebarNavItem | undefined {
  const normalized = normalizePathname(pathname);
  if (context?.fromReview && normalized.startsWith("/risk/")) {
    return SIDEBAR_NAV.find((item) => item.to === "/review");
  }
  const exact = SIDEBAR_NAV.find((item) => item.to === normalized);
  if (exact) return exact;
  if (normalized.startsWith("/risk/")) {
    return SIDEBAR_NAV.find((item) => item.to === "/risk");
  }
  return undefined;
}
