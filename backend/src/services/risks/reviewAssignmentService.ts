import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { risks } from "../../schema/risks/risks.js";
import { users } from "../../schema/users/users.js";
import { HttpError } from "../../utils/httpError.js";
import { isRiskInReviewQueue } from "./risks.service.js";
import {
  chunk,
  normalizeReviewIds,
  partitionAssignment,
  summarizeAssignment,
  type AssignmentResult,
} from "./reviewAssignment.js";

/** Set-based UPDATE stays well under Postgres' parameter ceiling per statement. */
const ASSIGN_CHUNK = 500;

export type BulkAssignInput = {
  assigneeId: string;
  actingUserId: string;
  /** Explicit selection by id (dominant path for "assign these N"). */
  reviewIds?: unknown;
  /** Server-side "select all matching" — avoids sending thousands of ids. */
  allMatching?: boolean;
  filter?: { assignedTo?: string | null; status?: string };
};

type QueueRow = {
  id: string;
  domains: string | null;
  qualityScore: number | null;
  extractionJson: unknown;
  assignedTo: string | null;
};

function eligible(row: QueueRow): boolean {
  // Only rows still in the Human Review queue may be assigned (not approved/rejected/classified).
  return isRiskInReviewQueue({
    domains: row.domains,
    qualityScore: row.qualityScore,
    extractionJson: row.extractionJson,
  });
}

/**
 * Assign many reviews to one user in a single backend operation.
 *
 * - validates the assignee exists and is active
 * - de-duplicates ids; ignores non-uuid input
 * - only assigns rows still eligible for Human Review (skips the rest)
 * - reassignment overwrites the prior owner (last-writer-wins); rows already on
 *   the target are reported as skipped, never double-counted
 * - writes in chunked, set-based UPDATEs inside one transaction
 * - returns honest accounting: requested / matched / assigned / skipped / failed
 */
export async function bulkAssignReviews(
  input: BulkAssignInput,
): Promise<AssignmentResult> {
  // 1) Validate assignee.
  const [assignee] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, input.assigneeId))
    .limit(1);
  if (!assignee) throw HttpError.unprocessable("Assignee not found.");
  if (!assignee.isActive) {
    throw HttpError.unprocessable("Assignee is not an active user.");
  }

  // 2) Resolve the requested rows (by id list, or server-side "all matching").
  let candidateRows: QueueRow[];
  let requestedIds: string[];

  if (Array.isArray(input.reviewIds) && input.reviewIds.length > 0) {
    const { ids } = normalizeReviewIds(input.reviewIds);
    if (ids.length === 0) {
      throw HttpError.unprocessable("No valid review ids were provided.");
    }
    requestedIds = ids;
    candidateRows = [];
    for (const part of chunk(ids, ASSIGN_CHUNK)) {
      const rows = await db
        .select({
          id: risks.id,
          domains: risks.domains,
          qualityScore: risks.qualityScore,
          extractionJson: risks.extractionJson,
          assignedTo: risks.assignedTo,
        })
        .from(risks)
        .where(inArray(risks.id, part));
      candidateRows.push(...(rows as QueueRow[]));
    }
  } else if (input.allMatching) {
    // Whole review queue (optionally narrowed by filter), resolved on the server.
    const rows = (await db
      .select({
        id: risks.id,
        domains: risks.domains,
        qualityScore: risks.qualityScore,
        extractionJson: risks.extractionJson,
        assignedTo: risks.assignedTo,
      })
      .from(risks)) as QueueRow[];
    const filterAssignedTo = input.filter?.assignedTo;
    candidateRows = rows.filter((r) => {
      if (!eligible(r)) return false;
      if (filterAssignedTo === null && r.assignedTo != null) return false;
      if (
        typeof filterAssignedTo === "string" &&
        filterAssignedTo &&
        r.assignedTo !== filterAssignedTo
      ) {
        return false;
      }
      return true;
    });
    requestedIds = candidateRows.map((r) => r.id);
  } else {
    throw HttpError.unprocessable(
      "Provide reviewIds or allMatching for assignment.",
    );
  }

  // 3) Partition into eligible / skipped, honoring idempotency on the target.
  const eligibleIds: string[] = [];
  const alreadyOnTarget: string[] = [];
  const byId = new Map(candidateRows.map((r) => [r.id.toLowerCase(), r]));
  for (const id of requestedIds) {
    const row = byId.get(id.toLowerCase());
    if (row && eligible(row)) {
      eligibleIds.push(row.id);
      if (row.assignedTo === input.assigneeId) alreadyOnTarget.push(row.id);
    }
  }
  const { toAssign, skipped } = partitionAssignment({
    requestedIds,
    eligibleIds,
    alreadyOnTargetIds: alreadyOnTarget,
  });

  // 4) Chunked, transactional, set-based assignment.
  let assignedCount = 0;
  if (toAssign.length > 0) {
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const part of chunk(toAssign, ASSIGN_CHUNK)) {
        const updated = await tx
          .update(risks)
          .set({
            assignedTo: input.assigneeId,
            assignedAt: now,
            assignedBy: input.actingUserId,
          })
          .where(inArray(risks.id, part))
          .returning({ id: risks.id });
        assignedCount += updated.length;
      }
    });
  }

  return summarizeAssignment({
    requested: requestedIds.length,
    toAssign,
    skipped,
    assignedCount,
  });
}
