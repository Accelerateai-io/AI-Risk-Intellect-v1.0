import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Download,
  Eye,
  RefreshCw,
  Shield,
} from "lucide-react";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import { PageHeader } from "../../Layout/PageHeader";
import "../Users/usersPage.css";
import { authFetch } from "../../../utils/authFetch";
import { formatDisplayDate } from "../../../utils/formatDate";
import { exportRisksToExcel } from "../../../utils/risksExportApi";
import {
  normalizeRisksFromApi,
  type RiskDetail,
  type RiskListMetrics,
} from "./riskData";
import { RiskListFilters } from "./RiskListFilters";
import { RiskRecordsTable } from "./RiskRecordsTable";
import "./riskPage.css";

type RiskMetric = {
  key: string;
  label: string;
  value: string;
  Icon: LucideIcon;
  variant: "total" | "technical" | "operational" | "business";
};

function buildRiskMetrics(m: RiskListMetrics): RiskMetric[] {
  return [
    {
      key: "total",
      label: "TOTAL RISKS",
      value: String(m.total),
      Icon: Shield,
      variant: "total",
    },
    {
      key: "technical",
      label: "TECHNICAL RISKS",
      value: String(m.technical),
      Icon: AlertTriangle,
      variant: "technical",
    },
    {
      key: "operational",
      label: "OPERATIONAL RISKS",
      value: String(m.operational),
      Icon: AlertTriangle,
      variant: "operational",
    },
    {
      key: "business",
      label: "BUSINESS RISKS",
      value: String(m.business),
      Icon: Eye,
      variant: "business",
    },
  ];
}

type RiskRow = RiskDetail;

function mapRiskListRows(risks: RiskDetail[]): RiskRow[] {
  return risks.map((r) => {
    const createdAt = r.createdAt ?? r.ingestedAt;
    return {
      ...r,
      createdAt,
      ingestedAt: createdAt ? formatDisplayDate(createdAt) : "—",
    };
  });
}

function riskListCacheKey(input: {
  page: number;
  pageSize: number;
  primaryRisk: string;
  tag: string;
  order: string;
  search: string;
}): string {
  return `${input.page}|${input.pageSize}|${input.primaryRisk}|${input.tag}|${input.order}|${input.search}`;
}

