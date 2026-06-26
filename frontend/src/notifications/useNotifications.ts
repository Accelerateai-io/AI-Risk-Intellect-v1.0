import { useContext } from "react";
import {
  NotificationsContext,
  type NotificationsContextValue,
} from "./notificationsContext";

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return ctx;
}
