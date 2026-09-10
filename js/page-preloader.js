/**
 * Preload / cache warming pós-login — background, fail-open, concorrência limitada.
 */
import { PRELOAD_CONCURRENCY, PRELOAD_IDLE_FALLBACK_MS } from "../lib/preload/page-preload-registry.mjs";
import {
  createPagePreloadQueue,
  shouldLimitPreloadForNetwork,
  shouldPausePreloadForVisibility,
} from "../lib/preload/page-preload-queue.mjs";
import { getCurrentPageId } from "./navigation.js";
import { canCurrentUserPreloadPage, isAccessReady } from "./access-context.js";
import {
  clearAllPageCacheAndInflight,
  fetchPageJsonPreload,
  getPageInflight,
  isForegroundBusy,
  isPageCacheValid,
  subscribeForegroundBusy,
} from "./utils/page-load.js";

/** @type {ReturnType<createPagePreloadQueue>|null} */
let queue = null;
let booted = false;
let idleHandle = null;
let idleTimeout = null;
const unsubs = [];

function perfEnabled() {
  return typeof location !== "undefined" && location.search.includes("perfDebug=1");
}

function preloadLog(level, message, detail) {
  if (level === "debug" && !perfEnabled()) return;
  if (detail) console[level === "warn" ? "warn" : "info"](message, detail);
  else console[level === "warn" ? "warn" : "info"](message);
}

function scheduleIdleTick() {
  if (idleHandle != null && typeof cancelIdleCallback === "function") {
    cancelIdleCallback(idleHandle);
    idleHandle = null;
  }
  if (idleTimeout != null) {
    clearTimeout(idleTimeout);
    idleTimeout = null;
  }

  const run = () => {
    idleHandle = null;
    idleTimeout = null;
    queue?.tick();
  };

  if (typeof requestIdleCallback === "function") {
    idleHandle = requestIdleCallback(run, { timeout: PRELOAD_IDLE_FALLBACK_MS + 500 });
  } else {
    idleTimeout = setTimeout(run, PRELOAD_IDLE_FALLBACK_MS);
  }
}

function bindQueue() {
  queue = createPagePreloadQueue({
    maxConcurrency: PRELOAD_CONCURRENCY,
    isCacheValid: isPageCacheValid,
    isInflight: (pageId, url) => Boolean(getPageInflight(pageId, url)),
    fetchPreload: fetchPageJsonPreload,
    getCurrentPageId,
    canPreloadPage: canCurrentUserPreloadPage,
    isForegroundBusy,
    shouldLimitNetwork: () => shouldLimitPreloadForNetwork(navigator.connection),
    shouldPauseVisibility: () => shouldPausePreloadForVisibility(document.visibilityState),
    log: preloadLog,
    onMetadata(pageId, meta) {
      if (perfEnabled()) {
        console.info(`[Preload] metadata page=${pageId}`, meta);
      }
    },
  });
  queue.setScheduler(scheduleIdleTick);
}

function onPageReady(event) {
  const pageId = event?.detail?.pageId || getCurrentPageId();
  if (!queue || !pageId) return;
  queue.onPageReady(pageId);
  scheduleIdleTick();
}

function onPageNavigate(event) {
  const pageId = event?.detail?.pageId;
  if (!queue || !pageId) return;
  queue.onNavigation(pageId);
}

function onVisibilityChange() {
  queue?.onVisibilityChange();
  if (document.visibilityState === "visible") scheduleIdleTick();
}

function onForegroundBusy(count) {
  if (!queue) return;
  if (count > 0) queue.pause("foreground_fetch");
  else {
    queue.resume("foreground_fetch");
    queue.onNavigationSettled(getCurrentPageId());
    scheduleIdleTick();
  }
}

export function bootPagePreloader() {
  if (booted) return;
  booted = true;
  bindQueue();
  if (isAccessReady()) queue.markAuthReady();

  document.addEventListener("page:ready", onPageReady);
  document.addEventListener("page:navigate", onPageNavigate);
  document.addEventListener("visibilitychange", onVisibilityChange);
  unsubs.push(subscribeForegroundBusy(onForegroundBusy));
}

export function shutdownPagePreloader() {
  queue?.cancelAll();
  clearAllPageCacheAndInflight();
  document.removeEventListener("page:ready", onPageReady);
  document.removeEventListener("page:navigate", onPageNavigate);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  for (const unsub of unsubs.splice(0)) unsub();
  if (idleHandle != null && typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle);
  if (idleTimeout != null) clearTimeout(idleTimeout);
  idleHandle = null;
  idleTimeout = null;
  queue = null;
  booted = false;
}

/** Promove página na fila quando usuário navega antes do preload completar. */
export function promotePreloadPage(pageId) {
  return queue?.promotePage(pageId) || false;
}

export function getPreloadDebugState() {
  return {
    booted,
    started: queue?.started || false,
    pending: queue?.pendingCount || 0,
    active: queue?.activeCount || 0,
    metadata: queue ? Object.fromEntries(queue.metadata) : {},
  };
}
