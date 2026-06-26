import { useEffect, useRef, useState } from "react";
import { BellIcon } from "lucide-react";
import { Link } from "react-router-dom";
import {
  formatNotificationTime,
  notificationKindClass,
} from "./notificationPresentation";
import { formatCronNotificationText } from "./formatCronNotificationText";
import { useNotifications } from "./useNotifications";
import "./notifications.css";

export function NotificationBell() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const {
    items,
    loading,
    unreadCount,
    readIds,
    load,
    markRead,
    markAllRead,
  } = useNotifications();

  useEffect(() => {
    if (!open) return;

    const onDocMouse = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDocMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void load({ silent: true });
  }, [open, load]);

  function toggleOpen(): void {
    setOpen((value) => !value);
  }

  return (
    <div className="notifications" ref={rootRef}>
      <button
        type="button"
        className={`notifications__trigger${open ? " notifications__trigger--active" : ""}`}
        onClick={toggleOpen}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
      >
        <BellIcon size={20} strokeWidth={1.75} aria-hidden />
        {unreadCount > 0 ? (
          <span className="notifications__badge" aria-hidden>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="notifications__panel"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="notifications__panelHead">
            <h2 className="notifications__panelTitle">Notifications</h2>
            <div className="notifications__panelActions">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  className="notifications__markAllBtn"
                  onClick={() => markAllRead()}
                >
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                className="notifications__refreshBtn"
                onClick={() => void load()}
                disabled={loading}
                aria-label="Refresh notifications"
              >
                {loading ? "…" : "↻"}
              </button>
            </div>
          </div>

          {loading && items.length === 0 ? (
            <p className="notifications__empty" role="status">
              Loading notifications…
            </p>
          ) : items.length === 0 ? (
            <p className="notifications__empty" role="status">
              No job queue or upload activity yet.
            </p>
          ) : (
            <ul className="notifications__list" role="list">
              {items.map((item) => {
                const isUnread = !readIds.has(item.id);
                const isCronNotification = item.kind.startsWith("cron_job_");
                const title = isCronNotification
                  ? formatCronNotificationText(item.title)
                  : item.title;
                const message = isCronNotification
                  ? formatCronNotificationText(item.message)
                  : item.message;
                const content = (
                  <>
                    <span
                      className={`notifications__itemDot ${notificationKindClass(item.kind)}`}
                      aria-hidden
                    />
                    <div className="notifications__itemBody">
                      <div className="notifications__itemTop">
                        <span className="notifications__itemTitle">
                          {title}
                        </span>
                        <time
                          className="notifications__itemTime"
                          dateTime={item.createdAt}
                        >
                          {formatNotificationTime(item.createdAt)}
                        </time>
                      </div>
                      <p className="notifications__itemMessage">
                        {message}
                      </p>
                    </div>
                  </>
                );

                return (
                  <li
                    key={item.id}
                    className={`notifications__item${isUnread ? " notifications__item--unread" : ""}`}
                  >
                    {item.href ? (
                      <Link
                        to={item.href}
                        className="notifications__itemLink"
                        onClick={() => {
                          markRead(item.id);
                          setOpen(false);
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="notifications__itemLink"
                        onClick={() => markRead(item.id)}
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
