/**
 * Filtros do Resumo Executivo — sem período global.
 */
import { DEFAULT_STATUS_FILTER } from "./general-filters.mjs";
import { normalizeProgramFilter } from "./filters/program.mjs";

export function defaultExecutiveSummaryFilters() {
  return {
    search: "",
    program: "all",
    engineer: "all",
    segment: "all",
    status: DEFAULT_STATUS_FILTER,
  };
}

export function executiveFiltersToDomain(filters = {}, domain = "general") {
  const base = {
    search: filters.search || "",
    program: normalizeProgramFilter(filters.program || "all"),
    engineer: filters.engineer || "all",
    segment: filters.segment || "all",
  };
  switch (domain) {
    case "general":
      return {
        ...base,
        status: filters.status || DEFAULT_STATUS_FILTER,
        contract: "all",
        cancel: "all",
        stay: "all",
        periodPreset: "all",
        periodFrom: "",
        periodTo: "",
      };
    case "journey":
    case "meetings":
    case "financial_updates":
    case "mechanisms":
      return { ...base, status: filters.status || DEFAULT_STATUS_FILTER, periodPreset: "all", periodFrom: "", periodTo: "" };
    case "satisfaction":
    case "renewal":
    case "ep_performance":
      return { ...base, status: "all", renewed: "all" };
    case "cancellations":
      return { ...base, status: "all", periodPreset: "all", periodFrom: "", periodTo: "" };
    case "temporal_indicators":
      return {
        search: base.search,
        program: base.program,
        source: "all",
        month: "all",
        cancelWindow: "all",
      };
    default:
      return base;
  }
}

export function executiveFiltersToSearchParams(filters = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.program && filters.program !== "all") params.set("program", normalizeProgramFilter(filters.program));
  if (filters.engineer && filters.engineer !== "all") params.set("engineer", filters.engineer);
  if (filters.segment && filters.segment !== "all") params.set("segment", filters.segment);
  if (filters.status && filters.status !== DEFAULT_STATUS_FILTER) params.set("status", filters.status);
  return params;
}

export function buildExecutiveSummaryApiUrl(filters = {}, { force = false } = {}) {
  const params = executiveFiltersToSearchParams(filters);
  if (force) params.set("force", "1");
  const qs = params.toString();
  return qs ? `/api/dashboard?page=executive_summary&${qs}` : "/api/dashboard?page=executive_summary";
}
