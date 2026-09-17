/**
 * Resumo Executivo — Fase 1b: core-only com bundle compartilhado + cache por domínio.
 */
import { buildExecutiveDomainSources } from "./compute-core.mjs";
import { preloadExecutiveSharedBundle } from "./executive-shared-bundle.mjs";
import {
  buildExecutiveBlocks,
  buildExecutiveContexts,
  buildOfficialSourceMetrics,
  compareExecutiveMetrics,
  extractExecutiveMetrics,
} from "./executive-summary-extractors.mjs";
import {
  getAnalyticsDataContext,
  perfDebugFromOptions,
  runWithAnalyticsDataContext,
} from "./analytics-data-context.mjs";

const DOMAIN_CACHE_TTL_MS = 5 * 60 * 1000;
const domainCache = new Map();

export function clearExecutiveSummaryCache() {
  domainCache.clear();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function buildFilterOptions(sources = {}) {
  const clients = sources.general?.clients || [];
  return {
    segments: uniqueSorted(clients.map((c) => c.segmentLabel || c.segment)),
    engineers: uniqueSorted(clients.map((c) => c.engineer)),
  };
}

export function buildExecutiveSummaryPayload(sources = {}, filters = {}) {
  const contexts = buildExecutiveContexts(sources, filters);
  const metrics = extractExecutiveMetrics(contexts);
  const blocks = buildExecutiveBlocks(metrics, contexts);
  const reference = buildOfficialSourceMetrics(contexts);
  const comparison = compareExecutiveMetrics(
    Object.fromEntries(
      Object.entries(metrics).map(([id, item]) => [id, { value: item?.value ?? null, status: item?.status }]),
    ),
    Object.fromEntries(Object.entries(reference).map(([id, value]) => [id, { value }])),
  );

  const sat = contexts.satisfaction;
  const ren = contexts.renewal;

  return {
    baseClients: blocks.baseClients,
    onboarding: blocks.onboarding,
    engagement: blocks.engagement,
    valueDelivery: blocks.valueDelivery,
    clientHealth: blocks.clientHealth,
    ep: blocks.ep,
    temporal: blocks.temporal,
    satisfaction: sat
      ? {
          nps: sat.summary?.nps ?? null,
          validResponses: sat.summary?.npsResponses ?? 0,
          promoters: sat.summary?.promoters ?? 0,
          neutrals: sat.summary?.neutrals ?? 0,
          detractors: sat.summary?.detractors ?? 0,
        }
      : null,
    renewal: ren
      ? {
          activeClients: ren.summary?.activeClients ?? null,
          renewedActiveClients: ren.summary?.renewedActiveClients ?? null,
          renewedActiveRate: ren.summary?.renewedActiveRate ?? null,
        }
      : null,
    comparison,
    pendingMetrics: [],
    filterOptions: buildFilterOptions(sources),
    contextsErrors: contexts.errors,
  };
}

/**
 * Carrega fontes Executive via core layer — uma paginação REST por tabela compartilhada.
 */
export async function loadExecutiveSummarySources(deps = {}, { force = false } = {}) {
  const startedAt = Date.now();
  const cacheKey = "executive_core_v1c";
  const now = Date.now();
  const cached = domainCache.get(cacheKey);
  if (!force && cached && now - cached.at < DOMAIN_CACHE_TTL_MS) {
    return {
      sources: cached.sources,
      sourcesLoaded: cached.sourcesLoaded,
      performance: { ...cached.performance, cacheHit: true, totalMs: 0 },
    };
  }

  const ctx = getAnalyticsDataContext();
  const coreTimings = {};

  const preloadStart = Date.now();
  if (typeof process !== "undefined" && (process.env.NODE_ENV !== "production" || process.env.EXECUTIVE_DEBUG === "1")) {
    console.info("[Executive] fetch clients start");
  }
  const bundle = await preloadExecutiveSharedBundle(ctx);
  coreTimings.preload_ms = bundle.preloadMs ?? Date.now() - preloadStart;
  if (typeof process !== "undefined" && (process.env.NODE_ENV !== "production" || process.env.EXECUTIVE_DEBUG === "1")) {
    console.info("[Executive] fetch clients end");
  }

  const { sources, domainMs, domainErrors } = await buildExecutiveDomainSources(bundle, { deps });
  Object.assign(coreTimings, domainMs);
  if (domainErrors && Object.keys(domainErrors).length) {
    console.error("[Executive] domain errors", domainErrors);
  }

  const transformStart = Date.now();
  coreTimings.serialization_ms = 0;
  coreTimings.total_ms = Date.now() - startedAt;

  const performance = {
    totalMs: coreTimings.total_ms,
    preloadMs: coreTimings.preload_ms,
    transformMs: Date.now() - transformStart,
    cacheHit: false,
    core: coreTimings,
    domains: domainMs,
  };

  const sourcesLoaded = Object.fromEntries(
    Object.keys(sources).map((key) => [key, sources[key] == null ? "error" : "core"]),
  );

  domainCache.set(cacheKey, { sources, sourcesLoaded, performance, at: now });

  return { sources, sourcesLoaded, performance };
}

export async function computeExecutiveSummaryPayload(filters = {}, deps = {}, options = {}) {
  const perfDebug = perfDebugFromOptions(options) || Boolean(deps.perfDebug);
  const force = Boolean(options.force);
  return runWithAnalyticsDataContext(async () => {
    if (typeof process !== "undefined" && (process.env.NODE_ENV !== "production" || process.env.EXECUTIVE_DEBUG === "1" || perfDebug)) {
      console.info("[Executive] start");
      console.info("[Executive] auth ok");
    }
    const startedAt = Date.now();
    if (force) clearExecutiveSummaryCache();

    const loaded = await loadExecutiveSummarySources(deps, { force });
    const transformStarted = Date.now();
    const body = buildExecutiveSummaryPayload(loaded.sources, filters);
    const transformMs = Date.now() - transformStarted;

    if (perfDebug && body.satisfaction) {
      const sat = body.satisfaction;
      console.info(
        `[Executive:NPS] validResponses=${sat.validResponses ?? 0} promoters=${sat.promoters ?? 0} neutrals=${sat.neutrals ?? 0} detractors=${sat.detractors ?? 0} nps=${sat.nps ?? "null"} program=${filters.program || "all"}`,
      );
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      filters,
      performance: {
        ...loaded.performance,
        transformMs,
        fetchSources: getAnalyticsDataContext()?.snapshot() || [],
      },
      sourcesLoaded: loaded.sourcesLoaded,
      ...body,
    };

    const ctx = getAnalyticsDataContext();
    ctx?.logPerf({
      total_ms: Date.now() - startedAt,
      compute_ms: transformMs,
      payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
      core: loaded.performance?.core,
    });
    return payload;
  }, { perfDebug, page: "executive_summary" });
}

export function toPublicExecutiveSummaryPayload(payload) {
  if (!payload) return payload;
  const { contextsErrors, ...rest } = payload;
  return rest;
}

export { buildExecutiveContexts, extractExecutiveMetrics, compareExecutiveMetrics } from "./executive-summary-extractors.mjs";

export function buildExecutiveSections(sources, filters) {
  const body = buildExecutiveSummaryPayload(sources, filters);
  return {
    sections: {
      base: { status: body.baseClients?.status, data: flattenBlock(body.baseClients) },
      onboarding: { status: body.onboarding?.status, data: flattenBlock(body.onboarding) },
      engagement: { status: body.engagement?.status, data: flattenBlock(body.engagement) },
      value: { status: body.valueDelivery?.status, data: flattenBlock(body.valueDelivery) },
      health: { status: body.clientHealth?.status, data: flattenBlock(body.clientHealth) },
      ep: { status: body.ep?.status, data: flattenBlock(body.ep) },
      temporal: { status: body.temporal?.status, data: flattenBlock(body.temporal) },
    },
    blockStatus: {
      base: body.baseClients?.status,
      onboarding: body.onboarding?.status,
      engagement: body.engagement?.status,
      value: body.valueDelivery?.status,
      health: body.clientHealth?.status,
      ep: body.ep?.status,
      temporal: body.temporal?.status,
    },
  };
}

function flattenBlock(block) {
  if (!block?.metrics) return null;
  const data = {};
  for (const [key, metric] of Object.entries(block.metrics)) {
    data[key] = metric?.value ?? null;
  }
  return data;
}

export function buildSourcePageSnapshots(sources, filters) {
  const contexts = buildExecutiveContexts(sources, filters);
  return buildOfficialSourceMetrics(contexts);
}

export function compareExecutiveWithSourcePages(sources, filters) {
  const contexts = buildExecutiveContexts(sources, filters);
  const executive = extractExecutiveMetrics(contexts);
  const reference = buildOfficialSourceMetrics(contexts);
  return compareExecutiveMetrics(
    Object.fromEntries(Object.entries(executive).map(([id, item]) => [id, { value: item?.value ?? null, status: item?.status }])),
    Object.fromEntries(Object.entries(reference).map(([id, value]) => [id, { value }])),
  );
}
