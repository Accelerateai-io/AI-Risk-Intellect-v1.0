export type CatalogRiskMatch = {
  riskId: string;
  title: string;
  description: string;
  domain: string;
  accuracyPercent: number;
  domainMatchPercent: number;
  descriptionMatchPercent: number;
  matchSummary: string;
};

export type HumanReviewInfo = {
  status: "pending" | "approved" | "rejected" | "classified" | null;
  classification?: "raw" | "structured" | null;
  reviewedBy: string | null;
  reviewedByUsername: string | null;
  reviewedAt: string | null;
  feedback: string | null;
};

export type RiskDetail = {
  id: string;
  /** Sequential display id from API (R-1, R-01, R-10, …). */
  displayId?: string;
  title: string;
  domain: string;
  primaryRisk: string;
  secondaryRisk: string;
  sector: string;
  industry: string;
  intent: string;
  qualityScore: string;
  primaryKey: string;
  tagKey: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  description: string;
  attackVector: string;
  observableIndicators: string;
  timing: string;
  articleId?: number;
  articleTitle: string;
  articleUrl: string;
  ingestedAt: string;
  /** ISO timestamp for sorting (from API `ingestedAt` before display formatting). */
  createdAt?: string;
  riskAnalysis: {
    risk_identified: string;
    article_context: string;
    alignment_reasoning: string;
    catalogMatches?: CatalogRiskMatch[];
  };
  modelSelfEvaluation: {
    decision_rationale: string;
  };
  scores: {
    overall: { value: number; max: number };
    metrics: { label: string; value: number; max: number; reasoning?: string }[];
    justification: {
      decision_rationale: string;
      context_clarity_reasoning?: string;
      keyword_reasoning?: string;
      tagging_reasoning?: string;
      evidence_reasoning?: string;
    };
  };
  evidence: {
    snippet: string;
    sources: string;
    dataToIdentifyRisk: string;
    breakdown: EvidenceBreakdownItem[];
  };
  modelName?: string | null;
  humanReview?: HumanReviewInfo;
};

export type EvidenceBreakdownItem = {
  field: string;
  strength: string;
  sourceText: string;
  specificity?: string;
  taxonomyAlignment?: string;
};

export const EVIDENCE_BREAKDOWN_HEADING_LABELS = [
  "Attack Vector",
  "Description",
  "Observable Indicators",
] as const;

/** Map API `field` (or list index) to Attack Vector / Description / Observable Indicators slot. */
export function resolveEvidenceBreakdownSlot(
  field: string,
  fallbackIndex: number,
): number {
  const normalized = field.trim().toLowerCase().replace(/[_-]+/g, " ");
  const byField: Record<string, number> = {
    "attack vector": 0,
    attack: 0,
    description: 1,
    "risk description": 1,
    "observable indicators": 2,
    "observable indicator": 2,
    indicators: 2,
  };
  if (normalized in byField) return byField[normalized]!;
  return Math.min(Math.max(fallbackIndex, 0), EVIDENCE_BREAKDOWN_HEADING_LABELS.length - 1);
}

export function orderEvidenceBreakdown(
  items: EvidenceBreakdownItem[],
): Array<{ item: EvidenceBreakdownItem; headingIndex: number }> {
  const slots: Array<{ item: EvidenceBreakdownItem; headingIndex: number } | null> = [
    null,
    null,
    null,
  ];
  items.forEach((item, index) => {
    const headingIndex = resolveEvidenceBreakdownSlot(item.field, index);
    if (!slots[headingIndex]) {
      slots[headingIndex] = { item, headingIndex };
    }
  });
  return slots.filter((entry): entry is NonNullable<typeof entry> => entry != null);
}

/** R-1 … R-9 when total < 10; zero-pad to 2 digits when total >= 10. */
export function formatRiskDisplayNumber(
  sequence: number,
  totalCount: number,
): string {
  if (sequence < 1) return "R-?";
  const minDigits = totalCount < 10 ? 1 : 2;
  return `R-${String(sequence).padStart(minDigits, "0")}`;
}

type RiskIdInput = string | Pick<RiskDetail, "id" | "displayId">;

/** Display id for tables and headers; prefers API `displayId`. */
export function formatRiskId(input: RiskIdInput): string {
  if (typeof input !== "string" && input.displayId?.trim()) {
    return input.displayId.trim();
  }

  const trimmed =
    typeof input === "string" ? input.trim() : input.id.trim();

  if (/^R-\d+$/i.test(trimmed)) return trimmed;

  const legacy = /^RISK-(\d+)$/i.exec(trimmed);
  if (legacy) return `R-${legacy[1]}`;

  return trimmed;
}

