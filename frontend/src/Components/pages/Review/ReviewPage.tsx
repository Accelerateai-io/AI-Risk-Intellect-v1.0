import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { CircleX, FilterX, RotateCw, Search, UserCheck, UserPlus } from "lucide-react";

import { readApiErrorMessage } from "../../../utils/readApiErrorMessage";
import { authFetch } from "../../../utils/authFetch";
import { formatDisplayDate } from "../../../utils/formatDate";
import { isCurrentUserAdmin } from "../../../utils/isAdminUser";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import {
  buildReviewAnalysisState,
  buildReviewRiskPath,
} from "../../../utils/reviewNav";
import { usePagination } from "../../../utils/usePagination";
import {
  bulkAssignReviews,
  editRiskFields,
  listAiriUsers,
  userDisplayName,
  type AiriUser,
  type BulkAssignPayload,
} from "../../../utils/reviewOpsApi";

import { PageHeader } from "../../Layout/PageHeader";

import {
  formatDisplayValue,
  normalizeRiskDetailFromApi,
  normalizeRisksFromApi,
  type RiskDetail,
} from "../Risk/riskData";
import { riskMatchesFilters } from "../Risk/riskListHelpers";

import { notifyPendingReviewCountChanged } from "../../../utils/reviewQueueEvents";

import { ReviewFeedbackDialog, type ReviewDialogMode } from "./ReviewFeedbackDialog";
import { AssigneePicker } from "./AssigneePicker";
import { AssignReviewsDialog } from "./AssignReviewsDialog";
import { DomainRemapDialog } from "./DomainRemapDialog";
import { ReviewFeedbackPanel } from "./ReviewFeedbackPanel";
import { ReviewRecordsTable } from "./ReviewRecordsTable";
import { REVIEW_WHY_LABELS } from "./reviewData";
import {
  normalizeReviewFeedbackFromApi,
  type ReviewFeedbackCounts,
  type ReviewFeedbackSample,
} from "./reviewFeedbackData";

import "../Users/usersPage.css";
import "../Risk/riskPage.css";
import "./reviewPage.css";

type ReviewTab = "queue" | "feedback";

type ReviewTabMeta = {
  id: ReviewTab;
  label: string;
  ariaLabel: (n: number) => string;
};

const REVIEW_TAB_METAS: readonly ReviewTabMeta[] = [
  { id: "queue", label: "Review Queue", ariaLabel: (n) => `Queue, ${n} item${n === 1 ? "" : "s"}` },
  { id: "feedback", label: "Feedback", ariaLabel: (n) => `Feedback, ${n} sample${n === 1 ? "" : "s"}` },
];

