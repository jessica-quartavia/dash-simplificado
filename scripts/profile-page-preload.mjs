#!/usr/bin/env node
/**
 * Benchmark preload — simula cache hit após aquecimento vs cold fetch.
 * Mede latência de leitura do page cache frontend (não requer servidor).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPreloadRequest } from "../lib/preload/page-preload-registry.mjs";
import { createPagePreloadQueue } from "../lib/preload/page-preload-queue.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_JSON = join(ROOT, "docs/preload-benchmark.json");
const OUT_MD = join(ROOT, "docs/preload-baseline.md");

const PAGES = [
  "executive_summary",
  "general",
  "meetings",
  "mechanisms",
  "cancellations",
  "satisfaction",
];

/** Latência simulada de rede por página (ms) — alinhada ao baseline cold aproximado. */
const SIMULATED_NETWORK_MS = {
  executive_summary: 8500,
  general: 120,
  meetings: 7400,
  mechanisms: 2100,
  cancellations: 900,
  satisfaction: 400,
};

function simulatePageCache() {
  const store = new Map();
  return {
    isValid(pageId, url) {
      return store.has(`${pageId}::${url}`);
    },
    set(pageId, url, data) {
      store.set(`${pageId}::${url}`, data);
    },
    readMs(pageId, url) {
      const t0 = performance.now();
      const row = store.get(`${pageId}::${url}`);
      if (!row) return null;
      structuredClone(row);
      return Math.round(performance.now() - t0);
    },
  };
}

async function runScenario() {
  const cache = simulatePageCache();
  const rows = [];

  for (const pageId of PAGES) {
    const req = buildPreloadRequest(pageId);
    if (!req) continue;
    const coldMs = SIMULATED_NETWORK_MS[pageId] ?? 500;

    const coldStart = performance.now();
    await new Promise((r) => setTimeout(r, Math.min(coldMs, 50) / 10));
    cache.set(pageId, req.url, { pageId, simulatedColdMs: coldMs });
    const coldMeasured = Math.round(performance.now() - coldStart);

    const warmMs = cache.readMs(pageId, req.url) ?? 0;
    const gainPct = coldMs > 0 ? Math.round((1 - warmMs / coldMs) * 1000) / 10 : 0;

    rows.push({
      pageId,
      label: pageId,
      coldMs,
      preloadSimMs: coldMeasured,
      warmOpenMs: warmMs,
      gainPct,
    });
  }

  const queueCache = simulatePageCache();
  let preloadTotalMs = 0;
  const queue = createPagePreloadQueue({
    maxConcurrency: 1,
    isCacheValid: queueCache.isValid.bind(queueCache),
    isInflight: () => false,
    fetchPreload: async (url, { pageId }) => {
      const delay = Math.min(SIMULATED_NETWORK_MS[pageId] ?? 200, 30);
      await new Promise((r) => setTimeout(r, delay));
      queueCache.set(pageId, url, { ok: true });
    },
    getCurrentPageId: () => "executive_summary",
    log: () => {},
  });
  queue.markAuthReady();
  const preloadStarted = performance.now();
  queue.onPageReady("executive_summary");
  queue.tick();
  while (queue.activeCount > 0 || queue.pendingCount > 0) {
    queue.tick();
    await new Promise((r) => setTimeout(r, 5));
  }
  preloadTotalMs = Math.round(performance.now() - preloadStarted);

  return { rows, preloadTotalMs, concurrency: 1 };
}

const result = await runScenario();
mkdirSync(dirname(OUT_JSON), { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(result, null, 2)}\n`, "utf8");

const table = [
  "| Página | Sem preload (cold sim) | Preload fila (sim) | Abertura pós-cache | Ganho % |",
  "|--------|------------------------|--------------------|--------------------|---------|",
  ...result.rows.map(
    (r) =>
      `| ${r.label} | ${r.coldMs} ms | ${result.preloadTotalMs} ms (fila total) | ${r.warmOpenMs} ms | ${r.gainPct}% |`,
  ),
].join("\n");

writeFileSync(
  OUT_MD,
  `# Preload benchmark (simulado)

Concorrência: ${result.concurrency}

${table}

> Medição local simula latência cold do baseline e leitura warm do page cache frontend.
> Preload real também aquece cache server-side (Redis/memory) quando API responde.
`,
  "utf8",
);

console.log(table);
console.log(`\nSalvo em ${OUT_JSON} e ${OUT_MD}`);
