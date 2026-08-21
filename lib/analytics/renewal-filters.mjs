/**
 * Filtros — Renovação (V2).
 * Elegíveis por ciclo válido; sem active-first forçado.
 *
 * Renovou?: Sim = ciclo > 1; Não = ciclo = 1 (somente ciclo válido).
 */
import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTER_OPTIONS,
  normalizeStatusFilter,
} from "./general-filters.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { programMatches } from "./filters/program.mjs";

export { DEFAULT_STATUS_FILTER, STATUS_FILTER_OPTIONS, normalizeStatusFilter };

export const RENEWED_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "yes", label: "Sim" },
  { value: "no", label: "Não" },
];

export function defaultRenewalFilters() {
  return {
    search: "",
    status: "all",
    engineer: "all",
    segment: "all",
    program: "all",
    renewed: "all",
  };
}

function matchesRenewedFilter(row, renewed) {
  if (!renewed || renewed === "all") return true;
  if (!row.cycleValid) return false;
  if (renewed === "yes") return row.renewed === true;
  if (renewed === "no") return row.currentCycle === 1;
  return true;
}

export function filterRenewalClients(clients, filters = {}) {
  const f = { ...defaultRenewalFilters(), ...filters };
  const statusFilter = normalizeStatusFilter(f.status);
  return (Array.isArray(clients) ? clients : []).filter((row) => {
    if (!matchesAnalyticalStatusFilter(row.analyticalStatus, statusFilter)) return false;
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (f.segment !== "all" && row.segment !== f.segment) return false;
    if (!programMatches(row, f.program)) return false;
    if (!matchesRenewedFilter(row, f.renewed)) return false;
    if (!matchesSearch(row, f.search)) return false;
    return true;
  });
}

export function sortRenewalClients(rows, sortKey = "clientName", sortDir = "asc") {
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
