/** Dispatched when the pending human review count may have changed. */
export const PENDING_REVIEW_COUNT_CHANGED = "app-pending-review-count-changed";

export function notifyPendingReviewCountChanged(): void {
  window.dispatchEvent(new Event(PENDING_REVIEW_COUNT_CHANGED));
}
