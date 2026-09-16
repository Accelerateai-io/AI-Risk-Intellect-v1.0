import { FilterX, Search } from "lucide-react";

interface RiskListFiltersProps {
  baseId: string;
  primaryRisk: string;
  tag: string;
  order: string;
  searchQuery: string;
  onPrimaryRiskChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onOrderChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onClearFilters: () => void;
  searchAriaLabel?: string;
}

export function RiskListFilters({
  baseId,
  primaryRisk,
  tag,
  order,
  searchQuery,
  onPrimaryRiskChange,
  onTagChange,
  onOrderChange,
  onSearchChange,
  onClearFilters,
  searchAriaLabel = "Search risks",
}: RiskListFiltersProps) {
  const filterId = (name: string) => `${baseId}-${name}`;

  return (
    <section className="riskPage__filters" aria-label="Filter risks">
      <div className="riskPage__filter">
        <label htmlFor={filterId("primary")}>PRIMARY RISK</label>
        <select
          id={filterId("primary")}
          value={primaryRisk}
          onChange={(e) => onPrimaryRiskChange(e.target.value)}
        >
          <option value="all">All</option>
          <option value="technical">Technical</option>
          <option value="operational">Operational</option>
          <option value="business">Business</option>
        </select>
      </div>
      <div className="riskPage__filter">
        <label htmlFor={filterId("tag")}>TAG</label>
        <select
          id={filterId("tag")}
          value={tag}
          onChange={(e) => onTagChange(e.target.value)}
        >
          <option value="all">All</option>
          <option value="bias">Bias</option>
          <option value="privacy">Privacy</option>
          <option value="safety">Safety</option>
          <option value="misinformation">Misinformation</option>
        </select>
      </div>
      <div className="riskPage__filter">
        <label htmlFor={filterId("order")}>ORDER</label>
        <select
          id={filterId("order")}
          value={order}
          onChange={(e) => onOrderChange(e.target.value)}
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="score">Highest score</option>
          <option value="severity">Highest severity</option>
        </select>
      </div>
      <button
        type="button"
        className="riskPage__clearBtn"
        onClick={onClearFilters}
        aria-label="Clear Filter"
        data-tooltip="Clear Filter"
      >
        <FilterX size={18} strokeWidth={2} aria-hidden />
      </button>
      <div className="riskPage__searchWrap">
        <Search
          className="riskPage__searchIcon"
          size={18}
          strokeWidth={2}
          aria-hidden
        />
        <input
          id={filterId("search")}
          type="search"
          className="riskPage__searchInput"
          placeholder="Search ID, title, domain, sector…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
          aria-label={searchAriaLabel}
        />
      </div>
    </section>
  );
}
