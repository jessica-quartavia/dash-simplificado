/**
 * Sincronização entre DateRangePicker, FilterBar e state.filters das páginas.
 */
import { sanitizePeriodFilters } from "./period.mjs";

export function officialPeriodState(filters = {}) {
  const sanitized = sanitizePeriodFilters(filters);
  return {
    preset: sanitized.period,
    start: sanitized.from || "",
    end: sanitized.to || "",
  };
}

export function periodFilterKey(filters = {}) {
  const sanitized = sanitizePeriodFilters(filters);
  return `${sanitized.period}|${sanitized.from}|${sanitized.to}`;
}

export function isPeriodApplyPayload(value) {
  return Boolean(value && typeof value === "object" && "period" in value && !("target" in value));
}

export function mergePeriodApply(filters = {}, periodApply) {
  if (!isPeriodApplyPayload(periodApply)) return { ...filters };
  return { ...filters, ...sanitizePeriodFilters(periodApply) };
}

export function createFilterChangeHandler({
  state,
  filtersFromForm,
  renderFilters,
  renderSuccess,
  rerenderOnPeriodChange = true,
}) {
  return function onFilterChange(periodApply) {
    const prevKey = periodFilterKey(state.filters);
    state.filters = mergePeriodApply(filtersFromForm(), periodApply);
    state.page = 1;
    if (rerenderOnPeriodChange && periodFilterKey(state.filters) !== prevKey) {
      renderFilters();
    }
    renderSuccess();
  };
}
