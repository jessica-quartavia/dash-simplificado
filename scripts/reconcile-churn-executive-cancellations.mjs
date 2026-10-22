#!/usr/bin/env node
/**
 * Reconciliação DEV — churn 12m Resumo Executivo × Cancelamentos (mesma data analítica).
 * Uso: node scripts/reconcile-churn-executive-cancellations.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function loadDotEnv() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    if (process.env[k] == null || process.env[k] === "") process.env[k] = t.slice(eq + 1).trim();
  }
}
loadDotEnv();
import { runWithAnalyticsDataContext } from "../lib/analytics/analytics-data-context.mjs";
import { buildExecutiveDomainSources } from "../lib/analytics/compute-core.mjs";
import { preloadExecutiveSharedBundle } from "../lib/analytics/executive-shared-bundle.mjs";
import { buildExecutiveContexts } from "../lib/analytics/executive-summary-extractors.mjs";
import { defaultExecutiveSummaryFilters } from "../lib/analytics/executive-summary-filters.mjs";
import {
  buildAnalyticalChurnMonthSeries,
  buildCanonicalAnalyticalChurnRows,
} from "../lib/analytics/canonical-churn-series.mjs";
import { buildChurnMonthClientIndex } from "../lib/analytics/churn-month-index.mjs";
import { distributionsFromCancellationRows } from "../lib/analytics/cancellations-metrics.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "exports/reconcile_churn_executive_cancellations.json");

function rowAuditSnippet(row, reason) {
  return {
    client_id: String(row.clientId ?? row.client_id ?? ""),
    analytical_churn_date: row.analyticalCancellationDate || row.effectiveCancellationDate || null,
    operational_churn_date: row.operationalCancellationDate || row.cancellationDate || null,
    data_fim_ciclo: row.cycleEndDate || null,
    status: row.analyticalStatus || null,
    archived: Boolean(row.isArchived || row.hasArchivedRecord),
    source: row.cancellationDateSource || null,
    reason,
  };
}

async function main() {
  await runWithAnalyticsDataContext(async () => {
    const bundle = await preloadExecutiveSharedBundle();
    const { sources } = await buildExecutiveDomainSources(bundle);
    const filters = defaultExecutiveSummaryFilters();
    const contexts = buildExecutiveContexts(sources, filters);
    const execSeries = contexts.general?.churnMonthSeries || [];
    const cancelRows = buildCanonicalAnalyticalChurnRows(sources, filters);
    const cancelSeries = buildAnalyticalChurnMonthSeries(cancelRows, 12);
    const chartSeries =
      contexts.cancellations?.dist?.byMonthIntentionVsEffective
      || distributionsFromCancellationRows(cancelRows, {}, {}).byMonthIntentionVsEffective
      || [];
    const chartByMonth = new Map(chartSeries.map((r) => [r.month, r.effective ?? r.effectiveCancellations ?? 0]));
    const execIndex = buildChurnMonthClientIndex(cancelRows);
    const cancelIndex = buildChurnMonthClientIndex(cancelRows);
    const rowByClient = new Map(
      (sources.cancellations?.clients || []).map((r) => [String(r.clientId ?? r.client_id ?? ""), r]),
    );
    const months = execSeries.map((r) => r.month);
    const byMonth = months.map((month) => {
      const e = execSeries.find((r) => r.month === month)?.churnClients ?? 0;
      const c = cancelSeries.find((r) => r.month === month)?.churnClients ?? 0;
      const chart = chartByMonth.get(month) ?? 0;
      const execSet = execIndex.get(month) || new Set();
      const cancelSet = cancelIndex.get(month) || new Set();
      const onlyExecutive = [...execSet].filter((id) => !cancelSet.has(id));
      const onlyCancellations = [...cancelSet].filter((id) => !execSet.has(id));
      return {
        month,
        executive: e,
        cancellations: c,
        cancellations_chart_effective: chart,
        difference: e - c,
        chart_difference: chart - e,
        status: e === c && chart === e ? "PASS" : "FAIL",
        only_executive_count: onlyExecutive.length,
        only_cancellations_count: onlyCancellations.length,
        only_executive: onlyExecutive.slice(0, 25).map((id) => rowAuditSnippet(rowByClient.get(id) || { clientId: id }, "only_executive")),
        only_cancellations: onlyCancellations.slice(0, 25).map((id) => rowAuditSnippet(rowByClient.get(id) || { clientId: id }, "only_cancellations")),
      };
    });
    const totalExecutive = execSeries.reduce((s, r) => s + (r.churnClients || 0), 0);
    const totalCancellations = cancelSeries.reduce((s, r) => s + (r.churnClients || 0), 0);
    const doc = {
      generated_at: new Date().toISOString(),
      rule: "analyticalCancellationDate = resolveAnalyticalChurnDate(operational, data_fim_ciclo)",
      churn12m: {
        executive: totalExecutive,
        cancellations: totalCancellations,
        difference: totalExecutive - totalCancellations,
        status: totalExecutive === totalCancellations ? "PASS" : "FAIL",
        field: "analyticalCancellationDate / buildChurnMonthSeries",
      },
      byMonth,
      note: "Para auditoria de ajustes fim de ciclo: node scripts/audit-effective-churn-date.mjs",
    };
    writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf8");
    console.log(JSON.stringify(doc, null, 2));
  }, { page: "reconcile-churn" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
