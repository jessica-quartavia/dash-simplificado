/**
 * Filtros da página Implementação de Mecanismos.
 * Default: Ativos (analyticalStatus === "Ativo").
 *
 * Mecanismo multiselect: OR entre mecanismos; AND com demais filtros.
 * Programa filtra população consolidada — não seleciona banco de origem.
 */
import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTER_OPTIONS,
  normalizeStatusFilter,
} from "./general-filters.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { COUNT_BANDS } from "./mechanism-metrics.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { defaultPeriodState, inPeriod, monthKeyInPeriod, resolvePeriod } from "./filters/period.mjs";
import { programMatches } from "./filters/program.mjs";
import { normalizeMultiSelectFilter } from "./filters/multiselect.mjs";

export { DEFAULT_STATUS_FILTER, STATUS_FILTER_OPTIONS, normalizeStatusFilter };

export const MECH_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "Apto", label: "Apto" },
  { value: "Em andamento", label: "Em andamento" },
  { value: "Implementado", label: "Implementado" },
  { value: "Não informado", label: "Não informado" },
];

export const COUNT_FILTER_OPTIONS = [
  { value: "all", label: "Todas" },
  ...COUNT_BANDS.map((value) => ({ value, label: value })),
];

export const YES_NO_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "yes", label: "Sim" },
  { value: "no", label: "Não" },
];

export function defaultMechanismFilters() {
  return {
    search: "",
    status: DEFAULT_STATUS_FILTER,
    engineer: "all",
    segment: "all",
    program: "all",
    mechStatus: "all",
    mechanism: [],
    category: "all",
    countBand: "all",
    hasImpl: "all",
    ...defaultPeriodState(),
  };
}

function matchesMechanisms(row, selectedMechanisms) {
  const selected = normalizeMultiSelectFilter(selectedMechanisms);
  if (!selected.length) return true;
  const mechs = row.mechanisms || [];
  return mechs.some(
    (m) => selected.includes(String(m.mechanismId)) || selected.includes(String(m.name)),
  );
}

function rowHasImplementedMechanism(row) {
  return (row.mechanisms || []).some((m) => m.status === "Implementado");
}

export function filterMechanismClients(clients, filters = {}) {
  const f = { ...defaultMechanismFilters(), ...filters };
  const statusFilter = normalizeStatusFilter(f.status);
  return (Array.isArray(clients) ? clients : []).filter((row) => {
    if (!matchesAnalyticalStatusFilter(row.analyticalStatus, statusFilter)) return false;
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (f.segment !== "all" && row.segment !== f.segment) return false;
    if (!programMatches(row, f.program)) return false;
    if (f.countBand !== "all" && row.mechanismsCountBand !== f.countBand) return false;
    if (f.hasImpl === "yes" && !rowHasImplementedMechanism(row)) return false;
    if (f.hasImpl === "no" && rowHasImplementedMechanism(row)) return false;
    const mechs = row.mechanisms || [];
    if (f.mechStatus !== "all" && !mechs.some((m) => m.status === f.mechStatus)) return false;
    if (!matchesMechanisms(row, f.mechanism)) return false;
    if (f.category !== "all" && !mechs.some((m) => (m.dimension || "Não informado") === f.category)) return false;
    if (!matchesSearch(row, f.search)) return false;
    return true;
  });
}

/**
 * Eventos de implementação no tempo. Não remove o vínculo atual do estoque.
 */
export function filterMechanismMonthSeries(clients, filters = {}, options = {}) {
  const period = resolvePeriod(filters, options.now || new Date());
  const rows = filterMechanismClients(clients, filters);
  const monthMap = new Map();
  for (const row of rows) {
    for (const mech of row.mechanisms || []) {
      if (mech.status !== "Implementado") continue;
      if (period.active) {
        if (mech.implementedAt && !inPeriod(mech.implementedAt, period)) continue;
        else if (!mech.implementedAt && !monthKeyInPeriod(mech.implementedMonth, period)) continue;
      }
      const key = mech.implementedMonth;
      if (!key) continue;
      monthMap.set(key, (monthMap.get(key) || 0) + 1);
    }
  }
  return [...monthMap.keys()].sort().map((label) => ({
    label,
    count: monthMap.get(label) || 0,
  }));
}

export function filterPortfolio(portfolio, filters = {}) {
  const f = { ...defaultMechanismFilters(), ...filters };
  const statusFilter = normalizeStatusFilter(f.status);
  return (Array.isArray(portfolio) ? portfolio : []).filter((row) => {
    if (!matchesAnalyticalStatusFilter(row.analyticalStatus, statusFilter)) return false;
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (f.segment !== "all" && row.segment !== f.segment) return false;
    return true;
  });
}

export function portfolioSize(portfolio) {
  return (Array.isArray(portfolio) ? portfolio : []).reduce(
    (sum, row) => sum + (Number(row?.count) || 1),
    0,
  );
}
