/**
 * Registry central de preload pós-login — URLs padrão (payload inicial), prioridades.
 * Não duplicar rotas espalhadas nos módulos de página.
 */
import {
  buildExecutiveSummaryApiUrl,
  defaultExecutiveSummaryFilters,
} from "../analytics/executive-summary-filters.mjs";
import {
  buildStatisticalCrossesApiUrl,
  defaultStatisticalCrossesFilters,
} from "../analytics/statistical-crosses-filters.mjs";

/** Concorrência máxima de preload em background. */
export const PRELOAD_CONCURRENCY = 1;

/** Fallback quando requestIdleCallback não existe. */
export const PRELOAD_IDLE_FALLBACK_MS = 1500;

/**
 * @typedef {{ pageId: string, priority: number, preload?: boolean, buildUrl: () => string, note?: string }} PreloadPageEntry
 */

/** @type {PreloadPageEntry[]} */
export const PRELOAD_PAGES = [
  {
    pageId: "executive_summary",
    priority: 1,
    preload: true,
    buildUrl: () => buildExecutiveSummaryApiUrl(defaultExecutiveSummaryFilters()),
  },
  {
    pageId: "general",
    priority: 1,
    preload: true,
    buildUrl: () => "/api/general-data",
  },
  {
    pageId: "meetings",
    priority: 1,
    preload: true,
    buildUrl: () => "/api/meetings",
    note: "Payload BASE QV principal; Calendly/tipos permanecem no handler.",
  },
  {
    pageId: "mechanisms",
    priority: 2,
    preload: true,
    buildUrl: () => "/api/mechanisms",
  },
  {
    pageId: "cancellations",
    priority: 2,
    preload: true,
    buildUrl: () => "/api/cancellations",
  },
  {
    pageId: "renewal",
    priority: 2,
    preload: true,
    buildUrl: () => "/api/renewal",
  },
  {
    pageId: "satisfaction",
    priority: 2,
    preload: true,
    buildUrl: () => "/api/satisfaction",
  },
  {
    pageId: "financial_updates",
    priority: 3,
    preload: true,
    buildUrl: () => "/api/financial-updates",
  },
  {
    pageId: "support",
    priority: 3,
    preload: false,
    buildUrl: () => "/api/support",
    note: "Legado owner-only — só carrega quando o Owner abre a página.",
  },
  {
    pageId: "ep_performance",
    priority: 3,
    preload: true,
    buildUrl: () => "/api/ep-performance",
  },
  {
    pageId: "temporal_indicators",
    priority: 3,
    preload: true,
    buildUrl: () => "/api/temporal-indicators",
    note: "Sem /details — lazy na página.",
  },
  {
    pageId: "quality",
    priority: 3,
    preload: true,
    buildUrl: () => "/api/quality",
    note: "Somente API principal; matriz composta permanece lazy.",
  },
  {
    pageId: "statistical_crosses",
    priority: 3,
    preload: true,
    buildUrl: () => buildStatisticalCrossesApiUrl(defaultStatisticalCrossesFilters()),
    note: "KPIs/gráficos iniciais; tabelas expandidas lazy.",
  },
  {
    pageId: "platform_usage",
    priority: 3,
    preload: true,
    buildUrl: () => "/api/platform-usage",
  },
  /* Lazy — fora da fila padrão */
  { pageId: "journey", priority: 99, preload: false, buildUrl: () => "/api/onboarding" },
  { pageId: "patrimonial_plan", priority: 99, preload: false, buildUrl: () => "/api/patrimonial-plan" },
  { pageId: "reports", priority: 99, preload: false, buildUrl: () => "/api/reports" },
];

const registryById = new Map(PRELOAD_PAGES.map((entry) => [entry.pageId, entry]));

export function getPreloadRegistryEntry(pageId) {
  return registryById.get(pageId) || null;
}

/**
 * Fila ordenada por prioridade (1 → 3), excluindo entradas desabilitadas.
 * @param {{ excludePageId?: string|null }} opts
 */
export function orderedPreloadEntries({ excludePageId = null, canPreloadPage = null } = {}) {
  return PRELOAD_PAGES.filter((entry) => {
    if (entry.preload === false) return false;
    if (excludePageId && entry.pageId === excludePageId) return false;
    if (typeof canPreloadPage === "function" && !canPreloadPage(entry.pageId)) return false;
    return true;
  }).sort((a, b) => a.priority - b.priority || a.pageId.localeCompare(b.pageId));
}

/**
 * @param {string} pageId
 * @returns {{ pageId: string, url: string }|null}
 */
export function buildPreloadRequest(pageId) {
  const entry = getPreloadRegistryEntry(pageId);
  if (!entry || entry.preload === false) return null;
  return { pageId: entry.pageId, url: entry.buildUrl() };
}
