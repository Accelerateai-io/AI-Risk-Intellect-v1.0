import { useCallback, useEffect, useId, useMemo, useState } from "react";
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
import { usePagination } from "../../../utils/usePagination";
import { PageHeader } from "../../Layout/PageHeader";
import "../Users/usersPage.css";
import { authFetch } from "../../../utils/authFetch";
import { formatDisplayDate } from "../../../utils/formatDate";
import {
  normalizeRisksFromApi,
  type RiskDetail,
  type RiskListMetrics,
} from "./riskData";
import { RiskListFilters } from "./RiskListFilters";
import { RiskRecordsTable } from "./RiskRecordsTable";
import { riskMatchesFilters, sortRiskRows } from "./riskListHelpers";
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

export function RiskPage() {
  const baseId = useId();
  const [primaryRisk, setPrimaryRisk] = useState("all");
  const [tag, setTag] = useState("all");
  const [order, setOrder] = useState("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [riskPageSize, setRiskPageSize] = useState(10);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<RiskRow[]>([]);
  const [metrics, setMetrics] = useState<RiskListMetrics>({
    total: 0,
    technical: 0,
    operational: 0,
    business: 0,
  });
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "idle",
  );

  const loadRisks = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      setRows([]);
      setLoadState("idle");
      return;
    }

    setLoadState("loading");
    try {
      const res = await authFetch("/risks");
      if (!res.ok) {
        setLoadState("error");
        return;
      }
      const data = normalizeRisksFromApi(await res.json());
      setRows(
        data.risks.map((r) => {
          const createdAt = r.createdAt ?? r.ingestedAt;
          return {
            ...r,
            createdAt,
            ingestedAt: createdAt ? formatDisplayDate(createdAt) : "—",
          };
        }),
      );
      setMetrics(data.metrics);
      setLoadState("idle");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadRisks();
  }, [loadRisks]);

  const displayMetrics = useMemo(() => buildRiskMetrics(metrics), [metrics]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        riskMatchesFilters(row, primaryRisk, tag, searchQuery),
      ),
    [rows, primaryRisk, tag, searchQuery],
  );

  const sortedRows = useMemo(
    () => sortRiskRows(filteredRows, order),
    [filteredRows, order],
  );

  const pager = usePagination({
    items: sortedRows,
    pageSize: riskPageSize,
    resetKey: `${primaryRisk}|${tag}|${order}|${searchQuery}`,
  });

  useEffect(() => {
    setDocumentPageTitle("Risks");
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRisks();
    setRefreshing(false);
    toast.success("Risk list refreshed.", { autoClose: 2000 });
  }, [loadRisks]);

  const handleExport = useCallback(() => {
    toast.info("Export is not connected to the API yet.", {
      autoClose: 3000,
    });
  }, []);

  const clearFilters = useCallback(() => {
    setPrimaryRisk("all");
    setTag("all");
    setOrder("newest");
    setSearchQuery("");
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
              onClick={handleExport}
            >
              <Download size={18} strokeWidth={2} aria-hidden />
              Export
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
        onPrimaryRiskChange={setPrimaryRisk}
        onTagChange={setTag}
        onOrderChange={setOrder}
        onSearchChange={setSearchQuery}
        onClearFilters={clearFilters}
      />

      <RiskRecordsTable
        rows={pager.pageItems}
        loadState={loadState}
        searchQuery={searchQuery}
        page={pager.page}
        pageCount={pager.pageCount}
        total={pager.total}
        pageSize={pager.pageSize}
        from={pager.from}
        to={pager.to}
        onPageChange={pager.setPage}
        onPageSizeChange={setRiskPageSize}
      />
    </main>
  );
}
