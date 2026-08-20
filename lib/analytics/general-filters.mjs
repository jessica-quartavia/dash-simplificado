/**
 * Filtros de Dados Gerais.
 * O status analítico já vem do kernel — este módulo só recorta a lista.
 *
 * Default V2: Ativos (analyticalStatus === "Ativo"). Congelado não entra.
 * Período global NÃO recorta estoque; só aquisição (ver filterGeneralAcquisitionRows).
 */
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { programMatches, programTokensFromRow } from "./filters/program.mjs";
import { defaultPeriodState, inPeriod, resolvePeriod } from "./filters/period.mjs";

export const DEFAULT_STATUS_FILTER = "active";

export const STATUS_FILTER_OPTIONS = [
  { value: "active", label: "Ativos" },
  { value: "active_or_frozen", label: "Ativos e congelados" },
  { value: "frozen", label: "Congelados" },
  { value: "cancelled", label: "Cancelados" },
  { value: "cancelled_no_date", label: "Cancelados sem confirmação" },
  { value: "unknown", label: "Não informado" },
  { value: "all", label: "Todos" },
];

const ALLOWED_STATUS = new Set(STATUS_FILTER_OPTIONS.map((o) => o.value));

export function defaultGeneralFilters() {
  return {
    search: "",
    status: DEFAULT_STATUS_FILTER,
    segment: "all",
    engineer: "all",
    program: "all",
    contract: "all",
    cancel: "all",
    stay: "all",
    ...defaultPeriodState(),
  };
}

export function normalizeStatusFilter(value) {
  return ALLOWED_STATUS.has(value) ? value : DEFAULT_STATUS_FILTER;
}

function monthsAgo(n, now = new Date()) {
  const d = new Date(now);
  d.setMonth(d.getMonth() - n);
  return d;
}

export function inDateBand(iso, band, now = new Date()) {
  if (!band || band === "all") return true;
  if (band === "none" || band === "missing") return !iso;
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  if (band === "last3") return d >= monthsAgo(3, now);
  if (band === "last6") return d >= monthsAgo(6, now);
  if (band === "last12") return d >= monthsAgo(12, now);
  if (band === "older12") return d < monthsAgo(12, now);
  return true;
}

export function programTokens(row) {
  return programTokensFromRow(row);
}

export { programMatches };

export function segmentLabelOf(client) {
  return client?.segmentLabel || client?.segment || "Dados insuficientes";
}

/**
 * Recorta a carteira. `ignoreStatus` é exclusivo do gráfico histórico de aquisição.
 */
export function filterGeneralClients(clients, filters = {}, options = {}) {
  const f = { ...defaultGeneralFilters(), ...filters };
  const statusFilter = options.ignoreStatus ? "all" : normalizeStatusFilter(f.status);
  const now = options.now || new Date();

  return (Array.isArray(clients) ? clients : []).filter((c) => {
    if (!matchesAnalyticalStatusFilter(c.analyticalStatus, statusFilter)) return false;
    if (f.segment !== "all" && segmentLabelOf(c) !== f.segment) return false;
    if (f.engineer !== "all" && c.engineer !== f.engineer) return false;
    if (!programMatches(c, f.program)) return false;
    if (f.stay !== "all" && c.stayRange !== f.stay) return false;
    if (!inDateBand(c.contractDate, f.contract, now)) return false;
    if (f.cancel === "none") {
      if (c.cancellationDate) return false;
    } else if (!inDateBand(c.cancellationDate, f.cancel, now)) {
      return false;
    }
    if (!matchesSearch(c, f.search)) return false;
    return true;
  });
}

/**
 * Aquisição histórica: ignora status (já existente) e aplica o período global
 * na data de contratação. Não usar para cards de estoque.
 */
export function filterGeneralAcquisitionRows(clients, filters = {}, options = {}) {
  const rows = filterGeneralClients(clients, filters, { ...options, ignoreStatus: true });
  const period = resolvePeriod(filters, options.now || new Date());
  if (!period.active) return rows;
  return rows.filter((row) => inPeriod(row.acquisitionDate || row.contractDate, period));
}

export function sortGeneralClients(rows, sortKey = "clientName", sortDir = "asc") {
  const list = [...rows];
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
