/**
 * Filtros — Cancelamento (V2).
 * População de processo/cancelamento — sem active-first forçado.
 *
 * Período:
 * - efetivados → cancellationDate (data analítica consolidada, com data confirmada)
 * - intenções → intencaoAt
 * - pedidos → pedidoAt
 */
import {
  STATUS_FILTER_OPTIONS,
  normalizeStatusFilter,
} from "./general-filters.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { programMatches } from "./filters/program.mjs";
import { defaultPeriodState, inPeriod, resolvePeriod } from "./filters/period.mjs";

export { STATUS_FILTER_OPTIONS, normalizeStatusFilter };

export function defaultCancellationFilters() {
  return {
    search: "",
    status: "all",
    engineer: "all",
    segment: "all",
    program: "all",
    ...defaultPeriodState(),
  };
}

export function cancellationEffectiveDate(row) {
  if (!row?.hasEfetivado) return null;
  if (row.hasConfirmedDate === false || row.effectiveWithoutConfirmedDate) return null;
  return row.cancellationDate || null;
}

export function rowInCancellationPeriod(row, period, { includeInProcess = false } = {}) {
  if (!period?.active) return true;
  if (includeInProcess && row.inProcessCurrently) return true;
  const effective = cancellationEffectiveDate(row);
  if (effective && inPeriod(effective, period)) return true;
  const intencaoAt = row.intencaoAt || null;
  if (intencaoAt && inPeriod(intencaoAt, period)) return true;
  const pedidoAt = row.pedidoAt || null;
  if (pedidoAt && inPeriod(pedidoAt, period)) return true;
  return false;
}

export function filterCancellationClients(clients, filters = {}, options = {}) {
  const f = { ...defaultCancellationFilters(), ...filters };
  const statusFilter = normalizeStatusFilter(f.status);
  const period = resolvePeriod(f, options.now || new Date());
  const includeInProcess = options.includeInProcessDespitePeriod !== false;
  return (Array.isArray(clients) ? clients : []).filter((row) => {
    if (!matchesAnalyticalStatusFilter(row.analyticalStatus, statusFilter)) return false;
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (f.segment !== "all" && row.segment !== f.segment) return false;
    if (!programMatches(row, f.program)) return false;
    if (period.active && !rowInCancellationPeriod(row, period, { includeInProcess })) return false;
    if (!matchesSearch(row, f.search)) return false;
    return true;
  });
}

export function filterCancellationEffectiveRows(clients, filters = {}, options = {}) {
  const base = filterCancellationClients(clients, filters, options);
  const period = resolvePeriod(filters, options.now || new Date());
  return base.filter((row) => {
    if (!row.hasEfetivado) return false;
    if (!period.active) return true;
    const effective = cancellationEffectiveDate(row);
    return Boolean(effective && inPeriod(effective, period));
  });
}

export function sortCancellationClients(rows, sortKey = "clientName", sortDir = "asc") {
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
