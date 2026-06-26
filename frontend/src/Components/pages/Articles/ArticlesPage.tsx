import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  ExternalLink,
  FileText,
  FilterX,
  RefreshCw,
  Search,
  Shield,
} from "lucide-react";
import { authFetch } from "../../../utils/authFetch";
import { formatDisplayDate } from "../../../utils/formatDate";
import { setDocumentPageTitle } from "../../../utils/pageTitle";
import { usePagination } from "../../../utils/usePagination";
import { PageHeader } from "../../Layout/PageHeader";
import { DataTablePagination } from "../../common/DataTablePagination";
import "../Users/usersPage.css";
import "../Jobs/jobsPage.css";
import "./articlesPage.css";

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  risks: number;
  created: string;
  createdAt: string;
};

type ArticleMetrics = {
  total: number;
  risksExtracted: number;
  avgRisksPerArticle: number;
};

function normalizeArticlesFromApi(raw: unknown): {
  articles: ArticleRow[];
  metrics: ArticleMetrics;
} {
  const data = raw as {
    articles?: Array<{
      id?: number;
      title?: string | null;
      url?: string;
      riskCount?: number;
      createdAt?: string;
    }>;
    metrics?: Partial<ArticleMetrics>;
  };

  const articles: ArticleRow[] = (data.articles ?? []).map((a) => ({
    id: a.id ?? 0,
    title: a.title?.trim() || "Untitled",
    url: a.url ?? "",
    risks: a.riskCount ?? 0,
    created: a.createdAt ? formatDisplayDate(a.createdAt) : "—",
    createdAt: a.createdAt ?? "",
  }));

  return {
    articles,
    metrics: {
      total: data.metrics?.total ?? articles.length,
      risksExtracted: data.metrics?.risksExtracted ?? 0,
      avgRisksPerArticle: data.metrics?.avgRisksPerArticle ?? 0,
    },
  };
}

