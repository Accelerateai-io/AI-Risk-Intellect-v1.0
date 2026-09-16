import type { RiskDetail } from "./riskData";

export type RiskEditDraft = {
  riskTitle: string;
  articleTitle: string;
  description: string;
  domains: string;
  primaryRisk: string;
  secondaryRisk: string;
  sector: string;
  industry: string;
  intent: string;
  likelihood: string;
  impact: string;
  aiProductName: string;
  aiProductVendor: string;
  attackVector: string;
  observableIndicators: string;
  timing: string;
};

function clean(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s === "—" ? "" : s;
}

export function draftFromRisk(risk: RiskDetail): RiskEditDraft {
  return {
    riskTitle: clean(risk.title),
    articleTitle: clean(risk.articleTitle),
    description: clean(risk.description),
    domains: clean(risk.domain),
    primaryRisk: clean(risk.primaryRisk),
    secondaryRisk: clean(risk.secondaryRisk),
    sector: clean(risk.sector),
    industry: clean(risk.industry),
    intent: clean(risk.intent),
    likelihood: risk.riskScoring?.likelihood != null ? String(risk.riskScoring.likelihood) : "",
    impact: risk.riskScoring?.impact != null ? String(risk.riskScoring.impact) : "",
    aiProductName: clean(risk.product?.name ?? ""),
    aiProductVendor: clean(risk.product?.vendor ?? ""),
    attackVector: clean(risk.attackVector),
    observableIndicators: clean(risk.observableIndicators),
    timing: clean(risk.timing),
  };
}

export function diffRiskDraft(
  initial: RiskEditDraft,
  draft: RiskEditDraft,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  (Object.keys(draft) as (keyof RiskEditDraft)[]).forEach((key) => {
    if (key === "likelihood" || key === "impact") return;
    if (draft[key] === initial[key]) return;
    out[key] = draft[key];
  });
  return out;
}

export const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes. If you leave without saving, all changes will be discarded.";
