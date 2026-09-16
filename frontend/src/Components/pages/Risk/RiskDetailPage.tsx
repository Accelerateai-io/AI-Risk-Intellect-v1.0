import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Link, useBlocker, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { authFetch } from "../../../utils/authFetch";
import { formatDisplayDate } from "../../../utils/formatDate";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import {
  isReviewSource,
  readReviewReturnTo,
  type ReviewNavState,
} from "../../../utils/reviewNav";
import { isCurrentUserAdmin } from "../../../utils/isAdminUser";
import { notifyPendingReviewCountChanged } from "../../../utils/reviewQueueEvents";
import {
  editRiskFields,
  moveReviewToRisks,
  submitReviewRaw,
  submitReviewStructured,
} from "../../../utils/reviewOpsApi";
import { ReviewFeedbackDialog } from "../Review/ReviewFeedbackDialog";
import {
  formatDisplayValue,
  formatRiskId,
  getRiskById,
  normalizeRiskDetailFromApi,
  riskBackNavTitle,
  type RiskDetail,
} from "./riskData";
import {
  parseRiskDetailTab,
  RiskDetailTabBar,
  RiskDetailView,
  type RiskDetailTab,
} from "./RiskDetailView";
import {
  draftFromRisk,
  diffRiskDraft,
  UNSAVED_CHANGES_MESSAGE,
  type RiskEditDraft,
} from "./riskEditDraft";
import { SaveReasonDialog } from "./SaveReasonDialog";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import "./riskDetailPage.css";

