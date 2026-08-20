/**
 * Filtros da página Jornada e Onboarding.
 * Default V2: Ativos (analyticalStatus === "Ativo").
 */
import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTER_OPTIONS,
  normalizeStatusFilter,
} from "./general-filters.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { defaultPeriodState, inPeriod, resolvePeriod } from "./filters/period.mjs";

export { DEFAULT_STATUS_FILTER, STATUS_FILTER_OPTIONS, normalizeStatusFilter };

export const COMPLETION_FILTER_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "yes", label: "Concluiu" },
  { value: "no", label: "Não concluiu" },
  { value: "unevaluable", label: "Não avaliável" },
];

export function defaultOnboardingFilters() {
  return {
    search: "",
    status: DEFAULT_STATUS_FILTER,
    engineer: "all",
    completion: "all",
    ...defaultPeriodState(),
  };
}

function matchesCompletion(row, completion) {
  if (!completion || completion === "all") return true;
  if (completion === "yes") return row.completedOnboarding === true;
  if (completion === "no") return row.completedOnboarding === false;
  if (completion === "unevaluable") return row.completedOnboarding == null;
  return true;
}

export function filterOnboardingClients(clients, filters = {}, options = {}) {
  const f = { ...defaultOnboardingFilters(), ...filters };
  const statusFilter = normalizeStatusFilter(f.status);
  const period = resolvePeriod(f, options.now || new Date());
  return (Array.isArray(clients) ? clients : []).filter((row) => {
    if (!matchesAnalyticalStatusFilter(row.analyticalStatus, statusFilter)) return false;
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (!matchesCompletion(row, f.completion)) return false;
    if (period.active && !inPeriod(row.contractDate, period)) return false;
    if (!matchesSearch(row, f.search)) return false;
    return true;
  });
}

export function sortOnboardingClients(rows, sortKey = "clientName", sortDir = "asc") {
  const list = [...(rows || [])];
  list.sort((a, b) => {
    const av = a?.[sortKey];
    const bv = b?.[sortKey];
    let cmp = 0;
    if (av == null && bv == null) cmp = 0;
    else if (av == null) cmp = 1;
    else if (bv == null) cmp = -1;
    else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else if (typeof av === "boolean" && typeof bv === "boolean") cmp = Number(av) - Number(bv);
    else cmp = String(av).localeCompare(String(bv), "pt-BR", { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });
  return list;
}
