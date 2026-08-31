/**
 * Filtros — Health Score (V2).
 */
import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTER_OPTIONS,
  normalizeStatusFilter,
} from "./general-filters.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { programMatches } from "./filters/program.mjs";
import { healthScoreClassLabel } from "./health-score-metrics.mjs";

export { DEFAULT_STATUS_FILTER, STATUS_FILTER_OPTIONS, normalizeStatusFilter };

export const HEALTH_SCORE_CLASSIFICATION_FILTER_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "healthy", label: "Saudável" },
  { value: "attention", label: "Atenção" },
  { value: "critical", label: "Crítico" },
  { value: "no_data", label: "Sem dados" },
];

export function defaultHealthScoreFilters() {
  return {
    search: "",
    engineer: "all",
    program: "all",
    status: DEFAULT_STATUS_FILTER,
    classification: "all",
  };
}

export function normalizeClassificationFilter(value) {
  const raw = String(value || "all").trim().toLowerCase();
  if (["healthy", "attention", "critical", "no_data"].includes(raw)) return raw;
  return "all";
}

export function filterHealthScoreClients(clients, filters = {}) {
  const f = { ...defaultHealthScoreFilters(), ...filters };
  const statusFilter = normalizeStatusFilter(f.status);
  const classification = normalizeClassificationFilter(f.classification);
  return (Array.isArray(clients) ? clients : []).filter((row) => {
    if (!matchesAnalyticalStatusFilter(row.analyticalStatus, statusFilter)) return false;
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (!programMatches(row, f.program)) return false;
    if (!matchesSearch(row, f.search)) return false;
    if (classification !== "all" && row.classification !== classification) return false;
    return true;
  });
}

export function filterHealthScoreBaseClients(clients, filters = {}) {
  return filterHealthScoreClients(clients, { ...defaultHealthScoreFilters(), ...filters, classification: "all" });
}

export function uniqueFilterOptions(clients = []) {
  return {
    engineers: [...new Set(clients.map((c) => c.engineer).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    ),
    programs: [...new Set(clients.map((c) => c.program).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    ),
  };
}

export function classificationFilterLabel(value) {
  if (value === "all") return "Todas";
  return healthScoreClassLabel(value);
}