/** Title for risk detail back nav — strips a leading display id if present in `title`. */
export function riskBackNavTitle(
  risk: Pick<RiskDetail, "title" | "id" | "displayId">,
): string {
  const title = risk.title.trim();
  if (!title) return "Untitled risk";

  const id = formatRiskId(risk);
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutId = title
    .replace(new RegExp(`^\\s*${escaped}\\s*(?:[:\\-|–—]\\s*)?`, "i"), "")
    .trim();

  return withoutId || title;
}

/** Article id for display (matches articles list: #123). */
export function formatArticleId(articleId: number | undefined | null): string {
  if (articleId == null || Number.isNaN(Number(articleId))) return "—";
  return `#${articleId}`;
}

/** Evidence strength label (e.g. "strong" → "Strong", "high" → "High"). */
export function formatEvidenceStrength(strength: string): string {
  const trimmed = strength.trim();
  if (!trimmed) return "";
  return trimmed
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Specificity / taxonomy fact values (e.g. "high" → "High"); phrases unchanged. */
export function formatEvidenceFactValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/\s/.test(trimmed)) {
    return formatEvidenceStrength(trimmed);
  }
  return trimmed;
}

/** Domain label without catalog numbering (e.g. "7. AI SYSTEM SAFETY" → "AI SYSTEM SAFETY"). */
export function formatRiskDomain(domain: string): string {
  const trimmed = domain.trim();
  if (!trimmed) return "—";
  const name = trimmed.replace(/^\d+\.\s*/, "").trim();
  return (name || trimmed).toUpperCase();
}

