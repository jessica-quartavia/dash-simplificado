import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  PRELOAD_PAGES,
  buildPreloadRequest,
  orderedPreloadEntries,
} from "../../lib/preload/page-preload-registry.mjs";
import {
  createPagePreloadQueue,
  shouldLimitPreloadForNetwork,
  shouldPausePreloadForVisibility,
} from "../../lib/preload/page-preload-queue.mjs";

function createTestQueue(overrides = {}) {
  const fetches = [];
  const cache = new Set();
  const inflight = new Map();

  const queue = createPagePreloadQueue({
    maxConcurrency: overrides.maxConcurrency ?? 1,
    isCacheValid: overrides.deps?.isCacheValid ?? ((pageId, url) => cache.has(`${pageId}::${url}`)),
    isInflight: overrides.deps?.isInflight ?? ((pageId, url) => inflight.has(`${pageId}::${url}`)),
    fetchPreload:
      overrides.deps?.fetchPreload
      ?? (async (url, { pageId }) => {
        const key = `${pageId}::${url}`;
        if (inflight.has(key)) return inflight.get(key);
        const promise = (async () => {
          await new Promise((r) => setTimeout(r, overrides.fetchDelayMs ?? 5));
          cache.add(key);
          fetches.push({ pageId, url });
          return { ok: true };
        })();
        inflight.set(key, promise);
        try {
          return await promise;
        } finally {
          inflight.delete(key);
        }
      }),
    getCurrentPageId: () => overrides.currentPageId ?? "executive_summary",
    isForegroundBusy: () => Boolean(overrides.foregroundBusy),
    shouldLimitNetwork: () => Boolean(overrides.limitNetwork),
    shouldPauseVisibility: () => Boolean(overrides.hiddenTab),
    log: () => {},
  });

  return { queue, fetches, cache, inflight };
}

test("registry filtra preload sem permissão", () => {
  const ordered = orderedPreloadEntries({
    canPreloadPage: (pageId) => pageId === "general" || pageId === "meetings",
  });
  assert.deepEqual(ordered.map((item) => item.pageId).sort(), ["general", "meetings"]);
});

test("registry ordena prioridades e exclui preload:false", () => {
  const ordered = orderedPreloadEntries();
  assert.ok(ordered.length >= 10);
  assert.ok(ordered.every((entry) => entry.preload !== false));
  const reports = PRELOAD_PAGES.find((p) => p.pageId === "reports");
  assert.equal(reports?.preload, false);
  const first = ordered[0];
  assert.equal(first.priority, 1);
});

test("buildPreloadRequest devolve URL canônica", () => {
  const req = buildPreloadRequest("meetings");
  assert.ok(req);
  assert.equal(req.url, "/api/meetings");
  assert.equal(buildPreloadRequest("reports"), null);
});

test("não inicia antes da auth", () => {
  const { queue } = createTestQueue();
  queue.onPageReady("executive_summary");
  assert.equal(queue.started, false);
});

test("inicia após auth + page ready", async () => {
  const { queue, fetches } = createTestQueue();
  queue.markAuthReady();
  queue.onPageReady("executive_summary");
  queue.tick();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(queue.started, true);
  assert.ok(fetches.length >= 1);
});

test("página atual é ignorada na fila", () => {
  const { queue, fetches } = createTestQueue({ currentPageId: "general" });
  queue.markAuthReady();
  queue.onPageReady("general");
  queue.tick();
  assert.ok(!fetches.some((f) => f.pageId === "general"));
});

test("cache hit é ignorado", () => {
  const cache = new Set(["meetings::/api/meetings"]);
  const { queue, fetches } = createTestQueue({
    deps: {
      isCacheValid: (pageId, url) => cache.has(`${pageId}::${url}`),
    },
  });
  queue.markAuthReady();
  queue.onPageReady("executive_summary");
  queue.tick();
  assert.ok(!fetches.some((f) => f.pageId === "meetings"));
});

