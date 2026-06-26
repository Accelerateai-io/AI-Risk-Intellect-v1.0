import { useEffect, useRef } from "react";
import {
  IDLE_LOGOUT_TIMEOUT_MS,
  scheduleIdleSignOut,
} from "./authFetch";

const ACTIVITY_EVENTS = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
  "wheel",
] as const;

const MOUSEMOVE_THROTTLE_MS = 1_000;

/** Signs the user out after 15 minutes without user activity. */
export function useIdleLogout(enabled: boolean): void {
  const lastActivityRef = useRef(0);
  const logoutTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;

    const clearLogoutTimer = () => {
      if (logoutTimerRef.current !== undefined) {
        window.clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = undefined;
      }
    };

    const scheduleLogoutAfterIdle = (delayMs = IDLE_LOGOUT_TIMEOUT_MS) => {
      clearLogoutTimer();
      logoutTimerRef.current = window.setTimeout(() => {
        if (!sessionStorage.getItem("accessToken")) return;
        scheduleIdleSignOut();
      }, delayMs);
    };

    const recordActivity = () => {
      lastActivityRef.current = Date.now();
      scheduleLogoutAfterIdle();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= IDLE_LOGOUT_TIMEOUT_MS) {
        scheduleIdleSignOut();
        return;
      }
      scheduleLogoutAfterIdle(IDLE_LOGOUT_TIMEOUT_MS - idleMs);
    };

    let lastMouseMoveAt = 0;
    const onMouseMove = () => {
      const now = Date.now();
      if (now - lastMouseMoveAt < MOUSEMOVE_THROTTLE_MS) return;
      lastMouseMoveAt = now;
      recordActivity();
    };

    lastActivityRef.current = Date.now();
    scheduleLogoutAfterIdle();

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, recordActivity, { passive: true });
    }
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearLogoutTimer();
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, recordActivity);
      }
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled]);
}
