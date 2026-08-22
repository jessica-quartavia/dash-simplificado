/**
 * Cache analítico por request de API — memória process-local com coalescing.
 * Interface preparada para RedisAnalyticsCache (Fase 2) sem acoplar domínio.
 */
import { createHash } from "node:crypto";
import { RedisAnalyticsCache } from "./redis-analytics-cache.mjs";

export const CALCULATION_VERSION = "v2.2026-08-22-perf-phase-a";

/** TTL por página (ms) — alinhado ao frontend page-load.js onde aplicável. */
export const PAGE_CACHE_TTL_MS = {
  general: 5 * 60 * 1000,
  meetings: 5 * 60 * 1000,
  cancellations: 5 * 60 * 1000,
  mechanisms: 5 * 60 * 1000,
  satisfaction: 10 * 60 * 1000,
  renewal: 10 * 60 * 1000,
  financial_updates: 5 * 60 * 1000,
  journey: 5 * 60 * 1000,
  patrimonial_plan: 10 * 60 * 1000,
  ep_performance: 10 * 60 * 1000,
  temporal_indicators: 10 * 60 * 1000,
  statistical_crosses: 15 * 60 * 1000,
  executive_summary: 5 * 60 * 1000,
  quality: 15 * 60 * 1000,
  platform_usage: 5 * 60 * 1000,
  support: 2 * 60 * 1000,
  reports: 2 * 60 * 1000,
  default: 5 * 60 * 1000,
};

/** Classificação metodológica de staleness (documentação). */
export const PAGE_CACHE_CLASS = {
  general: "A",
  meetings: "A",
  cancellations: "A",
  mechanisms: "A",
  satisfaction: "A",
  renewal: "A",
  financial_updates: "A",
  journey: "A",
  ep_performance: "B",
  temporal_indicators: "B",
  executive_summary: "A",
  quality: "B",
  platform_usage: "A",
  support: "C",
  reports: "C",
};

const FILTER_KEYS = [
  "search",
  "program",
  "engineer",
  "segment",
  "status",
  "archived",
  "period",
  "month",
  "year",
  "from",
  "to",
  "presence",
  "noShow",
  "renewal",
  "quarter",
  "npsClassification",
  "hasCsat",
  "lastNpsBand",
  "type",
  "priority",
  "area",
  "requester",
  "identified",
  "financialTraits",
  "mechanismStatus",
  "client_id",
];

export function normalizeAnalyticsFilters(raw = {}) {
  const out = {};
  for (const key of FILTER_KEYS) {
    const value = raw[key];
    if (value == null || value === "") continue;
    out[key] = String(value).trim();
  }
  return out;
}

export function buildAnalyticsCacheKey(pageId, filters = {}, extra = {}) {
  const normalized = normalizeAnalyticsFilters(filters);
  const payload = JSON.stringify({
    page: pageId,
    filters: normalized,
    calculation_version: CALCULATION_VERSION,
    ...extra,
  });
  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return `analytics:v2:${pageId}:${CALCULATION_VERSION}:${hash}`;
}

export class MemoryAnalyticsCache {
  constructor() {
    this.entries = new Map();
    this.inflight = new Map();
    this.provider = "memory";
  }