test("inflight é reutilizado — segundo fetch não dispara", async () => {
  let fetchCount = 0;
  const inflight = new Map();
  const { queue } = createTestQueue({
    deps: {
      fetchPreload: async (url, { pageId }) => {
        const key = `${pageId}::${url}`;
        if (inflight.has(key)) return inflight.get(key);
        fetchCount += 1;
        const p = Promise.resolve({ ok: true });
        inflight.set(key, p);
        await p;
        inflight.delete(key);
        return { ok: true };
      },
      isInflight: (pageId, url) => inflight.has(`${pageId}::${url}`),
    },
  });
  queue.markAuthReady();
  queue.onPageReady("executive_summary");
  queue.tick();
  await inflight.values().next().value;
  assert.equal(fetchCount, 1);
});

test("concorrência máxima respeitada", async () => {
  let active = 0;
  let maxActive = 0;
  const { queue } = createTestQueue({
    maxConcurrency: 1,
    fetchDelayMs: 20,
    deps: {
      fetchPreload: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
        return {};
      },
    },
  });
  queue.markAuthReady();
  queue.onPageReady("executive_summary");
  queue.tick();
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(maxActive <= 1);
});

test("foreground busy pausa novos jobs", () => {
  const { queue, fetches } = createTestQueue({ foregroundBusy: true });
  queue.markAuthReady();
  queue.onPageReady("executive_summary");
  queue.tick();
  assert.equal(fetches.length, 0);
});

test("saveData desabilita preload agressivo", () => {
  assert.equal(shouldLimitPreloadForNetwork({ saveData: true }), true);
  assert.equal(shouldLimitPreloadForNetwork({ effectiveType: "2g" }), true);
  assert.equal(shouldLimitPreloadForNetwork({ effectiveType: "4g" }), false);
});

test("aba hidden pausa novos jobs", () => {
  assert.equal(shouldPausePreloadForVisibility("hidden"), true);
  assert.equal(shouldPausePreloadForVisibility("visible"), false);
  const { queue, fetches } = createTestQueue({ hiddenTab: true });
  queue.markAuthReady();
  queue.onPageReady("executive_summary");
  queue.tick();
  assert.equal(fetches.length, 0);
});

test("foreground navigation remove página da fila", () => {
  const { queue } = createTestQueue();
  queue.markAuthReady();
  queue.onPageReady("executive_summary");
  queue.onNavigation("meetings");
  assert.equal(queue.promotePage("meetings"), false);
});

test("logout cancela fila", () => {
  const { queue } = createTestQueue();
  queue.markAuthReady();
  queue.onPageReady("executive_summary");
  queue.cancelAll();
  assert.equal(queue.cancelled, true);
  assert.equal(queue.pendingCount, 0);
});

test("falha de preload não quebra portal (fail-open)", async () => {
  const { queue } = createTestQueue({
    deps: {
      fetchPreload: async () => {
        throw new Error("network down");
      },
    },
  });
  queue.markAuthReady();
  queue.onPageReady("executive_summary");
  await assert.doesNotReject(async () => {
    queue.tick();
    await new Promise((r) => setTimeout(r, 10));
  });
});

test("page-load expõe preload silencioso e dedupe", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const source = readFileSync(join(ROOT, "js/utils/page-load.js"), "utf8");
  assert.match(source, /fetchPageJsonPreload/);
  assert.match(source, /clearAllPageCacheAndInflight/);
  assert.match(source, /page:ready/);
  assert.match(source, /inflight\.set/);
});

test("app boota preloader antes da navegação inicial", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const appJs = readFileSync(join(ROOT, "js/app.js"), "utf8");
  const preloaderIndex = appJs.indexOf("bootPagePreloader");
  const navigationIndex = appJs.indexOf("bootNavigation");
  assert.ok(preloaderIndex >= 0);
  assert.ok(navigationIndex >= 0);
  assert.ok(preloaderIndex < navigationIndex);
});
