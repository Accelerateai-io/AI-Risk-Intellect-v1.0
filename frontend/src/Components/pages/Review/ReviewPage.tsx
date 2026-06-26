import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { toast } from "react-toastify";

import { RotateCw, Search } from "lucide-react";

import { readApiErrorMessage } from "../../../utils/readApiErrorMessage";
import { authFetch } from "../../../utils/authFetch";
import { formatDisplayDate } from "../../../utils/formatDate";

import { setDocumentPageTitle } from "../../../utils/pageTitle";

import { usePagination } from "../../../utils/usePagination";

import { PageHeader } from "../../Layout/PageHeader";

import { normalizeRisksFromApi, type RiskDetail } from "../Risk/riskData";

import { notifyPendingReviewCountChanged } from "../../../utils/reviewQueueEvents";

import { ReviewFeedbackDialog, type ReviewDialogMode } from "./ReviewFeedbackDialog";

import { ReviewFeedbackPanel } from "./ReviewFeedbackPanel";

import { ReviewRecordsTable } from "./ReviewRecordsTable";

import {
  normalizeReviewFeedbackFromApi,
  type ReviewFeedbackCounts,
  type ReviewFeedbackSample,
} from "./reviewFeedbackData";

import "../Users/usersPage.css";

import "../Risk/riskPage.css";

import "./reviewPage.css";



type ReviewTab = "queue" | "feedback" | "prompts";

/** Placeholder until prompt versions are loaded from the API. */

const MOCK_PROMPT_VERSIONS: { id: string }[] = [];



type ReviewTabMeta = {

  id: ReviewTab;

  label: string;

  ariaLabel: (n: number) => string;

};



const REVIEW_TAB_METAS: readonly ReviewTabMeta[] = [

  {

    id: "queue",

    label: "Review Queue",

    ariaLabel: (n) => `Queue, ${n} item${n === 1 ? "" : "s"}`,

  },

  {

    id: "feedback",

    label: "Feedback",

    ariaLabel: (n) => `Feedback, ${n} sample${n === 1 ? "" : "s"}`,

  },

  {

    id: "prompts",

    label: "Prompts",

    ariaLabel: (n) => `Prompts, ${n} version${n === 1 ? "" : "s"}`,

  },

];



