import { getCurrentPageId, getPageGeneration } from "../navigation.js";
import { canCommitToPage, clearPageCache, markPageRender } from "./page-load.js";

/**
 * Utilitário de ciclo de vida SPA por página.
 * - generation guard contra race de navegação
 * - cleanup de listeners/timers no unmount
 */
export function createPageRuntime(pageId) {
  const cleanups = [];
  let mounted = false;
  let mountGeneration = 0;

  function onMount(fn) {
    cleanups.push(fn);
  }

  function unmount() {
    mounted = false;
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch (error) {
        console.error(`[${pageId}] unmount cleanup`, error);
      }
    }
  }

  function mount(onMounted) {
    mounted = true;
    mountGeneration = getPageGeneration();
    if (typeof onMounted === "function") onMounted(mountGeneration);
  }

  function isActive(generation = mountGeneration) {
    return mounted && canCommitToPage(pageId, generation);
  }

  function guardDomCommit(fn, generation = mountGeneration) {
    if (!isActive(generation)) return false;
    const started = performance.now();
    fn();
    markPageRender(pageId, started);
    return true;
  }

  function handleLoadError(error, state, { force = false } = {}) {
    if (error?.code === "STALE_NAVIGATION") return { stale: true };
    const code = error?.code || "error";
    state.errorCode = code;
    state.error = code === "AUTH_REQUIRED" ? "Sessão expirada." : error?.message || "Não foi possível carregar os dados.";
    if (force && state.payload) return { stale: false, keepPayload: true };
    state.payload = null;
    return { stale: false, keepPayload: false };
  }

  function invalidateCache() {
    clearPageCache(pageId);
  }

  return {
    pageId,
    mount,
    unmount,
    onMount,
    isActive,
    guardDomCommit,
    handleLoadError,
    invalidateCache,
    get mountGeneration() {
      return mountGeneration;
    },
    get mounted() {
      return mounted;
    },
  };
}

export function isCurrentPage(pageId) {
  return getCurrentPageId() === pageId;
}
