/**
 * Fila de preload pós-login — pura (testável), fail-open, concorrência limitada.
 */
import { orderedPreloadEntries } from "./page-preload-registry.mjs";

/**
 * @typedef {{ pageId: string, url: string, priority: number }} PreloadJob
 * @typedef {{ preloadedAt: number, durationMs: number, source: 'frontend-cache'|'backend-cache'|'network', url: string }} PreloadMetadata
 */

export function shouldLimitPreloadForNetwork(connection = null) {
  if (!connection) return false;
  if (connection.saveData === true) return true;
  const type = String(connection.effectiveType || "").toLowerCase();
  return type === "slow-2g" || type === "2g";
}

export function shouldPausePreloadForVisibility(visibilityState = "visible") {
  return visibilityState === "hidden";
}

/**
 * @param {object} deps
 * @param {number} [deps.maxConcurrency]
 * @param {(pageId: string, url: string) => boolean} deps.isCacheValid
 * @param {(pageId: string, url: string) => boolean} deps.isInflight
 * @param {(url: string, opts: { pageId: string }) => Promise<unknown>} deps.fetchPreload
 * @param {() => string|null} deps.getCurrentPageId
 * @param {() => boolean} [deps.isForegroundBusy]
 * @param {() => boolean} [deps.shouldLimitNetwork]
 * @param {() => boolean} [deps.shouldPauseVisibility]
 * @param {(level: string, message: string, detail?: object) => void} [deps.log]
 * @param {(pageId: string, meta: PreloadMetadata) => void} [deps.onMetadata]
 */
export function createPagePreloadQueue(deps) {
  const maxConcurrency = Math.max(1, deps.maxConcurrency || 1);
  const log = deps.log || (() => {});
  const onMetadata = deps.onMetadata || (() => {});

  /** @type {PreloadJob[]} */
  let pending = [];
  /** @type {Set<string>} */
  const queuedIds = new Set();
  /** @type {Map<string, PreloadMetadata>} */
  const metadata = new Map();

  let authReady = false;
  let started = false;
  let cancelled = false;
  let activeCount = 0;
  /** @type {Set<string>} */
  const pauseReasons = new Set();
  let currentPageId = null;
  let scheduleCallback = null;

  function isPaused() {
    return pauseReasons.size > 0;
  }

  function canStartNewJobs() {
    if (!authReady || !started || cancelled) return false;
    if (isPaused()) return false;
    if (deps.isForegroundBusy?.()) return false;
    if (deps.shouldLimitNetwork?.()) return false;
    if (deps.shouldPauseVisibility?.()) return false;
    return true;
  }

  function rebuildPending(excludePageId = currentPageId) {
    pending = [];
    queuedIds.clear();
    for (const entry of orderedPreloadEntries({ excludePageId })) {
      const url = entry.buildUrl();
      if (deps.isCacheValid(entry.pageId, url)) {
        log("debug", `[Preload] skip cached page=${entry.pageId}`);
        continue;
      }
      if (deps.isInflight(entry.pageId, url)) {
        log("debug", `[Preload] skip inflight page=${entry.pageId}`);
        continue;
      }
      pending.push({ pageId: entry.pageId, url, priority: entry.priority });
      queuedIds.add(entry.pageId);
    }
  }

  function scheduleProcess() {
    if (typeof scheduleCallback === "function") scheduleCallback();
  }

  function pump() {
    while (canStartNewJobs() && activeCount < maxConcurrency && pending.length > 0) {
      const job = pending.shift();
      if (!job) break;
      queuedIds.delete(job.pageId);
      activeCount += 1;
      void runJob(job).finally(() => {
        activeCount -= 1;
        scheduleProcess();
      });
    }
  }

  async function runJob(job) {
    const startedMs = performance.now?.() ?? Date.now();
    const cacheBefore = deps.isCacheValid(job.pageId, job.url);
    log("info", `[Preload] start page=${job.pageId}`);
    if (cacheBefore) {
      log("info", `[Preload] hit page=${job.pageId}`);
    } else {
      log("info", `[Preload] miss page=${job.pageId}`);
    }

    try {
      await deps.fetchPreload(job.url, { pageId: job.pageId });
      const durationMs = Math.round((performance.now?.() ?? Date.now()) - startedMs);
      const source = cacheBefore ? "frontend-cache" : "network";
      const meta = {
        preloadedAt: Date.now(),
        durationMs,
        source,
        url: job.url,
      };
      metadata.set(job.pageId, meta);
      onMetadata(job.pageId, meta);
      log("info", `[Preload] complete page=${job.pageId} ms=${durationMs} source=${source}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("warn", `[Preload] failed page=${job.pageId}`, { message });
    }
  }

  return {
    get metadata() {
      return metadata;
    },
    get pendingCount() {
      return pending.length;
    },
    get activeCount() {
      return activeCount;
    },
    get started() {
      return started;
    },
    get cancelled() {
      return cancelled;
    },

    setScheduler(fn) {
      scheduleCallback = fn;
    },

    markAuthReady() {
      authReady = true;
    },

    /**
     * Primeira página foreground pronta — inicia fila em background.
     * @param {string} pageId
     */
    onPageReady(pageId) {
      if (!authReady || cancelled) return;
      currentPageId = pageId;
      if (!started) {
        started = true;
        log("info", `[Preload] queue armed after page=${pageId}`);
      }
      rebuildPending(pageId);
      scheduleProcess();
    },

    onNavigation(pageId) {
      if (cancelled) return;
      currentPageId = pageId;
      pauseReasons.add("foreground_navigation");
      log("info", "[Preload] paused foreground_navigation");

      if (queuedIds.has(pageId)) {
        pending = pending.filter((job) => job.pageId !== pageId);
        queuedIds.delete(pageId);
        log("info", `[Preload] promoted page=${pageId} (removed from queue)`);
      }

      scheduleProcess();
    },

    onNavigationSettled(pageId) {
      if (cancelled) return;
      currentPageId = pageId;
      pauseReasons.delete("foreground_navigation");
      rebuildPending(pageId);
      scheduleProcess();
    },

    pause(reason) {
      pauseReasons.add(reason);
      log("debug", `[Preload] paused ${reason}`);
    },

    resume(reason) {
      pauseReasons.delete(reason);
      if (!isPaused()) scheduleProcess();
    },

    onVisibilityChange() {
      if (deps.shouldPauseVisibility?.()) {
        pauseReasons.add("hidden_tab");
        log("debug", "[Preload] paused hidden_tab");
      } else {
        pauseReasons.delete("hidden_tab");
        scheduleProcess();
      }
    },

    promotePage(pageId) {
      if (!queuedIds.has(pageId)) return false;
      pending = pending.filter((job) => job.pageId !== pageId);
      queuedIds.delete(pageId);
      log("info", `[Preload] promoted page=${pageId}`);
      return true;
    },

    cancelAll() {
      cancelled = true;
      started = false;
      pending = [];
      queuedIds.clear();
      metadata.clear();
      pauseReasons.clear();
      log("info", "[Preload] cancelled");
    },

    resetSession() {
      cancelled = false;
      started = false;
      authReady = false;
      pending = [];
      queuedIds.clear();
      metadata.clear();
      pauseReasons.clear();
      activeCount = 0;
      currentPageId = null;
    },

    tick() {
      pump();
    },
  };
}
