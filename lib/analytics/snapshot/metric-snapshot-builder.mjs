/**
 * Orquestra 1 compute oficial por página e extrai o snapshot das métricas
 * validadas no catálogo. Não é autoridade sobre quais métricas publicar.
 */
import { computeGeneralDataPayload } from "../general-data.mjs";
import { defaultGeneralFilters, filterGeneralClients } from "../general-filters.mjs";
import {
  buildAcquisitionMonthSeries,
  distributionsFromRows,
  summarizeGeneralRows,
} from "../general-metrics.mjs";
import { computeMeetingsPayload } from "../meetings.mjs";
import { applyMeetingFilters, defaultMeetingFilters } from "../meeting-filters.mjs";
import { distributionsFromMeetingRows, summarizeMeetingRows } from "../meeting-metrics.mjs";
import { computeOnboardingPayload } from "../onboarding.mjs";
import { defaultOnboardingFilters, filterOnboardingClients } from "../onboarding-filters.mjs";
import { distributionsFromOnboardingRows, summarizeOnboardingRows } from "../onboarding-metrics.mjs";
import { computePatrimonialPlanPayload } from "../patrimonial-plan.mjs";
import { computeMechanismsPayload } from "../mechanisms.mjs";
import {
  defaultMechanismFilters,
  filterMechanismClients,
  filterPortfolio,
  portfolioSize,
} from "../mechanism-filters.mjs";
import { summarizeEngineerBars, summarizeMechanismRows } from "../mechanism-metrics.mjs";
import { extractSnapshot } from "./metric-snapshot-registry.mjs";
import { assertSnapshotHasNoPii } from "./metric-snapshot-pii.mjs";
import { CALCULATION_VERSION } from "./metric-snapshot-scope.mjs";

function validatedMetrics(catalogRows) {
  return (catalogRows || []).filter((row) => row?.validated_for_v2 === true && row?.metric_id);
}

function groupByPage(metrics) {
  const groups = new Map();
  for (const metric of metrics) {
    const pageId = metric.page_id;
    if (!groups.has(pageId)) groups.set(pageId, []);
    groups.get(pageId).push(metric);
  }
  return groups;
}

export function buildGeneralSnapshotContext(payload, filters = null) {
  const clients = payload?.clients || [];
  const f = filters || defaultGeneralFilters();
  const active = filterGeneralClients(clients, f);
  const historical = filterGeneralClients(clients, f, { ignoreStatus: true });
  return {
    summaryActive: summarizeGeneralRows(active),
    summaryAll: summarizeGeneralRows(clients),
    distActive: distributionsFromRows(active),
    acquisitionSeries: buildAcquisitionMonthSeries(historical),
  };
}

export function buildMeetingsSnapshotContext(payload, filters = null) {
  const rows = applyMeetingFilters(payload?.clients || [], filters || defaultMeetingFilters());
  return {
    summary: summarizeMeetingRows(rows),
    dist: distributionsFromMeetingRows(rows),
    meetingTypes: {
      available: payload?.meetingTypes?.available === true,
      byFamily: payload?.meetingTypes?.byFamily || [],
    },
  };
}

export function buildJourneySnapshotContext(payload, filters = null) {
  const rows = filterOnboardingClients(payload?.clients || [], filters || defaultOnboardingFilters());
  return {
    summary: summarizeOnboardingRows(rows),
    dist: distributionsFromOnboardingRows(rows),
  };
}

export function buildPlanSnapshotContext(payload) {
  return { approvalTime: payload?.approvalTime || {} };
}

export function buildMechanismsSnapshotContext(payload, filters = null) {
  const f = filters || defaultMechanismFilters();
  const rows = filterMechanismClients(payload?.clients || [], f);
  const portfolio = filterPortfolio(payload?.portfolio || [], f);
  const summary = summarizeMechanismRows(rows, {
    catalog: payload?.catalog || [],
    portfolioCount: portfolioSize(portfolio),
  });
  summary.byEngineer = summarizeEngineerBars(rows, portfolio);
  return { summary };
}

export const DEFAULT_PAGE_COMPUTES = {
  general: async () => buildGeneralSnapshotContext(await computeGeneralDataPayload()),
  meetings: async () => buildMeetingsSnapshotContext(await computeMeetingsPayload()),
  journey: async () => buildJourneySnapshotContext(await computeOnboardingPayload()),
  patrimonial_plan: async () => buildPlanSnapshotContext(await computePatrimonialPlanPayload()),
  mechanisms: async () => buildMechanismsSnapshotContext(await computeMechanismsPayload()),
};

