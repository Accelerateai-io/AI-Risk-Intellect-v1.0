/**
 * Bulk review assignment — pure domain logic (no DB).
 *
 * The persistence layer resolves eligible rows and runs a single transactional
 * UPDATE; this module owns the honest accounting (requested → matched → assigned
 * → skipped) so results never over-claim. "Assign 1,000" is one server operation,
 * never 1,000 requests.
 */

export type AssignmentSkip = {
  id: string;
  reason: "not_found_or_ineligible" | "already_assigned_to_target";
};

export type AssignmentResult = {
  requested: number;
  matched: number;
  assigned: number;
  skipped: AssignmentSkip[];
  failed: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** De-duplicate + validate an incoming id list. Non-uuid / empty entries are dropped. */
export function normalizeReviewIds(input: unknown): {
  ids: string[];
  dropped: number;
} {
  if (!Array.isArray(input)) return { ids: [], dropped: 0 };
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of input) {
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s || !UUID_RE.test(s)) {
      dropped++;
      continue;
    }
    seen.add(s.toLowerCase());
  }
  return { ids: [...seen], dropped };
}

/**
 * Partition requested ids against the set of ids that actually exist AND are
 * eligible for assignment (resolved by the caller from the DB). Ids already
 * pointing at the target assignee are reported as skipped (idempotent no-ops),
 * not double-counted as newly assigned.
 */
export function partitionAssignment(params: {
  requestedIds: string[];
  eligibleIds: Iterable<string>;
  alreadyOnTargetIds?: Iterable<string>;
}): { toAssign: string[]; skipped: AssignmentSkip[] } {
  const eligible = new Set(
    [...params.eligibleIds].map((s) => s.toLowerCase()),
  );
  const alreadyTarget = new Set(
    [...(params.alreadyOnTargetIds ?? [])].map((s) => s.toLowerCase()),
  );

  const toAssign: string[] = [];
  const skipped: AssignmentSkip[] = [];
  for (const id of params.requestedIds) {
    const key = id.toLowerCase();
    if (!eligible.has(key)) {
      skipped.push({ id, reason: "not_found_or_ineligible" });
    } else if (alreadyTarget.has(key)) {
      skipped.push({ id, reason: "already_assigned_to_target" });
    } else {
      toAssign.push(id);
    }
  }
  return { toAssign, skipped };
}

/** Assemble the honest, non-over-claiming result. */
export function summarizeAssignment(params: {
  requested: number;
  toAssign: string[];
  skipped: AssignmentSkip[];
  assignedCount: number;
}): AssignmentResult {
  const matched = params.toAssign.length + params.skipped.filter(
    (s) => s.reason === "already_assigned_to_target",
  ).length;
  return {
    requested: params.requested,
    matched,
    assigned: params.assignedCount,
    skipped: params.skipped,
    failed: Math.max(0, params.toAssign.length - params.assignedCount),
  };
}

/** Chunk a large id list so a single statement never exceeds parameter limits. */
export function chunk<T>(items: T[], size = 500): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
