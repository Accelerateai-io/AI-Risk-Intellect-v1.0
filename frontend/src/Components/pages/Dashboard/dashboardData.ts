import { authFetch } from "../../../utils/authFetch";

export type DashboardApiStats = {
  metrics: Record<
    string,
    {
      value: string;
      sparkPoints: number[];
      trend: "up" | "down" | "neutral";
      changePct: string;
      changeAbs: string;
      footer: string;
    }
  >;
  severity: {
    rows: Array<{
      key: string;
      label: string;
      color: string;
      pct: string;
      count: string;
      delta: string;
      deltaPct: string;
      trend: "up" | "down";
    }>;
    total: number;
    totalDelta: number;
    totalDeltaPct: string;
    confidencePct: number;
  };
  confidence: {
    avgPct: number;
    breakdown: { high: number; medium: number; low: number };
  };
  taxonomy: Array<{ key: string; count: number }>;
  topCategories: Array<{ key: string; count: number; pct: number }>;
  sector: {
    total: number;
    private: number;
    public: number;
    nonprofit: number;
    industries: {
      private: Array<{ name: string; count: number }>;
      public: Array<{ name: string; count: number }>;
      nonprofit: Array<{ name: string; count: number }>;
    };
  };
  heatmap: Array<{
    label: string;
    values: [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    emphasizeTotal?: boolean;
  }>;
};

export async function fetchDashboardStats(): Promise<DashboardApiStats> {
  const res = await authFetch("/dashboard");
  if (!res.ok) {
    throw new Error(`Failed to load dashboard (${res.status})`);
  }
  return res.json() as Promise<DashboardApiStats>;
}
