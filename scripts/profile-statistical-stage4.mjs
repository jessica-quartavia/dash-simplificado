#!/usr/bin/env node
/**
 * Profile Etapa 4 — cancelamento + renovação (5 cold runs).
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
const RUNS = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] || 5);
const STAGE3_PATH = join(ROOT, "docs/statistical-compute-profile.json");

function blockMs(blocks, prefix) {
  if (!blocks) return 0;
  return Object.entries(blocks)
    .filter(([k]) => k === prefix || k.startsWith(`${prefix}.`))
    .reduce((sum, [, ms]) => sum + ms, 0);
}

function extractRunMetrics(payload, wallMs) {
  const perf = payload?.performance || {};
  const profile = perf.computeProfile || {};
  const blocks = profile.blocks || {};
  return {
    wall_ms: wallMs,
    total_ms: perf.total_ms ?? wallMs,
    fetch_ms: profile.fetch_ms ?? perf.fetch_ms ?? 0,
    compute_ms: profile.compute_ms ?? perf.compute_ms ?? 0,
    cancelamento_ms: blocks.cancelamento ?? blockMs(blocks, "cancelamento"),
    renovacao_ms: blocks.renovacao ?? blockMs(blocks, "renovacao"),
    rest_requests: (payload?._fetchStats || perf.fetchSources || []).reduce((a, s) => a + (s.request_count || 0), 0),
    payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
    blocks,
  };
}

function summarizeRuns(runs) {
  const pick = (key) => runs.map((r) => r[key]);
  return {
    wall_min: Math.min(...pick("wall_ms")),
    wall_p50: percentile(pick("wall_ms"), 0.5),
    wall_p95: percentile(pick("wall_ms"), 0.95),
    wall_max: Math.max(...pick("wall_ms")),
    fetch_p50: percentile(pick("fetch_ms"), 0.5),
    compute_min: Math.min(...pick("compute_ms")),
    compute_p50: percentile(pick("compute_ms"), 0.5),
    compute_max: Math.max(...pick("compute_ms")),
    cancelamento_p50: percentile(pick("cancelamento_ms"), 0.5),
    renovacao_p50: percentile(pick("renovacao_ms"), 0.5),
    requests_p50: percentile(pick("rest_requests"), 0.5),
    payload_p50: percentile(pick("payload_bytes"), 0.5),
  };
}

function loadStage3() {
  if (!existsSync(STAGE3_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STAGE3_PATH, "utf8"));
  } catch {
    return null;
  }
}

function subBlockTable(blocks, prefix) {
  return Object.entries(blocks || {})
    .filter(([k]) => k.startsWith(`${prefix}.`))
    .sort((a, b) => b[1] - a[1])
    .map(([k, ms]) => ({ sub: k.replace(`${prefix}.`, ""), ms }));
}

function renderMarkdown(report) {
  const b = report.before?.summary || {};
  const a = report.summary;
  const gain = (before, after) =>
    before && after ? Math.round(((before - after) / before) * 1000) / 10 : null;

  const lines = [
    "# Statistical Stage 4 Profile — Cancelamento + Renovação",
    "",
    `Gerado em: ${report.generatedAt}`,
    `Calculation version: \`${report.calculationVersion}\``,
    `Cold runs: ${report.runs.length}`,
    "",
    "## Performance (5 cold runs)",
    "",
    "| Métrica | min | p50 | p95/max |",
    "|---|---:|---:|---:|",
    `| wall_ms | ${a.wall_min} | ${a.wall_p50} | ${a.wall_max} |`,
    `| fetch_ms | ${Math.min(...report.runs.map((r) => r.fetch_ms))} | ${a.fetch_p50} | ${Math.max(...report.runs.map((r) => r.fetch_ms))} |`,
    `| compute_ms | ${a.compute_min} | ${a.compute_p50} | ${a.compute_max} |`,
    `| cancelamento_ms | ${Math.min(...report.runs.map((r) => r.cancelamento_ms))} | ${a.cancelamento_p50} | ${Math.max(...report.runs.map((r) => r.cancelamento_ms))} |`,
    `| renovacao_ms | ${Math.min(...report.runs.map((r) => r.renovacao_ms))} | ${a.renovacao_p50} | ${Math.max(...report.runs.map((r) => r.renovacao_ms))} |`,
    "",
    "## Before / After (Etapa 3 → 4, p50)",
    "",
    "| Métrica | Antes | Depois | Ganho % |",
    "|---|---:|---:|---:|",
    `| wall_ms | ${b.wall_p50 ?? b.p50 ?? "—"} | ${a.wall_p50} | ${gain(b.wall_p50 ?? b.p50, a.wall_p50) ?? "—"} |`,
    `| compute_ms | ${b.compute_p50 ?? "—"} | ${a.compute_p50} | ${gain(b.compute_p50, a.compute_p50) ?? "—"} |`,
    `| cancelamento_ms | ${report.before?.cancelamento_p50 ?? "—"} | ${a.cancelamento_p50} | ${gain(report.before?.cancelamento_p50, a.cancelamento_p50) ?? "—"} |`,
    `| renovacao_ms | ${report.before?.renovacao_p50 ?? "—"} | ${a.renovacao_p50} | ${gain(report.before?.renovacao_p50, a.renovacao_p50) ?? "—"} |`,
    "",
    "## Cancelamento — subetapas (último run)",
    "",
    "| Subetapa | ms |",
    "|---|---:|",
  ];
  for (const row of subBlockTable(report.runs[report.runs.length - 1]?.blocks, "cancelamento")) {
    lines.push(`| ${row.sub} | ${row.ms} |`);
  }
  lines.push("", "## Renovação — subetapas (último run)", "", "| Subetapa | ms |", "|---|---:|");
  for (const row of subBlockTable(report.runs[report.runs.length - 1]?.blocks, "renovacao")) {
    lines.push(`| ${row.sub} | ${row.ms} |`);
  }
  lines.push("", "## Requests", "", `p50: ${a.requests_p50} (meta: <=29)`, "");
  lines.push("## Payload", "", `p50: ${Math.round(a.payload_p50 / 1024)} KB`, "");
  return lines.join("\n");
}

async function main() {
  loadAuditEnv();
  const stage3 = loadStage3();
  const stage3Blocks = stage3?.runs?.[stage3.runs.length - 1]?.blocks || {};
  const before = stage3
    ? {
        summary: stage3.summary,
        cancelamento_p50: stage3Blocks.cancelamento ?? blockMs(stage3Blocks, "cancelamento"),
        renovacao_p50: stage3Blocks.renovacao ?? blockMs(stage3Blocks, "renovacao"),
      }
    : null;

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
          writeComputeProfile: false,
        }),
      { force: true },
    );
    runs.push(extractRunMetrics(payload, Date.now() - started));
    console.log(
      `Run ${i + 1}/${RUNS}: wall=${runs[runs.length - 1].wall_ms}ms compute=${runs[runs.length - 1].compute_ms}ms cancel=${runs[runs.length - 1].cancelamento_ms}ms renewal=${runs[runs.length - 1].renovacao_ms}ms`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    calculationVersion: CALCULATION_VERSION,
    before,
    runs,
    summary: summarizeRuns(runs),
  };

  const jsonPath = join(ROOT, "docs/statistical-stage4-profile.json");
  const mdPath = join(ROOT, "docs/statistical-stage4-profile.md");
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