export function ReviewPage() {

  const baseId = useId();

  const [tab, setTab] = useState<ReviewTab>("queue");

  const [reviewSearch, setReviewSearch] = useState("");

  const [refreshing, setRefreshing] = useState(false);

  const [reviewPageSize, setReviewPageSize] = useState(10);

  const [rows, setRows] = useState<RiskDetail[]>([]);

  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(

    "idle",

  );

  const [actingId, setActingId] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<RiskDetail | null>(null);

  const [dialogMode, setDialogMode] = useState<ReviewDialogMode>("edit");

  const [editSubmitting, setEditSubmitting] = useState(false);

  const [feedbackSamples, setFeedbackSamples] = useState<ReviewFeedbackSample[]>([]);

  const [feedbackCounts, setFeedbackCounts] = useState<ReviewFeedbackCounts>({
    raw: 0,
    structured: 0,
    total: 0,
  });

  const [feedbackLoadState, setFeedbackLoadState] = useState<
    "idle" | "loading" | "error"
  >("idle");

  const fid = (name: string) => `${baseId}-${name}`;

  const stub = useCallback((action: string) => {
    toast.info(`${action} is not wired to the API yet.`, { autoClose: 2800 });
  }, []);

  const loadReviewQueue = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");

    if (!token) {
      setRows([]);
      setLoadState("idle");
      return;
    }

    setLoadState("loading");
    try {
      const res = await authFetch("/risks/review-queue");

      if (!res.ok) {
        setLoadState("error");
        return;
      }

      const data = normalizeRisksFromApi(await res.json());

      setRows(
        data.risks.map((r) => {
          const createdAt = r.createdAt ?? r.ingestedAt;

          return {
            ...r,
            createdAt,
            ingestedAt: createdAt ? formatDisplayDate(createdAt) : "—",
          };
        }),
      );

      setLoadState("idle");
      notifyPendingReviewCountChanged();
    } catch {
      setLoadState("error");
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
    void loadFeedbackSamples();
  }, [loadFeedbackSamples]);

  useEffect(() => {
    setReviewSearch("");
  }, [tab]);



  useEffect(() => {

    if (tab === "queue") {

      void loadReviewQueue();

    }

  }, [tab, loadReviewQueue]);



  useEffect(() => {

    if (tab === "feedback") {

      void loadFeedbackSamples();

    }

  }, [tab, loadFeedbackSamples]);



  const pager = usePagination({

    items: rows,

    pageSize: reviewPageSize,

    resetKey: String(rows.length),

  });



  const tabCounts = useMemo(

    (): Record<ReviewTab, number> => ({

      queue: rows.length,

      feedback: feedbackCounts.total,

      prompts: MOCK_PROMPT_VERSIONS.length,

    }),

    [rows.length, feedbackCounts.total],

  );

  const feedbackSearchActive =
    tab === "feedback" && reviewSearch.trim().length > 0;



  const handleRefresh = useCallback(async () => {

    setRefreshing(true);

    if (tab === "queue") {

      await loadReviewQueue();

      setRefreshing(false);

      toast.success("Review queue refreshed.", { autoClose: 2000 });

      return;

    }

    setRefreshing(false);

    if (tab === "feedback") {

      await loadFeedbackSamples();

      setRefreshing(false);

      toast.success("Feedback samples refreshed.", { autoClose: 2000 });

      return;

    }

    stub("Refresh prompt versions");

  }, [loadReviewQueue, loadFeedbackSamples, stub, tab]);



  const handleSubmitRaw = useCallback(

    async (feedback: string) => {

      if (!editTarget || editSubmitting) return;



      setEditSubmitting(true);

      try {

        const res = await authFetch(

          `/risks/${encodeURIComponent(editTarget.id)}/review/reject`,

          {

            method: "POST",

            headers: { "Content-Type": "application/json" },

            body: JSON.stringify({ feedback, classification: "raw" }),

          },

        );

        const body = (await res.json().catch(() => ({}))) as { message?: string };



        if (!res.ok) {

          toast.error(

            readApiErrorMessage(body, "Could not save feedback. Try again."),

            { autoClose: 4000 },

          );

          return;

        }



        setEditTarget(null);

        await loadReviewQueue();

        await loadFeedbackSamples();

        notifyPendingReviewCountChanged();

        toast.success("Marked as Raw. Feedback saved.", {

          autoClose: 3000,

        });

      } catch {

        toast.error("Could not reach the server. Try again.", {

          autoClose: 4000,

        });

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

        const res = await authFetch(

          `/risks/${encodeURIComponent(editTarget.id)}/review/classify`,

          {

            method: "POST",

            headers: { "Content-Type": "application/json" },

            body: JSON.stringify({ feedback }),

          },

        );

        const body = (await res.json().catch(() => ({}))) as { message?: string };



        if (!res.ok) {

          toast.error(

            readApiErrorMessage(body, "Could not save as Structured. Try again."),

            { autoClose: 4000 },

          );

          return;

        }



        setEditTarget(null);

        await loadReviewQueue();

        await loadFeedbackSamples();

        notifyPendingReviewCountChanged();

        toast.success("Saved as Structured.", { autoClose: 3000 });

      } catch {

        toast.error("Could not reach the server. Try again.", {

          autoClose: 4000,

        });

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

        const res = await authFetch(

          `/risks/${encodeURIComponent(editTarget.id)}/review/feedback`,

          {

            method: "PATCH",

            headers: { "Content-Type": "application/json" },

            body: JSON.stringify({ feedback }),

          },

        );

        const body = (await res.json().catch(() => ({}))) as { message?: string };



        if (!res.ok) {

          toast.error(

            readApiErrorMessage(body, "Could not update feedback. Try again."),

            { autoClose: 4000 },

          );

          return;

        }



        setEditTarget(null);

        await loadReviewQueue();

        await loadFeedbackSamples();

        toast.success("Feedback updated.", { autoClose: 3000 });

      } catch {

        toast.error("Could not reach the server. Try again.", {

          autoClose: 4000,

        });

      } finally {

        setEditSubmitting(false);

      }

    },

    [editTarget, editSubmitting, loadReviewQueue, loadFeedbackSamples],

  );



  const handleMoveToRisks = useCallback(

    async (
      feedback: string,
      classification: "raw" | "structured",
    ) => {

      if (!editTarget || editSubmitting) return;



      setActingId(editTarget.id);

      setEditSubmitting(true);

      try {

        const res = await authFetch(

          `/risks/${encodeURIComponent(editTarget.id)}/review/approve`,

          {

            method: "POST",

            headers: { "Content-Type": "application/json" },

            body: JSON.stringify({ classification, feedback }),

          },

        );

        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          toast.error(
            readApiErrorMessage(body, "Could not move this risk. Try again."),
            { autoClose: 4000 },
          );
          return;
        }

        setEditTarget(null);
        await loadReviewQueue();

        await loadFeedbackSamples();

        notifyPendingReviewCountChanged();

        toast.success("Moved to Risks.", {
          autoClose: 3000,
        });

      } catch {

        toast.error("Could not reach the server. Try again.", {

          autoClose: 4000,

        });

      } finally {

        setActingId(null);

        setEditSubmitting(false);

      }

    },

    [editTarget, editSubmitting, loadReviewQueue, loadFeedbackSamples],

  );



  const handlePromoteClassifiedToRisks = useCallback(

    async (input: {
      id: string;
      feedback?: string | null;
      classification?: "raw" | "structured";
    }) => {

      if (actingId || editSubmitting) return;



      setActingId(input.id);

      try {

        const res = await authFetch(

          `/risks/${encodeURIComponent(input.id)}/review/approve`,

          {

            method: "POST",

            headers: { "Content-Type": "application/json" },

            body: JSON.stringify({

              classification: input.classification ?? "structured",

              feedback: input.feedback ?? "",

            }),

          },

        );

        const body = await res.json().catch(() => ({}));

        if (!res.ok) {

          toast.error(

            readApiErrorMessage(body, "Could not move this risk. Try again."),

            { autoClose: 4000 },

          );

          return;

        }



        await loadReviewQueue();

        await loadFeedbackSamples();

        notifyPendingReviewCountChanged();

        toast.success("Moved to Risks.", { autoClose: 3000 });

      } catch {

        toast.error("Could not reach the server. Try again.", {

          autoClose: 4000,

        });

      } finally {

        setActingId(null);

      }

    },

    [actingId, editSubmitting, loadReviewQueue, loadFeedbackSamples],

  );



  const searchPlaceholder =

    tab === "feedback"

      ? "Search feedback samples…"

      : "Search prompt versions…";



  const searchAriaLabel =

    tab === "feedback"

      ? "Search feedback samples"

      : "Search prompt versions";



  return (

    <main className="mainLayout__content reviewPage usersPage riskPage">

      <PageHeader

        title="Human Review"

        subtitle="Review each extraction as Raw or Structured, or explicitly move it to Risks."

        actions={

          <button

            type="button"

            className="usersPage__inviteBtn"

            onClick={() => void handleRefresh()}

            disabled={refreshing}

            aria-busy={refreshing}

            aria-label={

              tab === "queue"

                ? "Refresh review queue"

                : tab === "feedback"

                  ? "Refresh feedback samples"

                  : "Refresh prompt versions"

            }

          >

            <RotateCw

              size={18}

              strokeWidth={2}

              className={refreshing ? "pageHeader__refreshIcon--spin" : undefined}

              aria-hidden

            />

            Refresh

          </button>

        }

      />



      <div className="usersPage__toolbar">

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

                <span className="usersPage__tabCount" aria-hidden>

                  {count}

                </span>

              </button>

            );

          })}

        </div>

        {tab !== "queue" ? (

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

        ) : null}

      </div>



      {tab === "queue" ? (

        <section

          className="reviewPage__panel reviewPage__panel--queue"

          role="tabpanel"

          id={fid("panel-queue")}

          aria-labelledby={fid("tab-queue")}

        >

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
            }}

            onEdit={(row) => {
              setDialogMode("edit");
              setEditTarget(row);
            }}

            emptyMessage="No items in the review queue."

          />

        </section>

      ) : null}



      {tab === "feedback" ? (

        <section

          className="reviewPage__panel reviewPage__panel--feedback"

          role="tabpanel"

          id={fid("panel-feedback")}

          aria-labelledby={fid("tab-feedback")}

        >

          <ReviewFeedbackPanel

            idPrefix={fid("feedback")}

            samples={feedbackSamples}

            counts={feedbackCounts}

            loadState={feedbackLoadState}

            searchQuery={feedbackSearchActive ? reviewSearch : ""}

            promotingId={actingId}

            onMoveToRisks={(item) =>
              void handlePromoteClassifiedToRisks({
                id: item.id,
                feedback: item.feedback,
                classification: item.classification,
              })
            }

          />

        </section>

      ) : null}



      {tab === "prompts" ? (

        <section

          className="reviewPage__panel"

          role="tabpanel"

          id={fid("panel-prompts")}

          aria-labelledby={fid("tab-prompts")}

        >

          <p className="reviewPage__panelHint">

            Track prompt versions, compare outputs, and roll back when extraction quality

            regresses.

          </p>

        </section>

      ) : null}



      <ReviewFeedbackDialog

        open={editTarget != null}

        mode={dialogMode}

        riskTitle={editTarget?.title ?? "this item"}

        submitting={editSubmitting}

        initialReview={editTarget?.humanReview}

        onClose={() => {

          if (!editSubmitting) setEditTarget(null);

        }}

        onSubmitRaw={(feedback) => void handleSubmitRaw(feedback)}

        onSubmitStructured={(feedback) => void handleSubmitStructured(feedback)}

        onUpdateFeedback={(feedback) => void handleUpdateFeedback(feedback)}

        onMoveToRisks={(feedback, classification) =>
          void handleMoveToRisks(feedback, classification)
        }

      />

    </main>

  );

}