export function ReviewPage() {
  const baseId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<ReviewTab>(() =>
    searchParams.get("tab") === "feedback" ? "feedback" : "queue",
  );
  const [reviewSearch, setReviewSearch] = useState(() => searchParams.get("q") ?? "");
  const [whyFilter, setWhyFilter] = useState(() => searchParams.get("why") ?? "all");
  const [assignee, setAssignee] = useState(() => searchParams.get("assignee") ?? "all");
  const [refreshing, setRefreshing] = useState(false);
  const [reviewPageSize, setReviewPageSize] = useState(10);
  const [rows, setRows] = useState<RiskDetail[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [actingId, setActingId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<RiskDetail | null>(null);
  const [dialogMode, setDialogMode] = useState<ReviewDialogMode>("edit");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [domainTarget, setDomainTarget] = useState<RiskDetail | null>(null);
  const [taxonomyDomains, setTaxonomyDomains] = useState<string[]>([]);
  const [domainSubmitting, setDomainSubmitting] = useState(false);
  const [feedbackSamples, setFeedbackSamples] = useState<ReviewFeedbackSample[]>([]);
  const [feedbackCounts, setFeedbackCounts] = useState<ReviewFeedbackCounts>({ raw: 0, structured: 0, total: 0 });
  const [feedbackLoadState, setFeedbackLoadState] = useState<"idle" | "loading" | "error">("idle");

  // --- assignment / bulk state ---
  const [users, setUsers] = useState<AiriUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [assignChoice, setAssignChoice] = useState("");
  const [confirmingAssign, setConfirmingAssign] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [focusedReviewKey, setFocusedReviewKey] = useState(
    () => searchParams.get("review")?.trim() ?? "",
  );
  const extrasLoadedRef = useRef(false);
  const restoredFocusRef = useRef<string | null>(null);
  const canEditFields = isCurrentUserAdmin();

  const fid = (name: string) => `${baseId}-${name}`;

  const loadReviewQueue = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      setRows([]);
      setLoadState("idle");
      return;
    }
    setLoadState("loading");
    try {
      const url =
        assignee && assignee !== "all"
          ? `/risks/review-queue?assignee=${encodeURIComponent(assignee)}`
          : "/risks/review-queue";
      const res = await authFetch(url);
      if (!res.ok) {
        setLoadState("error");
        return;
      }
      const data = normalizeRisksFromApi(await res.json());
      setRows(
        data.risks.map((r) => {
          const createdAt = r.createdAt ?? r.ingestedAt;
          return { ...r, createdAt, ingestedAt: createdAt ? formatDisplayDate(createdAt) : "—" };
        }),
      );
      setLoadState("idle");
      notifyPendingReviewCountChanged();
    } catch {
      setLoadState("error");
    }
  }, [assignee]);

  const loadTaxonomyDomains = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) return;
    try {
      const res = await authFetch("/risks/taxonomy-domains");
      if (!res.ok) return;
      const data = (await res.json()) as { domains?: string[] };
      setTaxonomyDomains(Array.isArray(data.domains) ? data.domains.filter((d) => d.trim()) : []);
    } catch {
      setTaxonomyDomains([]);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) return;
    try {
      setUsers((await listAiriUsers()).filter((u) => u.isActive));
    } catch {
      setUsers([]);
    }
  }, []);

  const loadFeedbackSamples = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      setFeedbackSamples([]);
      setFeedbackCounts({ raw: 0, structured: 0, total: 0 });
      setFeedbackLoadState("idle");
      return;
    }
    setFeedbackLoadState("loading");
    try {
      const res = await authFetch("/risks/review-feedback");
      if (!res.ok) {
        setFeedbackLoadState("error");
        return;
      }
      const data = normalizeReviewFeedbackFromApi(await res.json());
      setFeedbackSamples(data.items);
      setFeedbackCounts(data.counts);
      setFeedbackLoadState("idle");
    } catch {
      setFeedbackLoadState("error");
    }
  }, []);

  useEffect(() => {
    setDocumentPageTitle("Human Review");
  }, []);

  useEffect(() => {
    if (tab !== "queue") return;
    void (async () => {
      await loadReviewQueue();
      if (extrasLoadedRef.current) return;
      extrasLoadedRef.current = true;
      void loadTaxonomyDomains();
      void loadUsers();
    })();
  }, [tab, loadReviewQueue, loadTaxonomyDomains, loadUsers]);

  useEffect(() => {
    if (tab !== "feedback") return;
    void loadFeedbackSamples();
    if (extrasLoadedRef.current) return;
    extrasLoadedRef.current = true;
    void loadTaxonomyDomains();
    void loadUsers();
  }, [tab, loadFeedbackSamples, loadTaxonomyDomains, loadUsers]);

  // Keep queue context URL-addressable (survives Analysis round-trips + refresh).
  // Only write while this page is active — setSearchParams would otherwise
  // replace /risk/:id?from=review after Analysis navigation.
  useEffect(() => {
    if (location.pathname !== "/review") return;
    const p = new URLSearchParams();
    if (tab !== "queue") p.set("tab", tab);
    if (whyFilter !== "all") p.set("why", whyFilter);
    if (reviewSearch.trim()) p.set("q", reviewSearch.trim());
    if (assignee !== "all") p.set("assignee", assignee);
    if (focusedReviewKey) p.set("review", focusedReviewKey);
    if (editTarget?.id && dialogMode === "view") p.set("view", editTarget.id);
    setSearchParams(p, { replace: true });
  }, [location.pathname, tab, whyFilter, reviewSearch, assignee, focusedReviewKey, editTarget, dialogMode, setSearchParams]);

  // Reopen the view dialog for ?view= once its row is present (e.g. returning from Analysis).
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (editTarget) return;
    if (viewId) {
      const row = rows.find((r) => r.id === viewId);
      if (row) {
        setDialogMode("view");
        setEditTarget(row);
        setFocusedReviewKey(row.displayId ?? row.id);
      }
    }
  }, [rows, searchParams, editTarget]);

  const whyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const label = row.reviewWhy?.trim() || "Review";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  const whyOptions = useMemo(() => {
    const extras = [...whyCounts.keys()].filter(
      (label) => !(REVIEW_WHY_LABELS as readonly string[]).includes(label),
    );
    extras.sort((a, b) => a.localeCompare(b));
    return [...REVIEW_WHY_LABELS, ...extras];
  }, [whyCounts]);

  const queueRows = useMemo(() => {
    const q = reviewSearch.trim().toLowerCase();
    return rows.filter((row) => {
      const why = row.reviewWhy?.trim() || "Review";
      if (whyFilter !== "all" && why !== whyFilter) return false;
      if (!q) return true;
      if (riskMatchesFilters(row, "all", "all", reviewSearch)) return true;
      return [row.reviewWhy, row.reviewReason]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [rows, reviewSearch, whyFilter]);

  const pager = usePagination({
    items: queueRows,
    pageSize: reviewPageSize,
    resetKey: `${queueRows.length}|${reviewSearch}|${whyFilter}|${assignee}`,
  });

  useEffect(() => {
    if (!focusedReviewKey || queueRows.length === 0) return;
    if (restoredFocusRef.current === `${focusedReviewKey}|${reviewPageSize}|${queueRows.length}`) {
      return;
    }
    const idx = queueRows.findIndex(
      (r) => r.id === focusedReviewKey || r.displayId === focusedReviewKey,
    );
    if (idx < 0) return;
    pager.setPage(Math.floor(idx / reviewPageSize));
    restoredFocusRef.current = `${focusedReviewKey}|${reviewPageSize}|${queueRows.length}`;
  }, [focusedReviewKey, queueRows, reviewPageSize, pager.setPage]);

  // Clear selection whenever the working set changes (avoids stale/ambiguous selection).
  useEffect(() => {
    setSelectedIds(new Set());
    setAllMatchingSelected(false);
    setConfirmingAssign(false);
  }, [whyFilter, reviewSearch, assignee, rows.length]);

  const tabCounts = useMemo(
    (): Record<ReviewTab, number> => ({ queue: rows.length, feedback: feedbackCounts.total }),
    [rows.length, feedbackCounts.total],
  );

  const feedbackSearchActive = tab === "feedback" && reviewSearch.trim().length > 0;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (tab === "queue") {
      await loadReviewQueue();
      setRefreshing(false);
      toast.success("Review queue refreshed.", { autoClose: 2000 });
      return;
    }
    if (tab === "feedback") {
      await loadFeedbackSamples();
      setRefreshing(false);
      toast.success("Feedback samples refreshed.", { autoClose: 2000 });
    }
  }, [loadReviewQueue, loadFeedbackSamples, tab]);

  const handleSubmitRaw = useCallback(
    async (feedback: string) => {
      if (!editTarget || editSubmitting) return;
      setEditSubmitting(true);
      try {
        const res = await authFetch(`/risks/${encodeURIComponent(editTarget.id)}/review/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback, classification: "raw" }),
        });
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        if (!res.ok) {
          toast.error(readApiErrorMessage(body, "Could not save feedback. Try again."), { autoClose: 4000 });
          return;
        }
        setEditTarget(null);
        await loadReviewQueue();
        await loadFeedbackSamples();
        notifyPendingReviewCountChanged();
        toast.success("Marked as Raw. Feedback saved.", { autoClose: 3000 });
      } catch {
        toast.error("Could not reach the server. Try again.", { autoClose: 4000 });
      } finally {
        setEditSubmitting(false);
      }
    },
    [editTarget, editSubmitting, loadReviewQueue, loadFeedbackSamples],
  );

  const handleSubmitStructured = useCallback(
    async (feedback: string) => {
      if (!editTarget || editSubmitting) return;
      setEditSubmitting(true);
      try {
        const res = await authFetch(`/risks/${encodeURIComponent(editTarget.id)}/review/classify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback }),
        });
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        if (!res.ok) {
          toast.error(readApiErrorMessage(body, "Could not save as Structured. Try again."), { autoClose: 4000 });
          return;
        }
        setEditTarget(null);
        await loadReviewQueue();
        await loadFeedbackSamples();
        notifyPendingReviewCountChanged();
        toast.success("Saved as Structured.", { autoClose: 3000 });
      } catch {
        toast.error("Could not reach the server. Try again.", { autoClose: 4000 });
      } finally {
        setEditSubmitting(false);
      }
    },
    [editTarget, editSubmitting, loadReviewQueue, loadFeedbackSamples],
  );

  const handleUpdateFeedback = useCallback(
    async (feedback: string) => {
      if (!editTarget || editSubmitting) return;
      setEditSubmitting(true);
      try {
        const res = await authFetch(`/risks/${encodeURIComponent(editTarget.id)}/review/feedback`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback }),
        });
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        if (!res.ok) {
          toast.error(readApiErrorMessage(body, "Could not update feedback. Try again."), { autoClose: 4000 });
          return;
        }
        setEditTarget(null);
        await loadReviewQueue();
        await loadFeedbackSamples();
        toast.success("Feedback updated.", { autoClose: 3000 });
      } catch {
        toast.error("Could not reach the server. Try again.", { autoClose: 4000 });
      } finally {
        setEditSubmitting(false);
      }
    },
    [editTarget, editSubmitting, loadReviewQueue, loadFeedbackSamples],
  );

  const handleMoveToRisks = useCallback(
    async (feedback: string, classification: "raw" | "structured", domain?: string) => {
      if (!editTarget || editSubmitting) return;
      setActingId(editTarget.id);
      setEditSubmitting(true);
      try {
        const res = await authFetch(`/risks/${encodeURIComponent(editTarget.id)}/review/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classification, feedback, domain }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(readApiErrorMessage(body, "Could not move this risk. Try again."), { autoClose: 4000 });
          return;
        }
        setEditTarget(null);
        await loadReviewQueue();
        await loadFeedbackSamples();
        notifyPendingReviewCountChanged();
        toast.success("Moved to Risks.", { autoClose: 3000 });
      } catch {
        toast.error("Could not reach the server. Try again.", { autoClose: 4000 });
      } finally {
        setActingId(null);
        setEditSubmitting(false);
      }
    },
    [editTarget, editSubmitting, loadReviewQueue, loadFeedbackSamples],
  );

  // Save corrected extracted fields (the new editable-review capability).
  const handleSaveFields = useCallback(
    async (fields: Record<string, unknown>, reason: string) => {
      if (!canEditFields || !editTarget || savingFields) return;
      setSavingFields(true);
      try {
        await editRiskFields(editTarget.id, fields, reason || undefined);
        toast.success("Changes saved.", { autoClose: 2500 });
        await loadReviewQueue();
        // Refresh the open editor with the authoritative saved values.
        try {
          const res = await authFetch(`/risks/${encodeURIComponent(editTarget.id)}`);
          if (res.ok) {
            const parsed = normalizeRiskDetailFromApi(await res.json());
            if (parsed) setEditTarget(parsed);
          }
        } catch {
          /* non-fatal */
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save changes.", { autoClose: 4000 });
      } finally {
        setSavingFields(false);
      }
    },
    [canEditFields, editTarget, savingFields, loadReviewQueue],
  );

  const handleRemapDomain = useCallback(
    async (domain: string) => {
      if (!canEditFields || !domainTarget || domainSubmitting) return;
      setDomainSubmitting(true);
      setActingId(domainTarget.id);
      try {
        const res = await authFetch(`/risks/${encodeURIComponent(domainTarget.id)}/review/domain`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(readApiErrorMessage(body, "Could not update the domain. Try again."), { autoClose: 4000 });
          return;
        }
        setDomainTarget(null);
        await loadReviewQueue();
        notifyPendingReviewCountChanged();
        toast.success("Domain updated.", { autoClose: 3000 });
      } catch {
        toast.error("Could not reach the server. Try again.", { autoClose: 4000 });
      } finally {
        setActingId(null);
        setDomainSubmitting(false);
      }
    },
    [canEditFields, domainTarget, domainSubmitting, loadReviewQueue],
  );

  const handlePromoteClassifiedToRisks = useCallback(
    async (input: { id: string; feedback?: string | null; classification?: "raw" | "structured" }) => {
      if (actingId || editSubmitting) return;
      setActingId(input.id);
      try {
        const res = await authFetch(`/risks/${encodeURIComponent(input.id)}/review/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classification: input.classification ?? "structured",
            feedback: input.feedback ?? "",
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(readApiErrorMessage(body, "Could not move this risk. Try again."), { autoClose: 4000 });
          return;
        }
        await loadReviewQueue();
        await loadFeedbackSamples();
        notifyPendingReviewCountChanged();
        toast.success("Moved to Risks.", { autoClose: 3000 });
      } catch {
        toast.error("Could not reach the server. Try again.", { autoClose: 4000 });
      } finally {
        setActingId(null);
      }
    },
    [actingId, editSubmitting, loadReviewQueue, loadFeedbackSamples],
  );

  // ---- selection helpers ----
  const pageItems = pager.pageItems;
  const pageAllSelected = pageItems.length > 0 && pageItems.every((r) => selectedIds.has(r.id));
  const selectedCount = allMatchingSelected ? queueRows.length : selectedIds.size;
  const canOfferAllMatching =
    pageAllSelected && !allMatchingSelected && queueRows.length > pageItems.length;

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAllMatchingSelected(false);
    setConfirmingAssign(false);
  }, []);

  const toggleRow = useCallback((id: string) => {
    setAllMatchingSelected(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const togglePage = useCallback(() => {
    if (allMatchingSelected) {
      clearSelection();
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everySelected = pageItems.length > 0 && pageItems.every((r) => next.has(r.id));
      if (everySelected) pageItems.forEach((r) => next.delete(r.id));
      else pageItems.forEach((r) => next.add(r.id));
      return next;
    });
  }, [allMatchingSelected, clearSelection, pageItems]);

  const buildQueueSearch = useCallback(
    (extra?: { review?: string; edit?: string; view?: string }) => {
      const p = new URLSearchParams();
      if (tab !== "queue") p.set("tab", tab);
      if (whyFilter !== "all") p.set("why", whyFilter);
      if (reviewSearch.trim()) p.set("q", reviewSearch.trim());
      if (assignee !== "all") p.set("assignee", assignee);
      if (extra?.review) p.set("review", extra.review);
      if (extra?.edit) p.set("edit", extra.edit);
      if (extra?.view) p.set("view", extra.view);
      const s = p.toString();
      return `/review${s ? `?${s}` : ""}`;
    },
    [tab, whyFilter, reviewSearch, assignee],
  );

  const buildAnalysisState = useCallback(
    (row: RiskDetail) => {
      const reviewKey = row.displayId ?? row.id;
      setFocusedReviewKey(reviewKey);
      return { returnTo: buildQueueSearch({ review: reviewKey }) };
    },
    [buildQueueSearch],
  );

  const openAnalysisFromEditor = useCallback(() => {
    if (!editTarget) return;
    const reviewKey = editTarget.displayId ?? editTarget.id;
    setFocusedReviewKey(reviewKey);
    const returnTo = buildQueueSearch({
      review: reviewKey,
      edit: dialogMode === "edit" ? editTarget.id : undefined,
      view: dialogMode === "view" ? editTarget.id : undefined,
    });
    navigate(buildReviewRiskPath(editTarget.id), {
      state: buildReviewAnalysisState(returnTo),
    });
  }, [editTarget, dialogMode, buildQueueSearch, navigate]);

  const buildAssignPayload = useCallback(
    (assigneeId: string): BulkAssignPayload => {
      if (allMatchingSelected) {
        const noClientFilter = whyFilter === "all" && !reviewSearch.trim();
        // Server-side "all matching" only honors the ownership filter — so it is only
        // honest to use it when no client-side why/search filter narrows the view.
        if (noClientFilter && assignee !== "me") {
          if (assignee === "unassigned") return { assigneeId, allMatching: true, filter: { assignedTo: null } };
          if (assignee === "all") return { assigneeId, allMatching: true, filter: {} };
          return { assigneeId, allMatching: true, filter: { assignedTo: assignee } };
        }
        // Filtered "all": send the exact visible id set (one request; backend chunks).
        return { assigneeId, reviewIds: queueRows.map((r) => r.id) };
      }
      return { assigneeId, reviewIds: [...selectedIds] };
    },
    [allMatchingSelected, whyFilter, reviewSearch, assignee, queueRows, selectedIds],
  );

  const handleBulkAssign = useCallback(async () => {
    if (!assignChoice || assigning) return;
    const assigneeUser = users.find((u) => u.id === assignChoice);
    setAssigning(true);
    try {
      const result = await bulkAssignReviews(buildAssignPayload(assignChoice));
      const name = assigneeUser ? userDisplayName(assigneeUser) : "reviewer";
      const skippedNote = result.skipped.length ? ` ${result.skipped.length} skipped.` : "";
      toast.success(
        `Assigned ${result.assigned} of ${result.requested} review${result.requested === 1 ? "" : "s"} to ${name}.${skippedNote}`,
        { autoClose: 4000 },
      );
      clearSelection();
      setAssignChoice("");
      await loadReviewQueue();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk assignment failed.", { autoClose: 4000 });
    } finally {
      setAssigning(false);
    }
  }, [assignChoice, assigning, users, buildAssignPayload, clearSelection, loadReviewQueue]);

  const assignReviewsToUser = useCallback(
    async (reviewIds: string[], label: string, assigneeId: string) => {
      if (!reviewIds.length || assigning) return;
      setAssigning(true);
      try {
        const result = await bulkAssignReviews({ assigneeId, reviewIds });
        const skippedNote = result.skipped.length ? ` ${result.skipped.length} skipped.` : "";
        toast.success(
          `Assigned ${result.assigned} of ${result.requested} review${result.requested === 1 ? "" : "s"} to ${label}.${skippedNote}`,
          { autoClose: 4000 },
        );
        setAssignDialogOpen(false);
        clearSelection();
        await loadReviewQueue();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Assignment failed.", { autoClose: 4000 });
      } finally {
        setAssigning(false);
      }
    },
    [assigning, clearSelection, loadReviewQueue],
  );

  const openOverviewEdit = useCallback(
    (row: RiskDetail) => {
      setEditTarget(null);
      setAssignDialogOpen(false);
      setFocusedReviewKey(row.displayId ?? row.id);
      const returnTo = buildQueueSearch({ review: row.displayId ?? row.id });
      navigate(`${buildReviewRiskPath(row.id)}&edit=1`, {
        state: buildReviewAnalysisState(returnTo),
      });
    },
    [buildQueueSearch, navigate],
  );

  const searchPlaceholder = tab === "queue" ? "Search review queue…" : "Search feedback samples…";
  const searchAriaLabel = tab === "queue" ? "Search review queue" : "Search feedback samples";
  const hasQueueFilters = tab === "queue" && (whyFilter !== "all" || Boolean(reviewSearch.trim()) || assignee !== "all");

  const clearQueueFilters = () => {
    setWhyFilter("all");
    setReviewSearch("");
    setAssignee("all");
  };

  return (
    <main className="mainLayout__content reviewPage usersPage riskPage">
      <PageHeader
        title="Human Review"
        subtitle="Correct extractions, assign reviews to your team, and track what is left."
        actions={
          <>
            {tab === "queue" ? (
              <button
                type="button"
                className="usersPage__inviteBtn"
                onClick={() => {
                  setAssignDialogOpen(true);
                  void loadUsers();
                }}
                aria-label="Assign reviews"
              >
                <UserPlus size={18} strokeWidth={2} aria-hidden />
                Assign
              </button>
            ) : null}
            <button
              type="button"
              className="usersPage__inviteBtn"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              aria-busy={refreshing}
              aria-label={tab === "queue" ? "Refresh review queue" : "Refresh feedback samples"}
            >
              <RotateCw size={18} strokeWidth={2} className={refreshing ? "pageHeader__refreshIcon--spin" : undefined} aria-hidden />
              Refresh
            </button>
          </>
        }
      />

      <div className="usersPage__toolbar reviewPage__toolbar">
        <div className="usersPage__tabs" role="tablist" aria-label="Human review sections">
          {REVIEW_TAB_METAS.map(({ id, label, ariaLabel }) => {
            const selected = tab === id;
            const count = tabCounts[id];
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={fid(`tab-${id}`)}
                aria-selected={selected}
                aria-controls={fid(`panel-${id}`)}
                tabIndex={selected ? 0 : -1}
                aria-label={ariaLabel(count)}
                className={`usersPage__tab${selected ? " usersPage__tab--selected" : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
                <span className="usersPage__tabCount" aria-hidden>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="reviewPage__toolbarActions">
          {tab === "queue" ? (
            <AssigneePicker
              className="reviewPage__assigneePicker"
              mode="filter"
              users={users}
              value={assignee}
              onChange={setAssignee}
              ariaLabel="Filter review queue by assignee"
            />
          ) : null}
          {tab === "queue" ? (
            <select
              id={fid("why")}
              className="reviewPage__whySelect"
              value={whyFilter}
              onChange={(e) => setWhyFilter(e.target.value)}
              aria-label="Filter review queue by why"
            >
              <option value="all">All reasons</option>
              {whyOptions.map((label) => (
                <option key={label} value={label}>
                  {label} ({whyCounts.get(label) ?? 0})
                </option>
              ))}
            </select>
          ) : null}
          {tab === "queue" ? (
            <button
              type="button"
              className="riskPage__clearBtn"
              onClick={clearQueueFilters}
              disabled={!hasQueueFilters}
              aria-label="Clear Filter"
              data-tooltip="Clear Filter"
            >
              <FilterX size={18} strokeWidth={2} aria-hidden />
            </button>
          ) : null}
          <div className="usersPage__searchWrap">
            <Search className="usersPage__searchIcon" size={18} strokeWidth={2} aria-hidden />
            <input
              id={fid("review-search")}
              type="search"
              className="usersPage__searchInput"
              placeholder={searchPlaceholder}
              value={reviewSearch}
              onChange={(e) => setReviewSearch(e.target.value)}
              aria-label={searchAriaLabel}
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
        </div>
      </div>

      {tab === "queue" ? (
        <section className="reviewPage__panel reviewPage__panel--queue" role="tabpanel" id={fid("panel-queue")} aria-labelledby={fid("tab-queue")}>
          {selectedCount > 0 ? (
            <div className="reviewPage__bulkBar" role="region" aria-label="Bulk assignment">
              {confirmingAssign ? (
                <>
                  <span className="reviewPage__bulkCount">
                    Assign {selectedCount} review{selectedCount === 1 ? "" : "s"} to{" "}
                    <strong>{userDisplayName(users.find((u) => u.id === assignChoice) ?? ({ username: "reviewer" } as AiriUser))}</strong>?
                  </span>
                  <div className="reviewPage__bulkActions">
                    <button type="button" className="usersPage__btn usersPage__btn--primary" disabled={assigning} aria-busy={assigning} onClick={() => void handleBulkAssign()}>
                      <UserPlus size={16} strokeWidth={2} aria-hidden />
                      {assigning ? "Assigning…" : "Confirm assignment"}
                    </button>
                    <button type="button" className="usersPage__btn" disabled={assigning} onClick={() => setConfirmingAssign(false)}>
                      <CircleX size={16} strokeWidth={1.75} aria-hidden />
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="reviewPage__bulkCount">
                    <UserCheck size={16} strokeWidth={2} aria-hidden />{" "}
                    {allMatchingSelected
                      ? `All ${selectedCount} matching review${selectedCount === 1 ? "" : "s"} selected`
                      : `${selectedCount} on this page selected`}
                    {canOfferAllMatching ? (
                      <button type="button" className="reviewPage__linkBtn" onClick={() => setAllMatchingSelected(true)}>
                        Select all {queueRows.length} matching
                      </button>
                    ) : null}
                  </span>
                  <div className="reviewPage__bulkActions">
                    <AssigneePicker
                      className="reviewPage__bulkAssigneePicker"
                      mode="assign"
                      users={users}
                      value={assignChoice}
                      onChange={setAssignChoice}
                      ariaLabel="Choose reviewer to assign to"
                    />
                    <button type="button" className="usersPage__btn usersPage__btn--primary" disabled={!assignChoice} onClick={() => setConfirmingAssign(true)}>
                      <UserPlus size={16} strokeWidth={2} aria-hidden />
                      Assign
                    </button>
                    <button type="button" className="usersPage__btn" onClick={clearSelection}>
                      Clear
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          <ReviewRecordsTable
            rows={pager.pageItems}
            loadState={loadState}
            page={pager.page}
            pageCount={pager.pageCount}
            total={pager.total}
            pageSize={pager.pageSize}
            from={pager.from}
            to={pager.to}
            onPageChange={pager.setPage}
            onPageSizeChange={setReviewPageSize}
            actingId={actingId}
            onView={(row) => {
              setDialogMode("view");
              setEditTarget(row);
              setFocusedReviewKey(row.displayId ?? row.id);
            }}
            onEdit={(row) => openOverviewEdit(row)}
            onFeedback={(row) => {
              setDialogMode("edit");
              setEditTarget(row);
              setFocusedReviewKey(row.displayId ?? row.id);
            }}
            onEditDomain={(row) => {
              setDomainTarget(row);
              setFocusedReviewKey(row.displayId ?? row.id);
            }}
            selectedIds={selectedIds}
            allMatchingSelected={allMatchingSelected}
            pageAllSelected={pageAllSelected}
            onToggleRow={toggleRow}
            onTogglePage={togglePage}
            buildAnalysisState={buildAnalysisState}
            canEditFields={canEditFields}
            focusedReviewKey={focusedReviewKey}
            emptyMessage={
              reviewSearch.trim() || whyFilter !== "all" || assignee !== "all"
                ? "No review items match your filters."
                : "No items in the review queue."
            }
          />
        </section>
      ) : null}

      {tab === "feedback" ? (
        <section className="reviewPage__panel reviewPage__panel--feedback" role="tabpanel" id={fid("panel-feedback")} aria-labelledby={fid("tab-feedback")}>
          <ReviewFeedbackPanel
            idPrefix={fid("feedback")}
            samples={feedbackSamples}
            counts={feedbackCounts}
            loadState={feedbackLoadState}
            searchQuery={feedbackSearchActive ? reviewSearch : ""}
            promotingId={actingId}
            onMoveToRisks={(item) =>
              void handlePromoteClassifiedToRisks({ id: item.id, feedback: item.feedback, classification: item.classification })
            }
          />
        </section>
      ) : null}

      <ReviewFeedbackDialog
        open={editTarget != null}
        mode={dialogMode}
        riskTitle={formatDisplayValue(editTarget?.title || "this item")}
        reviewWhy={editTarget?.reviewWhy}
        reviewReason={editTarget?.reviewReason}
        currentDomain={editTarget?.domain ?? ""}
        taxonomyDomains={taxonomyDomains}
        submitting={editSubmitting}
        initialReview={editTarget?.humanReview}
        editableRisk={dialogMode === "edit" && canEditFields ? editTarget : null}
        canEditFields={canEditFields}
        savingFields={savingFields}
        onSaveFields={(fields, reason) => void handleSaveFields(fields, reason)}
        onOpenAnalysis={openAnalysisFromEditor}
        onEditFields={() => {
          if (editTarget) openOverviewEdit(editTarget);
        }}
        onClose={() => {
          if (!editSubmitting && !savingFields) setEditTarget(null);
        }}
        onSubmitRaw={(feedback) => void handleSubmitRaw(feedback)}
        onSubmitStructured={(feedback) => void handleSubmitStructured(feedback)}
        onUpdateFeedback={(feedback) => void handleUpdateFeedback(feedback)}
        onMoveToRisks={(feedback, classification, domain) => void handleMoveToRisks(feedback, classification, domain)}
      />

      <AssignReviewsDialog
        open={assignDialogOpen}
        rows={rows}
        users={users}
        submitting={assigning}
        onClose={() => {
          if (!assigning) setAssignDialogOpen(false);
        }}
        onAssign={(assigneeId, reviewIds) => {
          const user = users.find((u) => u.id === assigneeId);
          void assignReviewsToUser(reviewIds, user ? userDisplayName(user) : "reviewer", assigneeId);
        }}
        onOpenReview={(row) => {
          setAssignDialogOpen(false);
          setFocusedReviewKey(row.displayId ?? row.id);
          navigate(buildReviewRiskPath(row.id), {
            state: buildReviewAnalysisState(
              buildQueueSearch({ review: row.displayId ?? row.id }),
            ),
          });
        }}
      />

      <DomainRemapDialog
        open={domainTarget != null}
        riskTitle={formatDisplayValue(domainTarget?.title || "this item")}
        currentDomain={domainTarget?.domain ?? ""}
        taxonomyDomains={taxonomyDomains}
        submitting={domainSubmitting}
        onClose={() => {
          if (!domainSubmitting) setDomainTarget(null);
        }}
        onSave={(domain) => void handleRemapDomain(domain)}
      />
    </main>
  );
}
