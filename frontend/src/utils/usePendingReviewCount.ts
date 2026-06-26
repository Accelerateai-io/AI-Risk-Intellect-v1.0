import { useCallback, useEffect, useState } from "react";
import { authFetch } from "./authFetch";
import {
  PENDING_REVIEW_COUNT_CHANGED,
  notifyPendingReviewCountChanged,
} from "./reviewQueueEvents";

const POLL_INTERVAL_MS = 60_000;

export function usePendingReviewCount(): number {
  const [pendingCount, setPendingCount] = useState(0);

  const loadCount = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      setPendingCount(0);
      return;
    }

    try {
      const res = await authFetch("/risks/review-queue/pending-count");
      if (!res.ok) return;
      const data = (await res.json()) as { pendingCount?: number };
      setPendingCount(
        typeof data.pendingCount === "number" && data.pendingCount >= 0
          ? data.pendingCount
          : 0,
      );
    } catch {
      /* keep last known count */
    }
  }, []);

  useEffect(() => {
    void loadCount();

    const onChanged = () => {
      void loadCount();
    };

    window.addEventListener(PENDING_REVIEW_COUNT_CHANGED, onChanged);
    const pollTimer = window.setInterval(() => {
      void loadCount();
    }, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener(PENDING_REVIEW_COUNT_CHANGED, onChanged);
      window.clearInterval(pollTimer);
    };
  }, [loadCount]);

  return pendingCount;
}

export { notifyPendingReviewCountChanged };