export const MOCK_RISK_ROWS: RiskDetail[] = [
  {
    id: "R-7259",
    title:
      "Hallucination and Information Accuracy Failures in Small Language Models Processing Government Data",
    domain: "7. AI SYSTEM SAFETY, FAILURES, & LIMITATIONS",
    primaryRisk: "Technical Risks",
    secondaryRisk: "Technical/Performance Risk",
    sector: "Public",
    industry: "Government Administration and Public Services",
    intent: "Accidental",
    qualityScore: "0.91",
    primaryKey: "technical",
    tagKey: "safety",
    confidence: "HIGH",
    articleTitle:
      "https://www.technologyreview.com/2026/04/16/1135216/making-ai-operational-in-constrained-public-sector-environments/",
    articleUrl:
      "https://www.technologyreview.com/2026/04/16/1135216/making-ai-operational-in-constrained-public-sector-environments/",
    articleId: 1135216,
    ingestedAt: "4/16/2026, 1:50:20 PM",
    description:
      "Small language models (SLMs) deployed in public sector environments may generate hallucinations and fabricated information when processing sensitive government data. These accuracy failures can lead to incorrect policy recommendations, misclassified citizen requests, and erosion of trust in AI-assisted government services. The risk is heightened when SLMs operate with limited context windows and insufficient grounding in authoritative government sources.",
    attackVector:
      "Small language models (SLMs) deployed in government settings may generate false or hallucinated information when queried on policy or citizen service data without verification mechanisms. Attackers or misconfigured integrations can exploit this by feeding misleading prompts or relying on unverified SLM outputs in decision workflows.",
    observableIndicators:
      "Inconsistent outputs across similar queries, fabricated citations or references, untraceable factual claims in responses, and discrepancies between SLM outputs and authoritative government records are common signs of this risk.",
    timing:
      "Ongoing during deployment and active use phases. Most acute when SLMs are queried on time-sensitive or post-cutoff topics without retrieval augmentation.",
    riskAnalysis: {
      risk_identified:
        "The article identifies hallucination and information accuracy failures in small language models (SLMs) deployed in government environments. SLMs may generate fabricated policy references, incorrect regulatory citations, or misleading summaries of government data when operating without grounding in authoritative sources.",
      article_context:
        "The source discusses operational constraints for AI in public-sector settings, including limited compute, restricted context windows, and pressure to deploy smaller models. It emphasizes that accuracy and verifiability are critical when models inform citizen-facing or policy decisions.",
      alignment_reasoning:
        "This risk aligns with the article's core discussion of AI system limitations in high-stakes government decision-making. Hallucinations and accuracy failures directly undermine the reliability guarantees that public-sector deployments require.",
    },
    modelSelfEvaluation: {
      decision_rationale:
        "I classified this risk under AI System Safety, Failures, & Limitations because hallucinations represent a fundamental model capability failure rather than a misuse or governance gap. Primary Risk: Technical Risks and Secondary Risk: Technical/Performance Risk reflect that output reliability and factual accuracy are technical properties of the model pipeline.",
    },
    scores: {
      overall: { value: 93, max: 100 },
      metrics: [
        {
          label: "Context Clarity",
          value: 42,
          max: 45,
          reasoning:
            "Context Clarity scored well because the source explicitly discusses SLM limitations in government settings.",
        },
        {
          label: "Keyword Matching",
          value: 18,
          max: 20,
          reasoning:
            "Minor deductions on Keyword Matching reflect some generic phrasing in the extraction.",
        },
        {
          label: "Tagging Accuracy",
          value: 19,
          max: 20,
          reasoning:
            "Tagging aligns with the AI System Safety domain and technical risk labels from the article themes.",
        },
        {
          label: "Evidence Strength",
          value: 14,
          max: 15,
          reasoning:
            "Evidence Strength scored well because the article provides direct quotes on model limitations and hallucination risk.",
        },
      ],
      justification: {
        decision_rationale:
          "The high overall score reflects strong alignment between extracted risk themes and article content.",
      },
    },
    evidence: {
      snippet:
        "Sponsored — Making AI operational in constrained public sector environments. Purpose-built small language models provide a practical solution for agencies that cannot deploy frontier-scale models due to distinct constraints around security, governance, and operations that require smaller, auditable systems with predictable resource use.",
      sources:
        "Article states: \"Large language models generate text based on what they were trained on, so there is a cut-off date when they were trained.\" The piece emphasizes that without retrieval from verified sources, models may hallucinate facts—especially when answering questions about events or policies outside their training window.",
      dataToIdentifyRisk:
        "Audit logs of SLM query outputs and source citations; comparison datasets of SLM-generated responses against verified government records; performance metrics on hallucination rates by topic area; user-reported incidents of incorrect policy guidance; and red-team evaluation results for factual accuracy in government-domain queries.",
      breakdown: [
        {
          field: "Attack Vector",
          strength: "Strong",
          sourceText:
            "Purpose-built small language models provide a practical solution for agencies that cannot deploy frontier-scale models due to distinct constraints around security, governance, and operations.",
          specificity: "Direct quote from article",
          taxonomyAlignment: "AI System Safety, Failures, & Limitations",
        },
        {
          field: "Description",
          strength: "Strong",
          sourceText:
            "Large language models generate text based on what they were trained on, so there is a cut-off date when they were trained; without retrieval from verified sources, models may hallucinate facts.",
          specificity: "Explicit limitation described in source",
        },
      ],
    },
  },
  {
    id: "R-10042",
    title: "Bias in recruitment screening model",
    domain: "3. Discrimination & Toxicity",
    primaryRisk: "Technical",
    secondaryRisk: "Fairness",
    sector: "Private",
    industry: "HR Technology",
    intent: "Commercial",
    qualityScore: "0.87",
    primaryKey: "technical",
    tagKey: "bias",
    confidence: "MEDIUM",
    articleTitle: "AI hiring tools show disparate impact in pilot study",
    articleUrl: "https://example.com/articles/ai-hiring-bias",
    articleId: 10042,
    ingestedAt: "4/10/2026, 9:15:00 AM",
    description:
      "Automated screening models may systematically disadvantage certain applicant groups when trained on historical hiring data that reflects past biases.",
    attackVector:
      "Biased training data and opaque scoring features can be exploited to produce discriminatory rankings at scale when models are deployed without fairness constraints.",
    observableIndicators:
      "Disparate pass rates across demographic groups, unstable rankings for near-identical résumés, and audit trails that cannot explain individual rejections.",
    timing:
      "Highest during active hiring seasons and when models are retrained on new applicant pools without bias regression testing.",
    riskAnalysis: {
      risk_identified:
        "The article highlights disparate impact from automated résumé screening systems trained on historical hiring data that encodes past discrimination patterns.",
      article_context:
        "The pilot study evaluated commercial hiring tools across multiple employers and documented statistically significant differences in recommendation rates across demographic groups.",
      alignment_reasoning:
        "Fairness and bias in automated hiring align with discrimination risks in HR technology deployments where model outputs directly affect employment outcomes.",
    },
    modelSelfEvaluation: {
      decision_rationale:
        "Classified under Discrimination & Toxicity with Technical primary risk because bias emerges from model training and feature engineering rather than intentional misuse. Fairness as secondary risk captures the specific harm mechanism.",
    },
    scores: {
      overall: { value: 87, max: 100 },
      metrics: [
        {
          label: "Context Clarity",
          value: 38,
          max: 45,
          reasoning:
            "Solid article alignment with documented disparate impact findings in the pilot study.",
        },
        {
          label: "Keyword Matching",
          value: 17,
          max: 20,
          reasoning:
            "Keywords match hiring bias and screening terminology used throughout the source.",
        },
        {
          label: "Tagging Accuracy",
          value: 18,
          max: 20,
          reasoning:
            "Tags reflect Discrimination & Toxicity with Technical primary and Fairness secondary risks.",
        },
        {
          label: "Evidence Strength",
          value: 14,
          max: 15,
          reasoning:
            "Strong direct quotes on disparate pass rates and vendor acknowledgment of training-data bias.",
        },
      ],
      justification: {
        decision_rationale:
          "Scores reflect solid article alignment with documented disparate impact findings, with minor reductions for limited discussion of mitigation strategies in the source material.",
      },
    },
    evidence: {
      snippet:
        "Pilot study excerpt: automated screening tools produced statistically significant differences in pass rates across demographic groups when evaluated on identical qualification profiles with only name and gender attributes varied.",
      sources:
        "Researchers cite vendor documentation acknowledging that models trained on historical hiring data may encode prior hiring patterns, and note that fairness testing was not uniformly applied across participating employers.",
      dataToIdentifyRisk:
        "Disparate impact ratios by protected class; model feature importance logs; historical hire/ reject labels used in training; vendor fairness audit reports; and complaint records from applicants flagged by automated screening.",
      breakdown: [
        {
          field: "Attack Vector",
          strength: "Strong",
          sourceText:
            "Automated screening tools produced statistically significant differences in pass rates across demographic groups when evaluated on identical qualification profiles.",
          specificity: "Pilot study finding",
          taxonomyAlignment: "Discrimination & Toxicity",
        },
        {
          field: "Observable Indicators",
          strength: "Medium",
          sourceText:
            "Vendor documentation acknowledges that models trained on historical hiring data may encode prior hiring patterns.",
          specificity: "Secondary source cited in article",
        },
      ],
    },
  },
];

