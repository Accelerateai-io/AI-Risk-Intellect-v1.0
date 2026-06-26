import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "react-toastify";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Clock,
  Cpu,
  ExternalLink,
  FileText,
  Gauge,
  LineChart,
  FilterX,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";
import { PageHeader } from "../../Layout/PageHeader";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import { usePolling } from "../../../utils/usePolling";
import { usePagination } from "../../../utils/usePagination";
import { formatRelativeDate } from "../../../utils/formatDate";
import { DataTablePagination } from "../../common/DataTablePagination";
import {
  fetchObservabilityStats,
  type ObservabilityDayStats,
  type ObservabilityTableRow,
} from "./observabilityData";
import { DayLineChart } from "./DayLineChart";
import "../Users/usersPage.css";
import "../Jobs/jobsPage.css";
import "./observabilityPage.css";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIsoDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path =
      u.pathname.length > 36 ? `${u.pathname.slice(0, 33)}…` : u.pathname;
    const host = u.hostname.replace(/^www\./, "");
    return path === "/" ? host : `${host}${path}`;
  } catch {
    return url.length > 52 ? `${url.slice(0, 49)}…` : url;
  }
}

function rowMatchesSearch(row: ObservabilityTableRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.modelName, row.url, String(row.wordCount), String(row.tokensGenerated)]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function rowMatchesFilters(
  row: ObservabilityTableRow,
  modelFilter: string,
  searchQuery: string,
): boolean {
  if (modelFilter !== "all" && row.modelName !== modelFilter) {
    return false;
  }
  return rowMatchesSearch(row, searchQuery);
}

type MetricAccent = "blue" | "amber" | "violet" | "green" | "cyan";

type MetricDef = {
  key: keyof ObservabilityDayStats["summary"];
  label: string;
  hint: string;
  accent: MetricAccent;
  Icon: LucideIcon;
  format: (summary: ObservabilityDayStats["summary"]) => string;
};

const METRIC_DEFS: MetricDef[] = [
  {
    key: "totalExtractions",
    label: "Extractions",
    hint: "Risk runs completed",
    accent: "blue",
    Icon: Activity,
    format: (s) => formatCount(s.totalExtractions),
  },
  {
    key: "totalWords",
    label: "Words processed",
    hint: "Input article text",
    accent: "green",
    Icon: FileText,
    format: (s) => formatCount(s.totalWords),
  },
  {
    key: "totalTokens",
    label: "Tokens generated",
    hint: "LLM output tokens",
    accent: "amber",
    Icon: Cpu,
    format: (s) => formatCount(s.totalTokens),
  },
  {
    key: "avgWordsPerSecond",
    label: "Avg words / sec",
    hint: "Tokenization throughput",
    accent: "cyan",
    Icon: Gauge,
    format: (s) => String(s.avgWordsPerSecond),
  },
  {
    key: "avgWordsPerMinute",
    label: "Avg words / min",
    hint: "Tokenization throughput",
    accent: "violet",
    Icon: Clock,
    format: (s) => String(s.avgWordsPerMinute),
  },
];

function MetricCard({
  def,
  summary,
  loading,
}: {
  def: MetricDef;
  summary: ObservabilityDayStats["summary"] | undefined;
  loading: boolean;
}) {
  const Icon = def.Icon;
  return (
    <article className="obsMetricCard">
      <span
        className={`obsMetricCard__icon obsMetricCard__icon--${def.accent}`}
        aria-hidden
      >
        <Icon size={22} strokeWidth={2} />
      </span>
      <div className="obsMetricCard__body">
        <p className="obsMetricCard__label">{def.label}</p>
        <p className="obsMetricCard__value">
          {loading || !summary ? "—" : def.format(summary)}
        </p>
        <p className="obsMetricCard__hint">{def.hint}</p>
      </div>
    </article>
  );
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <tr key={i} className="observabilityPage__skeletonRow">
          <td colSpan={7}>
            <div className="observabilityPage__skeletonBar" />
          </td>
        </tr>
      ))}
    </>
  );
}

