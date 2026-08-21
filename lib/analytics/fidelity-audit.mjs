/**
 * Auditoria global de fidelidade V1 × V2 — compute live, sem cache.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyCancellationScope,
  buildMechanismAuditSummary,
  compareSets,
  extractPopulationSet,
  METRIC_IDS,
} from "./fidelity-populations.mjs";
import { defaultMechanismFilters, filterMechanismClients } from "./mechanism-filters.mjs";
import { summarizeMechanismRows } from "./mechanism-metrics.mjs";
import { filterCancellationClients } from "./cancellations-filters.mjs";
import { summarizeCancellationRows, distributionsFromCancellationRows, topCancellationReasonsFromDistribution } from "./cancellations-metrics.mjs";
import {
  computeV1PatrimonialPlanPayload,
  computeV1PlatformUsagePayload,
  computeV1RenewalPayload,
  computeV1SatisfactionPayload,
} from "./fidelity-v1-compute.mjs";
import { buildActiveRiskSignalCountDistribution } from "./temporal-indicators-filters.mjs";
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const V1_ROOT = resolve(ROOT, "../analytics_jornada_cliente/analytics_jornada_cliente/netlify/functions");

export function loadAuditEnv() {
  for (const name of [".env", ".env.local"]) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      const k = t.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
  delete process.env.PHARUS_SUPABASE_SERVICE_ROLE_KEY;
}

export function numbersClose(a, b, tolerance = 0.0001) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) === String(b);
  if (na === nb) return true;
  return Math.abs(na - nb) <= tolerance;
}

export function classifyDifference({ note = "", page, metricId, v1_value, v2_value }) {
  if (note.includes("SOURCE") || note.includes("auth.users") || note.includes("personal_info")) return "SOURCE_DIFFERENCE";
  if (note.includes("FILTER") || note.includes("archived") || note.includes("apples")) return "FILTER_SCOPE_DIFFERENCE";
  if (note.includes("crosswalk") || note.includes("identity")) return "RULE_DIVERGENCE";
  if (page === "platform_usage") {
    if (v1_value == null && v2_value != null) return "SOURCE_DIFFERENCE";
    if (String(metricId || "").includes("users")) return "SOURCE_DIFFERENCE";
  }
  if (v1_value == null && v2_value != null) return "SOURCE_DIFFERENCE";
  return "IMPLEMENTATION_BUG";
}

export function countCompletedOnboarding(payload) {
  if (payload?.summary?.completedOnboarding != null) return payload.summary.completedOnboarding;
  return (payload?.clients || []).filter((row) => row.completedOnboarding === true).length;
}

export function compareScalarMetric(spec) {
  const {
    metric_id, label, page, v1_value, v2_value,
    v1_sample_size = null, v2_sample_size = null,
    tolerance = 0, note = "", v1_path = null, v2_path = null,
    classification: forcedClassification = null,
    status: forcedStatus = null,
  } = spec;
  if (forcedStatus === "EXPECTED_DIFFERENCE") {
    return {
      metric_id, label, page, v1_value, v2_value,
      difference: null, relative_difference: null,
      v1_sample_size, v2_sample_size,
      match: true, classification: forcedClassification || "SOURCE_DIFFERENCE",
      status: "EXPECTED_DIFFERENCE", note, payloadPathV1: v1_path, payloadPathV2: v2_path,
    };
  }
  const match = numbersClose(v1_value, v2_value, tolerance);
  const difference = (Number.isFinite(Number(v1_value)) && Number.isFinite(Number(v2_value)))
    ? Number(v2_value) - Number(v1_value) : null;
  return {
    metric_id, label, page, v1_value, v2_value, difference,
    relative_difference: difference != null && Number(v1_value)
      ? Math.round((difference / Number(v1_value)) * 10000) / 100 : null,
    v1_sample_size, v2_sample_size, match,
    classification: match ? "PASS" : (forcedClassification || classifyDifference({ note, page, metricId: metric_id, v1_value, v2_value })),
    status: match ? "PASS" : (forcedStatus || "DIVERGENT"),
    note, payloadPathV1: v1_path, payloadPathV2: v2_path,
  };
}

async function importV1(relativePath) {
  return import(pathToFileURL(join(V1_ROOT, relativePath)).href);
}

async function importV2(relativePath) {
  return import(pathToFileURL(join(ROOT, "lib/analytics", relativePath)).href);
}

const PAGE_LOADERS = {
  general: {
    v1: async () => (await importV1("general-data.mjs")).computeGeneralDataPayload(),
    v2: async () => (await importV2("general-data.mjs")).computeGeneralDataPayload(),
  },
  journey: {
    v1: async () => (await importV1("onboarding.mjs")).computeOnboardingPayload(),
    v2: async () => (await importV2("onboarding.mjs")).computeOnboardingPayload(),
  },
  meetings: {
    v1: async () => (await importV1("meetings.mjs")).computeMeetingsPayload({ includeMeetingTypes: false }),
    v2: async () => (await importV2("meetings.mjs")).computeMeetingsPayload({ includeMeetingTypes: false }),
  },
  patrimonial_plan: {
    v1: () => computeV1PatrimonialPlanPayload({}),
    v2: async () => (await importV2("patrimonial-plan.mjs")).computePatrimonialPlanPayload({}),
  },
  mechanisms: {
    v1: async () => (await importV1("mechanisms.mjs")).computeMechanismsPayload(),
    v2: async () => (await importV2("mechanisms.mjs")).computeMechanismsPayload(),
  },
  platform_usage: {
    v1: () => computeV1PlatformUsagePayload(),
    v2: async () => (await importV2("platform-usage.mjs")).computePlatformUsagePayload(),
  },
  financial_updates: {
    v1: async () => (await importV1("financial-updates.mjs")).computeFinancialUpdatesPayload(),
    v2: async () => (await importV2("financial-updates.mjs")).computeFinancialUpdatesPayload(),
  },
  support: {
    v1: async () => (await importV1("support.mjs")).computeSupportPayload({ forceRefresh: true }),
    v2: async () => (await importV2("support.mjs")).computeSupportPayload({ forceRefresh: true }),
  },
  satisfaction: {
    v1: () => computeV1SatisfactionPayload(),
    v2: async () => (await importV2("satisfaction.mjs")).computeSatisfactionPayload(),
  },
  cancellations: {
    v1: async () => (await importV1("cancellations.mjs")).computeCancellationsPayload(),
    v2: async () => (await importV2("cancellations.mjs")).computeCancellationsPayload(),
  },
  renewal: {
    v1: () => computeV1RenewalPayload(),
    v2: async () => (await importV2("renewal.mjs")).computeRenewalPayload(),
  },
  ep_performance: {
    v1: async () => (await importV1("ep-performance.mjs")).computeEpPerformancePayload({}),
    v2: async () => (await importV2("ep-performance.mjs")).computeEpPerformancePayload({}),
  },
  temporal_indicators: {
    v1: async () => (await importV1("temporal-indicators.mjs")).computeTemporalIndicatorsPayload(),
    v2: async () => (await importV2("temporal-indicators.mjs")).computeTemporalIndicatorsPayload(),
  },
  statistical_crosses: {
    v1: async () => (await importV1("statistical-crosses.mjs")).computeStatisticalCrossesPayload({}),
    v2: async () => (await importV2("statistical-crosses.mjs")).computeStatisticalCrossesPayload({}),
  },
  quality: {
    v1: async () => importV1("quality.mjs").then((m) => m.default(new Request("http://local")).then((r) => r.json())),
    v2: async () => (await importV2("quality.mjs")).computeQualityPayload(),
  },
  executive_summary: {
    v1: async () => importV1("executive-summary.mjs").then((m) => m.computeExecutiveSummaryPayload(new Request("http://local"))),
    v2: async () => {
      const mod = await importV2("executive-summary.mjs");
      mod.clearExecutiveSummaryCache?.();
      return mod.computeExecutiveSummaryPayload({}, {}, { force: true });
    },
  },
};

export async function computePagePair(pageId) {
  const loaders = PAGE_LOADERS[pageId];
  if (!loaders) throw new Error(`Página desconhecida: ${pageId}`);
  const timing = { v1_ms: null, v2_ms: null, v1_bytes: null, v2_bytes: null };
  let v1 = null; let v2 = null; let v1Error = null; let v2Error = null;
  const started = Date.now();
  const t1 = Date.now();
  try { v1 = await loaders.v1(); } catch (e) { v1Error = e instanceof Error ? e.message : String(e); }
  timing.v1_ms = Date.now() - t1;
  const t2 = Date.now();
  try { v2 = await loaders.v2(); } catch (e) { v2Error = e instanceof Error ? e.message : String(e); }
  timing.v2_ms = Date.now() - t2;
  if (v1) timing.v1_bytes = Buffer.byteLength(JSON.stringify(v1));
  if (v2) timing.v2_bytes = Buffer.byteLength(JSON.stringify(v2));
  return { page: pageId, v1, v2, v1Error, v2Error, timing, total_ms: Date.now() - started };
}

function extractMechanismsSummary(payload) {
  const rows = payload?.clients || [];
  return summarizeMechanismRows(rows, { catalog: payload?.catalog || [], portfolioCount: payload?.portfolio?.length || rows.length });
}

function extractCancellationPair(v1, v2) {
  const rowsV1 = applyCancellationScope(v1?.clients || v1?.rows || [], "v1_ui_default");
  const rowsV2 = filterCancellationClients(v2?.clients || v2?.rows || [], { archived: "no" });
  return { v1: summarizeCancellationRows(rowsV1), v2: summarizeCancellationRows(rowsV2) };
}

export function metricsForPage(pageId, pair) {
  const { v1, v2, v1Error, v2Error } = pair;
  if (v1Error || v2Error) {
    return [{ metric_id: `${pageId}_compute`, label: "Compute", page: pageId, v1_value: null, v2_value: null, match: false, status: "NOT_COMPARABLE", classification: "NOT_COMPARABLE", note: [v1Error, v2Error].filter(Boolean).join(" | ") }];
  }
  const push = (spec) => compareScalarMetric({ page: pageId, ...spec });
  const metrics = [];

  if (pageId === "general") {
    metrics.push(
      push({ metric_id: "gd_total", label: "Total clientes", v1_value: v1.summary?.totalClients, v2_value: v2.summary?.totalClients }),
      push({ metric_id: "gd_active", label: "Ativos", v1_value: v1.summary?.activeClients, v2_value: v2.summary?.activeClients }),
      push({ metric_id: "gd_frozen", label: "Congelados", v1_value: v1.summary?.frozenClients, v2_value: v2.summary?.frozenClients }),
      push({ metric_id: "gd_cancelled", label: "Cancelados", v1_value: v1.summary?.cancelledClients, v2_value: v2.summary?.cancelledClients }),
    );
  } else if (pageId === "mechanisms") {
    const impl = v2.metadata?.consolidationQuality?.totals?.implemented || {};
    metrics.push(
      push({ metric_id: "mech_base_qv", label: "BASE QV com mecanismos", v1_value: v1.crossSourceCoverage?.baseQvClients ?? v1.summary?.clientsWithMechanisms, v2_value: v2.metadata?.consolidationQuality?.clients?.qvClientsWithMechanisms ?? v2.metadata?.consolidationQuality?.clients?.baseQvOnly, note: "população BASE QV" }),
      push({ metric_id: "mech_matched", label: "Crosswalk matchedInBoth", v1_value: v1.crossSourceCoverage?.matchedInBoth, v2_value: v2.metadata?.consolidationQuality?.clients?.matchedInBoth, note: "identity matchPharusToBaseQv" }),
      push({ metric_id: "mech_consolidated", label: "Consolidado pessoas únicas", v1_value: v1.crossSourceCoverage?.consolidatedUniquePeople, v2_value: v2.metadata?.consolidationQuality?.clients?.consolidatedUniquePeople, tolerance: 1, note: "crosswalk matched+baseQvOnly+unmatchedPharus" }),
      push({ metric_id: "mech_pharus_users", label: "Usuários App Pharus", v1_value: v1.crossSourceCoverage?.appPharusUsers, v2_value: v2.metadata?.consolidationQuality?.clients?.pharusUsersWithMechanisms }),
      push({ metric_id: "mech_impl_base", label: "Implementados BASE QV (vínculos)", v1_value: v1.summary?.implementedMechanisms, v2_value: impl.baseQvImplementedLinks, note: "apples-to-apples BASE QV" }),
      push({ metric_id: "mech_impl_pharus", label: "Implementados App Pharus (vínculos)", v1_value: null, v2_value: impl.pharusImplementedLinks, status: "NOT_COMPARABLE", classification: "SOURCE_DIFFERENCE", note: "V1 não separa App Pharus" }),
      push({ metric_id: "mech_impl_consolidated", label: "Implementados consolidado (vínculos)", v1_value: v1.summary?.implementedMechanisms, v2_value: impl.consolidatedImplementedLinks, status: "NOT_COMPARABLE", classification: "FILTER_SCOPE_DIFFERENCE", note: "V1 BASE-only vs V2 consolidado — usar mech_impl_base" }),
    );
  } else if (pageId === "platform_usage") {
    const v1Blocked = !v1?.summary?.totalLogins && !v1?.summary?.totalUsers && (v1?.sources?.warnings?.length || v1?._auditSources?.metricsEvents === 0);
    const platformNote = v1Blocked ? "SOURCE metrics.events/auth.users vs analytics.platform_login_events" : "";
    metrics.push(
      push({ metric_id: "pu_logins", label: "Total logins", v1_value: v1.summary?.totalLogins, v2_value: v2.summary?.totalLogins, note: platformNote, classification: v1Blocked ? "SOURCE_DIFFERENCE" : null, status: v1Blocked ? "NOT_COMPARABLE" : null }),
      push({ metric_id: "pu_users", label: "Usuários", v1_value: v1.summary?.totalUsers, v2_value: v2.summary?.totalUsers, note: "SOURCE auth.users vs view user_id", classification: "SOURCE_DIFFERENCE", status: v1Blocked ? "NOT_COMPARABLE" : null }),
      push({ metric_id: "pu_recency", label: "Mediana dias último acesso", v1_value: v1.summary?.typicalDaysSinceLastAccess, v2_value: v2.summary?.typicalDaysSinceLastAccess, tolerance: 1, note: platformNote, classification: v1Blocked ? "SOURCE_DIFFERENCE" : null, status: v1Blocked ? "NOT_COMPARABLE" : null }),
      push({ metric_id: "pu_events_loaded", label: "Eventos carregados", v1_value: v1.summary?.eventsLoaded ?? v1._auditSources?.metricsEvents, v2_value: v2.summary?.eventsLoaded, note: "reconciliação" }),
      push({ metric_id: "pu_missing_uid", label: "Eventos sem user_id", v1_value: null, v2_value: v2.summary?.eventReconciliation?.excludedMissingUserId, status: "EXPECTED_DIFFERENCE", classification: "SOURCE_DIFFERENCE", note: "V2 breakdown view" }),
    );
  } else if (pageId === "cancellations") {
    const cx = extractCancellationPair(v1, v2);
    const v1Rows = applyCancellationScope(v1?.clients || v1?.rows || [], "v1_ui_default");
    const v2Rows = filterCancellationClients(v2?.clients || v2?.rows || [], { archived: "no" });
    const v1Reasons = topCancellationReasonsFromDistribution(
      distributionsFromCancellationRows(v1Rows, v1?.distributions || {}, v1?.summary || {}).byCategory || [],
    );
    const v2Reasons = topCancellationReasonsFromDistribution(
      distributionsFromCancellationRows(v2Rows, v2?.distributions || {}, v2?.summary || {}).byCategory || [],
    );
    metrics.push(
      push({ metric_id: "cx_effective", label: "Efetivados", v1_value: cx.v1.effectiveCancellations, v2_value: cx.v2.effectiveCancellations, note: "archived=no" }),
      push({ metric_id: "cx_intent", label: "Intenções/pedidos", v1_value: cx.v1.intentionsOrOrdersRegistered, v2_value: cx.v2.intentionsOrOrdersRegistered }),
      push({ metric_id: "cx_process", label: "Em processo", v1_value: cx.v1.inProcessCurrently, v2_value: cx.v2.inProcessCurrently }),
      push({ metric_id: "cx_non_renewal", label: "Não renovações", v1_value: cx.v1.nonRenewals, v2_value: cx.v2.nonRenewals }),
      push({ metric_id: "cx_early", label: "Antes fim ciclo", v1_value: cx.v1.earlyCancellations, v2_value: cx.v2.earlyCancellations }),
      push({
        metric_id: "cx_top_reason_1",
        label: "Top motivo #1",
        v1_value: v1Reasons[0] ? `${v1Reasons[0].label}:${v1Reasons[0].count}` : null,
        v2_value: v2Reasons[0] ? `${v2Reasons[0].label}:${v2Reasons[0].count}` : null,
        note: "byCategory efetivados",
      }),
    );
  } else if (pageId === "meetings") {
    metrics.push(
      push({ metric_id: "mt_total", label: "Total reuniões", v1_value: v1.summary?.totalMeetings, v2_value: v2.summary?.totalMeetings }),
      push({ metric_id: "mt_attendance", label: "Taxa comparecimento", v1_value: v1.summary?.attendanceRate, v2_value: v2.summary?.attendanceRate, tolerance: 0.5 }),
    );
  } else if (pageId === "satisfaction") {
    metrics.push(
      push({ metric_id: "sat_nps", label: "NPS", v1_value: v1.summary?.nps, v2_value: v2.summary?.nps, tolerance: 0.5 }),
      push({ metric_id: "sat_promoters", label: "Promotores", v1_value: v1.summary?.promoters, v2_value: v2.summary?.promoters }),
      push({ metric_id: "sat_neutrals", label: "Neutros", v1_value: v1.summary?.neutrals, v2_value: v2.summary?.neutrals }),
      push({ metric_id: "sat_detractors", label: "Detratores", v1_value: v1.summary?.detractors, v2_value: v2.summary?.detractors }),
      push({ metric_id: "sat_respondents", label: "Respondentes NPS (trimestre)", v1_value: v1.summary?.npsResponses, v2_value: v2.summary?.npsResponses }),
      push({ metric_id: "sat_coverage", label: "Cobertura NPS %", v1_value: v1.summary?.npsCoveragePercent, v2_value: v2.summary?.npsCoveragePercent, tolerance: 0.5 }),
    );
  } else if (pageId === "renewal") {
    metrics.push(
      push({ metric_id: "rn_renewed", label: "Renovados", v1_value: v1.summary?.renewedClients, v2_value: v2.summary?.renewedClients }),
      push({ metric_id: "rn_total", label: "Total renovações", v1_value: v1.summary?.totalRenewals, v2_value: v2.summary?.totalRenewals }),
      push({ metric_id: "rn_eligible", label: "Aptos (ciclo válido)", v1_value: v1.population?.eligibleClients, v2_value: v2.population?.eligibleClients }),
    );
  } else if (pageId === "temporal_indicators") {
    const v1Dist = buildActiveRiskSignalCountDistribution(v1.activeRisk?.clients || []);
    const v2Dist = buildActiveRiskSignalCountDistribution(v2.activeRisk?.clients || []);
    const bucketKey = (dist) => dist.map((row) => `${row.label}=${row.count}`).join("|");
    metrics.push(
      push({ metric_id: "ti_active_with_signals", label: "Ativos com sinais", v1_value: v1.activeRisk?.clientsWithSignals, v2_value: v2.activeRisk?.clientsWithSignals }),
      push({
        metric_id: "ti_signal_intensity",
        label: "Clientes por quantidade de sinais",
        v1_value: bucketKey(v1Dist),
        v2_value: bucketKey(v2Dist),
        note: "activeRisk.clients buckets V1",
      }),
    );
  } else if (pageId === "support") {
    metrics.push(push({ metric_id: "sup_total", label: "Total", v1_value: v1.summary?.totalTickets, v2_value: v2.summary?.totalTickets }));
  } else if (pageId === "journey") {
    metrics.push(
      push({
        metric_id: "on_completed",
        label: "Concluíram onboarding",
        v1_value: countCompletedOnboarding(v1),
        v2_value: countCompletedOnboarding(v2),
        status: "EXPECTED_DIFFERENCE",
        classification: "INTENTIONAL_V2_METHOD_CHANGE",
        note: "V1: minDate(client_meetings) sem comparecimento; V2: primeira reunião válida (compareceu). 38 only_v1 sem attendance, 1 no-show, 6 only_v2 com attendance.",
      }),
    );
  } else if (pageId === "financial_updates") {
    metrics.push(push({ metric_id: "fin_updated", label: "Atualizados", v1_value: v1.summary?.clientsWithFinancialUpdate, v2_value: v2.summary?.clientsWithFinancialUpdate }));
  } else if (pageId === "executive_summary") {
    for (const row of v2?.comparison?.rows || []) {
      if (row.pending) continue;
      metrics.push(push({
        metric_id: `exec_${row.metricId}`,
        label: row.label,
        v1_value: row.sourceValue,
        v2_value: row.executiveValue,
        note: `assertion vs ${row.sourcePage}`,
      }));
    }
  }

  return metrics;
}

export async function runFullAudit({ pages = null } = {}) {
  loadAuditEnv();
  const pageIds = pages || Object.keys(PAGE_LOADERS);
  const results = [];
  for (const pageId of pageIds) {
    const pair = await computePagePair(pageId);
    results.push({ page: pageId, metrics: metricsForPage(pageId, pair), timing: pair.timing, total_ms: pair.total_ms, v1Error: pair.v1Error, v2Error: pair.v2Error });
  }
  const flat = results.flatMap((r) => r.metrics);
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      compared: flat.length,
      pass: flat.filter((m) => m.status === "PASS").length,
      divergent: flat.filter((m) => m.status === "DIVERGENT").length,
      expected_difference: flat.filter((m) => m.status === "EXPECTED_DIFFERENCE").length,
      not_comparable: flat.filter((m) => m.status === "NOT_COMPARABLE").length,
      blocked: results.filter((r) => r.v1Error || r.v2Error).length,
    },
    slowest: [...results].sort((a, b) => (b.timing?.v2_ms || 0) - (a.timing?.v2_ms || 0)).slice(0, 5).map((r) => ({ page: r.page, v1_ms: r.timing.v1_ms, v2_ms: r.timing.v2_ms })),
    pages: results,
  };
}

export function formatAuditMarkdown(report) {
  const lines = [
    "# Auditoria V1 × V2",
    "",
    `Gerado: ${report.generatedAt}`,
    "",
    "## Totais",
    `- Comparadas: ${report.totals.compared}`,
    `- PASS: ${report.totals.pass}`,
    `- Divergentes: ${report.totals.divergent}`,
    `- Esperadas: ${report.totals.expected_difference}`,
    "",
    "## Divergências",
    "",
    "| Página | Métrica | V1 | V2 | Causa | Status |",
    "|---|---|---:|---:|---|---|",
  ];
  for (const m of report.pages.flatMap((p) => p.metrics)) {
    if (m.status === "PASS" || m.status === "EXPECTED_DIFFERENCE") continue;
    lines.push(`| ${m.page} | ${m.label} | ${m.v1_value ?? "—"} | ${m.v2_value ?? "—"} | ${m.classification} | ${m.status} |`);
  }
  lines.push("", "## Performance V2 (top 5)", "");
  for (const s of report.slowest) lines.push(`- ${s.page}: V1 ${s.v1_ms}ms · V2 ${s.v2_ms}ms`);
  return lines.join("\n");
}

export function writeAuditReport(report, options = {}) {
  const base = options.basename || "v1-v2-fidelity-audit";
  const jsonPath = join(ROOT, `docs/${base}.json`);
  const mdPath = join(ROOT, `docs/${base}.md`);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, formatAuditMarkdown(report));
  return { jsonPath, mdPath };
}
