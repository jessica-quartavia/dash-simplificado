/**
 * Integração de cache server-side nos handlers Vercel API.
 * Cache é otimização — falha de cache NUNCA derruba o dashboard (fail-open).
 */
import {
  buildAnalyticsCacheKey,
  cacheProviderName,
  cacheTtlForPage,
  getAnalyticsCache,
  isAnalyticsCacheDisabled,
} from "../cache/analytics-cache.mjs";
import { perfDebugFromRequest } from "./analytics-data-context.mjs";

export function parseForceRefresh(request) {
  if (!request?.url) return false;
  try {
    const url = new URL(request.url, "http://localhost");
    return (
      url.searchParams.get("force") === "1"
      || url.searchParams.get("refresh") === "1"
      || request.headers?.get("x-force-refresh") === "1"
    );
  } catch {
    return false;
  }
}

export function filtersFromRequestUrl(request, parser) {
  if (typeof parser === "function") return parser(request);
  return {};
}

function extractFetchStats(payload) {
  const sources = payload?.performance?.fetchSources || payload?._fetchStats || [];
  const restRequests = sources.reduce((a, s) => a + (s.request_count || 0), 0);
  const restRows = sources.reduce((a, s) => a + (s.total_rows || 0), 0);
  const dbFetchMs = sources.length ? Math.max(...sources.map((s) => s.fetch_ms || 0)) : 0;
  const slowest = [...sources].sort((a, b) => (b.fetch_ms || 0) - (a.fetch_ms || 0))[0] || null;
  return { sources, restRequests, restRows, dbFetchMs, slowestTable: slowest?.source || null };
}

export function buildCacheMeta(result, pageId, { force = false, ttlMs = 0, bypass = false, bypassReason = null } = {}) {
  const now = Date.now();
  const cachedAt = result?.cachedAt || now;
  const expiresAt = result?.expiresAt || now + ttlMs;
  const ageMs = Math.max(0, now - cachedAt);
  let status = "miss";
  if (bypass) status = "bypass";
  else if (force) status = "bypass";
  else if (result?.cacheHit) status = "hit";
  return {
    hit: result?.cacheHit === true,
    coalesced: result?.coalesced === true,
    status,
    provider: result?.provider || cacheProviderName(),
    key: result?.cacheKey || null,
    cachedAt,
    expiresAt,
    ageMs,
    ttlMs,
    bypassReason: bypassReason || null,
  };
}

export function buildPerfMeta({
  totalMs = 0,
  authMs = 0,
  cacheMs = 0,
  computeMs = 0,
  serializeMs = 0,
  payloadBytes = 0,
  payload = null,
  cache = null,
}) {
  const fetch = extractFetchStats(payload);
  return {
    total_ms: totalMs,
    auth_ms: authMs,
    cache_ms: cacheMs,
    compute_ms: computeMs,
    serialize_ms: serializeMs,
    payload_bytes: payloadBytes,
    rest_requests: fetch.restRequests,
    rest_rows: fetch.restRows,
    db_fetch_ms: fetch.dbFetchMs,
    slowest_table: fetch.slowestTable,
    sources: fetch.sources,
    cache,
  };
}

function safePayloadBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

async function computeWithoutCache(pageId, computeFn, { force = false, filters = {}, ttlMs = 0 } = {}) {
  const started = Date.now();
  const computeStarted = Date.now();
  const value = await computeFn();
  const computeMs = Date.now() - computeStarted;
  const serializeMs = 0;
  const cacheMeta = buildCacheMeta(null, pageId, {
    force,
    ttlMs,
    bypass: true,
    bypassReason: isAnalyticsCacheDisabled() ? "disabled" : "cache_unavailable",
  });
  return {
    payload: value,
    cache: cacheMeta,
    timing: buildPerfMeta({
      totalMs: Date.now() - started,
      computeMs,
      serializeMs,
      payloadBytes: safePayloadBytes(value),
      payload: value,
      cache: cacheMeta,
    }),
  };
}

/**
 * @param {string} pageId
 * @param {() => Promise<object>} computeFn
 * @param {{ request?: Request, filters?: object, force?: boolean, cacheExtra?: object }} opts
 */
export async function computeWithPageCache(pageId, computeFn, opts = {}) {
  const force = Boolean(opts.force ?? parseForceRefresh(opts.request));
  const filters = opts.filters ?? filtersFromRequestUrl(opts.request, opts.parseFilters);
  const ttlMs = cacheTtlForPage(pageId);

  if (isAnalyticsCacheDisabled()) {
    return computeWithoutCache(pageId, computeFn, { force, filters, ttlMs });
  }

  const cache = getAnalyticsCache();
  const key = buildAnalyticsCacheKey(pageId, filters, opts.cacheExtra || {});
  const started = Date.now();

  let computeMs = 0;
  const wrappedCompute = async () => {
    const computeStarted = Date.now();
    const value = await computeFn();
    computeMs = Date.now() - computeStarted;
    return value;
  };

  try {
    const result = await cache.getOrCompute(key, ttlMs, wrappedCompute, { force });
    if (!result?.value) {
      throw new Error("Cache retornou payload vazio.");
    }
    const cacheMeta = buildCacheMeta(result, pageId, { force, ttlMs });
    const cacheMs = Math.max(0, Date.now() - started - (cacheMeta.hit ? 0 : computeMs));
    const serializeMs = 0;
    return {
      payload: result.value,
      cache: cacheMeta,
      timing: buildPerfMeta({
        totalMs: Date.now() - started,
        cacheMs,
        computeMs,
        serializeMs,
        payloadBytes: safePayloadBytes(result.value),
        payload: result.value,
        cache: cacheMeta,
      }),
    };
  } catch (cacheError) {
    console.warn(
      `[Cache] unavailable, bypassing page=${pageId} provider=${cache.provider || cacheProviderName()}:`,
      cacheError instanceof Error ? cacheError.message : cacheError,
    );
    return computeWithoutCache(pageId, computeFn, {
      force,
      filters,
      ttlMs,
    });
  }
}

export function attachCacheMeta(payload, cacheInfo, request) {
  if (!payload || typeof payload !== "object") return payload;
  if (!perfDebugFromRequest(request) && process.env.ANALYTICS_PERF_DEBUG !== "1") return payload;
  return {
    ...payload,
    _cache: cacheInfo,
  };
}

export function attachPerfMeta(payload, perfMeta, request) {
  if (!payload || typeof payload !== "object") return payload;
  if (!perfDebugFromRequest(request) && process.env.ANALYTICS_PERF_DEBUG !== "1") return payload;
  return {
    ...payload,
    performance: {
      ...(payload.performance || {}),
      ...perfMeta,
    },
  };
}

export function getCacheEnvStatus() {
  const url = Boolean(
    String(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.REDIS_REST_URL || "").trim(),
  );
  const token = Boolean(
    String(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.REDIS_REST_TOKEN || "").trim(),
  );
  return {
    UPSTASH_REDIS_REST_URL: url ? "configured" : "missing",
    UPSTASH_REDIS_REST_TOKEN: token ? "configured" : "missing",
    KV_REST_API_URL: Boolean(String(process.env.KV_REST_API_URL || "").trim()) ? "configured" : "missing",
    KV_REST_API_TOKEN: Boolean(String(process.env.KV_REST_API_TOKEN || "").trim()) ? "configured" : "missing",
    ANALYTICS_CACHE_DISABLED: isAnalyticsCacheDisabled() ? "1" : "missing",
    active_provider: isAnalyticsCacheDisabled() ? "disabled" : cacheProviderName(),
  };
}
