#!/usr/bin/env node
/**
 * Benchmark Etapa 2 — compara cold/warm/requests/payload antes vs depois.
 * Gera docs/performance-stage2.json e docs/performance-stage2.md
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuditEnv } from "../lib/analytics/fidelity-audit.mjs";
import { resetAnalyticsCache, cacheProviderName, CALCULATION_VERSION } from "../lib/cache/analytics-cache.mjs";
import { computeWithPageCache } from "../lib/analytics/handler-cache.mjs";
import { clearExecutiveSummaryCache } from "../lib/analytics/executive-summary.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BEFORE_PATH = join(ROOT, "docs/performance-baseline.json");

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

const TO_PUBLIC = {
  meetings: () => import("../lib/analytics/meetings.mjs").then((m) => m.toPublicMeetingsPayload),
  mechanisms: () => import("../lib/analytics/mechanisms.mjs").then((m) => m.toPublicMechanismsPayload),
  satisfaction: () => import("../lib/analytics/satisfaction.mjs").then((m) => m.toPublicSatisfactionPayload),
  ep_performance: () => import("../lib/analytics/ep-performance.mjs").then((m) => m.toPublicEpPerformancePayload),
  temporal_indicators: () =>
    import("../lib/analytics/temporal-indicators.mjs").then((m) => m.toPublicTemporalIndicatorsPayload),
  statistical_crosses: () =>
    import("../lib/analytics/statistical-crosses.mjs").then((m) => m.toPublicStatisticalCrossesPayload),
  executive_summary: () =>
    import("../lib/analytics/executive-summary.mjs").then((m) => m.toPublicExecutiveSummaryPayload),
  platform_usage: () => import("../lib/analytics/platform-usage.mjs").then((m) => m.toPublicPlatformUsagePayload),
};

const PAGES = {
  general: async () => {
    const mod = await import("../lib/analytics/general-data.mjs");
    return () => mod.computeGeneralDataPayload({ perfDebug: true });
  },
  journey: async () => {
    const mod = await import("../lib/analytics/onboarding.mjs");
    return () => mod.computeOnboardingPayload();
  },
  meetings: async () => {
    const mod = await import("../lib/analytics/meetings.mjs");
    return () => mod.computeMeetingsPayload({ perfDebug: true });
  },
  patrimonial_plan: async () => {
    const mod = await import("../lib/analytics/patrimonial-plan.mjs");
    return () => mod.computePatrimonialPlanPayload();
  },
  mechanisms: async () => {
    const mod = await import("../lib/analytics/mechanisms.mjs");
    return () => mod.computeMechanismsPayload({ perfDebug: true });
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
    return () => mod.computeSatisfactionPayload({ perfDebug: true });
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

async function publicPayloadBytes(pageId, payload) {
  const loader = TO_PUBLIC[pageId];
  if (!loader) return null;
  try {
    const toPublic = await loader();
    if (typeof toPublic !== "function") return null;
    return Buffer.byteLength(JSON.stringify(toPublic(payload)));
  } catch {
    return null;
  }
}

async function profilePage(pageId, loaderFactory) {
  resetAnalyticsCache();
  clearExecutiveSummaryCache?.();
  const loader = await loaderFactory();
  const coldStarted = Date.now();
  const cold = await computeWithPageCache(pageId, loader, { force: true });
  const coldMs = Date.now() - coldStarted;
  const coldMetrics = extractMetrics(cold.payload, cold.timing);
  const publicBytes = await publicPayloadBytes(pageId, cold.payload);

  const warmStarted = Date.now();
  const warm = await computeWithPageCache(pageId, loader, { force: false });
  const warmMs = Date.now() - warmStarted;

  return {
    page_id: pageId,
    label: PAGE_LABELS[pageId] || pageId,
    cold_ms: coldMs,
    warm_ms: warmMs,
    cache_hit_warm: warm.cache.hit === true,
    cache_provider: warm.cache.provider || cacheProviderName(),
    public_payload_bytes: publicBytes,
    ...coldMetrics,
    warm_payload_bytes: Buffer.byteLength(JSON.stringify(warm.payload)),
  };
}

function pctGain(before, after) {
  if (before == null || after == null || before === 0) return null;
  return Math.round(((before - after) / before) * 1000) / 10;
}

function loadBefore() {
  if (!existsSync(BEFORE_PATH)) return new Map();
  try {
    const prior = JSON.parse(readFileSync(BEFORE_PATH, "utf8"));
    return new Map((prior.results || []).map((row) => [row.page_id, row]));
  } catch {
    return new Map();
  }
}

function renderMarkdown(report) {
  const lines = [
    "# Performance Etapa 2 — Analytics V2",
    "",
    `Gerado em: ${report.generatedAt}`,
    `Calculation version: \`${report.calculationVersion}\``,
    `Baseline antes: \`${report.beforeSource}\``,
    "",
    "## Before / After (cold load)",
    "",
    "| Página | Cold antes | Cold depois | Ganho % | Requests antes | Requests depois | Rows antes | Rows depois | Payload antes KB | Payload depois KB | Public KB |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const row of report.results) {
    const b = row.before || {};
    lines.push(
      `| ${row.label} | ${b.cold_ms ?? "—"} | ${row.cold_ms ?? "—"} | ${row.cold_gain_pct ?? "—"} | ${b.rest_requests ?? "—"} | ${row.rest_requests ?? "—"} | ${b.rest_rows ?? "—"} | ${row.rest_rows ?? "—"} | ${b.payload_bytes ? Math.round(b.payload_bytes / 1024) : "—"} | ${row.payload_bytes ? Math.round(row.payload_bytes / 1024) : "—"} | ${row.public_payload_bytes ? Math.round(row.public_payload_bytes / 1024) : "—"} |`,
    );
  }

  lines.push("", "## Top 5 gargalos (cold depois)", "");
  for (const [index, row] of report.topBottlenecks.entries()) {
    lines.push(`${index + 1}. **${row.label}** — ${row.cold_ms} ms · causa: ${row.primaryCause}`);
  }

  lines.push("", "## Paginação REST (depois)", "", "| Fonte | pageSize | requests | rows | fetch_ms |", "|---|---:|---:|---:|---:|");
  for (const row of report.paginationAudit || []) {
    lines.push(`| ${row.source} | ${row.pageSize} | ${row.request_count} | ${row.total_rows} | ${row.fetch_ms} |`);
  }

  lines.push("", "## Selects reduzidos (canônico contexto)", "", report.selectAudit || "", "");
  lines.push("## Fidelidade", "", report.fidelityNote || "", "");
  lines.push("## Preload", "", report.preloadNote || "", "");
  lines.push("## Próximo gargalo", "", report.nextBottleneck || "", "");
  lines.push("## Recomendação Etapa 3 (RPC — não implementar)", "", report.rpcRecommendation || "", "");
  lines.push("## Segurança", "", "- BASE QV / Pharus read-only", "- V1 intacto", "- RLS intacto", "- Git não executado", "");
  return lines.join("\n");
}

const SELECT_AUDIT = [
  "- **nps_responses / csat_responses (contexto compartilhado):** removidos `raw_payload`, `comment`, `client_name`, `client_email`, `typeform_form_id`",
  "- **Página Satisfação:** mantém select completo via `canonical: false` (precisa de `raw_payload` para fallback de programa)",
  "- **scopeInputs público:** NPS/CSAT slim no `toPublicSatisfactionPayload` (sem raw_payload/comment no wire)",
].join("\n");

const PRELOAD_NOTE =
  "Preloader (`js/page-preloader.js`) inalterado — continua aquecendo páginas via handlers existentes; cache version incrementada para invalidar payloads antigos.";

const RPC_REC =
  "**Primeira RPC candidata:** agregação server-side de `client_meetings` + `meeting_attendance` (KPIs BASE QV: total, recência, frequência, intervalo, no-show) — hoje ~7.5k meetings + ~4.8k attendance dominam requests e cold load em EP/Executive/Reuniões/Estatísticas.";

function primaryCause(row) {
  if ((row.rest_requests || 0) >= 20) return "paginação REST (meetings/clients/attendance)";
  if ((row.payload_bytes || 0) > 2_000_000) return "payload / serialização";
  if ((row.compute_ms || 0) > (row.db_fetch_ms || 0) * 1.2) return "compute";
  if (row.slowest_table === "client_meetings") return "meetings";
  if (row.slowest_table === "meeting_attendance") return "attendance";
  return row.slowest_table || "compute";
}

async function main() {
  loadAuditEnv();
  const beforeMap = loadBefore();
  const filter = process.argv.find((a) => a.startsWith("--page="))?.split("=")[1];
  const pageIds = filter ? [filter] : Object.keys(PAGES);
  const results = [];

  console.log("Benchmark Etapa 2 — provider:", cacheProviderName());
  for (const pageId of pageIds) {
    const factory = PAGES[pageId];
    if (!factory) {
      console.error("Página desconhecida:", pageId);
      process.exit(1);
    }
    console.log(`Profiling ${pageId}...`);
    try {
      const row = await profilePage(pageId, factory);
      const before = beforeMap.get(pageId) || null;
      results.push({
        ...row,
        before,
        cold_gain_pct: pctGain(before?.cold_ms, row.cold_ms),
        requests_gain_pct: pctGain(before?.rest_requests, row.rest_requests),
        payload_gain_pct: pctGain(before?.payload_bytes, row.payload_bytes),
        primaryCause: primaryCause({ ...row, compute_ms: row.compute_ms }),
      });
    } catch (error) {
      console.error(`  FAILED ${pageId}:`, error.message);
      results.push({
        page_id: pageId,
        label: PAGE_LABELS[pageId] || pageId,
        error: error.message,
        before: beforeMap.get(pageId) || null,
      });
    }
  }

  const sorted = results.filter((r) => !r.error).sort((a, b) => (b.cold_ms || 0) - (a.cold_ms || 0));
  const paginationAudit = [];
  for (const row of sorted.slice(0, 6)) {
    for (const source of row.sources || []) {
      paginationAudit.push({
        page: row.label,
        source: source.source,
        pageSize: source.pageSize || "—",
        request_count: source.request_count,
        total_rows: source.total_rows,
        fetch_ms: source.fetch_ms,
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    calculationVersion: CALCULATION_VERSION,
    beforeSource: "docs/performance-baseline.json",
    cacheProvider: cacheProviderName(),
    results: sorted.map((row) => ({
      ...row,
      primaryCause: row.primaryCause || primaryCause(row),
    })),
    topBottlenecks: sorted.slice(0, 5).map((row) => ({
      label: row.label,
      cold_ms: row.cold_ms,
      primaryCause: row.primaryCause || primaryCause(row),
    })),
    paginationAudit,
    selectAudit: SELECT_AUDIT,
    fidelityNote:
      "Testes existentes (executive-summary, ep-executive-ranking, meetings-fidelity, satisfaction-nps, statistical-crosses-parity) devem ser executados pós-benchmark — delta KPIs esperado: zero.",
    preloadNote: PRELOAD_NOTE,
    nextBottleneck: sorted[0]
      ? `${sorted[0].label} (${sorted[0].cold_ms} ms) — ${sorted[0].primaryCause || primaryCause(sorted[0])}`
      : "—",
    rpcRecommendation: RPC_REC,
  };

  const jsonPath = join(ROOT, "docs/performance-stage2.json");
  const mdPath = join(ROOT, "docs/performance-stage2.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(report));
  console.table(
    sorted.map((r) => ({
      page: r.label,
      cold_ms: r.cold_ms,
      cold_gain: r.cold_gain_pct != null ? `${r.cold_gain_pct}%` : "—",
      requests: r.rest_requests,
      req_gain: r.requests_gain_pct != null ? `${r.requests_gain_pct}%` : "—",
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
