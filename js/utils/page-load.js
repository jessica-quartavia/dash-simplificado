import { authenticatedFetch } from "../auth.mjs";
import { getCurrentPageId, getPageGeneration } from "../navigation.js";

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

export async function fetchPageJson(url, { force = false, pageId = null } = {}) {
  const activePageId = pageId || getCurrentPageId();
  const generationAtStart = getPageGeneration();
  const key = cacheKey(activePageId, url);
  const started = performance.now();

  if (!force) {
    const cached = pageCache.get(key);
    if (cached && Date.now() - cached.timestamp < cacheTtl(activePageId)) {
      if (perfEnabled()) {
        console.info(`[Perf] page=${activePageId} cache=hit url=${url} ageMs=${Date.now() - cached.timestamp}`);
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
  const signal = getFetchSignal();

  const promise = (async () => {
    const response = await authenticatedFetch(target, {
      signal,
      ...(force ? FORCE_FETCH_OPTIONS : {}),
    });
    const networkMs = Math.round(performance.now() - started);
    const payload = await response.json().catch(() => ({}));
    assertNavigationFresh(activePageId, generationAtStart);

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
      console.info(
        `[Perf] page=${activePageId} network=${networkMs}ms bytes=${bytes} url=${url}${force ? " force=1" : ""}`,
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
