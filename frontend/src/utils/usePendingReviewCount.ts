import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { authFetch } from "./authFetch";
import { isReviewSource, type ReviewNavState } from "./reviewNav";
import {
  PENDING_REVIEW_COUNT_CHANGED,
  notifyPendingReviewCountChanged,
} from "./reviewQueueEvents";

function isReviewPath(pathname: string): boolean {
  return pathname === "/review" || pathname.startsWith("/review/");
}

export function usePendingReviewCount(): number {
  const location = useLocation();
  const onReview =
    isReviewPath(location.pathname) ||
    isReviewSource({
      searchParams: new URLSearchParams(location.search),
      state: location.state as ReviewNavState | null,
    });
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
  }, [loadCount]);

  useEffect(() => {
    if (!onReview) return;

    void loadCount();
    const onChanged = () => {
      void loadCount();
    };
    window.addEventListener(PENDING_REVIEW_COUNT_CHANGED, onChanged);
    return () => {
      window.removeEventListener(PENDING_REVIEW_COUNT_CHANGED, onChanged);
    };
  }, [loadCount, onReview]);

  return pendingCount;
}

export { notifyPendingReviewCountChanged };
