import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { articles } from "../../schema/articles/articles.js";
import { jobs } from "../../schema/jobs/jobs.js";
import { risks } from "../../schema/risks/risks.js";
import { resolveQualityScore100 } from "../risks/riskQuality.js";

export type DashboardMetricCard = {
  value: string;
  sparkPoints: number[];
  trend: "up" | "down" | "neutral";
  changePct: string;
  changeAbs: string;
  footer: string;
};

export type DashboardSeverityRow = {
  key: string;
  label: string;
  color: string;
  pct: string;
  count: string;
  delta: string;
  deltaPct: string;
  trend: "up" | "down";
};

export type DashboardHeatmapRow = {
  label: string;
  values: [number, number, number, number, number, number, number];
  emphasizeTotal?: boolean;
};

export type DashboardTaxonomyItem = {
  key: string;
  count: number;
};

export type DashboardCategoryItem = {
  key: string;
  count: number;
  pct: number;
};

export type DashboardIndustryItem = {
  name: string;
  count: number;
};

export type DashboardStats = {
  metrics: {
    articles: DashboardMetricCard;
    risks: DashboardMetricCard;
    success: DashboardMetricCard;
    activity: DashboardMetricCard;
    avgTime: DashboardMetricCard;
    queue: DashboardMetricCard;
  };
  severity: {
    rows: DashboardSeverityRow[];
    total: number;
    totalDelta: number;
    totalDeltaPct: string;
    confidencePct: number;
  };
  /** Real likelihood×impact severity distribution (5×5 matrix bands). */
  riskRating: {
    rows: DashboardSeverityRow[];
    total: number;
    scored: number;
    unscored: number;
  };
  confidence: {
    avgPct: number;
    breakdown: { high: number; medium: number; low: number };
  };
  taxonomy: DashboardTaxonomyItem[];
  topCategories: DashboardCategoryItem[];
  sector: {
    total: number;
    private: number;
    public: number;
    nonprofit: number;
    industries: {
      private: DashboardIndustryItem[];
      public: DashboardIndustryItem[];
      nonprofit: DashboardIndustryItem[];
    };
  };
  heatmap: DashboardHeatmapRow[];
};

const TAXONOMY_KEYS = [
  "discrimination",
  "privacy",
  "misinformation",
  "malicious",
  "hci",
  "socioeconomic",
  "ai_safety",
] as const;

const HEATMAP_LABELS = [
  "This Week",
  "Last Week",
  "3 weeks ago",
  "4 weeks ago",
  "5 weeks ago",
  "6 weeks ago",
  "7 weeks ago",
  "8 weeks ago",
] as const;

function taxonomyKeyFromDomain(domain: string): (typeof TAXONOMY_KEYS)[number] | null {
  const d = domain.toLowerCase();
  if (d.includes("discrimination") || d.includes("toxicity")) return "discrimination";
  if (d.includes("privacy") || d.includes("security")) return "privacy";
  if (d.includes("misinformation")) return "misinformation";
  if (d.includes("malicious")) return "malicious";
  if (
    d.includes("human-computer") ||
    d.includes("hci") ||
    d.includes("interaction")
  ) {
    return "hci";
  }
  if (d.includes("socioeconomic") || d.includes("environmental")) {
    return "socioeconomic";
  }
  if (d.includes("safety") || d.includes("failure") || d.includes("limitation")) {
    return "ai_safety";
  }
  return null;
}

function sectorKey(
  sector: string | null,
): "private" | "public" | "nonprofit" | null {
  if (!sector) return null;
  const s = sector.toLowerCase();
  if (s.includes("private")) return "private";
  if (s.includes("public")) return "public";
  if (s.includes("nonprofit") || s.includes("non-profit")) return "nonprofit";
  return null;
}

function primaryCategoryKey(primary: string | null): "technical" | "operational" | "business" {
  const l = (primary ?? "").toLowerCase();
  if (l.includes("operational")) return "operational";
  if (l.includes("business")) return "business";
  return "technical";
}

function severityKey(score: number | null): "low" | "medium" | "high" | "critical" {
  if (score == null) return "low";
  // Accept both unit (0–1) and percent (0–100) quality scores.
  const pct = score <= 1 ? score * 100 : score;
  if (pct >= 90) return "critical";
  if (pct >= 75) return "high";
  if (pct >= 50) return "medium";
  return "low";
}