export function ArticlesPage() {
  const baseId = useId();
  const [searchQuery, setSearchQuery] = useState("");
  const [risksFilter, setRisksFilter] = useState<"all" | "with" | "none">("all");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<ArticleRow[]>([]);
  const [metrics, setMetrics] = useState<ArticleMetrics>({
    total: 0,
    risksExtracted: 0,
    avgRisksPerArticle: 0,
  });
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [articlePageSize, setArticlePageSize] = useState(10);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setRisksFilter("all");
    setOrder("newest");
  }, []);

  const loadArticles = useCallback(async () => {
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      setRows([]);
      setLoadState("idle");
      return;
    }

    setLoadState("loading");
    try {
      const res = await authFetch("/articles");
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (res.status === 401) {
        setLoadState("idle");
        return;
      }
      if (!res.ok) {
        setLoadState("error");
        toast.error(
          data.error?.message ?? "Could not load articles.",
          { autoClose: 3000 },
        );
        return;
      }
      const parsed = normalizeArticlesFromApi(data);
      setRows(parsed.articles);
      setMetrics(parsed.metrics);
      setLoadState("idle");
    } catch {
      setLoadState("error");
      toast.error("Network error while loading articles.", { autoClose: 3000 });
    }
  }, []);

  useEffect(() => {
    setDocumentPageTitle("Articles");
    void loadArticles();
  }, [loadArticles]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let filtered = rows;

    if (risksFilter === "with") {
      filtered = filtered.filter((a) => a.risks > 0);
    } else if (risksFilter === "none") {
      filtered = filtered.filter((a) => a.risks === 0);
    }

    if (q) {
      filtered = filtered.filter((a) => {
        const hay = [
          String(a.id),
          a.title,
          a.url,
          String(a.risks),
          a.created,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const copy = [...filtered];
    copy.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return order === "newest" ? bTime - aTime : aTime - bTime;
    });
    return copy;
  }, [rows, searchQuery, risksFilter, order]);

  const articlePager = usePagination({
    items: visibleRows,
    pageSize: articlePageSize,
    resetKey: `${searchQuery}|${risksFilter}|${order}`,
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadArticles();
    setRefreshing(false);
    toast.success("Articles list refreshed.", { autoClose: 2000 });
  }, [loadArticles]);

  const filterId = (name: string) => `${baseId}-${name}`;

  return (
    <main className="mainLayout__content articlesPage jobsPage">
      <PageHeader
        title="Articles"
        subtitle="Source articles and documents."
        actions={
          <button
            type="button"
            className="usersPage__inviteBtn"
            onClick={() => void handleRefresh()}
            disabled={refreshing || loadState === "loading"}
            aria-busy={refreshing || loadState === "loading"}
          >
            <RefreshCw
              size={18}
              strokeWidth={2}
              className={
                refreshing || loadState === "loading"
                  ? "pageHeader__refreshIcon--spin"
                  : undefined
              }
              aria-hidden
            />
            Refresh
          </button>
        }
      />

      <div className="articlesPage__metrics">
        <article className="articlesPage__metric articlesPage__metric--total">
          <div className="articlesPage__metricInner">
            <div className="articlesPage__metricCopy">
              <p className="articlesPage__metricLabel">Total articles</p>
              <p className="articlesPage__metricValue">{metrics.total}</p>
            </div>
            <div className="articlesPage__metricIcon articlesPage__metricIcon--blue">
              <FileText size={22} strokeWidth={2} aria-hidden />
            </div>
          </div>
        </article>
        <article className="articlesPage__metric articlesPage__metric--risks">
          <div className="articlesPage__metricInner">
            <div className="articlesPage__metricCopy">
              <p className="articlesPage__metricLabel">Risks extracted</p>
              <p className="articlesPage__metricValue">{metrics.risksExtracted}</p>
            </div>
            <div className="articlesPage__metricIcon articlesPage__metricIcon--orange">
              <Shield size={22} strokeWidth={2} aria-hidden />
            </div>
          </div>
        </article>
        <article className="articlesPage__metric articlesPage__metric--avg">
          <div className="articlesPage__metricInner">
            <div className="articlesPage__metricCopy">
              <p className="articlesPage__metricLabel">Avg risks/article</p>
              <p className="articlesPage__metricValue articlesPage__metricValue--tabular">
                {metrics.avgRisksPerArticle.toFixed(1)}
              </p>
            </div>
            <div className="articlesPage__metricIcon articlesPage__metricIcon--slate">
              <FileText size={22} strokeWidth={2} aria-hidden />
            </div>
          </div>
        </article>
      </div>

      <section className="jobsPage__filters" aria-label="Filter articles">
        <div className="jobsPage__filter">
          <label htmlFor={filterId("risks")}>RISKS</label>
          <select
            id={filterId("risks")}
            value={risksFilter}
            onChange={(e) => {
              const value = e.target.value;
              setRisksFilter(
                value === "with" || value === "none" ? value : "all",
              );
            }}
          >
            <option value="all">All</option>
            <option value="with">Has risks</option>
            <option value="none">No risks</option>
          </select>
        </div>
        <div className="jobsPage__filter">
          <label htmlFor={filterId("order")}>ORDER</label>
          <select
            id={filterId("order")}
            value={order}
            onChange={(e) =>
              setOrder(e.target.value === "oldest" ? "oldest" : "newest")
            }
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
        <button
          type="button"
          className="jobsPage__clearBtn"
          onClick={clearFilters}
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
            placeholder="Search title, URL, ID…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            enterKeyHint="search"
            aria-label="Search articles"
          />
        </div>
      </section>

      <section
        className="articlesPage__tableSection"
        aria-label="Articles table"
      >
        <div className="articlesPage__tableWrap">
          <div className="articlesPage__tableScroll">
            <table className="articlesPage__table">
              <thead>
                <tr>
                  <th scope="col" className="articlesPage__th">
                    ID
                  </th>
                  <th scope="col" className="articlesPage__th">
                    Title
                  </th>
                  <th scope="col" className="articlesPage__th">
                    URL
                  </th>
                  <th scope="col" className="articlesPage__th articlesPage__th--narrow">
                    Risks
                  </th>
                  <th scope="col" className="articlesPage__th">
                    Created
                  </th>
                  <th scope="col" className="articlesPage__th articlesPage__th--actions">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loadState === "loading" ? (
                  <tr>
                    <td className="articlesPage__td articlesPage__td--empty" colSpan={6}>
                      Loading articles…
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td className="articlesPage__td articlesPage__td--empty" colSpan={6}>
                      {searchQuery.trim() || risksFilter !== "all"
                        ? "No articles match your filters or search."
                        : loadState === "error"
                          ? "Could not load articles."
                          : "No articles to display."}
                    </td>
                  </tr>
                ) : (
                  articlePager.pageItems.map((row) => (
                    <tr key={row.id}>
                      <td className="articlesPage__td">
                        <span className="articlesPage__id">#{row.id}</span>
                      </td>
                      <td className="articlesPage__td articlesPage__td--title">
                        {row.title}
                      </td>
                      <td className="articlesPage__td articlesPage__td--url">
                        <a
                          href={row.url}
                          className="articlesPage__url"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row.url}
                        </a>
                      </td>
                      <td className="articlesPage__td articlesPage__td--center">
                        {row.risks}
                      </td>
                      <td className="articlesPage__td articlesPage__td--muted">
                        {row.created}
                      </td>
                      <td className="articlesPage__td articlesPage__td--actions">
                        <a
                          href={row.url}
                          className="articlesPage__actionLink"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink size={14} strokeWidth={2} aria-hidden />
                          Open
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <DataTablePagination
            className="articlesPage__pager"
            page={articlePager.page}
            pageCount={articlePager.pageCount}
            total={articlePager.total}
            pageSize={articlePager.pageSize}
            from={articlePager.from}
            to={articlePager.to}
            onPageChange={articlePager.setPage}
            onPageSizeChange={setArticlePageSize}
          />
        </div>
      </section>
    </main>
  );
}
