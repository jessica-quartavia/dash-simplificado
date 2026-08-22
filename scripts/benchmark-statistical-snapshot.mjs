#!/usr/bin/env node
/**
 * Benchmark Análises Estatísticas — LIVE vs SNAPSHOT (5 cold runs cada).
 *
 * Pré-requisito snapshot: sql aplicado + npm run analytics:refresh-statistical-snapshot
 *
 * node scripts/benchmark-statistical-snapshot.mjs
 * node scripts/benchmark-statistical-snapshot.mjs --runs=3
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuditEnv } from "../lib/analytics/fidelity-audit.mjs";
import { resetAnalyticsCache, CALCULATION_VERSION } from "../lib/cache/analytics-cache.mjs";
import { computeWithPageCache } from "../lib/analytics/handler-cache.mjs";
import { computeStatisticalCrossesPayload } from "../lib/analytics/statistical-crosses.mjs";
import { percentile } from "../lib/analytics/stat-compute-profiler.mjs";
import { statisticalSnapshotStore } from "../lib/analytics/statistical-snapshot-store.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUNS = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] || 5);

function extractRunMetrics(payload, wallMs) {
  const perf = payload?.performance || {};
  const profile = perf.computeProfile || {};
  return {
    wall_ms: wallMs,
    fetch_ms: profile.fetch_ms ?? perf.fetch_ms ?? 0,
    compute_ms: profile.compute_ms ?? perf.compute_ms ?? 0,
    data_source: perf.dataSource || "unknown",
    rest_requests: (payload?._fetchStats || perf.fetchSources || []).reduce(
      (a, s) => a + (s.request_count || 0),
      0,
    ),
    rest_rows: (payload?._fetchStats || perf.fetchSources || []).reduce(
      (a, s) => a + (s.total_rows || 0),
      0,
    ),
    payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
  };
}

function summarizeRuns(runs) {
  const pick = (key) => runs.map((r) => r[key]);
  return {
    wall_p50: percentile(pick("wall_ms"), 0.5),
    wall_min: Math.min(...pick("wall_ms")),
    wall_max: Math.max(...pick("wall_ms")),
    fetch_p50: percentile(pick("fetch_ms"), 0.5),
    compute_p50: percentile(pick("compute_ms"), 0.5),
    requests_p50: percentile(pick("rest_requests"), 0.5),
    rows_p50: percentile(pick("rest_rows"), 0.5),
    payload_p50_kb: Math.round(percentile(pick("payload_bytes"), 0.5) / 1024),
  };
}

function gainPct(before, after) {
  if (!before || !after) return null;
  return Math.round(((before - after) / before) * 1000) / 10;
}

function accessTokenFromArgs(argv) {
  const envToken = String(process.env.ANALYTICS_ACCESS_TOKEN || "").trim();
  if (envToken) return envToken;
  const eq = argv.find((arg) => arg.startsWith("--access-token="));
  if (eq) return eq.slice("--access-token=".length).trim();
  return "";
}

async function runMode(label, options, envPatch = {}) {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    for (const [k, v] of Object.entries(envPatch)) process.env[k] = v;
    resetAnalyticsCache();
    const started = Date.now();
    const { payload } = await computeWithPageCache(
      "statistical_crosses",
      () =>
        computeStatisticalCrossesPayload({
          filters: {},
          perfDebug: true,
          profileCompute: true,
          writeComputeProfile: false,
          ...options,
        }),
      { force: true },
    );
    const metrics = extractRunMetrics(payload, Date.now() - started);
    runs.push(metrics);
    console.log(
      `[${label}] run ${i + 1}/${RUNS}: wall=${metrics.wall_ms}ms fetch=${metrics.fetch_ms}ms compute=${metrics.compute_ms}ms requests=${metrics.rest_requests} source=${metrics.data_source}`,
    );
  }
  return runs;
}

function renderMarkdown(report) {
  const live = report.live.summary;
  const snap = report.snapshot.summary;
  return [
    "# Statistical Snapshot Benchmark — Live vs Snapshot",
    "",
    `Gerado em: ${report.generatedAt}`,
    `Calculation version: \`${report.calculationVersion}\``,
    `Cold runs por modo: ${report.runsPerMode}`,
    `Snapshot disponível: ${report.snapshotAvailable ? "sim" : "não (fallback live esperado)"}`,
    "",
    "## Performance (p50)",
    "",
    "| Métrica | Live | Snapshot | Ganho % |",
    "|---|---:|---:|---:|",
    `| wall_ms | ${live.wall_p50} | ${snap.wall_p50} | ${gainPct(live.wall_p50, snap.wall_p50) ?? "—"} |`,
    `| fetch_ms | ${live.fetch_p50} | ${snap.fetch_p50} | ${gainPct(live.fetch_p50, snap.fetch_p50) ?? "—"} |`,
    `| compute_ms | ${live.compute_p50} | ${snap.compute_p50} | ${gainPct(live.compute_p50, snap.compute_p50) ?? "—"} |`,
    `| rest_requests | ${live.requests_p50} | ${snap.requests_p50} | ${gainPct(live.requests_p50, snap.requests_p50) ?? "—"} |`,
    "",
    "## Meta POC",
    "",
    "- wall p50 < 5000 ms",
    "- redução requests BASE QV > 70%",
    "",
    "## Freshness",
    "",
    `TTL configurado: ${report.ttlMinutes} min`,
    report.snapshotMeta
      ? `- versão ativa: \`${report.snapshotMeta.snapshot_version}\`\n- gerado: ${report.snapshotMeta.snapshot_generated_at}\n- clientes: ${report.snapshotMeta.client_count}`
      : "- snapshot não carregado",
    "",
  ].join("\n");
}

async function main() {
  loadAuditEnv();
  const accessToken = accessTokenFromArgs(process.argv);

  let snapshotAvailable = false;
  let snapshotMeta = null;
  if (accessToken) {
    try {
      snapshotMeta = await statisticalSnapshotStore.readActiveRun({ accessToken });
      snapshotAvailable = Boolean(snapshotMeta?.snapshot_version);
    } catch {
      snapshotAvailable = false;
    }
  } else {
    console.warn("[StatSnapshot] ANALYTICS_ACCESS_TOKEN ausente — modo snapshot usará fallback live.");
  }

  if (!snapshotAvailable) {
    console.warn("[StatSnapshot] Nenhum snapshot ativo — modo snapshot usará fallback live.");
    console.warn("Aplique sql/analytics/011_statistical_client_features.sql e rode analytics:refresh-statistical-snapshot");
  }

  const prevFlag = process.env.STATISTICAL_SNAPSHOT_ENABLED;
  process.env.STATISTICAL_SNAPSHOT_ENABLED = "false";
  console.log("=== LIVE (forceLive) ===");
  const liveRuns = await runMode("LIVE", { forceLive: true });

  console.log("=== SNAPSHOT (STATISTICAL_SNAPSHOT_ENABLED=true) ===");
  const snapshotRuns = await runMode(
    "SNAPSHOT",
    { accessToken: accessToken || undefined },
    { STATISTICAL_SNAPSHOT_ENABLED: "true" },
  );

  if (prevFlag == null) delete process.env.STATISTICAL_SNAPSHOT_ENABLED;
  else process.env.STATISTICAL_SNAPSHOT_ENABLED = prevFlag;

  const report = {
    generatedAt: new Date().toISOString(),
    calculationVersion: CALCULATION_VERSION,
    runsPerMode: RUNS,
    snapshotAvailable,
    snapshotMeta,
    ttlMinutes: 15,
    live: { runs: liveRuns, summary: summarizeRuns(liveRuns) },
    snapshot: { runs: snapshotRuns, summary: summarizeRuns(snapshotRuns) },
  };

  const jsonPath = join(ROOT, "docs/statistical-snapshot-benchmark.json");
  const mdPath = join(ROOT, "docs/statistical-snapshot-benchmark.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(report));
  console.log("Written:", jsonPath);
  console.log("Written:", mdPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
