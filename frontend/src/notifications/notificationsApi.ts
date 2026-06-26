import { authFetch } from "../utils/authFetch";
import type { NotificationItem } from "./types";

type ApiErrorBody = {
  error?: { message?: string };
  message?: string;
};

function errorMessage(data: ApiErrorBody, fallback: string): string {
  return data.error?.message ?? data.message ?? fallback;
}

export async function fetchNotifications(): Promise<
  | { ok: true; notifications: NotificationItem[] }
  | { ok: false; message: string }
> {
  try {
    const res = await authFetch("/notifications");
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
      notifications?: NotificationItem[];
    };

    if (!res.ok) {
      return {
        ok: false,
        message: errorMessage(data, "Could not load notifications."),
      };
    }

    return { ok: true, notifications: data.notifications ?? [] };
  } catch {
    return {
      ok: false,
      message: "Network error while loading notifications.",
    };
  }
}