  get(key) {
    const row = this.entries.get(key);
    if (!row) return null;
    if (Date.now() > row.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return { value: row.value, cachedAt: row.cachedAt, expiresAt: row.expiresAt };
  }

  set(key, value, ttlMs) {
    const cachedAt = Date.now();
    this.entries.set(key, {
      value,
      cachedAt,
      expiresAt: cachedAt + ttlMs,
    });
  }

  del(key) {
    this.entries.delete(key);
    this.inflight.delete(key);
  }

  clear(prefix = null) {
    if (!prefix) {
      this.entries.clear();
      this.inflight.clear();
      return;
    }
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
    for (const key of [...this.inflight.keys()]) {
      if (key.startsWith(prefix)) this.inflight.delete(key);
    }
  }

  /**
   * Request coalescing — evita cache stampede na mesma instância.
   */
  async getOrCompute(key, ttlMs, computeFn, { force = false } = {}) {
    if (!force) {
      const hit = this.get(key);
      if (hit) return { ...hit, cacheHit: true, cacheKey: key, provider: this.provider };
    } else {
      this.del(key);
    }

    if (this.inflight.has(key)) {
      const value = await this.inflight.get(key);
      return { value, cachedAt: Date.now(), expiresAt: Date.now() + ttlMs, cacheHit: false, coalesced: true, cacheKey: key, provider: this.provider };
    }

    const promise = Promise.resolve().then(computeFn);
    this.inflight.set(key, promise);
    try {
      const value = await promise;
      this.set(key, value, ttlMs);
      const stored = this.get(key);
      return { ...stored, cacheHit: false, cacheKey: key, provider: this.provider };
    } finally {
      this.inflight.delete(key);
    }
  }

  stats() {
    return { provider: this.provider, entries: this.entries.size, inflight: this.inflight.size };
  }
}

let sharedMemoryCache = null;
let sharedAnalyticsCache = null;

export function getMemoryAnalyticsCache() {
  if (!sharedMemoryCache) sharedMemoryCache = new MemoryAnalyticsCache();
  return sharedMemoryCache;
}

export function resetMemoryAnalyticsCache() {
  sharedMemoryCache = new MemoryAnalyticsCache();
  return sharedMemoryCache;
}

/**
 * Cache analítico compartilhado — Redis quando configurado, senão memória process-local.
 */
export function getAnalyticsCache() {
  if (sharedAnalyticsCache) return sharedAnalyticsCache;
  if (isAnalyticsCacheDisabled()) {
    sharedAnalyticsCache = getMemoryAnalyticsCache();
    return sharedAnalyticsCache;
  }
  const { url, token } = getRedisEnv();
  if (url && token) {
    sharedAnalyticsCache = new ResilientAnalyticsCache(
      new RedisAnalyticsCache({ url, token }),
      getMemoryAnalyticsCache(),
    );
    return sharedAnalyticsCache;
  }
  sharedAnalyticsCache = getMemoryAnalyticsCache();
  return sharedAnalyticsCache;
}

export function resetAnalyticsCache() {
  sharedAnalyticsCache = null;
  return resetMemoryAnalyticsCache();
}

export function cacheProviderName() {
  return getAnalyticsCache().provider || "memory";
}

function getRedisEnv() {
  const url = String(
    process.env.UPSTASH_REDIS_REST_URL
    || process.env.KV_REST_API_URL
    || process.env.REDIS_REST_URL
    || "",
  ).trim();
  const token = String(
    process.env.UPSTASH_REDIS_REST_TOKEN
    || process.env.KV_REST_API_TOKEN
    || process.env.REDIS_REST_TOKEN
    || "",
  ).trim();
  return { url, token };
}

/**
 * Redis primário com fallback memory — falha Redis não propaga.
 */
class ResilientAnalyticsCache {
  constructor(primary, fallback) {
    this.primary = primary;
    this.fallback = fallback;
    this.provider = primary.provider;
    this.inflight = primary.inflight;
  }

  get(key) {
    return this.primary.get(key).catch(() => this.fallback.get(key));
  }

  set(key, value, ttlMs) {
    return this.primary.set(key, value, ttlMs).catch(() => this.fallback.set(key, value, ttlMs));
  }

  del(key) {
    return this.primary.del(key).catch(() => this.fallback.del(key));
  }

  clear(prefix = null) {
    this.primary.clear(prefix);
    this.fallback.clear(prefix);
  }

  async getOrCompute(key, ttlMs, computeFn, opts = {}) {
    try {
      return await this.primary.getOrCompute(key, ttlMs, computeFn, opts);
    } catch (error) {
      console.warn("[Cache] Redis getOrCompute failed, falling back to memory:", error?.message || error);
      return this.fallback.getOrCompute(key, ttlMs, computeFn, opts);
    }
  }

  stats() {
    return {
      provider: this.provider,
      primary: this.primary.stats?.() || null,
      fallback: this.fallback.stats?.() || null,
    };
  }
}

export function cacheTtlForPage(pageId) {
  return PAGE_CACHE_TTL_MS[pageId] || PAGE_CACHE_TTL_MS.default;
}

export function isAnalyticsCacheDisabled() {
  return String(process.env.ANALYTICS_CACHE_DISABLED || "").trim() === "1";
}

export function getRedisEnvStatus() {
  const url = getRedisEnv().url;
  const token = getRedisEnv().token;
  return {
    UPSTASH_REDIS_REST_URL: Boolean(String(process.env.UPSTASH_REDIS_REST_URL || "").trim()) ? "configured" : "missing",
    UPSTASH_REDIS_REST_TOKEN: Boolean(String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim()) ? "configured" : "missing",
    KV_REST_API_URL: Boolean(String(process.env.KV_REST_API_URL || "").trim()) ? "configured" : "missing",
    KV_REST_API_TOKEN: Boolean(String(process.env.KV_REST_API_TOKEN || "").trim()) ? "configured" : "missing",
    redis_ready: Boolean(url && token),
  };
}
