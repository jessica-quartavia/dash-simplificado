/**
 * Filtros do Plano Patrimonial.
 * Histórico da carteira completa — sem active-first.
 */
import { matchesSearch } from "./filters/search.mjs";
import { defaultPeriodState, inPeriod, resolvePeriod } from "./filters/period.mjs";
import { medianDays, meanDays } from "./patrimonial-plan.mjs";
import { programMatches } from "./filters/program.mjs";

export function defaultPlanFilters() {
  return {
    search: "",
    engineer: "all",
    program: "all",
    ...defaultPeriodState(),
  };
}

export function filterPlanClients(rows, filters = {}, options = {}) {
  const f = { ...defaultPlanFilters(), ...filters };
  const period = resolvePeriod(f, options.now || new Date());
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (!programMatches(row, f.program)) return false;
    if (period.active && !inPeriod(row.approvedAt, period)) return false;
    if (!matchesSearch(row, f.search)) return false;
    return true;
  });
}

export function summarizeFilteredPlanClients(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const eligible = list.filter((row) => row.daysToApproval != null && Number.isFinite(Number(row.daysToApproval)));
  const total = list.length;
  const sample = eligible.length;
  const days = eligible.map((row) => Number(row.daysToApproval));
  const value = sample ? medianDays(days) : null;
  return {
    value,
    meanValue: sample ? meanDays(days) : null,
    calculation: "median",
    eligibleClients: sample,
    totalPopulation: total,
    coveragePercent: total ? Math.round((sample / total) * 1000) / 10 : 0,
  };
}