export function compareSnapshotToCompute(snapshots, contexts) {
  const byId = Object.fromEntries((snapshots || []).map((row) => [row.metric_id, row]));
  const general = contexts.general || {};
  const meetings = contexts.meetings || {};
  const journey = contexts.journey || {};
  const plan = contexts.patrimonial_plan || {};
  const mechanisms = contexts.mechanisms || {};
  const checks = [
    ["active_clients", general.summaryActive?.activeClients, byId.active_clients?.value?.value],
    ["total_clients", general.summaryAll?.totalClients, byId.total_clients?.value?.value],
    ["median_stay_days", general.summaryActive?.typicalStayDays, byId.median_stay_days?.value?.value],
    ["total_meetings", meetings.summary?.totalMeetings, byId.total_meetings?.value?.value],
    ["attendance_rate", meetings.summary?.attendanceRate, byId.attendance_rate?.value?.value],
    ["no_show_meetings", meetings.summary?.totalNoShows, byId.no_show_meetings?.value?.value],
    ["plan_days_to_approval", plan.approvalTime?.value, byId.plan_days_to_approval?.value?.value],
    ["clients_with_mechanisms", mechanisms.summary?.clientsWithMechanisms, byId.clients_with_mechanisms?.value?.value],
    ["implemented_mechanisms", mechanisms.summary?.implementedMechanisms, byId.implemented_mechanisms?.value?.value],
    ["implementation_rate", mechanisms.summary?.implementationPercent, byId.implementation_rate?.value?.value],
    ["onboarding_completion_chart", journey.dist?.completion?.[0]?.count, byId.onboarding_completion_chart?.value?.categories?.[0]?.count],
    ["total_onboarding_time_chart", journey.dist?.totalOnboarding, byId.total_onboarding_time_chart?.value?.categories],
  ];
  return checks.map(([metricId, computeValue, snapshotValue]) => {
    const match = metricId === "total_onboarding_time_chart"
      ? JSON.stringify(computeValue) === JSON.stringify(snapshotValue)
      : Object.is(computeValue, snapshotValue);
    return { metric_id: metricId, compute: computeValue, snapshot: snapshotValue, match };
  });
}

export async function buildMetricSnapshots({
  catalogRows,
  computes = DEFAULT_PAGE_COMPUTES,
} = {}) {
  const startedAt = Date.now();
  const metrics = validatedMetrics(catalogRows);
  const rejected = (catalogRows || []).filter((row) => row && row.validated_for_v2 !== true).map((row) => row.metric_id);
  const groups = groupByPage(metrics);
  const snapshots = [];
  const missing = [];
  const pageErrors = [];
  const timings = {};
  const contexts = {};

  for (const [pageId, pageMetrics] of groups.entries()) {
    const compute = computes[pageId];
    const pageStarted = Date.now();
    if (typeof compute !== "function") {
      missing.push(...pageMetrics.map((m) => m.metric_id));
      timings[pageId] = Date.now() - pageStarted;
      pageErrors.push({ pageId, error: `Compute ausente para ${pageId}.` });
      continue;
    }
    try {
      const ctx = await compute();
      contexts[pageId] = ctx;
      timings[pageId] = Date.now() - pageStarted;
      for (const metric of pageMetrics) {
        const snapshot = extractSnapshot(metric, ctx);
        if (!snapshot) {
          missing.push(metric.metric_id);
          continue;
        }
        assertSnapshotHasNoPii(snapshot);
        snapshots.push(snapshot);
      }
    } catch (error) {
      timings[pageId] = Date.now() - pageStarted;
      pageErrors.push({
        pageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (missing.length) {
    const err = new Error(`missing snapshot extractor: ${missing.join(", ")}`);
    err.code = "missing_snapshot_extractor";
    err.missing = missing;
    throw err;
  }

  const comparison = compareSnapshotToCompute(snapshots, contexts);
  return {
    generated_at: new Date().toISOString(),
    calculation_version: CALCULATION_VERSION,
    snapshots,
    rejected_unvalidated: rejected.filter(Boolean),
    page_errors: pageErrors,
    timings,
    total_ms: Date.now() - startedAt,
    counts: Object.fromEntries([...groups.entries()].map(([pageId, list]) => [pageId, list.length])),
    expected_total: metrics.length,
    comparison,
  };
}
