import { authFetch } from "../../../utils/authFetch";

export type ObservabilityHourlyPoint = {
  hour: number;
  label: string;
  extractions: number;
  words: number;
  tokensGenerated: number;
};

export type ObservabilityTableRow = {
  id: number;
  modelName: string;
  url: string;
  wordCount: number;
  tokensGenerated: number;
  wordsPerSecond: number;
  wordsPerMinute: number;
  durationMs: number;
  createdAt: string;
};

export type ObservabilityDayStats = {
  date: string;
  dataSource?: "metrics" | "risks";
  summary: {
    totalExtractions: number;
    totalWords: number;
    totalTokens: number;
    avgWordsPerSecond: number;
    avgWordsPerMinute: number;
  };
  charts: {
    hourly: ObservabilityHourlyPoint[];
  };
  rows: ObservabilityTableRow[];
};

export async function fetchObservabilityStats(
  date?: string,
): Promise<ObservabilityDayStats> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  const res = await authFetch(`/observability${qs}`);
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      body.error?.message ?? `Failed to load observability (${res.status})`,
    );
  }
  return body as ObservabilityDayStats;
}
