/**
 * Filtros — Atualização Financeira (V2).
 * Default: clientes ativos (active-first permitido nesta página).
 *
 * Multiselect financeiro: OR entre opções; AND com demais filtros.
 * Período: eventos usam financialUpdateDate (updated_at > created_at).
 */
import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTER_OPTIONS,
  normalizeStatusFilter,
} from "./general-filters.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { normalizeProgramFilter, programMatches } from "./filters/program.mjs";
import { defaultPeriodState, inPeriod, resolvePeriod } from "./filters/period.mjs";
import { multiSelectOrMatch, normalizeMultiSelectFilter } from "./filters/multiselect.mjs";

export { DEFAULT_STATUS_FILTER, STATUS_FILTER_OPTIONS, normalizeStatusFilter };

export const FINANCIAL_TRAIT_OPTIONS = [
  { value: "hasFinancialData", label: "Possui dados financeiros" },
  { value: "hasLiquidityReserve", label: "Possui reserva de liquidez" },
  { value: "hasMonthlyIncome", label: "Possui renda mensal" },
  { value: "hasLastContribution", label: "Possui último aporte" },
];

const FINANCIAL_TRAIT_MATCHERS = {
  hasFinancialData: (row) => row.hasFinancialData === true,
  hasLiquidityReserve: (row) => row.liquidityReserve != null,
  hasMonthlyIncome: (row) => row.monthlyIncome != null,
  hasLastContribution: (row) => row.lastContribution != null,
};

export function defaultFinancialUpdatesFilters() {
  return {
    search: "",
    status: DEFAULT_STATUS_FILTER,
    engineer: "all",
    segment: "all",
    program: "all",
    financialTraits: [],
    ...defaultPeriodState(),
  };
}

export function filterFinancialUpdateClients(clients, filters = {}) {
  const f = { ...defaultFinancialUpdatesFilters(), ...filters };
  const statusFilter = normalizeStatusFilter(f.status);
  const traits = normalizeMultiSelectFilter(f.financialTraits);
  return (Array.isArray(clients) ? clients : []).filter((row) => {
    if (!matchesAnalyticalStatusFilter(row.analyticalStatus, statusFilter)) return false;
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (f.segment !== "all" && row.segment !== f.segment) return false;
    if (!programMatches(row, f.program)) return false;
    if (traits.length && !multiSelectOrMatch(row, traits, FINANCIAL_TRAIT_MATCHERS)) return false;
    if (!matchesSearch(row, f.search)) return false;
    return true;
  });
}

/** Eventos de atualização financeira real (updated_at > created_at) recortados pelo período. */
export function filterFinancialUpdateEvents(clients, filters = {}, options = {}) {
  const base = filterFinancialUpdateClients(clients, filters);
  const period = resolvePeriod(filters, options.now || new Date());
  if (!period.active) return base;
  return base.filter(
    (row) =>
      row.hasPostCreationUpdate
      && row.financialUpdateDate
      && inPeriod(row.financialUpdateDate, period),
  );
}

export function sortFinancialUpdateClients(rows, sortKey = "clientName", sortDir = "asc") {
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
