#!/usr/bin/env node
/**
 * Auditoria DEV — cancelamentos arquivados vs população analítica (read-only).
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
import { preloadExecutiveSharedBundle } from "../lib/analytics/executive-shared-bundle.mjs";
import { buildExecutiveDomainSources } from "../lib/analytics/compute-core.mjs";
import { buildExecutiveContexts } from "../lib/analytics/executive-summary-extractors.mjs";
import { defaultExecutiveSummaryFilters } from "../lib/analytics/executive-summary-filters.mjs";
import { filterGeneralClients } from "../lib/analytics/general-filters.mjs";
import { executiveFiltersToDomain } from "../lib/analytics/executive-summary-filters.mjs";
import {
  buildAnalyticalCancellationMap,
  clientHasOnlyArchivedCancellationRows,
  isArchivedCancellationRow,
  parseFlexibleDate,
  classifyClientAnalyticalStatus,
  shouldUseClientDataChurnForAnalytical,
} from "../lib/analytics/analytical-cancellation.mjs";
import { buildAnalyticalChurnMonthSeries, buildCanonicalAnalyticalChurnRows } from "../lib/analytics/canonical-churn-series.mjs";
import { buildIntentionVsEffectiveMonthSeries } from "../lib/analytics/cancellations-metrics.mjs";

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "exports/audit_archived_cancellation_global.json");

function statusBucket(label) {
  const s = String(label || "");
  if (s === "Ativo") return "ativos";
  if (s.includes("Congelado")) return "congelados";
  if (s.includes("Cancelado")) return "cancelados";
  return "outros";
}

async function main() {
  await runWithAnalyticsDataContext(async () => {
    const bundle = await preloadExecutiveSharedBundle();
    const cancellationsRaw = bundle.cancellations || [];
    const clients = bundle.clients || [];
    const clientById = new Map(clients.map((c) => [String(c.id), c]));

    const byClient = new Map();
    for (const row of cancellationsRaw) {
      const id = String(row.client_id || "");
      if (!id) continue;
      if (!byClient.has(id)) byClient.set(id, { archived: [], active: [] });
      const bag = byClient.get(id);
      if (isArchivedCancellationRow(row)) bag.archived.push(row);
      else bag.active.push(row);
    }

    let withAnyArchived = 0;
    let onlyArchived = 0;
    let archivedPlusValid = 0;
    const onlyArchivedStatus = { ativos: 0, congelados: 0, cancelados: 0, outros: 0 };
    let onlyArchivedWithDataChurn = 0;
    const onlyArchivedSamples = [];

    const { map: cancelMap } = buildAnalyticalCancellationMap(cancellationsRaw, clients);

    for (const [clientId, bag] of byClient) {
      const hasArchived = bag.archived.length > 0;
      const hasActive = bag.active.length > 0;
      if (hasArchived) withAnyArchived += 1;
      if (hasArchived && !hasActive) {
        onlyArchived += 1;
        const cl = clientById.get(clientId);
        const cancelInfo = cancelMap.get(clientId) || null;
        const analytical = classifyClientAnalyticalStatus(cl?.status, cancelInfo);
        const bucket = statusBucket(analytical.analyticalStatus);
        onlyArchivedStatus[bucket] += 1;
        if (cl?.data_churn) {
          onlyArchivedWithDataChurn += 1;
          if (onlyArchivedSamples.length < 40) {
            onlyArchivedSamples.push({
              client_id: clientId,
              data_churn: cl.data_churn,
              archived_at: bag.archived[0]?.archived_at || null,
              outras_evidencias_validas: Boolean(cancelInfo?.isCancelled),
              status_analitico: analytical.analyticalStatus,
              data_churn_usada: shouldUseClientDataChurnForAnalytical(cl, cancellationsRaw, clientId),
            });
          }
        }
      }
      if (hasArchived && hasActive && cancelMap.get(clientId)?.isCancelled) archivedPlusValid += 1;
    }

    const filters = defaultExecutiveSummaryFilters();
    const { sources } = await buildExecutiveDomainSources(bundle);
    const contexts = buildExecutiveContexts(sources, filters);
    const execChurn = contexts.general?.churnMonthSeries || [];
    const chart = contexts.cancellations?.dist?.byMonthIntentionVsEffective || [];
    const byMonth = execChurn.map((row) => {
      const c = chart.find((m) => m.month === row.month)?.effective ?? 0;
      return { month: row.month, executive: row.churnClients, cancelamentos: c, difference: row.churnClients - c };
    });

    const gf = executiveFiltersToDomain(filters, "general");
    const generalRows = filterGeneralClients(sources.general?.clients || [], gf);
    const activeCanonical = generalRows.filter((r) => r.analyticalStatus === "Ativo").length;
    const execActive = contexts.general?.summary?.activeClients ?? null;
    const countActive = (rows) => (rows || []).filter((r) => r.analyticalStatus === "Ativo").length;
    const meetingsActive = countActive(contexts.meetings?.rows);
    const mechanismsActive = countActive(contexts.mechanisms?.rows);
    const renewalActive = contexts.renewal?.summary?.activeClients ?? countActive(contexts.renewal?.rows);

    const doc = {
      generated_at: new Date().toISOString(),
      rule: "archived_at != null → registro ignorado; data_churn ignorada se só cancellations arquivados",
      audit: {
        clientes_com_algum_archived: withAnyArchived,
        somente_archived: onlyArchived,
        archived_mais_cancelamento_valido: archivedPlusValid,
        somente_archived_status: onlyArchivedStatus,
        somente_archived_com_data_churn: onlyArchivedWithDataChurn,
      },
      data_churn_policy:
        "clients.data_churn é evidência independente, exceto quando 100% dos registros em cancellations do cliente estão arquivados",
      only_archived_samples: onlyArchivedSamples,
      executive_x_cancelamentos_by_month: byMonth,
      churn_12m: {
        executive: execChurn.reduce((s, r) => s + r.churnClients, 0),
        cancelamentos: chart.reduce((s, r) => s + (r.effective || 0), 0),
      },
      active_clients: {
        canonico_dados_gerais: activeCanonical,
        executive_summary: execActive,
        reunioes: meetingsActive,
        mecanismos: mechanismsActive,
        renovacao: renewalActive,
        delta_vs_canonico: {
          executive_summary: (execActive ?? 0) - activeCanonical,
          reunioes: meetingsActive - activeCanonical,
          mecanismos: mechanismsActive - activeCanonical,
          renovacao: (renewalActive ?? 0) - activeCanonical,
        },
      },
    };

    writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf8");
    console.log(
      JSON.stringify(
        { outPath, audit: doc.audit, churn_12m: doc.churn_12m, active_clients: doc.active_clients },
        null,
        2,
      ),
    );
  }, { page: "audit-archived-global" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
