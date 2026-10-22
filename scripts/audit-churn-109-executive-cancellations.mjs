#!/usr/bin/env node
/**
 * Auditoria DEV — explica diferença Executive × Cancelamentos (ex.: +109 com archived:all).
 * Uso: node scripts/audit-churn-109-executive-cancellations.mjs
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
import { defaultExecutiveSummaryFilters, executiveFiltersToDomain } from "../lib/analytics/executive-summary-filters.mjs";
import { filterCancellationClients } from "../lib/analytics/cancellations-filters.mjs";
import { filterGeneralClients } from "../lib/analytics/general-filters.mjs";
import {
  buildAnalyticalChurnMonthSeries,
  buildCanonicalAnalyticalChurnRows,
} from "../lib/analytics/canonical-churn-series.mjs";
import { buildChurnMonthClientIndex } from "../lib/analytics/churn-month-index.mjs";
import { isExcludedClient } from "../lib/analytics/data-exclusions.mjs";
import { rowCountsForAnalyticalChurn, analyticalCancellationDateFromRow } from "../lib/analytics/analytical-cancellation.mjs";
import { buildIntentionVsEffectiveMonthSeries } from "../lib/analytics/cancellations-metrics.mjs";
import { monthKey } from "../lib/analytics/general-metrics.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, "exports/audit_churn_109_executive_only.json");

function classifySource(row) {
  const src = String(row.cancellationDateSource || row.analyticalSource || "").toLowerCase();
  if (src.includes("churn_efetivado") || src.includes("efetivado")) return "churn_efetivado_at";
  if (src.includes("distrato") && src.includes("assinado") && !row.hasConfirmedDate) return "distrato_assinado_sem_data";
  if (src.includes("distrato")) return "distrato_assinado_at";
  if (src.includes("data_churn") || src.includes("client")) return "clients.data_churn";
  return src || "unknown";
}

function auditRow(row, reason) {
  const d = analyticalCancellationDateFromRow(row);
  return {
    client_id: String(row.clientId ?? row.client_id ?? ""),
    analytical_churn_date: d ? d.toISOString().slice(0, 10) : null,
    operational_churn_date: row.operationalCancellationDate || row.cancellationDate || null,
    data_fim_ciclo: row.cycleEndDate || null,
    analytical_status: row.analyticalStatus || null,
    cancellation_is_cancelled: row.hasEfetivado ?? null,
    hasConfirmedDate: row.hasConfirmedDate ?? null,
    archived: Boolean(row.isArchived || row.hasArchivedRecord),
    source: classifySource(row),
    excluido_por_regra_de_teste: isExcludedClient(row),
    motivo: reason,
  };
}

async function main() {
  await runWithAnalyticsDataContext(async () => {
    const bundle = await preloadExecutiveSharedBundle();
    const { sources } = await buildExecutiveDomainSources(bundle);
    const filters = defaultExecutiveSummaryFilters();
    const cancelFilters = executiveFiltersToDomain(filters, "cancellations");

    const canonicalRows = buildCanonicalAnalyticalChurnRows(sources, filters);
    const legacyExecutiveRows = filterCancellationClients(sources.cancellations?.clients || [], {
      ...cancelFilters,
      archived: "all",
    });

    const gf = executiveFiltersToDomain(filters, "general");
    const portfolioFilters = { ...gf, status: "all" };
    const generalChurnRows = filterGeneralClients(sources.general?.clients || [], portfolioFilters).filter((r) =>
      rowCountsForAnalyticalChurn(r),
    );

    const now = new Date();
    const canonicalSeries = buildAnalyticalChurnMonthSeries(canonicalRows, 12, now);
    const legacySeries = buildAnalyticalChurnMonthSeries(legacyExecutiveRows, 12, now);
    const generalSeries = buildAnalyticalChurnMonthSeries(generalChurnRows, 12, now);
    const chartSeries = buildIntentionVsEffectiveMonthSeries(canonicalRows, { active: false }, now);

    const legacyIndex = buildChurnMonthClientIndex(legacyExecutiveRows, now);
    const canonicalIndex = buildChurnMonthClientIndex(canonicalRows, now);
    const rowById = new Map(
      (sources.cancellations?.clients || []).map((r) => [String(r.clientId ?? r.client_id ?? ""), r]),
    );

    const allOnlyLegacy = new Set();
    for (const [, set] of legacyIndex) {
      for (const id of set) {
        if (!id.startsWith("__anon")) allOnlyLegacy.add(id);
      }
    }
    for (const [, set] of canonicalIndex) {
      for (const id of set) {
        if (!id.startsWith("__anon")) allOnlyLegacy.delete(id);
      }
    }

    const onlyLegacyRecords = [...allOnlyLegacy].map((id) => {
      const row = rowById.get(id) || { clientId: id };
      return {
        ...auditRow(row, "only_legacy_executive_archived_all"),
        motivo_por_que_entra_no_executive: "Filtro legacy archived:all inclui registro arquivado com churn analítico",
        motivo_por_que_nao_entra_em_cancelamentos: "Página Cancelamentos usa archived:no (padrão V2)",
      };
    });

    const breakdown = {
      archived: onlyLegacyRecords.filter((r) => r.archived).length,
      teste: onlyLegacyRecords.filter((r) => r.excluido_por_regra_de_teste).length,
      clients_data_churn: onlyLegacyRecords.filter((r) => r.source === "clients.data_churn").length,
      churn_efetivado_at: onlyLegacyRecords.filter((r) => r.source === "churn_efetivado_at").length,
      distrato_assinado_at: onlyLegacyRecords.filter((r) => r.source === "distrato_assinado_at").length,
      distrato_assinado_sem_data: onlyLegacyRecords.filter((r) => r.source === "distrato_assinado_sem_data").length,
      outros: onlyLegacyRecords.filter(
        (r) =>
          !r.archived
          && !r.excluido_por_regra_de_teste
          && !["clients.data_churn", "churn_efetivado_at", "distrato_assinado_at", "distrato_assinado_sem_data"].includes(
            r.source,
          ),
      ).length,
    };

    const months = canonicalSeries.map((r) => r.month);
    const byMonth = months.map((month) => {
      const legacy = legacySeries.find((r) => r.month === month)?.churnClients ?? 0;
      const canonical = canonicalSeries.find((r) => r.month === month)?.churnClients ?? 0;
      const chart = chartSeries.find((r) => r.month === month)?.effective ?? 0;
      const general = generalSeries.find((r) => r.month === month)?.churnClients ?? 0;
      const legSet = legacyIndex.get(month) || new Set();
      const canSet = canonicalIndex.get(month) || new Set();
      const onlyExecutive = [...legSet].filter((id) => !canSet.has(id));
      const onlyCancellations = [...canSet].filter((id) => !legSet.has(id));
      return {
        month,
        executive_legacy: legacy,
        cancelamentos_canonical: canonical,
        chart_effective: chart,
        general_clients_fallback: general,
        difference_legacy_minus_canonical: legacy - canonical,
        only_executive_count: onlyExecutive.length,
        only_cancellations_count: onlyCancellations.length,
        only_executive: onlyExecutive.slice(0, 15).map((id) => auditRow(rowById.get(id) || { clientId: id }, "only_executive_month")),
      };
    });

    const doc = {
      generated_at: new Date().toISOString(),
      root_cause:
        "Executive legacy usava archived:all na população de churn; Cancelamentos (gráfico effective) usa archived:no. Diferença = churn de registros arquivados, não regra de data.",
      data_rule: "effectiveCancellationDate = resolveAnalyticalChurnDate(operational, data_fim_ciclo) — inalterada",
      totals_12m: {
        executive_legacy_archived_all: legacySeries.reduce((s, r) => s + r.churnClients, 0),
        cancelamentos_canonical: canonicalSeries.reduce((s, r) => s + r.churnClients, 0),
        difference: legacySeries.reduce((s, r) => s + r.churnClients, 0) - canonicalSeries.reduce((s, r) => s + r.churnClients, 0),
        general_clients_churn_total: generalSeries.reduce((s, r) => s + r.churnClients, 0),
      },
      only_legacy_executive_unique_clients: onlyLegacyRecords.length,
      breakdown_109: breakdown,
      only_legacy_executive_clients: onlyLegacyRecords,
      byMonth,
      canonical_builder: "buildCanonicalAnalyticalChurnRows + buildAnalyticalChurnMonthSeries",
    };

    writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf8");
    console.log(JSON.stringify({ totals: doc.totals_12m, breakdown: doc.breakdown_109, outPath }, null, 2));
  }, { page: "audit-churn-109" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
