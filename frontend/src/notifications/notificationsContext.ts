import { createContext } from "react";
import type { NotificationItem } from "./types";

export type NotificationsContextValue = {
  items: NotificationItem[];
  loading: boolean;
  unreadCount: number;
  readIds: Set<string>;
  load: (options?: { silent?: boolean }) => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => void;
};

export const NotificationsContext =
  createContext<NotificationsContextValue | null>(null);