export function getRiskById(riskId: string | undefined): RiskDetail | undefined {
  if (!riskId) return undefined;
  const raw = decodeURIComponent(riskId).trim();
  return MOCK_RISK_ROWS.find(
    (row) =>
      row.id === raw ||
      formatRiskId(row) === raw ||
      formatRiskId(row.id) === raw,
  );
}

export type RiskListMetrics = {
  total: number;
  technical: number;
  operational: number;
  business: number;
};

export function normalizeRisksFromApi(raw: unknown): {
  risks: RiskDetail[];
  metrics: RiskListMetrics;
} {
  const data = raw as {
    risks?: RiskDetail[];
    metrics?: Partial<RiskListMetrics>;
  };

  const risks = (data.risks ?? []).map((r) => ({
    ...r,
    id: r.id ?? "",
    displayId: r.displayId?.trim() || undefined,
    title: r.title ?? "Untitled risk",
    domain: r.domain ?? "—",
    primaryRisk: r.primaryRisk ?? "—",
    secondaryRisk: r.secondaryRisk ?? "—",
    sector: r.sector ?? "—",
    industry: r.industry ?? "—",
    intent: r.intent ?? "—",
    qualityScore: r.qualityScore ?? "—",
    primaryKey: r.primaryKey ?? "technical",
    tagKey: r.tagKey ?? "general",
    confidence: r.confidence ?? "MEDIUM",
    description: r.description ?? "",
    attackVector: r.attackVector ?? "",
    observableIndicators: r.observableIndicators ?? "",
    timing: r.timing ?? "",
    articleId: r.articleId ?? undefined,
    articleTitle: r.articleTitle ?? "",
    articleUrl: r.articleUrl ?? "",
    ingestedAt: r.ingestedAt ?? "",
    createdAt: r.createdAt ?? r.ingestedAt ?? "",
    riskAnalysis: {
      ...(r.riskAnalysis ?? {
        risk_identified: "",
        article_context: "",
        alignment_reasoning: "",
      }),
      catalogMatches: r.riskAnalysis?.catalogMatches ?? [],
    },
    modelSelfEvaluation: r.modelSelfEvaluation ?? { decision_rationale: "" },
    scores: r.scores ?? {
      overall: { value: 0, max: 100 },
      metrics: [],
      justification: { decision_rationale: "" },
    },
    evidence: {
      snippet: r.evidence?.snippet ?? "",
      sources: r.evidence?.sources ?? "",
      dataToIdentifyRisk: r.evidence?.dataToIdentifyRisk ?? "",
      breakdown: r.evidence?.breakdown ?? [],
    },
    modelName: r.modelName ?? null,
    humanReview: {
      status: r.humanReview?.status ?? null,
      classification: r.humanReview?.classification ?? null,
      reviewedBy: r.humanReview?.reviewedBy ?? null,
      reviewedByUsername: r.humanReview?.reviewedByUsername ?? null,
      reviewedAt: r.humanReview?.reviewedAt ?? null,
      feedback: r.humanReview?.feedback ?? null,
    },
  }));

  return {
    risks,
    metrics: {
      total: data.metrics?.total ?? risks.length,
      technical: data.metrics?.technical ?? 0,
      operational: data.metrics?.operational ?? 0,
      business: data.metrics?.business ?? 0,
    },
  };
}

export function normalizeRiskDetailFromApi(raw: unknown): RiskDetail | null {
  const data = raw as { risk?: RiskDetail };
  if (!data.risk?.id) return null;
  return normalizeRisksFromApi({ risks: [data.risk] }).risks[0] ?? null;
}
