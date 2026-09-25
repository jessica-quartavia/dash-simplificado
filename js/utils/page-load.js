import { authenticatedFetch } from "../auth.mjs";
import { getCurrentPageId, getPageGeneration } from "../navigation.js";
import { canCurrentUserAccessPage, canCurrentUserPreloadPage } from "../access-context.js";

const CACHE_TTL_MS = {
  general: 5 * 60 * 1000,
  meetings: 5 * 60 * 1000,
  cancellations: 5 * 60 * 1000,
  mechanisms: 5 * 60 * 1000,
  satisfaction: 5 * 60 * 1000,
  renewal: 5 * 60 * 1000,
  financial_updates: 5 * 60 * 1000,
  journey: 5 * 60 * 1000,
  patrimonial_plan: 5 * 60 * 1000,
  ep_performance: 5 * 60 * 1000,
  temporal_indicators: 5 * 60 * 1000,
  statistical_crosses: 10 * 60 * 1000,
  internal_mechanisms_satisfaction: 0,
  internal_mechanisms_renewal_projection: 0,
  health_score: 5 * 60 * 1000,
  executive_summary: 5 * 60 * 1000,
  quality: 10 * 60 * 1000,
  platform_usage: 5 * 60 * 1000,
  support: 5 * 60 * 1000,
  reports: 2 * 60 * 1000,
  default: 5 * 60 * 1000,
};

const pageCache = new Map();
const inflight = new Map();
let fetchAbortController = null;
let preloadAbortController = null;
let foregroundFetches = 0;
const foregroundListeners = new Set();

function perfEnabled() {
  return typeof location !== "undefined" && location.search.includes("perfDebug=1");
}

function cacheTtl(pageId) {
  return CACHE_TTL_MS[pageId] || CACHE_TTL_MS.default;
}

function cacheKey(pageId, url) {
  return `${pageId}::${url}`;
}

export function resetPageFetchContext() {
  fetchAbortController?.abort();
  fetchAbortController = new AbortController();
}

export function resetPreloadFetchContext() {
  preloadAbortController?.abort();
  preloadAbortController = new AbortController();
}

function getPreloadSignal() {
  if (!preloadAbortController) resetPreloadFetchContext();
  return preloadAbortController.signal;
}

export function isForegroundBusy() {
  return foregroundFetches > 0;
}

export function subscribeForegroundBusy(listener) {
  if (typeof listener !== "function") return () => {};
  foregroundListeners.add(listener);
  listener(foregroundFetches);
  return () => foregroundListeners.delete(listener);
}

function notifyForegroundBusy(count) {
  for (const listener of foregroundListeners) {
    try {
      listener(count);
    } catch (error) {
      console.error("[page-load] foreground listener", error);
    }
  }
}

function bumpForeground(delta) {
  foregroundFetches = Math.max(0, foregroundFetches + delta);
  notifyForegroundBusy(foregroundFetches);
}

function dispatchPageReady(pageId) {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent("page:ready", { detail: { pageId } }));
}

export function getFetchSignal() {
  if (!fetchAbortController) resetPageFetchContext();
  return fetchAbortController.signal;
}

export function clearPageCache(pageId = null) {
  if (!pageId) {
    pageCache.clear();
    return;
  }
  for (const key of pageCache.keys()) {
    if (key.startsWith(`${pageId}::`)) pageCache.delete(key);
  }
}

export function clearAllPageCacheAndInflight() {
  pageCache.clear();
  inflight.clear();
  resetPageFetchContext();
  resetPreloadFetchContext();
}

export function isPageCacheValid(pageId, url) {
  const key = cacheKey(pageId, url);
  const cached = pageCache.get(key);
  return Boolean(cached && Date.now() - cached.timestamp < cacheTtl(pageId));
}

export function getPageInflight(pageId, url) {
  return inflight.get(cacheKey(pageId, url)) || null;
}

export function getPageCacheMeta(pageId, url) {
  const key = cacheKey(pageId, url);
  const cached = pageCache.get(key);
  if (!cached) return null;
  return {
    cachedAt: cached.timestamp,
    ageMs: Date.now() - cached.timestamp,
    ttlMs: cacheTtl(pageId),
    valid: Date.now() - cached.timestamp < cacheTtl(pageId),
  };
}

function assertNavigationFresh(pageId, generationAtStart) {
  if (generationAtStart !== getPageGeneration()) {
    const err = new Error("Navegação alterada durante o carregamento.");
    err.code = "STALE_NAVIGATION";
    throw err;
  }
  if (pageId && getCurrentPageId() !== pageId) {
    const err = new Error("Página ativa mudou durante o carregamento.");
    err.code = "STALE_NAVIGATION";
    throw err;
  }
}

