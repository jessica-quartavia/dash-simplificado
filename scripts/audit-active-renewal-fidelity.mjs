/**
 * Auditoria fidelidade — clientes ativos × renovação (BASE QV live, read-only).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    parsed[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return parsed;
}

for (const [k, v] of Object.entries(parseEnvFile(resolve(root, ".env")))) {
  if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
}

import {
  isEffectiveCancelledStatus,
  isConfirmedCancelledStatus,
  isEffectiveCancelledWithoutDateStatus,
  ANALYTICAL_STATUS,
} from "../lib/analytics/analytical-cancellation.mjs";
import { filterGeneralClients, defaultGeneralFilters } from "../lib/analytics/general-filters.mjs";
import { summarizeGeneralRows } from "../lib/analytics/general-metrics.mjs";
import { filterRenewalClients, defaultRenewalFilters } from "../lib/analytics/renewal-filters.mjs";
import { summarizeRenewalRows } from "../lib/analytics/renewal-metrics.mjs";
import { renewalFromClient, countRenewedClients, sumRenewalCounts } from "../lib/analytics/client-cycle-renewal.mjs";
import { buildExecutiveContexts, extractExecutiveMetrics } from "../lib/analytics/executive-summary-extractors.mjs";
import { buildExecutiveDomainSources } from "../lib/analytics/compute-core.mjs";
import { defaultExecutiveSummaryFilters } from "../lib/analytics/executive-summary-filters.mjs";
import {
  buildCanonicalRenewalPopulation,
  summarizeRenewalPopulation,
} from "../lib/analytics/internal-mechanisms-renewal-population.mjs";
import { loadMechanismsSatisfactionDataset } from "../lib/analytics/mechanisms-satisfaction-dataset.mjs";
import { computeGeneralDataPayload } from "../lib/analytics/general-data.mjs";
import { computeRenewalPayload } from "../lib/analytics/renewal.mjs";
import { applyMeetingFilters, defaultMeetingFilters } from "../lib/analytics/meeting-filters.mjs";
import { summarizeMeetingRows } from "../lib/analytics/meeting-metrics.mjs";

function foldToken(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isRawArchived(rawStatus) {
  const t = foldToken(rawStatus);
  return t.includes("arquiv");
}

function activeFunnel(clients) {
  const list = clients || [];
  const total = list.length;
  const rawArchived = list.filter((c) => isRawArchived(c.rawStatus ?? c.status)).length;
  const frozen = list.filter((c) => c.analyticalStatus === ANALYTICAL_STATUS.FROZEN).length;
  const cancelledEffective = list.filter((c) => isEffectiveCancelledStatus(c.analyticalStatus)).length;
  const activeOfficial = list.filter((c) => c.analyticalStatus === ANALYTICAL_STATUS.ACTIVE).length;
  const activeWithCycleValid = list.filter(
    (c) => c.analyticalStatus === ANALYTICAL_STATUS.ACTIVE && c.cycleValid === true,
  ).length;
  const activeWithoutCycleValid = activeOfficial - activeWithCycleValid;
  return {
    total,
    rawArchived,
    frozen,
    cancelledEffective,
    activeOfficial,
    activeWithCycleValid,
    activeWithoutCycleValid,
  };
}

function renewalFunnel(clients) {
  const list = clients || [];
  const active = list.filter((c) => c.analyticalStatus === ANALYTICAL_STATUS.ACTIVE);
  const withCycle = active.filter((c) => c.currentCycle != null && Number.isFinite(c.currentCycle));
  const cycleValid = active.filter((c) => c.cycleValid === true);
  const cycle1 = cycleValid.filter((c) => c.currentCycle === 1);
  const ge2 = cycleValid.filter((c) => (c.currentCycle || 0) >= 2);
  const ge3 = cycleValid.filter((c) => (c.currentCycle || 0) >= 3);
  const ge4 = cycleValid.filter((c) => (c.currentCycle || 0) >= 4);
  return {
    totalClients: list.length,
    active: active.length,
    activeWithCycleInformed: withCycle.length,
    activeCycleValid: cycleValid.length,
    activeCycle1: cycle1.length,
    activeCycleGe2: ge2.length,
    activeCycleGe3: ge3.length,
    activeCycleGe4: ge4.length,
  };
}

function sumRenewalCountsScoped(rows, predicate) {
  let n = 0;
  for (const r of rows || []) {
    if (predicate && !predicate(r)) continue;
    n += Math.max(0, r.renewalCount ?? renewalFromClient(r).renewalCount);
  }
  return n;
}

function countRenewedScoped(rows, predicate) {
  let n = 0;
  for (const r of rows || []) {
    if (predicate && !predicate(r)) continue;
    const renewed = r.renewed === true || renewalFromClient(r).hasRenewed;
    if (renewed) n += 1;
  }
  return n;
}

function exclusionReason(row) {
  if (!row.cycleValid) {
    const r = renewalFromClient(row);
    return r.invalidReason || "cycle_invalid";
  }
  if (!row.renewed && (row.currentCycle || 0) >= 2) return "renewed_flag_mismatch";
  return "eligible_renewed";
}

function diagnoseRenewalExclusions(renewalRows) {
  const ge2Raw = renewalRows.filter((r) => {
    const c = renewalFromClient(r).currentCycle;
    return c != null && c >= 2;
  });
  const renewedOfficial = renewalRows.filter((r) => r.cycleValid && r.renewed);
  const renewedIds = new Set(renewedOfficial.map((r) => String(r.clientId)));
  const excluded = ge2Raw.filter((r) => !renewedIds.has(String(r.clientId)));
  const byReason = new Map();
  for (const row of excluded) {
    let motivo = "unknown";
    if (!row.cycleValid) {
      motivo = `cycleValid_false:${renewalFromClient(row).invalidReason || "invalid"}`;
    } else if (!row.renewed) {
      motivo = "ciclo>=2_mas_renewed_false";
    }
    byReason.set(motivo, (byReason.get(motivo) || 0) + 1);
  }
  return {
    ge2RawCount: ge2Raw.length,
    renewedOfficialCount: renewedOfficial.length,
    excludedCount: excluded.length,
    byReason: [...byReason.entries()].map(([motivo, quantidade]) => ({ motivo, quantidade })),
    sample: excluded.slice(0, 5).map((r) => ({
      client_id: r.clientId,
      ciclo: r.currentCycle,
      analytical_status: r.analyticalStatus,
      cycleValid: r.cycleValid,
      motivo_exclusao: exclusionReason(r),
    })),
  };
}

const generalPayload = await computeGeneralDataPayload();
const renewalPayload = await computeRenewalPayload();
const execFilters = defaultExecutiveSummaryFilters();
const execSources = await buildExecutiveDomainSources();
const execContexts = buildExecutiveContexts(execSources, execFilters);
const execMetrics = extractExecutiveMetrics(execContexts);

const allGeneral = generalPayload.clients || [];
const funnel = activeFunnel(
  allGeneral.map((c) => ({
    ...c,
    rawStatus: c.rawStatus ?? c.status,
    cycleValid: c.cycleValid ?? renewalFromClient(c).valid,
  })),
);

const generalFiltered = filterGeneralClients(allGeneral, defaultGeneralFilters());
const generalSummary = summarizeGeneralRows(generalFiltered);

const renewalAllRows = renewalPayload.clients || [];
const renewalDefaultSummary = summarizeRenewalRows(filterRenewalClients(renewalAllRows, defaultRenewalFilters()));
const renewalActiveSummary = summarizeRenewalRows(
  filterRenewalClients(renewalAllRows, { ...defaultRenewalFilters(), status: "active" }),
);

let imsPopulation = null;
try {
  const imsDataset = await loadMechanismsSatisfactionDataset();
  const wide = imsDataset.wideClients || imsDataset.clients || [];
  const pop = buildCanonicalRenewalPopulation(wide, { status: "active" });
  imsPopulation = {
    count: pop.length,
    summary: summarizeRenewalPopulation(pop),
  };
} catch (e) {
  imsPopulation = { error: e.message };
}

const meetingRows = applyMeetingFilters(execSources.meetings?.clients || [], {
  ...defaultMeetingFilters(),
  status: "active",
});
const meetingSummary = summarizeMeetingRows(meetingRows);

const renewalFunnelAll = renewalFunnel(renewalAllRows);
const renewalFunnelActive = renewalFunnel(
  renewalAllRows.filter((c) => c.analyticalStatus === ANALYTICAL_STATUS.ACTIVE),
);

const exclusions = diagnoseRenewalExclusions(renewalAllRows);

const totalRenewalsBreakdown = {
  allClients: sumRenewalCounts(renewalAllRows),
  allClients_rawHasRenewed: sumRenewalCountsScoped(renewalAllRows, null),
  activeOfficial: sumRenewalCountsScoped(renewalAllRows, (r) => r.analyticalStatus === "Ativo"),
  activeCycleValid: sumRenewalCountsScoped(
    renewalAllRows,
    (r) => r.analyticalStatus === "Ativo" && r.cycleValid,
  ),
  pagePopulation_summarizeRenewalRows: renewalDefaultSummary.totalRenewals,
  payloadBuildRenewal_summary: renewalPayload.summary?.totalRenewals,
};

const renewedBreakdown = {
  all_hasRenewed_noCycleValidFilter: countRenewedClients(renewalAllRows),
  all_cycleValidFilter: renewalDefaultSummary.renewedClients,
  active_cycleValid: renewalActiveSummary.renewedClients,
  active_cicloGe2_noCycleValid: countRenewedScoped(
    renewalAllRows,
    (r) => r.analyticalStatus === "Ativo" && (r.currentCycle || 0) >= 2,
  ),
  ims_canonical: imsPopulation.summary?.renewed ?? null,
};

const pageTable = [
  {
    page: "Resumo Executivo",
    clientesAtivos: execMetrics.active_clients?.value ?? null,
    fonte: "general → filterGeneralClients(status=active) → summarizeGeneralRows.activeClients",
  },
  {
    page: "Dados Gerais",
    clientesAtivos: generalSummary.activeClients,
    fonte: "default filters active → summarizeGeneralRows (equivale row count quando status=active)",
  },
  {
    page: "Reuniões",
    clientesAtivos: meetingSummary.filteredClients,
    fonte: "meeting filter status=active → filteredClients",
  },
  {
    page: "Mecanismos (IMS renewal universe)",
    clientesAtivos: imsPopulation.count,
    fonte: "canonicalRenewalPopulation status=active (não é KPI carteira)",
  },
  {
    page: "Renovação (KPI ativos)",
    clientesAtivos: renewalDefaultSummary.activeClients,
    fonte: "summarizeRenewalActiveClients em rows filtradas (status default all)",
  },
  {
    page: "Renovação filtro ativos",
    clientesAtivos: renewalActiveSummary.activeClients,
    fonte: "filter status=active + summarizeRenewalActiveClients",
  },
];

console.log(
  JSON.stringify(
    {
      funnel,
      hypothesis:
        funnel.activeOfficial > 1616 && funnel.activeWithCycleValid === 1616
          ? "REGRESSION_CONFIRMED_active_equals_cycleValid"
          : funnel.activeOfficial === 1616
            ? "1616_is_official_active_not_cycleValid_proxy"
            : "other",
      executive: {
        active_clients: execMetrics.active_clients?.value,
        renewed_active_rate: execMetrics.renewed_active_clients_rate,
        renewalContext: execContexts.renewal?.summary,
      },
      general: { activeClients: generalSummary.activeClients, totalFiltered: generalFiltered.length },
      renewalPage: {
        defaultFilters: renewalDefaultSummary,
        activeStatusFilter: renewalActiveSummary,
        payloadSummary: renewalPayload.summary,
      },
      ims: imsPopulation,
      renewalFunnel: { all: renewalFunnelAll, activeOnly: renewalFunnelActive },
      renewedBreakdown,
      totalRenewalsBreakdown,
      exclusions,
      pageTable,
      comparisonTable: {
        clientesAtivos: {
          baseQv: funnel.activeOfficial,
          executive: execMetrics.active_clients?.value,
          renewalPage: renewalDefaultSummary.activeClients,
          imsCanonical: imsPopulation.count,
        },
        clientesComCicloValido: {
          baseQv_active: funnel.activeWithCycleValid,
          renewalEligible_default: renewalDefaultSummary.eligibleClients,
          imsEligible: imsPopulation.summary?.eligible,
        },
        clientesRenovados: {
          baseQv_active_cicloGe2_strict: renewalFunnelActive.activeCycleGe2,
          baseQv_all_cicloGe2_raw: exclusions.ge2RawCount,
          renewalPage_cycleValid: renewalDefaultSummary.renewedClients,
          payload_countRenewedClients: renewalPayload.summary?.renewedClients,
          ims_canonical: imsPopulation.summary?.renewed,
        },
        totalRenovacoes: {
          baseQv_all: totalRenewalsBreakdown.allClients,
          baseQv_active_cycleValid: totalRenewalsBreakdown.activeCycleValid,
          renewalPage: renewalDefaultSummary.totalRenewals,
          payload: renewalPayload.summary?.totalRenewals,
        },
      },
    },
    null,
    2,
  ),
);