function confidenceKey(score: number | null): "high" | "medium" | "low" {
  if (score == null) return "low";
  const pct = score <= 1 ? score * 100 : score;
  if (pct >= 85) return "high";
  if (pct >= 65) return "medium";
  return "low";
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

function formatDelta(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("en-US")}`;
}

function trendFromDelta(delta: number): "up" | "down" | "neutral" {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "neutral";
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeekSunday(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

function buildWeeklySparkline(
  dailyMap: Map<string, number>,
  weeks: number,
): number[] {
  const now = new Date();
  const weekStart = startOfWeekSunday(now);
  const points: number[] = [];
  let cumulative = 0;

  for (let w = weeks - 1; w >= 0; w--) {
    let weekTotal = 0;
    const start = new Date(weekStart);
    start.setDate(start.getDate() - w * 7);
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + d);
      weekTotal += dailyMap.get(dateKey(day)) ?? 0;
    }
    cumulative += weekTotal;
    points.push(cumulative);
  }
  return points.length > 0 ? points : Array.from({ length: weeks }, () => 0);
}

function countInRange(
  dailyMap: Map<string, number>,
  start: Date,
  end: Date,
): number {
  let total = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  while (cur <= endDay) {
    total += dailyMap.get(dateKey(cur)) ?? 0;
    cur.setDate(cur.getDate() + 1);
  }
  return total;
}

function metricCardFromSeries(
  current: number,
  previous: number,
  sparkPoints: number[],
  formatValue: (n: number) => string,
  footerBuilder: (current: number, previous: number) => string,
): DashboardMetricCard {
  const delta = current - previous;
  const changePct =
    previous > 0
      ? formatPct((delta / previous) * 100)
      : current > 0
        ? formatPct(100)
        : "0.0%";

  return {
    value: formatValue(current),
    sparkPoints: sparkPoints.length > 0 ? sparkPoints : [0],
    trend: trendFromDelta(delta),
    changePct,
    changeAbs: formatDelta(delta),
    footer: footerBuilder(current, previous),
  };
}

function buildHeatmap(dailyRiskMap: Map<string, number>): DashboardHeatmapRow[] {
  const now = new Date();
  const thisWeekStart = startOfWeekSunday(now);

  return HEATMAP_LABELS.map((label, weekIndex) => {
    const values = [0, 0, 0, 0, 0, 0, 0] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const weekStart = new Date(thisWeekStart);
    weekStart.setDate(weekStart.getDate() - weekIndex * 7);

    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + d);
      values[d] = dailyRiskMap.get(dateKey(day)) ?? 0;
    }

    return {
      label,
      values,
      emphasizeTotal: weekIndex === 0,
    };
  });
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since56d = new Date(now.getTime() - 56 * 24 * 60 * 60 * 1000);
  const since84d = new Date(now.getTime() - 84 * 24 * 60 * 60 * 1000);

  const [articleAgg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      risksExtracted: sql<number>`coalesce(sum(${articles.riskCount}), 0)::int`,
    })
    .from(articles);

  const [jobAgg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${jobs.status} = 'pending')::int`,
      done: sql<number>`count(*) filter (where ${jobs.status} in ('done', 'completed'))::int`,
      done24h: sql<number>`count(*) filter (where ${jobs.status} in ('done', 'completed') and ${jobs.updatedAt} >= ${since24h})::int`,
      avgSeconds: sql<number | null>`avg(extract(epoch from (${jobs.updatedAt} - ${jobs.createdAt}))) filter (where ${jobs.status} in ('done', 'completed'))`,
    })
    .from(jobs);

  const articleDailyRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${articles.createdAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(articles)
    .where(sql`${articles.createdAt} >= ${since84d}`)
    .groupBy(sql`date_trunc('day', ${articles.createdAt})`);

  const riskDailyRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${risks.createdAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(risks)
    .where(sql`${risks.createdAt} >= ${since56d}`)
    .groupBy(sql`date_trunc('day', ${risks.createdAt})`);

  const riskRows = await db
    .select({
      domains: risks.domains,
      primaryRisk: risks.primaryRisk,
      sector: risks.sector,
      industry: risks.industry,
      qualityScore: risks.qualityScore,
      severityBand: risks.severityBand,
      extractionJson: risks.extractionJson,
      createdAt: risks.createdAt,
    })
    .from(risks);

  const articleDailyMap = new Map<string, number>();
  for (const row of articleDailyRows) {
    articleDailyMap.set(row.day, row.count);
  }

  const riskDailyMap = new Map<string, number>();
  for (const row of riskDailyRows) {
    riskDailyMap.set(row.day, row.count);
  }

  const totalArticles = articleAgg?.total ?? 0;
  const totalRisks = riskRows.length;
  const jobTotal = jobAgg?.total ?? 0;
  const jobDone = jobAgg?.done ?? 0;
  const successRate = jobTotal > 0 ? Math.round((jobDone / jobTotal) * 100) : 0;
  const pending = jobAgg?.pending ?? 0;
  const completed24h = jobAgg?.done24h ?? 0;
  const avgSeconds = Math.round(jobAgg?.avgSeconds ?? 0);

  const last7End = new Date(now);
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prev7End = new Date(last7Start.getTime() - 1);
  const prev7Start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const articlesLast7 = countInRange(articleDailyMap, last7Start, last7End);
  const articlesPrev7 = countInRange(articleDailyMap, prev7Start, prev7End);
  const risksLast7 = countInRange(riskDailyMap, last7Start, last7End);
  const risksPrev7 = countInRange(riskDailyMap, prev7Start, prev7End);

  const articleSpark = buildWeeklySparkline(articleDailyMap, 12);
  const riskSpark = buildWeeklySparkline(riskDailyMap, 12);

  const severityCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  const ratingCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  let ratingUnscored = 0;
  const confidenceCounts = { high: 0, medium: 0, low: 0 };
  const taxonomyCounts = Object.fromEntries(
    TAXONOMY_KEYS.map((k) => [k, 0]),
  ) as Record<(typeof TAXONOMY_KEYS)[number], number>;
  const categoryCounts = { technical: 0, operational: 0, business: 0 };
  const sectorCounts = { private: 0, public: 0, nonprofit: 0 };
  const industryBySector: Record<
    "private" | "public" | "nonprofit",
    Map<string, number>
  > = {
    private: new Map(),
    public: new Map(),
    nonprofit: new Map(),
  };

  let scoreSum = 0;
  let scoreCount = 0;

  for (const row of riskRows) {
    const score = resolveQualityScore100({
      qualityScore: row.qualityScore,
      extractionJson: row.extractionJson,
    });
    severityCounts[severityKey(score)] += 1;
    confidenceCounts[confidenceKey(score)] += 1;

    const band = (row.severityBand ?? "").toLowerCase();
    if (band === "low" || band === "medium" || band === "high" || band === "critical") {
      ratingCounts[band] += 1;
    } else {
      ratingUnscored += 1;
    }

    if (score != null) {
      scoreSum += score;
      scoreCount += 1;
    }

    const domainKey = taxonomyKeyFromDomain(row.domains ?? "");
    if (domainKey) taxonomyCounts[domainKey] += 1;

    categoryCounts[primaryCategoryKey(row.primaryRisk)] += 1;

    const sk = sectorKey(row.sector);
    if (sk) {
      sectorCounts[sk] += 1;
      const industry = (row.industry ?? "").trim();
      if (industry) {
        const map = industryBySector[sk];
        map.set(industry, (map.get(industry) ?? 0) + 1);
      }
    }
  }

  const severityTotal = totalRisks;
  const severityColors: Record<string, string> = {
    low: "#22c55e",
    medium: "#eab308",
    high: "#f97316",
    critical: "#ef4444",
  };
  const severityLabels: Record<string, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    critical: "Critical",
  };

  const severityRows: DashboardSeverityRow[] = (
    ["low", "medium", "high", "critical"] as const
  ).map((key) => {
    const count = severityCounts[key];
    const pct =
      severityTotal > 0 ? (count / severityTotal) * 100 : 0;
    return {
      key,
      label: severityLabels[key],
      color: severityColors[key],
      pct: formatPct(pct, 0),
      count: formatCount(count),
      delta: "0",
      deltaPct: "(0.0%)",
      trend: "up" as const,
    };
  });

  const ratingScored =
    ratingCounts.low + ratingCounts.medium + ratingCounts.high + ratingCounts.critical;
  const ratingRows: DashboardSeverityRow[] = (
    ["low", "medium", "high", "critical"] as const
  ).map((key) => {
    const count = ratingCounts[key];
    const pct = ratingScored > 0 ? (count / ratingScored) * 100 : 0;
    return {
      key,
      label: severityLabels[key],
      color: severityColors[key],
      pct: formatPct(pct, 0),
      count: formatCount(count),
      delta: "0",
      deltaPct: "(0.0%)",
      trend: "up" as const,
    };
  });

  const avgConfidence =
    scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : 0;

  const categoryTotal = totalRisks;
  const topCategories: DashboardCategoryItem[] = (
    ["technical", "operational", "business"] as const
  ).map((key) => {
    const count = categoryCounts[key];
    return {
      key,
      count,
      pct:
        categoryTotal > 0
          ? Math.round((count / categoryTotal) * 1000) / 10
          : 0,
    };
  });

  function topIndustries(
    map: Map<string, number>,
    limit = 5,
  ): DashboardIndustryItem[] {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }

  const sectorTotal = sectorCounts.private + sectorCounts.public + sectorCounts.nonprofit;

  return {
    metrics: {
      articles: metricCardFromSeries(
        totalArticles,
        articlesPrev7,
        articleSpark,
        (n) => formatCount(n),
        (cur, prev) => `Previous period: ${formatCount(prev)} · Last 7d: +${articlesLast7}`,
      ),
      risks: metricCardFromSeries(
        totalRisks,
        risksPrev7,
        riskSpark,
        (n) => formatCount(n),
        (cur, prev) => `Previous period: ${formatCount(prev)} · Last 7d: +${risksLast7}`,
      ),
      success: {
        value: `${successRate}%`,
        sparkPoints: [successRate],
        trend: "neutral",
        changePct: "0.0%",
        changeAbs: "0",
        footer: `${formatCount(jobDone)} of ${formatCount(jobTotal)} jobs completed`,
      },
      activity: metricCardFromSeries(
        completed24h,
        0,
        [completed24h],
        (n) => formatCount(n),
        () =>
          `~${(completed24h / 24).toFixed(1)}/hour avg`,
      ),
      avgTime: {
        value: `${avgSeconds}s`,
        sparkPoints: [avgSeconds],
        trend: "neutral",
        changePct: "0.0%",
        changeAbs: "0",
        footer: avgSeconds > 0 ? "Completed jobs only" : "No completed jobs yet",
      },
      queue: metricCardFromSeries(
        pending,
        0,
        [pending],
        (n) => formatCount(n),
        () =>
          pending > 0
            ? `Est. ${Math.max(1, Math.round(pending * (avgSeconds || 30) / 60))}min to clear`
            : "Queue is clear",
      ),
    },
    severity: {
      rows: severityRows,
      total: severityTotal,
      totalDelta: risksLast7 - risksPrev7,
      totalDeltaPct:
        risksPrev7 > 0
          ? formatPct(((risksLast7 - risksPrev7) / risksPrev7) * 100)
          : risksLast7 > 0
            ? formatPct(100)
            : "0.0%",
      confidencePct: avgConfidence,
    },
    riskRating: {
      rows: ratingRows,
      total: totalRisks,
      scored: ratingScored,
      unscored: ratingUnscored,
    },
    confidence: {
      avgPct: avgConfidence,
      breakdown: confidenceCounts,
    },
    taxonomy: TAXONOMY_KEYS.map((key) => ({
      key,
      count: taxonomyCounts[key],
    })),
    topCategories,
    sector: {
      total: sectorTotal,
      private: sectorCounts.private,
      public: sectorCounts.public,
      nonprofit: sectorCounts.nonprofit,
      industries: {
        private: topIndustries(industryBySector.private),
        public: topIndustries(industryBySector.public),
        nonprofit: topIndustries(industryBySector.nonprofit),
      },
    },
    heatmap: buildHeatmap(riskDailyMap),
  };
}