export function canCommitToPage(pageId, generationAtStart) {
  return generationAtStart === getPageGeneration() && getCurrentPageId() === pageId;
}

const FORCE_FETCH_OPTIONS = { cache: "no-store" };

async function fetchPageJsonInternal(url, {
  pageId,
  force = false,
  preload = false,
  generationAtStart = null,
  assertNavigation = true,
  signal = null,
} = {}) {
  if (pageId) {
    const allowed = preload ? canCurrentUserPreloadPage(pageId) : canCurrentUserAccessPage(pageId);
    if (!allowed) {
      const err = new Error("Você não tem permissão para acessar esta página.");
      err.code = "forbidden";
      err.httpStatus = 403;
      throw err;
    }
  }
  const key = cacheKey(pageId, url);
  const started = performance.now();

  if (!force) {
    const cached = pageCache.get(key);
    if (cached && Date.now() - cached.timestamp < cacheTtl(pageId)) {
      if (perfEnabled()) {
        const tag = preload ? "preload" : "page";
        console.info(`[Perf] ${tag}=${pageId} cache=hit url=${url} ageMs=${Date.now() - cached.timestamp}`);
      }
      return structuredClone(cached.data);
    }
    if (inflight.has(key)) {
      return inflight.get(key);
    }
  } else {
    pageCache.delete(key);
  }

  const target = force ? `${url}${url.includes("?") ? "&" : "?"}force=1&_=${Date.now()}` : url;
  const fetchSignal = signal || (preload ? getPreloadSignal() : getFetchSignal());

  const promise = (async () => {
    const response = await authenticatedFetch(target, {
      signal: fetchSignal,
      ...(force ? FORCE_FETCH_OPTIONS : {}),
    });
    const networkMs = Math.round(performance.now() - started);
    const payload = await response.json().catch(() => ({}));
    if (assertNavigation) {
      assertNavigationFresh(pageId, generationAtStart ?? getPageGeneration());
    }

    if (!response.ok) {
      const err = new Error(payload.error || "Não foi possível carregar os dados.");
      err.code = payload.code || String(response.status);
      err.httpStatus = response.status;
      err.postgrestCode = payload.postgrest_code || payload.postgrestCode || null;
      throw err;
    }

    pageCache.set(key, { data: payload, timestamp: Date.now() });
    const bytes = JSON.stringify(payload).length;
    if (perfEnabled()) {
      const tag = preload ? "preload" : "page";
      console.info(
        `[Perf] ${tag}=${pageId} network=${networkMs}ms bytes=${bytes} url=${url}${force ? " force=1" : ""}`,
      );
    }
    return payload;
  })()
    .catch((error) => {
      if (error?.name === "AbortError" || error?.code === "STALE_NAVIGATION") {
        const err = new Error("Carregamento cancelado por navegação.");
        err.code = "STALE_NAVIGATION";
        throw err;
      }
      throw error;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export async function fetchPageJson(url, { force = false, pageId = null } = {}) {
  const activePageId = pageId || getCurrentPageId();
  const generationAtStart = getPageGeneration();
  bumpForeground(1);
  try {
    return await fetchPageJsonInternal(url, {
      pageId: activePageId,
      force,
      preload: false,
      generationAtStart,
      assertNavigation: true,
    });
  } finally {
    bumpForeground(-1);
    if (!isForegroundBusy() && activePageId === getCurrentPageId()) {
      dispatchPageReady(activePageId);
    }
  }
}

/** Preload silencioso — compartilha cache/inflight, sem force e sem assert de navegação. */
export async function fetchPageJsonPreload(url, { pageId }) {
  if (!pageId) throw new Error("pageId obrigatório para preload.");
  return fetchPageJsonInternal(url, {
    pageId,
    force: false,
    preload: true,
    assertNavigation: false,
  });
}

export function mapLoadError(error) {
  const code = error?.code || "error";
  if (code === "STALE_NAVIGATION") {
    return { errorCode: code, error: null, stale: true };
  }
  return {
    errorCode: code,
    error: code === "AUTH_REQUIRED" ? "Sessão expirada." : error?.message || "Não foi possível carregar os dados.",
  };
}

/** Aplica erro de fetch no state; retorna true se navegação cancelou o load. */
export function applyLoadError(state, error, { force = false, pageRefresh = null } = {}) {
  const mapped = mapLoadError(error);
  if (mapped.stale) return true;
  state.errorCode = mapped.errorCode;
  state.error = mapped.error;
  if (force && state.payload) {
    pageRefresh?.markError?.(state.error);
  } else {
    state.payload = null;
    pageRefresh?.render?.();
  }
  return false;
}

export function markPageRender(pageId, startedMs) {
  if (!perfEnabled()) return;
  console.info(`[Perf] page=${pageId} render=${Math.round(performance.now() - startedMs)}ms`);
}
