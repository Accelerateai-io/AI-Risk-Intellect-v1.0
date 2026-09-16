import { memo, useCallback, useEffect, useId, useMemo, useState, type RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Brain,
  Building2,
  ClipboardList,
  Clock,
  Database,
  Eye,
  Factory,
  FileText,
  Flag,
  Gauge,
  Globe,
  Hash,
  Layers,
  ExternalLink,
  Link2,
  Package,
  Quote,
  ScrollText,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  CircleX,
  Pencil,
  Save,
  Tags,
  Target,
} from "lucide-react";
import {
  EVIDENCE_BREAKDOWN_HEADING_LABELS,
  formatArticleId,
  formatDisplayValue,
  formatEvidenceFactValue,
  formatEvidenceStrength,
  formatProductCell,
  formatRiskDomain,
  orderEvidenceBreakdown,
  formatRiskId,
  type CatalogRiskMatch,
  type RiskDetail,
} from "./riskData";
import type { RiskEditDraft } from "./riskEditDraft";
import { FieldEditDialog, type FieldEditSpec } from "./FieldEditDialog";
import "./riskDetailDialog.css";

type EditableFieldKey =
  | "articleTitle"
  | "riskTitle"
  | "domains"
  | "primaryRisk"
  | "secondaryRisk"
  | "intent"
  | "aiProduct"
  | "description"
  | "attackVector"
  | "observableIndicators"
  | "sector"
  | "industry"
  | "timing"
  | "extractedRisk";

export type RiskDetailTab = "overview" | "analysis" | "scores" | "evidence";

const SCORE_METRIC_ICONS: Record<string, LucideIcon> = {
  "Overall decision": Gauge,
  "Context Clarity": BookOpen,
  "Keyword Matching": Hash,
  "Tagging Accuracy": Tags,
  "Evidence Strength": ShieldCheck,
};

const EVIDENCE_BREAKDOWN_ICONS: LucideIcon[] = [
  AlertTriangle,
  ScrollText,
  Eye,
];

const TABS: { key: RiskDetailTab; label: string; icon: LucideIcon }[] = [
  { key: "overview", label: "Overview", icon: FileText },
  { key: "analysis", label: "Analysis", icon: Brain },
  { key: "scores", label: "Scores", icon: BarChart3 },
  { key: "evidence", label: "Evidence", icon: Eye },
];

type RiskDetailTabBarProps = {
  idPrefix: string;
  tab: RiskDetailTab;
  onTabChange: (tab: RiskDetailTab) => void;
  tabPanelId: string;
  className?: string;
};

