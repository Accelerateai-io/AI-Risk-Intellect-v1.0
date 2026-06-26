import { useEffect, useId, useState, type RefObject } from "react";
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
  Quote,
  ScrollText,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Tags,
  Target,
} from "lucide-react";
import {
  EVIDENCE_BREAKDOWN_HEADING_LABELS,
  formatArticleId,
  formatEvidenceFactValue,
  formatEvidenceStrength,
  formatRiskDomain,
  orderEvidenceBreakdown,
  formatRiskId,
  type CatalogRiskMatch,
  type RiskDetail,
} from "./riskData";
import "./riskDetailDialog.css";

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

export function RiskDetailTabBar({
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
}

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
};

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

function ScoreBar({ value, max }: { value: number; max: number }) {
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
}

function DetailText({ children }: { children: string }) {
  const text = children.trim();
  if (!text) {
    return <p className="riskDetail__empty">No data available for this section.</p>;
  }
  return <p className="riskDetail__description">{text}</p>;
}

function AnalysisBlock({
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
}

function DetailInfoCard({
  title,
  value,
  children,
  ddClassName,
  icon: Icon,
  headerHref,
  headerActionLabel,
}: {
  title: string;
  value?: string;
  children?: React.ReactNode;
  ddClassName?: string;
  icon?: LucideIcon;
  headerHref?: string;
  headerActionLabel?: string;
}) {
  const body = children ?? value ?? "—";
  const openHref = headerHref?.trim();
  const showHeaderAction = Boolean(openHref);

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
      className={`riskDetail__classCard${Icon ? "" : " riskDetail__classCard--noIcon"}${showHeaderAction ? " riskDetail__classCard--withAction" : ""}`}
    >
      {showHeaderAction ? (
        <div className="riskDetail__classCardHeadRow">
          {cardHead}
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
        </div>
      ) : (
        cardHead
      )}
      <dd className={ddClassName}>{body}</dd>
    </div>
  );
}

function CatalogMatchCard({ match }: { match: CatalogRiskMatch }) {
  return (
    <li className="riskDetail__catalogMatch">
      <div className="riskDetail__catalogMatchHead">
        <span className="riskDetail__riskIdPill">{match.riskId}</span>
        <span
          className="riskDetail__catalogMatchScore"
          title={`Domain: ${match.domainMatchPercent}% · Description: ${match.descriptionMatchPercent}%`}
        >
          {match.accuracyPercent}% match
        </span>
      </div>
      <div className="riskDetail__catalogMatchTitleRow">
        <p className="riskDetail__innerCardTitle riskDetail__catalogMatchTitle">{match.title}</p>
        <span className="riskDetail__domainHighlight riskDetail__domainHighlight--inline">
          {formatRiskDomain(match.domain)}
        </span>
      </div>
      <p className="riskDetail__catalogMatchDescription">{match.description}</p>
      <p className="riskDetail__catalogMatchSummary">{match.matchSummary}</p>
    </li>
  );
}