function scrollRiskDetailTabContent(contentEl: HTMLElement | null): void {
  if (!contentEl) return;

  const scrollRoot = contentEl.closest(".mainLayout__scroll");
  const header = contentEl
    .closest(".riskDetailPage")
    ?.querySelector(".riskDetailPage__stickyHeader");

  if (!(scrollRoot instanceof HTMLElement) || !(header instanceof HTMLElement)) {
    contentEl.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const contentTop = contentEl.getBoundingClientRect().top;
  const scrollRootTop = scrollRoot.getBoundingClientRect().top;
  const stickyOffset = header.getBoundingClientRect().height + 8;
  const nextTop = scrollRoot.scrollTop + (contentTop - scrollRootTop) - stickyOffset;

  scrollRoot.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}

function confidenceLabel(level: RiskDetail["confidence"]): string {
  switch (level) {
    case "HIGH":
      return "HIGH CONFIDENCE";
    case "MEDIUM":
      return "MEDIUM CONFIDENCE";
    default:
      return "LOW CONFIDENCE";
  }
}

type RiskDetailBackNavProps = {
  risk: RiskDetail | null;
  fallbackLabel: string;
  backTo?: string;
};

const RiskDetailBackNav = memo(function RiskDetailBackNav({ risk, fallbackLabel, backTo }: RiskDetailBackNavProps) {
  const displayTitle = risk ? riskBackNavTitle(risk) : fallbackLabel;
  // Preserve caller context (e.g. the Review queue) when provided, else fall back to Risks.
  const to = backTo ?? "/risk";
  const backToReview = backTo?.startsWith("/review");
  const destLabel = backToReview ? "Back to review queue" : "Back to risks list";
  return (
    <Link
      to={to}
      className="riskDetailPage__back"
      aria-label={risk ? `${destLabel}: ${displayTitle}` : destLabel}
    >
      <ArrowLeft size={18} strokeWidth={2} className="riskDetailPage__backIcon" aria-hidden />
      <span
        id={risk ? "risk-detail-page-title" : undefined}
        className="riskDetailPage__backTitle"
      >
        {displayTitle}
      </span>
    </Link>
  );
});

const RiskDetailPageMeta = memo(function RiskDetailPageMeta({ risk }: { risk: RiskDetail }) {
  const confidence = risk.confidence.toLowerCase();
  return (
    <div className="riskDetailPage__meta" aria-label="Risk metadata">
      <div className="riskDetailPage__metaCluster">
        <div className="riskDetailPage__metaChip riskDetailPage__metaChip--id">
          <span className="riskDetailPage__metaChipLabel">Risk ID</span>
          <span className="riskDetailPage__metaChipValue">{formatRiskId(risk)}</span>
        </div>
        <span className="riskDetailPage__metaSep" aria-hidden />
        <div
          className={`riskDetailPage__metaChip riskDetailPage__metaChip--confidence riskDetailPage__metaChip--confidence-${confidence}`}
        >
          <Sparkles size={13} strokeWidth={2.25} aria-hidden />
          <span className="riskDetailPage__metaChipValue">
            {confidenceLabel(risk.confidence)}
          </span>
        </div>
        {risk.modelName ? (
          <>
            <span className="riskDetailPage__metaSep" aria-hidden />
            <div
              className="riskDetailPage__metaChip riskDetailPage__metaChip--model"
              title={risk.modelName}
            >
              <span className="riskDetailPage__metaChipLabel">Model</span>
              <span className="riskDetailPage__metaChipValue">{risk.modelName}</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
});

export function RiskDetailPage() {
  const { riskId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as ReviewNavState | null;
  const fromReview = isReviewSource({ searchParams, state: navState });
  const canEditFields = isCurrentUserAdmin();
  const editMode = fromReview && canEditFields && searchParams.get("edit") === "1";
  const returnTo =
    navState?.returnTo ??
    (fromReview ? readReviewReturnTo() : undefined) ??
    undefined;
  const detailId = useId();
  const [risk, setRisk] = useState<RiskDetail | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">(
    "loading",
  );
  const [draft, setDraft] = useState<RiskEditDraft | null>(null);
  const [baseline, setBaseline] = useState<RiskEditDraft | null>(null);
  const [taxonomyDomains, setTaxonomyDomains] = useState<string[]>([]);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [cancelEditOpen, setCancelEditOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const seededForId = useRef<string | null>(null);
  const allowLeaveRef = useRef(false);

  const initialTab = useMemo(
    () => parseRiskDetailTab(searchParams.get("tab")) ?? "overview",
    [searchParams],
  );
  const [tab, setTab] = useState<RiskDetailTab>(initialTab);
  const tabContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [risk?.id, initialTab]);

  useEffect(() => {
    if (!fromReview) return;
    if (
      searchParams.get("from") === "review" &&
      parseRiskDetailTab(searchParams.get("tab"))
    ) {
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("from", "review");
        if (!parseRiskDetailTab(next.get("tab"))) next.set("tab", "overview");
        return next;
      },
      { replace: true },
    );
  }, [fromReview, searchParams, setSearchParams]);

  const handleTabChange = useCallback((next: RiskDetailTab) => {
    setTab(next);
    setSearchParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        nextParams.set("tab", next);
        if (fromReview) nextParams.set("from", "review");
        return nextParams;
      },
      { replace: true },
    );
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollRiskDetailTabContent(tabContentRef.current);
      });
    });
  }, [fromReview, setSearchParams]);

  const tabPanelId = `${detailId}-panel`;

  const loadRisk = useCallback(async () => {
    const id = riskId?.trim();
    if (!id) {
      setRisk(null);
      setLoadState("idle");
      return;
    }

    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      setRisk(getRiskById(id) ?? null);
      setLoadState("idle");
      return;
    }

    setLoadState("loading");
    try {
      const res = await authFetch(
        `/risks/${encodeURIComponent(id)}?skipCatalogMatches=1`,
      );
      if (!res.ok) {
        setRisk(null);
        setLoadState("error");
        return;
      }
      const parsed = normalizeRiskDetailFromApi(await res.json());
      if (parsed?.ingestedAt) {
        parsed.ingestedAt = formatDisplayDate(parsed.ingestedAt);
      }
      setRisk(parsed);
      setLoadState(parsed ? "idle" : "error");

      if (parsed && (parsed.riskAnalysis.catalogMatches?.length ?? 0) === 0) {
        try {
          const extra = await authFetch(
            `/risks/${encodeURIComponent(id)}?ensureCatalogMatches=1`,
          );
          if (!extra.ok) return;
          const next = normalizeRiskDetailFromApi(await extra.json());
          if (next?.ingestedAt) {
            next.ingestedAt = formatDisplayDate(next.ingestedAt);
          }
          if (next) setRisk(next);
        } catch {
          /* catalog matches are non-blocking */
        }
      }
    } catch {
      setRisk(null);
      setLoadState("error");
    }
  }, [riskId]);

  useEffect(() => {
    void loadRisk();
  }, [loadRisk]);

  useEffect(() => {
    if (!fromReview && !editMode && !feedbackOpen) return;
    const token = sessionStorage.getItem("accessToken");
    if (!token) return;
    void (async () => {
      try {
        const res = await authFetch("/risks/taxonomy-domains");
        if (!res.ok) return;
        const data = (await res.json()) as { domains?: string[] };
        setTaxonomyDomains(Array.isArray(data.domains) ? data.domains.filter((d) => d.trim()) : []);
      } catch {
        setTaxonomyDomains([]);
      }
    })();
  }, [fromReview, editMode, feedbackOpen]);

  useEffect(() => {
    if (editMode) allowLeaveRef.current = false;
  }, [editMode]);

  useEffect(() => {
    if (!editMode || !risk) {
      seededForId.current = null;
      setDraft(null);
      setBaseline(null);
      return;
    }
    if (seededForId.current === risk.id) return;
    const next = draftFromRisk(risk);
    setDraft(next);
    setBaseline(next);
    seededForId.current = risk.id;
  }, [editMode, risk]);

  const dirty = Boolean(
    draft && baseline && Object.keys(diffRiskDraft(baseline, draft)).length > 0,
  );

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allowLeaveRef.current &&
      dirty &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = UNSAVED_CHANGES_MESSAGE;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (risk) {
      setDocumentPageTitle(
        fromReview ? `${formatRiskId(risk)} | Review` : `${formatRiskId(risk)} | Risks`,
      );
    } else if (loadState === "loading") {
      setDocumentPageTitle("Loading risk…");
    } else {
      setDocumentPageTitle("Risk not found");
    }
  }, [risk, loadState, fromReview]);

  const startEdit = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set("edit", "1");
    if (fromReview) next.set("from", "review");
    setSearchParams(next, { replace: true });
  }, [fromReview, searchParams, setSearchParams]);

  const handleDraftChange = useCallback((patch: Partial<RiskEditDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const exitEditMode = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("edit");
        if (fromReview) next.set("from", "review");
        return next;
      },
      { replace: true },
    );
  }, [fromReview, setSearchParams]);

  const handleConfirmSave = useCallback(
    async (reason: string) => {
      if (!risk || !draft || !baseline || saving) return;
      const fields = diffRiskDraft(baseline, draft);
      delete fields.likelihood;
      delete fields.impact;
      if (Object.keys(fields).length === 0) {
        setReasonOpen(false);
        return;
      }
      setSaving(true);
      try {
        const trimmedReason = reason.trim();
        if (trimmedReason.length < 3) {
          toast.error("Enter a reason for this change (at least 3 characters).", {
            autoClose: 3500,
          });
          return;
        }
        await editRiskFields(risk.id, fields, trimmedReason);
        toast.success("Changes saved.", { autoClose: 2500 });
        setReasonOpen(false);
        seededForId.current = null;
        await loadRisk();
        exitEditMode();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save changes.", {
          autoClose: 4000,
        });
      } finally {
        setSaving(false);
      }
    },
    [risk, draft, baseline, saving, loadRisk, exitEditMode],
  );

  const discardEdits = useCallback(() => {
    allowLeaveRef.current = true;
    seededForId.current = null;
    setDraft(null);
    setBaseline(null);
    setCancelEditOpen(false);
  }, []);

  const returnToReview = useCallback(() => {
    navigate(returnTo ?? "/review");
  }, [navigate, returnTo]);

  const leaveEditWithoutSaving = useCallback(() => {
    discardEdits();
    if (fromReview) {
      returnToReview();
      return;
    }
    exitEditMode();
  }, [discardEdits, exitEditMode, fromReview, returnToReview]);

  const handleSubmitRaw = useCallback(
    async (feedback: string) => {
      if (!risk || reviewSubmitting) return;
      setReviewSubmitting(true);
      try {
        const trimmed = feedback.trim();
        if (trimmed.length < 3) {
          toast.error("Enter feedback (at least 3 characters).", { autoClose: 3500 });
          return;
        }
        await submitReviewRaw(risk.id, trimmed);
        setFeedbackOpen(false);
        notifyPendingReviewCountChanged();
        toast.success("Marked as Raw. Feedback saved.", { autoClose: 3000 });
        await loadRisk();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save feedback. Try again.", {
          autoClose: 4000,
        });
      } finally {
        setReviewSubmitting(false);
      }
    },
    [risk, reviewSubmitting, loadRisk],
  );

  const handleSubmitStructured = useCallback(
    async (feedback: string) => {
      if (!risk || reviewSubmitting) return;
      setReviewSubmitting(true);
      try {
        const trimmed = feedback.trim();
        if (trimmed.length < 3) {
          toast.error("Enter feedback (at least 3 characters).", { autoClose: 3500 });
          return;
        }
        await submitReviewStructured(risk.id, trimmed);
        setFeedbackOpen(false);
        notifyPendingReviewCountChanged();
        toast.success("Saved as Structured.", { autoClose: 3000 });
        await loadRisk();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Could not save as Structured. Try again.",
          { autoClose: 4000 },
        );
      } finally {
        setReviewSubmitting(false);
      }
    },
    [risk, reviewSubmitting, loadRisk],
  );

  const handleMoveToRisks = useCallback(
    async (feedback: string, classification: "raw" | "structured", domain?: string) => {
      if (!risk || reviewSubmitting) return;
      setReviewSubmitting(true);
      try {
        const trimmed = feedback.trim();
        if (trimmed.length < 3) {
          toast.error("Enter feedback (at least 3 characters).", { autoClose: 3500 });
          return;
        }
        await moveReviewToRisks(risk.id, trimmed, classification, domain);
        setFeedbackOpen(false);
        notifyPendingReviewCountChanged();
        toast.success("Moved to Risks.", { autoClose: 3000 });
        returnToReview();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not move this risk. Try again.", {
          autoClose: 4000,
        });
      } finally {
        setReviewSubmitting(false);
      }
    },
    [risk, reviewSubmitting, returnToReview],
  );

  const fallbackLabel =
    loadState === "loading" ? "Loading risk…" : "Risks";

  if (loadState === "loading" && !risk) {
    return (
      <main className="mainLayout__content riskDetailPage">
        <RiskDetailBackNav risk={null} fallbackLabel={fallbackLabel} backTo={returnTo} />
        <p className="riskDetailPage__notFound">Loading risk…</p>
      </main>
    );
  }

  if (!risk) {
    return (
      <main className="mainLayout__content riskDetailPage">
        <RiskDetailBackNav risk={null} fallbackLabel="Risks" backTo={returnTo} />
        <p className="riskDetailPage__notFound">Risk not found.</p>
      </main>
    );
  }

  return (
    <main className="mainLayout__content riskDetailPage">
      <div className="riskDetailPage__stickyHeader">
        <div className="riskDetailPage__stickyBar">
          <RiskDetailBackNav risk={risk} fallbackLabel={fallbackLabel} backTo={returnTo} />
          <div className="riskDetailPage__stickyMeta">
            <RiskDetailPageMeta risk={risk} />
          </div>
        </div>
        <RiskDetailTabBar
          idPrefix={detailId}
          tab={tab}
          onTabChange={handleTabChange}
          tabPanelId={tabPanelId}
          className="riskDetailPage__stickyTabs"
        />
      </div>
      <RiskDetailView
        risk={risk}
        initialTab={initialTab}
        tab={tab}
        onTabChange={handleTabChange}
        hideTabBar
        idPrefix={detailId}
        tabContentRef={tabContentRef}
        titleElementId="risk-detail-page-title"
        editMode={editMode}
        draft={draft ?? undefined}
        taxonomyDomains={taxonomyDomains}
        onDraftChange={editMode ? handleDraftChange : undefined}
        onEdit={fromReview && canEditFields && !editMode ? startEdit : undefined}
        onSave={
          editMode
            ? () => {
                if (!dirty || saving) return;
                setReasonOpen(true);
              }
            : undefined
        }
        onCancel={
          editMode
            ? () => {
                if (dirty) setCancelEditOpen(true);
                else leaveEditWithoutSaving();
              }
            : undefined
        }
        saveDisabled={!dirty || saving}
        saving={saving}
      />
      <SaveReasonDialog
        open={reasonOpen}
        submitting={saving}
        onClose={() => {
          if (!saving) setReasonOpen(false);
        }}
        onConfirm={(reason) => void handleConfirmSave(reason)}
      />
      <ReviewFeedbackDialog
        open={feedbackOpen && risk != null}
        mode="edit"
        riskTitle={formatDisplayValue(risk.title)}
        reviewWhy={risk.reviewWhy}
        reviewReason={risk.reviewReason}
        currentDomain={risk.domain}
        taxonomyDomains={taxonomyDomains}
        submitting={reviewSubmitting}
        initialReview={risk.humanReview}
        canEditFields={canEditFields}
        onClose={() => {
          if (!reviewSubmitting) setFeedbackOpen(false);
        }}
        onSubmitRaw={(feedback) => void handleSubmitRaw(feedback)}
        onSubmitStructured={(feedback) => void handleSubmitStructured(feedback)}
        onUpdateFeedback={() => undefined}
        onMoveToRisks={(feedback, classification, domain) =>
          void handleMoveToRisks(feedback, classification, domain)
        }
      />
      <UnsavedChangesDialog
        open={blocker.state === "blocked" || cancelEditOpen}
        onStay={() => {
          setCancelEditOpen(false);
          blocker.reset?.();
        }}
        onLeave={() => {
          if (cancelEditOpen) {
            leaveEditWithoutSaving();
            return;
          }
          allowLeaveRef.current = true;
          blocker.proceed?.();
        }}
      />
    </main>
  );
}