export const RiskDetailTabBar = memo(function RiskDetailTabBar({
  idPrefix,
  tab,
  onTabChange,
  tabPanelId,
  className,
}: RiskDetailTabBarProps) {
  return (
    <div className={`riskDetail__tabBar${className ? ` ${className}` : ""}`}>
      <div className="riskDetail__tabs" role="tablist" aria-label="Risk detail sections">
        {TABS.map(({ key, label, icon: TabIcon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={tabPanelId}
            tabIndex={tab === key ? 0 : -1}
            className={`riskDetail__tab${tab === key ? " riskDetail__tab--selected" : ""}`}
            onClick={() => onTabChange(key)}
          >
            <TabIcon size={15} strokeWidth={2} className="riskDetail__tabIcon" aria-hidden />
            <span className="riskDetail__tabLabel">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

export function parseRiskDetailTab(value: string | null): RiskDetailTab | undefined {
  if (
    value === "overview" ||
    value === "analysis" ||
    value === "scores" ||
    value === "evidence"
  ) {
    return value;
  }
  return undefined;
}

type RiskDetailViewProps = {
  risk: RiskDetail;
  initialTab?: RiskDetailTab;
  /** When set (e.g. page back nav title), used for `aria-labelledby` on the detail shell. */
  titleElementId?: string;
  tab?: RiskDetailTab;
  onTabChange?: (tab: RiskDetailTab) => void;
  hideTabBar?: boolean;
  idPrefix?: string;
  tabContentRef?: RefObject<HTMLDivElement | null>;
  editMode?: boolean;
  draft?: RiskEditDraft;
  taxonomyDomains?: string[];
  onDraftChange?: (patch: Partial<RiskEditDraft>) => void;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
};

function DetailActionBar({
  editMode,
  onEdit,
  onSave,
  onCancel,
  saveDisabled,
  saving,
}: {
  editMode: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  saveDisabled: boolean;
  saving: boolean;
}) {
  if (editMode && onSave) {
    return (
      <div className="riskDetail__saveBar">
        <button
          type="button"
          className="riskDetailPage__saveBtn"
          disabled={saveDisabled || saving}
          onClick={onSave}
        >
          <Save size={16} strokeWidth={2} aria-hidden />
          {saving ? "Saving…" : "Save"}
        </button>
        {onCancel ? (
          <button
            type="button"
            className="riskDetailPage__cancelBtn"
            disabled={saving}
            onClick={onCancel}
          >
            <CircleX size={16} strokeWidth={2} aria-hidden />
            Cancel
          </button>
        ) : null}
      </div>
    );
  }
  if (!editMode && onEdit) {
    return (
      <div className="riskDetail__saveBar">
        <button type="button" className="riskDetailPage__saveBtn" onClick={onEdit}>
          <Pencil size={16} strokeWidth={2} aria-hidden />
          Edit
        </button>
      </div>
    );
  }
  return null;
}

function EditFieldButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="riskDetail__classCardAction riskDetail__classCardAction--edit"
      onClick={onClick}
      aria-label={`Edit ${label}`}
      title={`Edit ${label}`}
    >
      <Pencil size={15} strokeWidth={2} aria-hidden />
    </button>
  );
}

function SectionHeading({
  id,
  icon: Icon,
  children,
  onEdit,
}: {
  id: string;
  icon: LucideIcon;
  children: string;
  onEdit?: () => void;
}) {
  return (
    <div className="riskDetail__sectionTitleRow">
      <h3 id={id} className="riskDetail__sectionTitle">
        <Icon size={16} strokeWidth={2} aria-hidden />
        {children}
      </h3>
      {onEdit ? <EditFieldButton label={children} onClick={onEdit} /> : null}
    </div>
  );
}

function domainFieldOptions(current: string, taxonomyDomains: string[]) {
  const options = [
    { value: "", label: current ? "Keep current" : "Select a taxonomy domain…" },
    ...taxonomyDomains.map((domain) => ({ value: domain, label: domain })),
  ];
  if (current && !taxonomyDomains.includes(current)) {
    options.push({ value: current, label: `${current} (current)` });
  }
  return options;
}

function fieldEditSpecFor(
  key: EditableFieldKey,
  draft: RiskEditDraft,
  taxonomyDomains: string[],
): FieldEditSpec {
  switch (key) {
    case "articleTitle":
      return {
        key,
        title: "Title",
        fields: [{ key: "articleTitle", value: draft.articleTitle, control: "textarea", rows: 8 }],
      };
    case "riskTitle":
      return {
        key,
        title: "Risk title",
        fields: [{ key: "riskTitle", value: draft.riskTitle, control: "textarea", rows: 6 }],
      };
    case "domains":
      return {
        key,
        title: "Domain",
        fields: [
          {
            key: "domains",
            value: draft.domains,
            control: "select",
            options: domainFieldOptions(draft.domains, taxonomyDomains),
          },
        ],
      };
    case "primaryRisk":
      return {
        key,
        title: "Primary Risk",
        fields: [{ key: "primaryRisk", value: draft.primaryRisk, control: "textarea", rows: 6 }],
      };
    case "secondaryRisk":
      return {
        key,
        title: "Secondary Risk",
        fields: [{ key: "secondaryRisk", value: draft.secondaryRisk, control: "textarea", rows: 6 }],
      };
    case "intent":
      return {
        key,
        title: "Intent",
        fields: [{ key: "intent", value: draft.intent, control: "textarea", rows: 6 }],
      };
    case "aiProduct":
      return {
        key,
        title: "AI Product",
        fields: [
          {
            key: "aiProductName",
            label: "Product name",
            value: draft.aiProductName,
            control: "textarea",
            rows: 4,
          },
          {
            key: "aiProductVendor",
            label: "Vendor",
            value: draft.aiProductVendor,
            control: "textarea",
            rows: 4,
          },
        ],
      };
    case "description":
      return {
        key,
        title: "Description",
        fields: [{ key: "description", value: draft.description, control: "textarea", rows: 12 }],
      };
    case "attackVector":
      return {
        key,
        title: "Attack Vector",
        fields: [{ key: "attackVector", value: draft.attackVector, control: "textarea", rows: 10 }],
      };
    case "observableIndicators":
      return {
        key,
        title: "Observable Indicators",
        fields: [
          {
            key: "observableIndicators",
            value: draft.observableIndicators,
            control: "textarea",
            rows: 10,
          },
        ],
      };
    case "sector":
      return {
        key,
        title: "Sector",
        fields: [{ key: "sector", value: draft.sector, control: "textarea", rows: 6 }],
      };
    case "industry":
      return {
        key,
        title: "Industry",
        fields: [{ key: "industry", value: draft.industry, control: "textarea", rows: 6 }],
      };
    case "timing":
      return {
        key,
        title: "Timing",
        fields: [{ key: "timing", value: draft.timing, control: "textarea", rows: 6 }],
      };
    case "extractedRisk":
      return {
        key,
        title: "Extracted Risk",
        fields: [
          {
            key: "riskTitle",
            label: "Risk title",
            value: draft.riskTitle,
            control: "textarea",
            rows: 4,
          },
          {
            key: "description",
            label: "Description",
            value: draft.description,
            control: "textarea",
            rows: 10,
          },
        ],
      };
  }
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

function scorePercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

function ScoreMetricIcon({ label }: { label: string }) {
  const Icon = SCORE_METRIC_ICONS[label] ?? BarChart3;
  return <Icon size={16} strokeWidth={2} aria-hidden />;
}

const ScoreBar = memo(function ScoreBar({ value, max }: { value: number; max: number }) {
  const pct = scorePercent(value, max);
  return (
    <div
      className="riskDetail__scoreBar"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={`${pct}%`}
    >
      <div className="riskDetail__scoreBarFill" style={{ width: `${pct}%` }} />
    </div>
  );
});

function DetailText({ children }: { children: string }) {
  const text = children.trim();
  if (!text) {
    return <p className="riskDetail__empty">No data available for this section.</p>;
  }
  return <p className="riskDetail__description">{text}</p>;
}

const AnalysisBlock = memo(function AnalysisBlock({
  label,
  text,
  icon,
  iconLabel,
}: {
  label: string;
  text: string;
  icon?: LucideIcon;
  iconLabel?: string;
}) {
  const Icon = icon ?? (iconLabel ? (SCORE_METRIC_ICONS[iconLabel] ?? BarChart3) : undefined);
  return (
    <div className="riskDetail__analysisBlock">
      {Icon ? (
        <div className="riskDetail__classCardHead">
          <span className="riskDetail__classCardIcon" aria-hidden>
            <Icon size={16} strokeWidth={2} />
          </span>
          <h4 className="riskDetail__innerCardTitle">{label}</h4>
        </div>
      ) : (
        <h4 className="riskDetail__innerCardTitle">{label}</h4>
      )}
      <DetailText>{text}</DetailText>
    </div>
  );
});

const DetailInfoCard = memo(function DetailInfoCard({
  title,
  value,
  children,
  ddClassName,
  icon: Icon,
  headerHref,
  headerActionLabel,
  onEdit,
}: {
  title: string;
  value?: string;
  children?: React.ReactNode;
  ddClassName?: string;
  icon?: LucideIcon;
  headerHref?: string;
  headerActionLabel?: string;
  onEdit?: () => void;
}) {
  const body = children ?? value ?? "—";
  const openHref = headerHref?.trim();
  const showHeaderAction = Boolean(openHref) || Boolean(onEdit);

  const cardHead = Icon ? (
    <div className="riskDetail__classCardHead">
      <span className="riskDetail__classCardIcon" aria-hidden>
        <Icon size={16} strokeWidth={2} />
      </span>
      <dt>{title}</dt>
    </div>
  ) : (
    <dt>{title}</dt>
  );

  return (
    <div
      className={`riskDetail__classCard${Icon ? "" : " riskDetail__classCard--noIcon"}${showHeaderAction ? " riskDetail__classCard--withAction" : ""}${onEdit ? " riskDetail__classCard--editable" : ""}`}
    >
      {showHeaderAction ? (
        <div className="riskDetail__classCardHeadRow">
          {cardHead}
          <div className="riskDetail__classCardActions">
            {onEdit ? <EditFieldButton label={title} onClick={onEdit} /> : null}
            {openHref ? (
              <a
                href={openHref}
                target="_blank"
                rel="noopener noreferrer"
                className="riskDetail__classCardAction"
                aria-label={headerActionLabel ?? `Open ${title}`}
                title={headerActionLabel ?? `Open ${title}`}
              >
                <ExternalLink size={16} strokeWidth={2} aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        cardHead
      )}
      <dd className={ddClassName}>{body}</dd>
    </div>
  );
});

const CatalogMatchScores = memo(function CatalogMatchScores({
  accuracyPercent,
  domainMatchPercent,
  descriptionMatchPercent,
}: Pick<
  CatalogRiskMatch,
  "accuracyPercent" | "domainMatchPercent" | "descriptionMatchPercent"
>) {
  return (
    <div className="riskDetail__catalogMatchScores">
      <span className="riskDetail__catalogMatchScoresLabel">Match</span>
      <span className="riskDetail__catalogMatchScore">
        {accuracyPercent}% accuracy score
      </span>
      <span className="riskDetail__catalogMatchScore riskDetail__catalogMatchScore--domain">
        {domainMatchPercent}% domain
      </span>
      <span className="riskDetail__catalogMatchScore riskDetail__catalogMatchScore--description">
        {descriptionMatchPercent}% description
      </span>
    </div>
  );
});

const CatalogMatchCard = memo(function CatalogMatchCard({ match }: { match: CatalogRiskMatch }) {
  return (
    <li className="riskDetail__catalogMatch">
      <div className="riskDetail__catalogMatchHead">
        <span className="riskDetail__riskIdPill">{match.riskId}</span>
        <CatalogMatchScores
          accuracyPercent={match.accuracyPercent}
          domainMatchPercent={match.domainMatchPercent}
          descriptionMatchPercent={match.descriptionMatchPercent}
        />
      </div>
      <div className="riskDetail__catalogMatchTitleRow">
        <p className="riskDetail__innerCardTitle riskDetail__catalogMatchTitle">{formatDisplayValue(match.title)}</p>
        <span className="riskDetail__domainHighlight riskDetail__domainHighlight--inline">
          {formatRiskDomain(match.domain)}
        </span>
      </div>
      <p className="riskDetail__catalogMatchDescription">{match.description}</p>
      <p className="riskDetail__catalogMatchSummary">{match.matchSummary}</p>
    </li>
  );
});

export const RiskDetailView = memo(function RiskDetailView({
  risk,
  initialTab = "overview",
  titleElementId,
  tab: controlledTab,
  onTabChange,
  hideTabBar = false,
  idPrefix: idPrefixProp,
  tabContentRef,
  editMode = false,
  draft,
  taxonomyDomains = [],
  onDraftChange,
  onEdit,
  onSave,
  onCancel,
  saveDisabled = true,
  saving = false,
}: RiskDetailViewProps) {
  const generatedId = useId();
  const baseId = idPrefixProp ?? generatedId;
  const [internalTab, setInternalTab] = useState<RiskDetailTab>(initialTab);
  const tab = controlledTab ?? internalTab;

  const setTab = (next: RiskDetailTab) => {
    if (onTabChange) onTabChange(next);
    else setInternalTab(next);
  };

  useEffect(() => {
    if (controlledTab === undefined) setInternalTab(initialTab);
  }, [risk.id, initialTab, controlledTab]);

  const [editingKey, setEditingKey] = useState<EditableFieldKey | null>(null);
  const live = editMode && draft && onDraftChange ? draft : null;

  const requestEdit = useCallback((key: EditableFieldKey) => {
    setEditingKey(key);
  }, []);

  const fieldEditSpec = useMemo(() => {
    if (!editingKey || !live) return null;
    return fieldEditSpecFor(editingKey, live, taxonomyDomains);
  }, [editingKey, live, taxonomyDomains]);

  const handleFieldApply = useCallback(
    (values: Record<string, string>) => {
      if (!onDraftChange || !editingKey) return;
      if (editingKey === "aiProduct") {
        onDraftChange({
          aiProductName: values.aiProductName ?? "",
          aiProductVendor: values.aiProductVendor ?? "",
        });
      } else if (editingKey === "extractedRisk") {
        onDraftChange({
          riskTitle: values.riskTitle ?? "",
          description: values.description ?? "",
        });
      } else {
        onDraftChange({ [editingKey]: values[editingKey] ?? "" } as Partial<RiskEditDraft>);
      }
      setEditingKey(null);
    },
    [editingKey, onDraftChange],
  );

  useEffect(() => {
    if (!editMode) setEditingKey(null);
  }, [editMode]);

  const tabPanelId = `${baseId}-panel`;
  const bestCatalogMatch = (risk.riskAnalysis.catalogMatches ?? [])[0];

  return (
    <div className="riskDetail riskDetail--page">
      <article
        className="riskDetail__shell"
        aria-labelledby={titleElementId ?? `${baseId}-title`}
      >
        {!titleElementId ? (
          <>
            <h2 id={`${baseId}-title`} className="riskDetail__srTitle">
              {formatDisplayValue(risk.title)}
            </h2>
            <header className="riskDetail__header">
              <div className="riskDetail__headerMain">
                <p className="riskDetail__riskId">{formatRiskId(risk)}</p>
              </div>
              <div className="riskDetail__headerActions">
                <span
                  className={`riskDetail__confidence riskDetail__confidence--${risk.confidence.toLowerCase()}`}
                >
                  <Sparkles size={14} strokeWidth={2} aria-hidden />
                  {confidenceLabel(risk.confidence)}
                </span>
                {risk.modelName ? (
                  <span className="riskDetail__modelTag" title="Extraction model">
                    {risk.modelName}
                  </span>
                ) : null}
              </div>
            </header>
          </>
        ) : null}

        {!hideTabBar ? (
          <RiskDetailTabBar
            idPrefix={baseId}
            tab={tab}
            onTabChange={setTab}
            tabPanelId={tabPanelId}
          />
        ) : null}

        <div
          ref={tabContentRef}
          id={tabPanelId}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab}`}
          className="riskDetail__body"
        >
          {tab === "overview" ? (
            <>
              <DetailActionBar
                editMode={editMode}
                onEdit={onEdit}
                onSave={onSave}
                onCancel={onCancel}
                saveDisabled={saveDisabled}
                saving={saving}
              />
              <section
                className="riskDetail__section riskDetail__section--source riskDetail__cardSection"
                aria-labelledby={`${baseId}-source`}
              >
                <h3 id={`${baseId}-source`} className="riskDetail__sectionTitle">
                  <FileText size={16} strokeWidth={2} aria-hidden />
                  Source Article
                </h3>
                <div className="riskDetail__sourceColumns">
                  <dl className="riskDetail__classification riskDetail__sourceGrid">
                    <DetailInfoCard
                      title="Title"
                      icon={BookOpen}
                      onEdit={live ? () => requestEdit("articleTitle") : undefined}
                    >
                      {formatDisplayValue(live ? live.articleTitle : risk.articleTitle)}
                    </DetailInfoCard>
                    <DetailInfoCard
                      title="URL"
                      icon={Link2}
                      headerHref={risk.articleUrl}
                      headerActionLabel="Open article in new tab"
                    >
                      <a
                        href={risk.articleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="riskDetail__link"
                      >
                        {risk.articleUrl}
                      </a>
                    </DetailInfoCard>
                  </dl>
                  <dl className="riskDetail__classification riskDetail__sourceGrid">
                    <DetailInfoCard
                      title="Article ID"
                      value={formatArticleId(risk.articleId)}
                      icon={Hash}
                      ddClassName="riskDetail__classCardValue--articleId"
                    />
                    <DetailInfoCard
                      title="Ingested"
                      value={risk.ingestedAt}
                      icon={Clock}
                    />
                    <DetailInfoCard
                      title="Quality score"
                      value={risk.qualityScore}
                      icon={Gauge}
                      ddClassName="riskDetail__classCardValue--qualityScore"
                    />
                  </dl>
                </div>
              </section>

              <section
                className="riskDetail__section riskDetail__cardSection"
                aria-labelledby={`${baseId}-classification`}
              >
                <h3 id={`${baseId}-classification`} className="riskDetail__sectionTitle">
                  <Target size={16} strokeWidth={2} aria-hidden />
                  Classification
                </h3>
                <dl className="riskDetail__classification">
                  <DetailInfoCard
                    title="Risk title"
                    icon={FileText}
                    onEdit={live ? () => requestEdit("riskTitle") : undefined}
                  >
                    {formatDisplayValue(live ? live.riskTitle : risk.title)}
                  </DetailInfoCard>
                  <DetailInfoCard
                    title="Domain"
                    icon={Globe}
                    onEdit={live ? () => requestEdit("domains") : undefined}
                  >
                    {formatRiskDomain(live ? live.domains : risk.domain)}
                  </DetailInfoCard>
                  <DetailInfoCard
                    title="Primary Risk"
                    icon={AlertTriangle}
                    onEdit={live ? () => requestEdit("primaryRisk") : undefined}
                  >
                    {formatDisplayValue(live ? live.primaryRisk : risk.primaryRisk)}
                  </DetailInfoCard>
                  <DetailInfoCard
                    title="Secondary Risk"
                    icon={ShieldCheck}
                    onEdit={live ? () => requestEdit("secondaryRisk") : undefined}
                  >
                    {formatDisplayValue(live ? live.secondaryRisk : risk.secondaryRisk)}
                  </DetailInfoCard>
                  <DetailInfoCard
                    title="Intent"
                    icon={Flag}
                    onEdit={live ? () => requestEdit("intent") : undefined}
                  >
                    {formatDisplayValue(live ? live.intent : risk.intent)}
                  </DetailInfoCard>
                  <DetailInfoCard
                    title="AI Product"
                    icon={Package}
                    onEdit={live ? () => requestEdit("aiProduct") : undefined}
                  >
                    {formatProductCell(
                      live
                        ? { name: live.aiProductName, vendor: live.aiProductVendor }
                        : risk.product,
                    )}
                  </DetailInfoCard>
                </dl>
              </section>

              <section
                className="riskDetail__section riskDetail__cardSection"
                aria-labelledby={`${baseId}-riskRating`}
              >
                <h3 id={`${baseId}-riskRating`} className="riskDetail__sectionTitle">
                  <Gauge size={16} strokeWidth={2} aria-hidden />
                  Risk Rating (Likelihood × Impact)
                </h3>
                <dl className="riskDetail__classification riskDetail__classification--rating">
                  <DetailInfoCard title="Likelihood" icon={BarChart3}>
                    <span>
                      {risk.riskScoring?.likelihood != null
                        ? `${risk.riskScoring.likelihood} — ${risk.riskScoring.likelihoodLabel}`
                        : "—"}
                    </span>
                    {risk.riskScoring?.likelihoodReasoning ? (
                      <p className="riskDetail__ratingReasoning">
                        {risk.riskScoring.likelihoodReasoning}
                      </p>
                    ) : null}
                  </DetailInfoCard>
                  <DetailInfoCard title="Impact" icon={AlertTriangle}>
                    <span>
                      {risk.riskScoring?.impact != null
                        ? `${risk.riskScoring.impact} — ${risk.riskScoring.impactLabel}`
                        : "—"}
                    </span>
                    {risk.riskScoring?.impactReasoning ? (
                      <p className="riskDetail__ratingReasoning">
                        {risk.riskScoring.impactReasoning}
                      </p>
                    ) : null}
                  </DetailInfoCard>
                  <DetailInfoCard title="Severity" icon={Gauge}>
                    <span>
                      {risk.riskScoring?.severityScore != null
                        ? `${risk.riskScoring.severityScore} / 25 — ${risk.riskScoring.severityBand}`
                        : "—"}
                    </span>
                    {risk.riskScoring?.lossCategories?.length ? (
                      <p className="riskDetail__ratingReasoning">
                        Loss categories (FAIR):{" "}
                        {risk.riskScoring.lossCategories.join(", ")}
                      </p>
                    ) : null}
                  </DetailInfoCard>
                </dl>
              </section>

              <section
                className="riskDetail__section"
                aria-labelledby={`${baseId}-description`}
              >
                <SectionHeading
                  id={`${baseId}-description`}
                  icon={ScrollText}
                  onEdit={live ? () => requestEdit("description") : undefined}
                >
                  Description
                </SectionHeading>
                <DetailText>{formatDisplayValue(live ? live.description : risk.description)}</DetailText>
              </section>

              <div className="riskDetail__dualColRow">
                <div className="riskDetail__dualCol riskDetail__dualCol--stack">
                  <section
                    className="riskDetail__section"
                    aria-labelledby={`${baseId}-attack`}
                  >
                    <SectionHeading
                      id={`${baseId}-attack`}
                      icon={AlertTriangle}
                      onEdit={live ? () => requestEdit("attackVector") : undefined}
                    >
                      Attack Vector
                    </SectionHeading>
                    <DetailText>{formatDisplayValue(live ? live.attackVector : risk.attackVector)}</DetailText>
                  </section>
                  <section
                    className="riskDetail__section"
                    aria-labelledby={`${baseId}-indicators`}
                  >
                    <SectionHeading
                      id={`${baseId}-indicators`}
                      icon={Eye}
                      onEdit={live ? () => requestEdit("observableIndicators") : undefined}
                    >
                      Observable Indicators
                    </SectionHeading>
                    <DetailText>
                      {formatDisplayValue(live ? live.observableIndicators : risk.observableIndicators)}
                    </DetailText>
                  </section>
                </div>
                <div className="riskDetail__dualCol riskDetail__dualCol--stack">
                  <section
                    className="riskDetail__section"
                    aria-labelledby={`${baseId}-sector`}
                  >
                    <SectionHeading
                      id={`${baseId}-sector`}
                      icon={Building2}
                      onEdit={live ? () => requestEdit("sector") : undefined}
                    >
                      Sector
                    </SectionHeading>
                    <DetailText>{formatDisplayValue(live ? live.sector : risk.sector)}</DetailText>
                  </section>
                  <section
                    className="riskDetail__section"
                    aria-labelledby={`${baseId}-industry`}
                  >
                    <SectionHeading
                      id={`${baseId}-industry`}
                      icon={Factory}
                      onEdit={live ? () => requestEdit("industry") : undefined}
                    >
                      Industry
                    </SectionHeading>
                    <DetailText>{formatDisplayValue(live ? live.industry : risk.industry)}</DetailText>
                  </section>
                  <section
                    className="riskDetail__section"
                    aria-labelledby={`${baseId}-timing`}
                  >
                    <SectionHeading
                      id={`${baseId}-timing`}
                      icon={Clock}
                      onEdit={live ? () => requestEdit("timing") : undefined}
                    >
                      Timing
                    </SectionHeading>
                    <DetailText>{formatDisplayValue(live ? live.timing : risk.timing)}</DetailText>
                  </section>
                </div>
              </div>
            </>
          ) : tab === "analysis" ? (
            <>
              <DetailActionBar
                editMode={editMode}
                onEdit={onEdit}
                onSave={onSave}
                onCancel={onCancel}
                saveDisabled={saveDisabled}
                saving={saving}
              />
              <section
                className="riskDetail__section"
                aria-labelledby={`${baseId}-extracted-risk`}
              >
                <SectionHeading
                  id={`${baseId}-extracted-risk`}
                  icon={FileText}
                  onEdit={live ? () => requestEdit("extractedRisk") : undefined}
                >
                  Extracted Risk (from article)
                </SectionHeading>
                <div className="riskDetail__extractedRisk">
                  <div className="riskDetail__catalogMatchHead">
                    <span className="riskDetail__riskIdPill riskDetail__extractedRiskId">
                      {formatRiskId(risk)}
                    </span>
                    {bestCatalogMatch ? (
                      <CatalogMatchScores
                        accuracyPercent={bestCatalogMatch.accuracyPercent}
                        domainMatchPercent={bestCatalogMatch.domainMatchPercent}
                        descriptionMatchPercent={
                          bestCatalogMatch.descriptionMatchPercent
                        }
                      />
                    ) : null}
                  </div>
                  <div className="riskDetail__catalogMatchTitleRow">
                    <p className="riskDetail__extractedRiskTitle">
                      {formatDisplayValue(live ? live.riskTitle : risk.title)}
                    </p>
                    <span className="riskDetail__domainHighlight riskDetail__domainHighlight--inline">
                      {formatRiskDomain(live ? live.domains : risk.domain)}
                    </span>
                  </div>
                  <DetailText>{formatDisplayValue(live ? live.description : risk.description)}</DetailText>
                </div>
              </section>

              <section
                className="riskDetail__section"
                aria-labelledby={`${baseId}-catalog-matches`}
              >
                <h3 id={`${baseId}-catalog-matches`} className="riskDetail__sectionTitle">
                  <Link2 size={16} strokeWidth={2} aria-hidden />
                  Catalog Risk Mappings
                </h3>
                {(risk.riskAnalysis.catalogMatches ?? []).length === 0 ? (
                  <p className="riskDetail__empty">
                    No catalog mappings met the minimum relevance threshold for this
                    risk.
                  </p>
                ) : (
                  <ol className="riskDetail__catalogList">
                    {(risk.riskAnalysis.catalogMatches ?? []).map((match) => (
                      <CatalogMatchCard key={match.riskId} match={match} />
                    ))}
                  </ol>
                )}
              </section>

              <section
                className="riskDetail__section"
                aria-labelledby={`${baseId}-risk-analysis`}
              >
                <h3 id={`${baseId}-risk-analysis`} className="riskDetail__sectionTitle">
                  <Brain size={16} strokeWidth={2} aria-hidden />
                  Risk Analysis
                </h3>
                <div className="riskDetail__analysisStack">
                  <AnalysisBlock
                    label="Risk identified"
                    text={risk.riskAnalysis.risk_identified}
                    icon={SearchCheck}
                  />
                  <AnalysisBlock
                    label="Article context"
                    text={risk.riskAnalysis.article_context}
                    icon={BookOpen}
                  />
                  <AnalysisBlock
                    label="Alignment reasoning"
                    text={risk.riskAnalysis.alignment_reasoning}
                    icon={Link2}
                  />
                </div>
              </section>

              <section
                className="riskDetail__section"
                aria-labelledby={`${baseId}-model-eval`}
              >
                <h3 id={`${baseId}-model-eval`} className="riskDetail__sectionTitle">
                  <BarChart3 size={16} strokeWidth={2} aria-hidden />
                  Model Self-Evaluation
                </h3>
                <AnalysisBlock
                  label="Decision rationale"
                  text={risk.modelSelfEvaluation.decision_rationale}
                  icon={ClipboardList}
                />
              </section>
            </>
          ) : tab === "scores" ? (
            <>
              <section
                className="riskDetail__section riskDetail__section--overall"
                aria-labelledby={`${baseId}-overall-score`}
              >
                <div className="riskDetail__overallHead">
                  <h3
                    id={`${baseId}-overall-score`}
                    className="riskDetail__sectionTitle riskDetail__overallLabel"
                  >
                    <Gauge size={16} strokeWidth={2} aria-hidden />
                    Overall Accuracy Score
                  </h3>
                  <div className="riskDetail__overallRight">
                    <p className="riskDetail__overallValue">
                      {risk.scores.overall.value}/{risk.scores.overall.max}
                    </p>
                    <p className="riskDetail__overallConfidence">
                      {confidenceLabel(risk.confidence)}
                    </p>
                  </div>
                </div>
                <ScoreBar
                  value={risk.scores.overall.value}
                  max={risk.scores.overall.max}
                />
                <DetailText>{formatDisplayValue(risk.scores.justification.decision_rationale)}</DetailText>
              </section>

              <ul className="riskDetail__evidenceList riskDetail__evidenceList--scores">
                {risk.scores.metrics.map((metric) => (
                  <li key={metric.label} className="riskDetail__evidenceItem">
                    <div className="riskDetail__evidenceItemHead">
                      <div className="riskDetail__classCardHead">
                        <span className="riskDetail__classCardIcon" aria-hidden>
                          <ScoreMetricIcon label={metric.label} />
                        </span>
                        <h4 className="riskDetail__innerCardTitle">{metric.label}</h4>
                      </div>
                      <span className="riskDetail__evidenceStrength riskDetail__scoreMetricValue">
                        {metric.value}/{metric.max}
                      </span>
                    </div>
                    <p className="riskDetail__evidenceText">
                      {metric.reasoning?.trim() || "—"}
                    </p>
                  </li>
                ))}
              </ul>

              {/* Score Justification — content moved under Overall Accuracy Score
              <section
                className="riskDetail__section"
                aria-labelledby={`${baseId}-score-justification`}
              >
                <h3
                  id={`${baseId}-score-justification`}
                  className="riskDetail__sectionTitle"
                >
                  <ClipboardList size={16} strokeWidth={2} aria-hidden />
                  Score Justification
                </h3>
                <div className="riskDetail__analysisStack">
                  <AnalysisBlock
                    label="Overall decision"
                    iconLabel="Overall decision"
                    text={risk.scores.justification.decision_rationale}
                  />
                  {risk.scores.metrics.map((metric) => (
                    <AnalysisBlock
                      key={metric.label}
                      label={metric.label}
                      iconLabel={metric.label}
                      text={metric.reasoning ?? ""}
                    />
                  ))}
                </div>
              </section>
              */}
            </>
          ) : (
            <>
              <section
                className="riskDetail__section"
                aria-labelledby={`${baseId}-evidence-snippet`}
              >
                <h3 id={`${baseId}-evidence-snippet`} className="riskDetail__sectionTitle">
                  <Quote size={16} strokeWidth={2} aria-hidden />
                  Evidence Snippet
                </h3>
                <p className="riskDetail__evidenceSnippet">
                  {risk.evidence.snippet.trim() || "No snippet available."}
                </p>
              </section>

              <div className="riskDetail__dualColRow">
                <section
                  className="riskDetail__section"
                  aria-labelledby={`${baseId}-evidence-data`}
                >
                  <h3 id={`${baseId}-evidence-data`} className="riskDetail__sectionTitle">
                    <Database size={16} strokeWidth={2} aria-hidden />
                    Data to Identify Risk
                  </h3>
                  <DetailText>{formatDisplayValue(risk.evidence.dataToIdentifyRisk)}</DetailText>
                </section>

                <section
                  className="riskDetail__section"
                  aria-labelledby={`${baseId}-evidence-sources`}
                >
                  <h3 id={`${baseId}-evidence-sources`} className="riskDetail__sectionTitle">
                    <Link2 size={16} strokeWidth={2} aria-hidden />
                    Evidence Sources
                  </h3>
                  <DetailText>{formatDisplayValue(risk.evidence.sources)}</DetailText>
                </section>
              </div>

              <section
                className="riskDetail__section"
                aria-labelledby={`${baseId}-evidence-breakdown`}
              >
                <h3 id={`${baseId}-evidence-breakdown`} className="riskDetail__sectionTitle">
                  <Layers size={16} strokeWidth={2} aria-hidden />
                  Evidence Breakdown
                </h3>
                {risk.evidence.breakdown.length === 0 ? (
                  <p className="riskDetail__empty">No structured evidence breakdown.</p>
                ) : (
                  <ul className="riskDetail__evidenceList riskDetail__evidenceList--breakdown">
                    {orderEvidenceBreakdown(risk.evidence.breakdown).map(
                      ({ item, headingIndex }) => {
                        const HeadingIcon =
                          EVIDENCE_BREAKDOWN_ICONS[headingIndex] ?? AlertTriangle;
                        const headingLabel =
                          EVIDENCE_BREAKDOWN_HEADING_LABELS[headingIndex] ??
                          EVIDENCE_BREAKDOWN_HEADING_LABELS[0];
                        return (
                      <li
                        key={`${headingLabel}-${headingIndex}`}
                        className="riskDetail__evidenceItem"
                      >
                        <div className="riskDetail__evidenceItemHead">
                          <div className="riskDetail__classCardHead">
                            <span className="riskDetail__classCardIcon" aria-hidden>
                              <HeadingIcon size={16} strokeWidth={2} />
                            </span>
                            <h4 className="riskDetail__innerCardTitle">{headingLabel}</h4>
                          </div>
                          {item.strength?.trim() ? (
                            <span className="riskDetail__evidenceStrength">
                              {formatEvidenceStrength(item.strength)}
                            </span>
                          ) : null}
                        </div>
                        <p className="riskDetail__evidenceText">{item.sourceText}</p>
                        <dl className="riskDetail__evidenceFacts">
                          <div className="riskDetail__evidenceFactRow">
                            <dt>Specificity</dt>
                            <dd className="riskDetail__evidenceFactValue">
                              {item.specificity?.trim()
                                ? formatEvidenceFactValue(item.specificity)
                                : "—"}
                            </dd>
                          </div>
                          <div className="riskDetail__evidenceFactRow">
                            <dt>Taxonomy alignment</dt>
                            <dd className="riskDetail__evidenceFactValue">
                              {item.taxonomyAlignment?.trim()
                                ? formatEvidenceFactValue(item.taxonomyAlignment)
                                : "—"}
                            </dd>
                          </div>
                        </dl>
                      </li>
                        );
                      },
                    )}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </article>
      {fieldEditSpec ? (
        <FieldEditDialog
          key={fieldEditSpec.key}
          spec={fieldEditSpec}
          onClose={() => setEditingKey(null)}
          onApply={handleFieldApply}
        />
      ) : null}
    </div>
  );
});
