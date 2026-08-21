/**
 * Integração de cache server-side nos handlers Vercel API.
 */
import {
  buildAnalyticsCacheKey,
  cacheTtlForPage,
  getMemoryAnalyticsCache,
} from "../cache/analytics-cache.mjs";

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

/**
 * @param {string} pageId
 * @param {() => Promise<object>} computeFn
 * @param {{ request?: Request, filters?: object, force?: boolean, cacheExtra?: object }} opts
 */
export async function computeWithPageCache(pageId, computeFn, opts = {}) {
  const force = Boolean(opts.force ?? parseForceRefresh(opts.request));
  const filters = opts.filters ?? filtersFromRequestUrl(opts.request, opts.parseFilters);
  const cache = getMemoryAnalyticsCache();
  const key = buildAnalyticsCacheKey(pageId, filters, opts.cacheExtra || {});
  const ttlMs = cacheTtlForPage(pageId);

  const result = await cache.getOrCompute(key, ttlMs, computeFn, { force });
  return {
    payload: result.value,
    cache: {
      hit: result.cacheHit === true,
      coalesced: result.coalesced === true,
      key,
      cachedAt: result.cachedAt || null,
      expiresAt: result.expiresAt || null,
    },
  };
}

export function attachCacheMeta(payload, cacheInfo) {
  if (!payload || typeof payload !== "object") return payload;
  return {
    ...payload,
    _cache: cacheInfo,
  };
}