export function ObservabilityPage() {
  const baseId = useId();
  const [selectedDate, setSelectedDate] = useState(todayIsoDate);
  const [stats, setStats] = useState<ObservabilityDayStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modelFilter, setModelFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [rowPageSize, setRowPageSize] = useState(10);

  const filterId = (name: string) => `${baseId}-${name}`;

  useEffect(() => {
    setDocumentPageTitle("Observability");
  }, []);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      try {
        const data = await fetchObservabilityStats(selectedDate);
        setStats(data);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load observability";
        if (!silent) {
          toast.error(message, { autoClose: 3500 });
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedDate],
  );

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    setModelFilter("all");
    setSearchQuery("");
  }, [selectedDate]);

  usePolling(() => load({ silent: true }), 30_000);

  const handleRefresh = () => {
    setRefreshing(true);
    void load({ silent: true });
  };

  const hourlyLabels = useMemo(
    () => stats?.charts.hourly.map((p) => p.label) ?? [],
    [stats],
  );

  const wordsSeries = useMemo(
    () => stats?.charts.hourly.map((p) => p.words) ?? [],
    [stats],
  );

  const tokensSeries = useMemo(
    () => stats?.charts.hourly.map((p) => p.tokensGenerated) ?? [],
    [stats],
  );

  const extractionsSeries = useMemo(
    () => stats?.charts.hourly.map((p) => p.extractions) ?? [],
    [stats],
  );

  const modelOptions = useMemo(() => {
    if (!stats) return [];
    const names = new Set(stats.rows.map((row) => row.modelName).filter(Boolean));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [stats]);

  const filteredRows = useMemo(() => {
    if (!stats) return [];
    return stats.rows.filter((row) =>
      rowMatchesFilters(row, modelFilter, searchQuery),
    );
  }, [stats, modelFilter, searchQuery]);

  const pager = usePagination({
    items: filteredRows,
    pageSize: rowPageSize,
    resetKey: `${selectedDate}|${modelFilter}|${searchQuery}`,
  });

  const clearTableFilters = () => {
    setModelFilter("all");
    setSearchQuery("");
  };

  const isToday = selectedDate === todayIsoDate();
  const isYesterday = selectedDate === yesterdayIsoDate();
  const showInitialLoad = loading && !stats;
  const filtersDisabled = showInitialLoad || !stats;

  return (
    <main className="mainLayout__content observabilityPage jobsPage">
      <PageHeader
        title="Observability"
        subtitle="LLM extraction throughput, token usage, and per-URL performance"
        actions={
          <>
            <span className="observabilityPage__live" role="status">
              <span className="observabilityPage__liveDot" aria-hidden />
              Auto-refresh 30s
            </span>
            <button
              type="button"
              className="usersPage__inviteBtn"
              onClick={handleRefresh}
              disabled={refreshing || showInitialLoad}
              aria-busy={refreshing}
            >
              <RefreshCw
                size={18}
                strokeWidth={2}
                className={refreshing ? "pageHeader__refreshIcon--spin" : undefined}
                aria-hidden
              />
              Refresh
            </button>
          </>
        }
      />

      <div className="observabilityPage__filters">
        <div className="observabilityPage__filtersRow">
          <div className="observabilityPage__dateField">
            <span className="observabilityPage__dateLabel">Report day (UTC)</span>
            <input
              id="obs-date"
              type="date"
              className="observabilityPage__dateInput"
              value={selectedDate}
              max={todayIsoDate()}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="observabilityPage__quickDates" role="group" aria-label="Quick dates">
            <button
              type="button"
              className={`observabilityPage__quickBtn${isToday ? " observabilityPage__quickBtn--active" : ""}`}
              onClick={() => setSelectedDate(todayIsoDate())}
            >
              Today
            </button>
            <button
              type="button"
              className={`observabilityPage__quickBtn${isYesterday ? " observabilityPage__quickBtn--active" : ""}`}
              onClick={() => setSelectedDate(yesterdayIsoDate())}
            >
              Yesterday
            </button>
          </div>
        </div>
      </div>

      <div className="observabilityPage__summary" role="group" aria-label="Day summary">
        {METRIC_DEFS.map((def) => (
          <MetricCard
            key={def.key}
            def={def}
            summary={stats?.summary}
            loading={showInitialLoad}
          />
        ))}
      </div>

      {!showInitialLoad && stats && stats.summary.totalExtractions === 0 ? (
        <p className="observabilityPage__sectionMeta" style={{ marginTop: "-0.5rem" }}>
          No extractions on this UTC day. Try Yesterday or run a new risk extraction job.
        </p>
      ) : null}

      <section aria-labelledby="obs-charts-title">
        <div className="observabilityPage__sectionHead">
          <h2 id="obs-charts-title" className="observabilityPage__sectionTitle">
            <LineChart size={17} strokeWidth={2} aria-hidden />
            Hourly activity
          </h2>
          <p className="observabilityPage__sectionMeta">
            24-hour UTC buckets
            {stats?.dataSource === "risks"
              ? " · estimated from stored risks"
              : stats?.dataSource === "metrics"
                ? " · live extraction metrics"
                : ""}
          </p>
        </div>
        <div className="observabilityPage__charts">
          <DayLineChart
            title="Words processed"
            subtitle="Article text tokenized per hour"
            color="#3b82f6"
            labels={hourlyLabels}
            values={wordsSeries}
            valueFormatter={formatCount}
            loading={showInitialLoad}
          />
          <DayLineChart
            title="Tokens generated"
            subtitle="LLM output tokens per hour"
            color="#f59e0b"
            labels={hourlyLabels}
            values={tokensSeries}
            valueFormatter={formatCount}
            loading={showInitialLoad}
          />
          <DayLineChart
            title="Extractions"
            subtitle="Completed risk extractions per hour"
            color="#10b981"
            labels={hourlyLabels}
            values={extractionsSeries}
            valueFormatter={formatCount}
            loading={showInitialLoad}
          />
        </div>
      </section>

      <section aria-labelledby="obs-table-title">
        <div className="observabilityPage__sectionHead">
          <h2 id="obs-table-title" className="observabilityPage__sectionTitle">
            <BarChart3 size={17} strokeWidth={2} aria-hidden />
            Extraction details
          </h2>
          <p className="observabilityPage__sectionMeta">
            {stats
              ? `${filteredRows.length} of ${stats.rows.length} runs`
              : "Per URL metrics"}
          </p>
        </div>
      </section>

      <section className="jobsPage__filters" aria-label="Filter extractions">
        <div className="jobsPage__filter">
          <label htmlFor={filterId("model")}>MODEL</label>
          <select
            id={filterId("model")}
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            disabled={filtersDisabled}
          >
            <option value="all">All</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="jobsPage__clearBtn"
          onClick={clearTableFilters}
          disabled={filtersDisabled}
          aria-label="Clear Filter"
          data-tooltip="Clear Filter"
        >
          <FilterX size={18} strokeWidth={2} aria-hidden />
        </button>
        <div className="jobsPage__searchWrap">
          <Search
            className="jobsPage__searchIcon"
            size={18}
            strokeWidth={2}
            aria-hidden
          />
          <input
            id={filterId("search")}
            type="search"
            className="jobsPage__searchInput"
            placeholder="Search URL, model…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={filtersDisabled}
            autoComplete="off"
            enterKeyHint="search"
            aria-label="Search extractions"
          />
        </div>
      </section>

      <section className="jobsPage__tableSection" aria-label="Extraction details table">
        <div className="observabilityPage__tablePanel">
          <div className="observabilityPage__tableWrap">
            {showInitialLoad ? (
              <table className="observabilityPage__table">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">URL</th>
                    <th scope="col">Words</th>
                    <th scope="col">Tokens</th>
                    <th scope="col">Words / sec</th>
                    <th scope="col">Words / min</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  <TableSkeleton />
                </tbody>
              </table>
            ) : !stats ? (
              <div className="observabilityPage__empty">
                <p className="observabilityPage__emptyTitle">Could not load metrics</p>
                <p className="observabilityPage__emptyDesc">
                  Check that the API is running and you are signed in, then refresh.
                </p>
              </div>
            ) : stats.rows.length === 0 ? (
              <div className="observabilityPage__empty">
                <span className="observabilityPage__emptyIcon" aria-hidden>
                  <Zap size={24} strokeWidth={2} />
                </span>
                <p className="observabilityPage__emptyTitle">No data for this day</p>
                <p className="observabilityPage__emptyDesc">
                  No extractions were recorded on {formatDisplayDate(stats.date)}.
                  Run jobs on the Jobs page to extract risks and populate metrics.
                </p>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="observabilityPage__empty">
                <p className="observabilityPage__emptyTitle">No matching rows</p>
                <p className="observabilityPage__emptyDesc">
                  No rows match your filters or search. Try another model or clear
                  the filters.
                </p>
              </div>
            ) : (
              <table className="observabilityPage__table">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">URL</th>
                    <th scope="col">Words</th>
                    <th scope="col">Tokens</th>
                    <th scope="col">Words / sec</th>
                    <th scope="col">Words / min</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span
                          className="observabilityPage__modelBadge"
                          title={row.modelName}
                        >
                          {row.modelName}
                        </span>
                      </td>
                      <td className="observabilityPage__urlCell">
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="observabilityPage__urlLink"
                          title={row.url}
                        >
                          <span className="observabilityPage__urlText">
                            {displayUrl(row.url)}
                          </span>
                          <ExternalLink size={14} strokeWidth={2} aria-hidden />
                        </a>
                      </td>
                      <td className="observabilityPage__num">
                        {formatCount(row.wordCount)}
                      </td>
                      <td className="observabilityPage__num">
                        {formatCount(row.tokensGenerated)}
                      </td>
                      <td className="observabilityPage__num">
                        {row.wordsPerSecond}
                      </td>
                      <td className="observabilityPage__num">
                        {row.wordsPerMinute}
                      </td>
                      <td className="observabilityPage__num">
                        {formatRelativeDate(row.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <DataTablePagination
            className="usersPage__pager"
            page={pager.page}
            pageCount={pager.pageCount}
            total={pager.total}
            pageSize={pager.pageSize}
            from={pager.from}
            to={pager.to}
            onPageChange={pager.setPage}
            onPageSizeChange={setRowPageSize}
          />
        </div>
      </section>
    </main>
  );
}