export function RiskDetailView({
  risk,
  initialTab = "overview",
  titleElementId,
  tab: controlledTab,
  onTabChange,
  hideTabBar = false,
  idPrefix: idPrefixProp,
  tabContentRef,
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

  const tabPanelId = `${baseId}-panel`;

  return (
    <div className="riskDetail riskDetail--page">
      <article
        className="riskDetail__shell"
        aria-labelledby={titleElementId ?? `${baseId}-title`}
      >
        {!titleElementId ? (
          <>
            <h2 id={`${baseId}-title`} className="riskDetail__srTitle">
              {risk.title}
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
                      value={risk.articleTitle}
                      icon={BookOpen}
                    />
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
                    title="Domain"
                    value={formatRiskDomain(risk.domain)}
                    icon={Globe}
                  />
                  <DetailInfoCard
                    title="Primary Risk"
                    value={risk.primaryRisk}
                    icon={AlertTriangle}
                  />
                  <DetailInfoCard
                    title="Secondary Risk"
                    value={risk.secondaryRisk}
                    icon={ShieldCheck}
                  />
                  <DetailInfoCard title="Intent" value={risk.intent} icon={Flag} />
                </dl>
              </section>

              <section
                className="riskDetail__section"
                aria-labelledby={`${baseId}-description`}
              >
                <h3 id={`${baseId}-description`} className="riskDetail__sectionTitle">
                  <ScrollText size={16} strokeWidth={2} aria-hidden />
                  Description
                </h3>
                <DetailText>{risk.description}</DetailText>
              </section>

              <div className="riskDetail__dualColRow">
                <div className="riskDetail__dualCol riskDetail__dualCol--stack">
                  <section
                    className="riskDetail__section"
                    aria-labelledby={`${baseId}-attack`}
                  >
                    <h3 id={`${baseId}-attack`} className="riskDetail__sectionTitle">
                      <AlertTriangle size={16} strokeWidth={2} aria-hidden />
                      Attack Vector
                    </h3>
                    <DetailText>{risk.attackVector}</DetailText>
                  </section>
                  <section
                    className="riskDetail__section"
                    aria-labelledby={`${baseId}-indicators`}
                  >
                    <h3 id={`${baseId}-indicators`} className="riskDetail__sectionTitle">
                      <Eye size={16} strokeWidth={2} aria-hidden />
                      Observable Indicators
                    </h3>
                    <DetailText>{risk.observableIndicators}</DetailText>
                  </section>
                </div>
                <div className="riskDetail__dualCol riskDetail__dualCol--stack">
                  <section
                    className="riskDetail__section"
                    aria-labelledby={`${baseId}-sector`}
                  >
                    <h3 id={`${baseId}-sector`} className="riskDetail__sectionTitle">
                      <Building2 size={16} strokeWidth={2} aria-hidden />
                      Sector
                    </h3>
                    <DetailText>{risk.sector}</DetailText>
                  </section>
                  <section
                    className="riskDetail__section"
                    aria-labelledby={`${baseId}-industry`}
                  >
                    <h3 id={`${baseId}-industry`} className="riskDetail__sectionTitle">
                      <Factory size={16} strokeWidth={2} aria-hidden />
                      Industry
                    </h3>
                    <DetailText>{risk.industry}</DetailText>
                  </section>
                  <section
                    className="riskDetail__section"
                    aria-labelledby={`${baseId}-timing`}
                  >
                    <h3 id={`${baseId}-timing`} className="riskDetail__sectionTitle">
                      <Clock size={16} strokeWidth={2} aria-hidden />
                      Timing
                    </h3>
                    <DetailText>{risk.timing}</DetailText>
                  </section>
                </div>
              </div>
            </>
          ) : tab === "analysis" ? (
            <>
              <section
                className="riskDetail__section"
                aria-labelledby={`${baseId}-extracted-risk`}
              >
                <h3 id={`${baseId}-extracted-risk`} className="riskDetail__sectionTitle">
                  <FileText size={16} strokeWidth={2} aria-hidden />
                  Extracted Risk (from article)
                </h3>
                <div className="riskDetail__extractedRisk">
                  <span className="riskDetail__riskIdPill riskDetail__extractedRiskId">
                    {formatRiskId(risk)}
                  </span>
                  <div className="riskDetail__catalogMatchTitleRow">
                    <p className="riskDetail__extractedRiskTitle">{risk.title}</p>
                    <span className="riskDetail__domainHighlight riskDetail__domainHighlight--inline">
                      {formatRiskDomain(risk.domain)}
                    </span>
                  </div>
                  <DetailText>{risk.description}</DetailText>
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
                <DetailText>{risk.scores.justification.decision_rationale}</DetailText>
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
                  <DetailText>{risk.evidence.dataToIdentifyRisk}</DetailText>
                </section>

                <section
                  className="riskDetail__section"
                  aria-labelledby={`${baseId}-evidence-sources`}
                >
                  <h3 id={`${baseId}-evidence-sources`} className="riskDetail__sectionTitle">
                    <Link2 size={16} strokeWidth={2} aria-hidden />
                    Evidence Sources
                  </h3>
                  <DetailText>{risk.evidence.sources}</DetailText>
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
    </div>
  );
}
