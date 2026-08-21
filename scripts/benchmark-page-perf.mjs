#!/usr/bin/env node
/**
 * Benchmark targeted de páginas V2 — mede total_ms e fetches via AnalyticsDataContext.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuditEnv } from "../lib/analytics/fidelity-audit.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const PAGES = {
  executive_summary: () => import("../lib/analytics/executive-summary.mjs").then((m) => {
    m.clearExecutiveSummaryCache?.();
    return m.computeExecutiveSummaryPayload({}, {}, { force: true, perfDebug: true });
  }),
  ep_performance: () => import("../lib/analytics/ep-performance.mjs").then((m) => m.computeEpPerformancePayload({ perfDebug: true })),
  quality: () => import("../lib/analytics/quality.mjs").then((m) => m.computeQualityPayload({ perfDebug: true })),
  temporal_indicators: () => import("../lib/analytics/temporal-indicators.mjs").then((m) => m.computeTemporalIndicatorsPayload({ perfDebug: true })),
  cancellations: () => import("../lib/analytics/cancellations.mjs").then((m) => m.computeCancellationsPayload({ perfDebug: true })),
};

async function benchmarkPage(pageId, loader) {
  const started = Date.now();
  const payload = await loader();
  const totalMs = Date.now() - started;
  const sources = payload?.performance?.fetchSources || payload?._fetchStats || [];
  const requestCount = sources.reduce((a, s) => a + s.request_count, 0);
  const dedupHits = sources.reduce((a, s) => a + s.dedup_hits, 0);
  return {
    page: pageId,
    total_ms: totalMs,
    payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
    request_count: requestCount,
    dedup_hits: dedupHits,
    sources,
  };
}

async function main() {
  loadAuditEnv();
  const filter = process.argv.find((a) => a.startsWith("--page="))?.split("=")[1];
  const pageIds = filter ? [filter] : Object.keys(PAGES);
  const results = [];
  for (const pageId of pageIds) {
    const loader = PAGES[pageId];
    if (!loader) {
      console.error("Página desconhecida:", pageId);
      process.exit(1);
    }
    console.log(`Benchmark ${pageId}...`);
    results.push(await benchmarkPage(pageId, loader));
  }
  const out = join(ROOT, "docs/page-perf-benchmark.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.table(results.map((r) => ({
    page: r.page,
    total_ms: r.total_ms,
    requests: r.request_count,
    dedup_hits: r.dedup_hits,
    payload_kb: Math.round(r.payload_bytes / 1024),
  })));
  console.log("Written:", out);
}

main().catch((e) => { console.error(e); process.exit(1); });
