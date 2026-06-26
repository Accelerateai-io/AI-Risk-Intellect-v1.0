import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { authFetch } from "../../../utils/authFetch";
import { formatDisplayDate } from "../../../utils/formatDate";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import {
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
};

function RiskDetailBackNav({ risk, fallbackLabel }: RiskDetailBackNavProps) {
  const displayTitle = risk ? riskBackNavTitle(risk) : fallbackLabel;
  return (
    <Link
      to="/risk"
      className="riskDetailPage__back"
      aria-label={
        risk ? `Back to risks list: ${displayTitle}` : "Back to risks list"
      }
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
}

function RiskDetailPageMeta({ risk }: { risk: RiskDetail }) {
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
}

export function RiskDetailPage() {
  const { riskId } = useParams();
  const [searchParams] = useSearchParams();
  const detailId = useId();
  const [risk, setRisk] = useState<RiskDetail | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">(
    "loading",
  );

  const initialTab = useMemo(
    () => parseRiskDetailTab(searchParams.get("tab")) ?? "overview",
    [searchParams],
  );
  const [tab, setTab] = useState<RiskDetailTab>(initialTab);
  const tabContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [risk?.id, initialTab]);

  const handleTabChange = useCallback((next: RiskDetailTab) => {
    setTab(next);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollRiskDetailTabContent(tabContentRef.current);
      });
    });
  }, []);

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
      const res = await authFetch(`/risks/${encodeURIComponent(id)}`);
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
    } catch {
      setRisk(null);
      setLoadState("error");
    }
  }, [riskId]);

  useEffect(() => {
    void loadRisk();
  }, [loadRisk]);

  useEffect(() => {
    if (risk) {
      setDocumentPageTitle(`${formatRiskId(risk)} | Risks`);
    } else if (loadState === "loading") {
      setDocumentPageTitle("Loading risk…");
    } else {
      setDocumentPageTitle("Risk not found");
    }
  }, [risk, loadState]);

  const fallbackLabel =
    loadState === "loading" ? "Loading risk…" : "Risks";

  if (loadState === "loading" && !risk) {
    return (
      <main className="mainLayout__content riskDetailPage">
        <RiskDetailBackNav risk={null} fallbackLabel={fallbackLabel} />
        <p className="riskDetailPage__notFound">Loading risk…</p>
      </main>
    );
  }

  if (!risk) {
    return (
      <main className="mainLayout__content riskDetailPage">
        <RiskDetailBackNav risk={null} fallbackLabel="Risks" />
        <p className="riskDetailPage__notFound">Risk not found.</p>
      </main>
    );
  }

  return (
    <main className="mainLayout__content riskDetailPage">
      <div className="riskDetailPage__stickyHeader">
        <div className="riskDetailPage__stickyBar">
          <RiskDetailBackNav risk={risk} fallbackLabel={fallbackLabel} />
          <RiskDetailPageMeta risk={risk} />
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
      />
    </main>
  );
}