export function RiskPage() {
  const baseId = useId();
  const [primaryRisk, setPrimaryRisk] = useState("all");
  const [tag, setTag] = useState("all");
  const [order, setOrder] = useState("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [riskPageSize, setRiskPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<RiskRow[]>([]);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [metrics, setMetrics] = useState<RiskListMetrics>({
    total: 0,
    technical: 0,
    operational: 0,
    business: 0,
  });
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [exportPending, setExportPending] = useState(false);
  const [tableBusy, setTableBusy] = useState(false);
  const loadGen = useRef(0);
  const metricsGen = useRef(0);
  const hasRowsRef = useRef(false);
  const pageCacheRef = useRef<
    Map<string, { rows: RiskRow[]; total: number; metrics?: RiskListMetrics }>
  >(new Map());
  hasRowsRef.current = rows.length > 0;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const prevSearchRef = useRef(debouncedSearch);
  useEffect(() => {
    if (prevSearchRef.current === debouncedSearch) return;
    prevSearchRef.current = debouncedSearch;
    setFilteredTotal(0);
    setPage(0);
  }, [debouncedSearch]);

  const riskListParams = useCallback(
    (targetPage: number, includeMetrics: boolean, limit = riskPageSize) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(targetPage * riskPageSize),
        order,
        includeMetrics: includeMetrics ? "1" : "0",
      });
      if (primaryRisk !== "all") params.set("primaryKey", primaryRisk);
      if (tag !== "all") params.set("tag", tag);
      const q = debouncedSearch.trim();
      if (q) params.set("search", q);
      return params;
    },
    [debouncedSearch, order, primaryRisk, riskPageSize, tag],
  );

  const rememberPage = useCallback(
    (key: string, entry: { rows: RiskRow[]; total: number; metrics?: RiskListMetrics }) => {
      pageCacheRef.current.set(key, entry);
      while (pageCacheRef.current.size > 24) {
        const first = pageCacheRef.current.keys().next().value;
        if (first === undefined) break;
        pageCacheRef.current.delete(first);
      }
    },
    [],
  );

  const loadRiskMetrics = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) return;
    const gen = ++metricsGen.current;
    try {
      const res = await authFetch(`/risks?${riskListParams(0, true, 0).toString()}`);
      if (!res.ok || gen !== metricsGen.current) return;
      const parsed = normalizeRisksFromApi(await res.json());
      if (gen !== metricsGen.current) return;
      setMetrics(parsed.metrics);
      setFilteredTotal(parsed.total);
    } catch {
      /* table rows still render without metric cards */
    }
  }, [riskListParams]);

  const loadRisks = useCallback(
    async (targetPage: number, background = false) => {
      const token = sessionStorage.getItem("accessToken");
      if (!token) {
        if (!background) {
          setRows([]);
          setLoadState("idle");
          setTableBusy(false);
        }
        return;
      }

      const key = riskListCacheKey({
        page: targetPage,
        pageSize: riskPageSize,
        primaryRisk,
        tag,
        order,
        search: debouncedSearch.trim(),
      });
      const cached = pageCacheRef.current.get(key);
      if (cached) {
        if (!background) {
          setRows(cached.rows);
          if (cached.total > 0) setFilteredTotal(cached.total);
          if (cached.metrics) setMetrics(cached.metrics);
          setLoadState("idle");
          setTableBusy(false);
        }
        return;
      }

      let gen = loadGen.current;
      if (!background) {
        gen = ++loadGen.current;
        setTableBusy(hasRowsRef.current);
        if (!hasRowsRef.current) setLoadState("loading");
      }
      try {
        const res = await authFetch(
          `/risks?${riskListParams(targetPage, false).toString()}`,
        );
        if (!res.ok) {
          if (!background && gen === loadGen.current) {
            setLoadState("error");
            setTableBusy(false);
          }
          return;
        }
        const parsed = normalizeRisksFromApi(await res.json());
        const mapped = mapRiskListRows(parsed.risks);
        const estimatedTotal =
          targetPage * riskPageSize + mapped.length + (parsed.hasMore ? 1 : 0);
        rememberPage(key, { rows: mapped, total: estimatedTotal });
        if (background || gen !== loadGen.current) return;
        setRows(mapped);
        setFilteredTotal((prev) => (prev > 0 ? prev : estimatedTotal));
        setLoadState("idle");
        setTableBusy(false);
      } catch {
        if (!background && gen === loadGen.current) {
          setLoadState("error");
          setTableBusy(false);
        }
      }
    },
    [debouncedSearch, order, primaryRisk, rememberPage, riskListParams, riskPageSize, tag],
  );

  useEffect(() => {
    void loadRisks(page, false);
  }, [loadRisks, page]);

  useEffect(() => {
    void loadRiskMetrics();
  }, [loadRiskMetrics]);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(filteredTotal / riskPageSize));
    if (page + 1 < pageCount) {
      void loadRisks(page + 1, true);
    }
  }, [filteredTotal, loadRisks, page, riskPageSize]);

  const displayMetrics = useMemo(() => buildRiskMetrics(metrics), [metrics]);

  const pageCount = Math.max(1, Math.ceil(filteredTotal / riskPageSize));
  const safePage = Math.min(page, pageCount - 1);
  const from = filteredTotal === 0 ? 0 : safePage * riskPageSize + 1;
  const to = Math.min((safePage + 1) * riskPageSize, filteredTotal);

  useEffect(() => {
    setDocumentPageTitle("Risks");
  }, []);

  const handleRefresh = useCallback(async () => {
    pageCacheRef.current.clear();
    setRefreshing(true);
    await Promise.all([loadRisks(page, false), loadRiskMetrics()]);
    setRefreshing(false);
    toast.success("Risk list refreshed.", { autoClose: 2000 });
  }, [loadRiskMetrics, loadRisks, page]);

  const handleExport = useCallback(async () => {
    if (exportPending) return;
    setExportPending(true);
    try {
      const result = await exportRisksToExcel();
      if (!result.ok) {
        toast.error(result.message, { autoClose: 3000 });
        return;
      }
      toast.success(`Exported ${result.fileName}.`, { autoClose: 2800 });
    } finally {
      setExportPending(false);
    }
  }, [exportPending]);

  const clearFilters = useCallback(() => {
    setPrimaryRisk("all");
    setTag("all");
    setOrder("newest");
    setSearchQuery("");
    setDebouncedSearch("");
    setFilteredTotal(0);
    setPage(0);
  }, []);

  return (
    <main className="mainLayout__content riskPage">
      <PageHeader
        title="Risks"
        subtitle="AI risk extractions and analysis"
        actions={
          <>
            <button
              type="button"
              className="usersPage__inviteBtn"
              onClick={handleRefresh}
              disabled={refreshing}
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
            <button
              type="button"
              className="usersPage__inviteBtn"
              onClick={() => void handleExport()}
              disabled={exportPending}
              aria-busy={exportPending}
            >
              <Download size={18} strokeWidth={2} aria-hidden />
              {exportPending ? "Exporting…" : "Export"}
            </button>
          </>
        }
      />

      <div className="riskPage__grid">
        {displayMetrics.map((m) => (
          <article
            key={m.key}
            className={`riskPage__card riskPage__card--${m.variant}`}
          >
            <div className={`riskPage__cardIcon riskPage__cardIcon--${m.variant}`}>
              <m.Icon size={22} strokeWidth={2} aria-hidden />
            </div>
            <div className="riskPage__cardBody">
              <p className="riskPage__cardLabel">{m.label}</p>
              <p className="riskPage__cardValue">{m.value}</p>
            </div>
          </article>
        ))}
      </div>

      <RiskListFilters
        baseId={baseId}
        primaryRisk={primaryRisk}
        tag={tag}
        order={order}
        searchQuery={searchQuery}
        onPrimaryRiskChange={(value) => {
          setPrimaryRisk(value);
          setFilteredTotal(0);
          setPage(0);
        }}
        onTagChange={(value) => {
          setTag(value);
          setFilteredTotal(0);
          setPage(0);
        }}
        onOrderChange={(value) => {
          setOrder(value);
          setPage(0);
        }}
        onSearchChange={setSearchQuery}
        onClearFilters={clearFilters}
      />

      <RiskRecordsTable
        rows={rows}
        loadState={loadState}
        tableBusy={tableBusy}
        searchQuery={searchQuery}
        page={safePage}
        pageCount={pageCount}
        total={filteredTotal}
        pageSize={riskPageSize}
        from={from}
        to={to}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setRiskPageSize(size);
          setPage(0);
        }}
      />
    </main>
  );
}
