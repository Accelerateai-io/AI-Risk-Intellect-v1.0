import type { Request, Response } from "express";
import { HttpError } from "../../utils/httpError.js";
import { assertAdminUser } from "../../utils/isAdminUser.js";
import { resolveReviewer } from "../../services/risks/riskReview.service.js";
import { editRiskFields } from "../../services/risks/reviewEdit.service.js";
import { bulkAssignReviews } from "../../services/risks/reviewAssignmentService.js";

/** PATCH /risks/:id/fields — correct a risk's reviewable fields (allow-listed, audited). */
export async function editRiskFieldsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) throw HttpError.unauthorized("Authentication required.");
  assertAdminUser(req.user, "Only Admin users can edit risks.");

  const riskId = String(req.params.id ?? "").trim();
  const body = (req.body ?? {}) as { fields?: unknown; reason?: unknown };
  const patch = body.fields;
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw HttpError.unprocessable("`fields` must be an object of edits.");
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "";
  if (reason.length < 3) {
    throw HttpError.unprocessable("A reason for the change is required.");
  }

  const reviewer = await resolveReviewer(userId);
  const risk = await editRiskFields(riskId, {
    patch: patch as Record<string, unknown>,
    reason,
    reviewer,
  });
  res.status(200).json({ risk });
}

/** POST /risks/bulk/assign — assign many reviews to one user in one backend op. */
export async function bulkAssignReviewsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) throw HttpError.unauthorized("Authentication required.");

  const body = (req.body ?? {}) as {
    assigneeId?: unknown;
    assignToMe?: unknown;
    reviewIds?: unknown;
    allMatching?: unknown;
    filter?: { assignedTo?: string | null; status?: string };
  };
  const assigneeId =
    body.assignToMe === true
      ? userId
      : typeof body.assigneeId === "string"
        ? body.assigneeId.trim()
        : "";
  if (!assigneeId) throw HttpError.unprocessable("`assigneeId` is required.");

  const result = await bulkAssignReviews({
    assigneeId,
    actingUserId: userId,
    reviewIds: body.reviewIds,
    allMatching: body.allMatching === true,
    filter: body.filter,
  });
  res.status(200).json(result);
}
