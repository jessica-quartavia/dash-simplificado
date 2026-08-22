#!/usr/bin/env node
/**
 * Profile compute de Análises Estatísticas — 3 cold runs + docs/statistical-compute-profile.json
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuditEnv } from "../lib/analytics/fidelity-audit.mjs";
import { resetAnalyticsCache, CALCULATION_VERSION } from "../lib/cache/analytics-cache.mjs";
import { computeWithPageCache } from "../lib/analytics/handler-cache.mjs";
import { computeStatisticalCrossesPayload } from "../lib/analytics/statistical-crosses.mjs";
import { percentile } from "../lib/analytics/stat-compute-profiler.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUNS = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] || 3);
const PRIOR_PATH = join(ROOT, "docs/performance-stage2.json");

function extractRunMetrics(payload, wallMs) {
  const perf = payload?.performance || {};
  const profile = perf.computeProfile || {};
  const sources = payload?._fetchStats || perf.fetchSources || [];
  return {
    wall_ms: wallMs,
    total_ms: perf.total_ms ?? wallMs,
    fetch_ms: profile.fetch_ms ?? perf.fetch_ms ?? 0,
    compute_ms: profile.compute_ms ?? perf.compute_ms ?? 0,
    serialization_ms: profile.serialization_ms ?? perf.serialization_ms ?? 0,
    rest_requests: sources.reduce((a, s) => a + (s.request_count || 0), 0),
    rest_rows: sources.reduce((a, s) => a + (s.total_rows || 0), 0),
    payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
    blocks: profile.blocks || {},
  };
}

function summarizeRuns(runs) {
  const pick = (key) => runs.map((r) => r[key]);
  return {
    min: Math.min(...pick("wall_ms")),
    p50: percentile(pick("wall_ms"), 0.5),
    max: Math.max(...pick("wall_ms")),
    fetch_p50: percentile(pick("fetch_ms"), 0.5),
    compute_p50: percentile(pick("compute_ms"), 0.5),
    compute_min: Math.min(...pick("compute_ms")),
    compute_max: Math.max(...pick("compute_ms")),
    requests_p50: percentile(pick("rest_requests"), 0.5),
    payload_p50: percentile(pick("payload_bytes"), 0.5),
  };
}

function loadPrior() {
  if (!existsSync(PRIOR_PATH)) return null;
  try {
    const prior = JSON.parse(readFileSync(PRIOR_PATH, "utf8"));
    return prior.results?.find((r) => r.page_id === "statistical_crosses") || null;
  } catch {
    return null;
  }
}

function renderMarkdown(report) {
  const lines = [
    "# Statistical Compute Profile — Etapa 3",
    "",
    `Gerado em: ${report.generatedAt}`,
    `Calculation version: \`${report.calculationVersion}\``,
    `Cold runs: ${report.runs.length}`,
    "",
    "## Performance (wall cold)",
    "",
    "| Métrica | min | p50 | max |",
    "|---|---:|---:|---:|",
    `| total_ms | ${report.summary.min} | ${report.summary.p50} | ${report.summary.max} |`,
    `| fetch_ms | ${Math.min(...report.runs.map((r) => r.fetch_ms))} | ${report.summary.fetch_p50} | ${Math.max(...report.runs.map((r) => r.fetch_ms))} |`,
    `| compute_ms | ${report.summary.compute_min} | ${report.summary.compute_p50} | ${report.summary.compute_max} |`,
    "",
    "## Before / After (p50 wall)",
    "",
    `| Antes (Etapa 2) | Depois (Etapa 3) | Ganho % |`,
    `|---:|---:|---:|`,
    `| ${report.before?.cold_ms ?? "—"} | ${report.summary.p50} | ${report.gain_pct ?? "—"} |`,
    "",
    "## Compute blocks (último run, ms)",
    "",
    "| Bloco | ms |",
    "|---|---:|",
  ];
  const blocks = report.runs[report.runs.length - 1]?.blocks || {};
  for (const [name, ms] of Object.entries(blocks).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${name} | ${ms} |`);
  }
  lines.push("", "## Requests", "", `p50: ${report.summary.requests_p50} (meta: <=29)`, "");
  lines.push("## Payload", "", `p50: ${Math.round(report.summary.payload_p50 / 1024)} KB`, "");
  return lines.join("\n");
}

async function main() {
  loadAuditEnv();
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    resetAnalyticsCache();
    const started = Date.now();
    const { payload } = await computeWithPageCache(
      "statistical_crosses",
      () =>
        computeStatisticalCrossesPayload({
          filters: {},
          perfDebug: true,
          profileCompute: true,
          writeComputeProfile: i === RUNS - 1,
        }),
      { force: true },
    );
    runs.push(extractRunMetrics(payload, Date.now() - started));
    console.log(`Run ${i + 1}/${RUNS}: wall=${runs[runs.length - 1].wall_ms}ms compute=${runs[runs.length - 1].compute_ms}ms requests=${runs[runs.length - 1].rest_requests}`);
  }

  const before = loadPrior();
  const summary = summarizeRuns(runs);
  const gain_pct =
    before?.cold_ms && summary.p50
      ? Math.round(((before.cold_ms - summary.p50) / before.cold_ms) * 1000) / 10
      : null;

  const report = {
    generatedAt: new Date().toISOString(),
    calculationVersion: CALCULATION_VERSION,
    before: before
      ? {
          cold_ms: before.cold_ms,
          compute_ms: before.compute_ms,
          rest_requests: before.rest_requests,
          payload_bytes: before.payload_bytes,
        }
      : null,
    runs,
    summary,
    gain_pct,
  };

  const jsonPath = join(ROOT, "docs/statistical-compute-profile.json");
  const mdPath = join(ROOT, "docs/statistical-compute-profile.md");
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
