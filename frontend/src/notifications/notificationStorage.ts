const STORAGE_KEY = "app.notifications.readIds";

function readIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeIds(ids: Set<string>): void {
  const list = [...ids].slice(-500);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getReadNotificationIds(): Set<string> {
  return readIds();
}

export function markNotificationRead(id: string): void {
  const ids = readIds();
  ids.add(id);
  writeIds(ids);
}

export function markAllNotificationsRead(notificationIds: string[]): void {
  const ids = readIds();
  for (const id of notificationIds) {
    ids.add(id);
  }
  writeIds(ids);
}
