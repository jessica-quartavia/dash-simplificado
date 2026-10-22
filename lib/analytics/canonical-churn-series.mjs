/**
 * População e série mensal canônica de churn analítico — Executivo e Cancelamentos.
 */
import { filterCancellationClients } from "./cancellations-filters.mjs";
import { executiveFiltersToDomain } from "./executive-summary-filters.mjs";
import { buildChurnMonthSeries } from "./general-metrics.mjs";

/**
 * Linhas elegíveis ao churn mensal analítico (mesma população da aba Cancelamentos com filtros equivalentes).
 * @param {object} sources — { general, cancellations }
 * @param {object} filters — filtros do Resumo Executivo
 */
export function buildCanonicalAnalyticalChurnRows(sources = {}, filters = {}) {
  const cancelFilters = {
    ...executiveFiltersToDomain(filters, "cancellations"),
    archived: "no",
  };
  const cancelClients = sources.cancellations?.clients;
  if (!Array.isArray(cancelClients)) {
    const message = "buildCanonicalAnalyticalChurnRows requer sources.cancellations.clients";
    if (process.env.NODE_ENV !== "production") throw new Error(message);
    return [];
  }
  return filterCancellationClients(cancelClients, cancelFilters);
}

/** Série mensal 12m — dedupe por client_id, data analítica canônica. */
export function buildAnalyticalChurnMonthSeries(rows, limit = 12, now = new Date()) {
  return buildChurnMonthSeries(rows, limit, now);
}
