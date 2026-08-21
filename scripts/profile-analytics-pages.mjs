#!/usr/bin/env node
/**
 * Profile cold/warm por página — compute miss vs cache hit.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuditEnv } from "../lib/analytics/fidelity-audit.mjs";
import { resetMemoryAnalyticsCache } from "../lib/cache/analytics-cache.mjs";
import { computeWithPageCache } from "../lib/analytics/handler-cache.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const PAGES = {
  executive_summary: async () => {
    const mod = await import("../lib/analytics/executive-summary.mjs");
    mod.clearExecutiveSummaryCache?.();
    return () => mod.computeExecutiveSummaryPayload({}, {}, { force: true });
  },
  ep_performance: async () => {
    const mod = await import("../lib/analytics/ep-performance.mjs");
    return () => mod.computeEpPerformancePayload({});
  },
  quality: async () => {
    const mod = await import("../lib/analytics/quality.mjs");
    return () => mod.computeQualityPayload({});
  },
  temporal_indicators: async () => {
    const mod = await import("../lib/analytics/temporal-indicators.mjs");
    return () => mod.computeTemporalIndicatorsPayload({});
  },
  cancellations: async () => {
    const mod = await import("../lib/analytics/cancellations.mjs");
    return () => mod.computeCancellationsPayload({});
  },
  mechanisms: async () => {
    const mod = await import("../lib/analytics/mechanisms.mjs");
    return () => mod.computeMechanismsPayload();
  },
};

async function profilePage(pageId, loaderFactory) {
  resetMemoryAnalyticsCache();
  const loader = await loaderFactory();
  const coldStarted = Date.now();
  const cold = await computeWithPageCache(pageId, loader, { force: true });
  const coldMs = Date.now() - coldStarted;

  const warmStarted = Date.now();
  const warm = await computeWithPageCache(pageId, loader, { force: false });
  const warmMs = Date.now() - warmStarted;

  const fetchStats = cold.payload?._fetchStats || cold.payload?.performance?.fetchSources || [];
  const requestCount = fetchStats.reduce((a, s) => a + (s.request_count || 0), 0);

  return {
    page: pageId,
    cold_ms: coldMs,
    warm_ms: warmMs,
    cold_cache_hit: cold.cache.hit,
    warm_cache_hit: warm.cache.hit,
    payload_bytes_cold: Buffer.byteLength(JSON.stringify(cold.payload)),
    request_count_cold: requestCount,
    dedup_hits: fetchStats.reduce((a, s) => a + (s.dedup_hits || 0), 0),
  };
}

async function main() {
  loadAuditEnv();
  const filter = process.argv.find((a) => a.startsWith("--page="))?.split("=")[1];
  const pageIds = filter ? [filter] : Object.keys(PAGES);
  const results = [];
  for (const pageId of pageIds) {
    console.log(`Profiling ${pageId}...`);
    results.push(await profilePage(pageId, PAGES[pageId]));
  }
  const out = join(ROOT, "docs/analytics-perf-profile.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.table(results);
  console.log("Written:", out);
}

main().catch((e) => { console.error(e); process.exit(1); });
