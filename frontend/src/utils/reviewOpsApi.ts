import { authFetch } from "./authFetch";

export type AiriUser = {
  id: string;
  username: string;
  fullName: string | null;
  email: string;
  isActive: boolean;
};

/** Real AIRI users for the assignee picker / filter (GET /users). */
export async function listAiriUsers(): Promise<AiriUser[]> {
  const res = await authFetch("/users");
  if (!res.ok) throw new Error("Failed to load users.");
  const data = (await res.json()) as unknown;
  const arr = (
    Array.isArray(data) ? data : ((data as { users?: unknown[] }).users ?? [])
  ) as Array<Record<string, unknown>>;
  return arr.map((u) => ({
    id: String(u.id ?? ""),
    username: (u.username as string) ?? "",
    fullName: (u.fullName as string | null) ?? (u.full_name as string | null) ?? null,
    email: (u.email as string) ?? "",
    isActive: (u.isActive as boolean) ?? (u.is_active as boolean) ?? true,
  }));
}

export function capitalizeDisplayName(name: string): string {
  const raw = name.trim();
  if (!raw) return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function userDisplayName(u: AiriUser): string {
  const raw = (u.fullName && u.fullName.trim()) || u.username || u.email || "User";
  return capitalizeDisplayName(raw);
}

export type BulkAssignSkip = { id: string; reason: string };
export type BulkAssignResult = {
  requested: number;
  matched: number;
  assigned: number;
  skipped: BulkAssignSkip[];
  failed: number;
};

export type BulkAssignPayload = {
  assigneeId?: string;
  assignToMe?: boolean;
  reviewIds?: string[];
  allMatching?: boolean;
  filter?: { assignedTo?: string | null };
};

/** One backend bulk operation (chunked, set-based) — never N per-row requests. */
export async function bulkAssignReviews(
  payload: BulkAssignPayload,
): Promise<BulkAssignResult> {
  const res = await authFetch("/risks/bulk/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || "Bulk assignment failed.");
  }
  return body as BulkAssignResult;
}

/** Correct a risk's reviewable fields (server-side allow-list is authoritative). */
export async function editRiskFields(
  id: string,
  fields: Record<string, unknown>,
  reason?: string,
): Promise<void> {
  const res = await authFetch(`/risks/${encodeURIComponent(id)}/fields`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields, reason }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || "Could not save changes.");
  }
}

async function postReviewAction(
  path: string,
  body: Record<string, unknown>,
  fallbackMessage: string,
): Promise<void> {
  const res = await authFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string })?.message || fallbackMessage);
  }
}

export async function submitReviewRaw(id: string, feedback: string): Promise<void> {
  await postReviewAction(
    `/risks/${encodeURIComponent(id)}/review/reject`,
    { feedback, classification: "raw" },
    "Could not save feedback.",
  );
}

export async function submitReviewStructured(id: string, feedback: string): Promise<void> {
  await postReviewAction(
    `/risks/${encodeURIComponent(id)}/review/classify`,
    { feedback },
    "Could not save as Structured.",
  );
}

export async function moveReviewToRisks(
  id: string,
  feedback: string,
  classification: "raw" | "structured",
  domain?: string,
): Promise<void> {
  await postReviewAction(
    `/risks/${encodeURIComponent(id)}/review/approve`,
    { classification, feedback, domain },
    "Could not move this risk.",
  );
}
