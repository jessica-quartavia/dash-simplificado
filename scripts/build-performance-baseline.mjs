#!/usr/bin/env node
/**
 * Benchmark Fase A — cold/warm por página analítica.
 * Gera docs/performance-baseline.json e docs/performance-baseline.md
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuditEnv } from "../lib/analytics/fidelity-audit.mjs";
import { resetAnalyticsCache, cacheProviderName, CALCULATION_VERSION } from "../lib/cache/analytics-cache.mjs";
import { computeWithPageCache } from "../lib/analytics/handler-cache.mjs";
import { clearExecutiveSummaryCache } from "../lib/analytics/executive-summary.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const PAGE_LABELS = {
  general: "Dados Gerais",
  journey: "Jornada/Onboarding",
  meetings: "Reuniões",
  patrimonial_plan: "Plano Patrimonial",
  mechanisms: "Mecanismos",
  financial_updates: "Atualização Financeira",
  support: "Acionamentos",
  satisfaction: "Pesquisa de Satisfação",
  cancellations: "Cancelamento",
  renewal: "Renovação",
  ep_performance: "Performance por EP",
  temporal_indicators: "Indicadores Temporais",
  statistical_crosses: "Análises Estatísticas",
  executive_summary: "Resumo Executivo",
  platform_usage: "Uso da Plataforma",
  quality: "Qualidade",
};

const PAGES = {
  general: async () => {
    const mod = await import("../lib/analytics/general-data.mjs");
    return () => mod.computeGeneralDataPayload();
  },
  journey: async () => {
    const mod = await import("../lib/analytics/onboarding.mjs");
    return () => mod.computeOnboardingPayload();
  },
  meetings: async () => {
    const mod = await import("../lib/analytics/meetings.mjs");
    return () => mod.computeMeetingsPayload();
  },
  patrimonial_plan: async () => {
    const mod = await import("../lib/analytics/patrimonial-plan.mjs");
    return () => mod.computePatrimonialPlanPayload();
  },
  mechanisms: async () => {
    const mod = await import("../lib/analytics/mechanisms.mjs");
    return () => mod.computeMechanismsPayload();
  },
  financial_updates: async () => {
    const mod = await import("../lib/analytics/financial-updates.mjs");
    return () => mod.computeFinancialUpdatesPayload();
  },
  support: async () => {
    const mod = await import("../lib/analytics/support.mjs");
    return () => mod.computeSupportPayload({ allowN8nFallback: false });
  },
  satisfaction: async () => {
    const mod = await import("../lib/analytics/satisfaction.mjs");
    return () => mod.computeSatisfactionPayload();
  },
  cancellations: async () => {
    const mod = await import("../lib/analytics/cancellations.mjs");
    return () => mod.computeCancellationsPayload({ perfDebug: true });
  },
  renewal: async () => {
    const mod = await import("../lib/analytics/renewal.mjs");
    return () => mod.computeRenewalPayload();
  },
  ep_performance: async () => {
    const mod = await import("../lib/analytics/ep-performance.mjs");
    return () => mod.computeEpPerformancePayload({ perfDebug: true });
  },
  temporal_indicators: async () => {
    const mod = await import("../lib/analytics/temporal-indicators.mjs");
    return () => mod.computeTemporalIndicatorsPayload({ perfDebug: true });
  },
  statistical_crosses: async () => {
    const mod = await import("../lib/analytics/statistical-crosses.mjs");
    return () => mod.computeStatisticalCrossesPayload({ filters: {}, perfDebug: true });
  },
  executive_summary: async () => {
    const mod = await import("../lib/analytics/executive-summary.mjs");
    mod.clearExecutiveSummaryCache?.();
    return () => mod.computeExecutiveSummaryPayload({}, {}, { force: true, perfDebug: true });
  },
  platform_usage: async () => {
    const mod = await import("../lib/analytics/platform-usage.mjs");
    return () => mod.computePlatformUsagePayload();
  },
  quality: async () => {
    const mod = await import("../lib/analytics/quality.mjs");
    return () => mod.computeQualityPayload({ perfDebug: true });
  },
};

function extractMetrics(payload, timing = {}) {
  const sources = payload?.performance?.fetchSources || payload?._fetchStats || [];
  const restRequests = sources.reduce((a, s) => a + (s.request_count || 0), 0);
  const restRows = sources.reduce((a, s) => a + (s.total_rows || 0), 0);
  const dbFetchMs = sources.length ? Math.max(...sources.map((s) => s.fetch_ms || 0)) : timing.db_fetch_ms || 0;
  const slowest = [...sources].sort((a, b) => (b.fetch_ms || 0) - (a.fetch_ms || 0))[0] || null;
  return {
    rest_requests: restRequests,
    rest_rows: restRows,
    db_fetch_ms: dbFetchMs,
    compute_ms: timing.compute_ms || payload?.timing?.totalMs || payload?.performance?.total_ms || null,
    payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
    slowest_table: slowest?.source || timing.slowest_table || null,
    sources,
  };
}

async function profilePage(pageId, loaderFactory, filters = {}) {
  resetAnalyticsCache();
  clearExecutiveSummaryCache?.();
  const loader = await loaderFactory();
  const coldStarted = Date.now();
  const cold = await computeWithPageCache(pageId, loader, { force: true, filters });
  const coldMs = Date.now() - coldStarted;
  const coldMetrics = extractMetrics(cold.payload, cold.timing);

  const warmStarted = Date.now();
  const warm = await computeWithPageCache(pageId, loader, { force: false, filters });
  const warmMs = Date.now() - warmStarted;

  return {
    page_id: pageId,
    label: PAGE_LABELS[pageId] || pageId,
    cold_ms: coldMs,
    warm_ms: warmMs,
    cache_hit_warm: warm.cache.hit === true,
    cache_provider: warm.cache.provider || cacheProviderName(),
    ...coldMetrics,
    warm_payload_bytes: Buffer.byteLength(JSON.stringify(warm.payload)),
  };
}

function mergePriorBaseline(results, priorPath) {
  if (!existsSync(priorPath)) return results.map((row) => ({ ...row, prior: null }));
  try {
    const prior = JSON.parse(readFileSync(priorPath, "utf8"));
    const byPage = new Map((prior.results || []).map((r) => [r.page_id, r]));
    return results.map((row) => ({ ...row, prior: byPage.get(row.page_id) || null }));
  } catch {
    return results.map((row) => ({ ...row, prior: null }));
  }
}

function renderMarkdown(report) {
  const lines = [
    "# Performance Baseline — Analytics V2",
    "",
    `Gerado em: ${report.generatedAt}`,
    `Calculation version: \`${report.calculationVersion}\``,
    `Cache provider: **${report.cacheProvider}**`,
    "",
    "## Resumo por página (cold compute)",
    "",
    "| Página | Cold ms | Warm ms | Requests | Rows | Payload KB | Tabela mais lenta |",
    "|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const row of report.results) {
    lines.push(
      `| ${row.label} | ${row.cold_ms} | ${row.warm_ms} | ${row.rest_requests} | ${row.rest_rows} | ${Math.round(row.payload_bytes / 1024)} | ${row.slowest_table || "—"} |`,
    );
  }
  lines.push("", "## Top gargalos (cold)", "");
  const sorted = [...report.results].sort((a, b) => b.cold_ms - a.cold_ms);
  for (const row of sorted.slice(0, 10)) {
    lines.push(
      `- **${row.label}** — ${row.cold_ms} ms · ${row.rest_requests} requests · ${Math.round(row.payload_bytes / 1024)} KB · ${row.slowest_table || "—"}`,
    );
  }
  if (report.afterImplementation) {
    lines.push("", "## Before / After (warm)", "", "| Página | Antes warm | Depois warm |", "|---|---:|---:|");
    for (const row of report.results) {
      const before = row.prior?.warm_ms;
      if (before == null) continue;
      lines.push(`| ${row.label} | ${before} | ${row.warm_ms} |`);
    }
  }
  lines.push("", "## RPC candidatos (proposta — não executar SQL nesta rodada)", "");
  for (const item of report.rpcCandidates || []) {
    lines.push(`- **${item.page}** — ${item.summary}`);
  }
  lines.push("", "## Edge Function", "", report.edgeFunctionConclusion || "", "");
  lines.push("## Duplicatas / datasets compartilháveis", "", report.duplicateAudit || "", "");
  return lines.join("\n");
}

const RPC_CANDIDATES = [
  { page: "Análises Estatísticas", summary: "Matrizes NPS/CSAT/meetings — GROUP BY server-side; hoje transfere clients + nps + meetings completos." },
  { page: "Resumo Executivo", summary: "KPIs agregados de múltiplos domínios — candidato a snapshot/RPC após bundle compartilhado estabilizado." },
  { page: "Performance por EP", summary: "Ranking por EP — agregação COUNT/GROUP BY por engenheiro_patrimonial." },
  { page: "Indicadores Temporais", summary: "Séries mensais — bucket por mês no SQL." },
  { page: "Qualidade", summary: "Coverage missing fields — COUNT condicional por coluna." },
  { page: "Reuniões", summary: "KPIs BASE QV agregados; manter Calendly separado." },
];

const EDGE_CONCLUSION =
  "Edge Function **não recomendada nesta fase**. Benchmarks indicam gargalo principal em volume REST + compute JS repetido, não latência Vercel→Supabase isolada. Edge só vale após RPC/agregação server-side comprovada.";

const DUPLICATE_AUDIT =
  "Páginas sem AnalyticsDataContext ainda refetcham clients/meetings/financial independentemente. Executive/EP/Temporal/Cancellations/Quality já deduplicam via contexto + shared bundle. Próximo passo: estender contexto às páginas Class-A restantes.";

async function main() {
  const env = loadAuditEnv();
  const filter = process.argv.find((a) => a.startsWith("--page="))?.split("=")[1];
  const pageIds = filter ? [filter] : Object.keys(PAGES);
  const priorPath = join(ROOT, "docs/performance-baseline-prior.json");
  const results = [];

  console.log("Benchmark Fase A — provider:", cacheProviderName());
  for (const pageId of pageIds) {
    const factory = PAGES[pageId];
    if (!factory) {
      console.error("Página desconhecida:", pageId);
      process.exit(1);
    }
    console.log(`Profiling ${pageId}...`);
    try {
      results.push(await profilePage(pageId, factory));
    } catch (error) {
      console.error(`  FAILED ${pageId}:`, error.message);
      results.push({
        page_id: pageId,
        label: PAGE_LABELS[pageId] || pageId,
        error: error.message,
        cold_ms: null,
        warm_ms: null,
      });
    }
  }

  const merged = mergePriorBaseline(results.filter((r) => !r.error), priorPath);
  const report = {
    generatedAt: new Date().toISOString(),
    calculationVersion: CALCULATION_VERSION,
    cacheProvider: cacheProviderName(),
    envConfigured: env,
    afterImplementation: existsSync(priorPath),
    results: merged.sort((a, b) => (b.cold_ms || 0) - (a.cold_ms || 0)),
    rpcCandidates: RPC_CANDIDATES,
    edgeFunctionConclusion: EDGE_CONCLUSION,
    duplicateAudit: DUPLICATE_AUDIT,
  };

  const jsonPath = join(ROOT, "docs/performance-baseline.json");
  const mdPath = join(ROOT, "docs/performance-baseline.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(report));
  console.table(
    report.results.map((r) => ({
      page: r.label,
      cold_ms: r.cold_ms,
      warm_ms: r.warm_ms,
      requests: r.rest_requests,
      payload_kb: r.payload_bytes ? Math.round(r.payload_bytes / 1024) : "—",
    })),
  );
  console.log("Written:", jsonPath);
  console.log("Written:", mdPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
