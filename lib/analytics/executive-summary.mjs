/**
 * Resumo Executivo — agregador com cache por domínio e API estruturada por blocos.
 */
import { computeGeneralDataPayload } from "./general-data.mjs";
import { computeOnboardingPayload } from "./onboarding.mjs";
import { computeMeetingsPayload } from "./meetings.mjs";
import { computeFinancialUpdatesPayload } from "./financial-updates.mjs";
import { computeMechanismsPayload } from "./mechanisms.mjs";
import { computeSatisfactionPayload } from "./satisfaction.mjs";
import { computeCancellationsPayload } from "./cancellations.mjs";
import { computeRenewalPayload } from "./renewal.mjs";
import { computeEpPerformancePayload } from "./ep-performance.mjs";
import { computeTemporalIndicatorsPayload } from "./temporal-indicators.mjs";
import {
  buildExecutiveBlocks,
  buildExecutiveContexts,
  buildOfficialSourceMetrics,
  compareExecutiveMetrics,
  extractExecutiveMetrics,
} from "./executive-summary-extractors.mjs";
import { RENEWAL_ELIGIBLE_RULE_STATUS } from "./executive-summary-registry.mjs";

const DOMAIN_CACHE_TTL_MS = 5 * 60 * 1000;
const domainCache = new Map();

const DOMAIN_LOADERS = {
  general: computeGeneralDataPayload,
  journey: computeOnboardingPayload,
  meetings: () => computeMeetingsPayload({ includeMeetingTypes: false }),
  financial_updates: computeFinancialUpdatesPayload,
  mechanisms: computeMechanismsPayload,
  satisfaction: computeSatisfactionPayload,
  cancellations: computeCancellationsPayload,
  renewal: computeRenewalPayload,
  ep_performance: computeEpPerformancePayload,
  temporal_indicators: computeTemporalIndicatorsPayload,
};

function unwrapSettled(result, label) {
  if (result.status === "fulfilled") return { ok: true, value: result.value, label };
  return {
    ok: false,
    label,
    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
  };
}

export function clearExecutiveSummaryCache() {
  domainCache.clear();
}

async function loadDomain(key, loader, { force = false } = {}) {
  const now = Date.now();
  const cached = domainCache.get(key);
  if (!force && cached && now - cached.at < DOMAIN_CACHE_TTL_MS) {
    return { value: cached.value, ms: 0, cacheHit: true };
  }
  const started = Date.now();
  const value = await loader();
  domainCache.set(key, { value, at: now });
  return { value, ms: Date.now() - started, cacheHit: false };
}

export async function loadExecutiveSummarySources(deps = {}, { force = false } = {}) {
  const startedAt = Date.now();
  const loaders = { ...DOMAIN_LOADERS, ...deps };
  const entries = Object.entries(loaders);
  const results = await Promise.allSettled(
    entries.map(([key, fn]) => loadDomain(key, fn, { force })),
  );

  const sources = {};
  const domains = {};
  const sourcesLoaded = {};

  entries.forEach(([key], index) => {
    const settled = unwrapSettled(results[index], key);
    if (settled.ok && results[index].status === "fulfilled") {
      const payload = results[index].value;
      sources[key] = payload.value;
      domains[key] = payload.ms;
      sourcesLoaded[key] = payload.cacheHit ? "cache" : "ok";
    } else {
      sources[key] = null;
      domains[key] = 0;
      sourcesLoaded[key] = "error";
      console.warn(`[Executive Summary] ${key} failed:`, settled.error || settled.label);
    }
  });

  return {
    sources,
    sourcesLoaded,
    performance: {
      totalMs: Date.now() - startedAt,
      domains,
    },
  };
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

  return {
    baseClients: blocks.baseClients,
    onboarding: blocks.onboarding,
    engagement: blocks.engagement,
    valueDelivery: blocks.valueDelivery,
    clientHealth: blocks.clientHealth,
    ep: blocks.ep,
    temporal: blocks.temporal,
    comparison,
    pendingMetrics: [RENEWAL_ELIGIBLE_RULE_STATUS],
    filterOptions: buildFilterOptions(sources),
    contextsErrors: contexts.errors,
  };
}

export async function computeExecutiveSummaryPayload(filters = {}, deps = {}, options = {}) {
  const force = Boolean(options.force);
  if (force) clearExecutiveSummaryCache();

  const loaded = await loadExecutiveSummarySources(deps, { force });
  const body = buildExecutiveSummaryPayload(loaded.sources, filters);

  return {
    generatedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    filters,
    performance: loaded.performance,
    sourcesLoaded: loaded.sourcesLoaded,
    ...body,
  };
}

export function toPublicExecutiveSummaryPayload(payload) {
  if (!payload) return payload;
  const { contextsErrors, ...rest } = payload;
  return rest;
}

// Compatibilidade com testes/importações anteriores
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
