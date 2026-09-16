export const REVIEW_RETURN_STORAGE_KEY = "airi.reviewReturnTo";

export type ReviewNavState = {
  returnTo?: string;
  fromReview?: boolean;
};

export function rememberReviewReturnTo(returnTo: string): void {
  try {
    sessionStorage.setItem(REVIEW_RETURN_STORAGE_KEY, returnTo);
  } catch {
    /* ignore quota / private mode */
  }
}

export function readReviewReturnTo(): string | undefined {
  try {
    const value = sessionStorage.getItem(REVIEW_RETURN_STORAGE_KEY)?.trim();
    return value?.startsWith("/review") ? value : undefined;
  } catch {
    return undefined;
  }
}

export function isReviewSource(input: {
  searchParams?: URLSearchParams;
  state?: ReviewNavState | null;
}): boolean {
  if (input.searchParams?.get("from") === "review") return true;
  if (input.searchParams?.get("review")?.trim()) return true;
  if (input.state?.fromReview) return true;
  return Boolean(input.state?.returnTo?.startsWith("/review"));
}

export function buildReviewRiskPath(riskId: string): string {
  return `/risk/${encodeURIComponent(riskId)}?tab=overview&from=review`;
}

export function buildReviewAnalysisState(returnTo: string): ReviewNavState {
  rememberReviewReturnTo(returnTo);
  return { returnTo, fromReview: true };
}
