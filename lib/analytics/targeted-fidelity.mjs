/**
 * Auditoria targeted V1 × V2 — Dados Gerais, Jornada, Reuniões.
 */
import { filterGeneralAcquisitionRows, defaultGeneralFilters } from "./general-filters.mjs";
import {
  acquisitionSummaryFromSeries,
  buildAcquisitionMonthSeries,
} from "./general-metrics.mjs";
import { filterOnboardingClients, defaultOnboardingFilters } from "./onboarding-filters.mjs";
import {
  distributionsFromOnboardingRows,
  summarizeOnboardingRows,
} from "./onboarding-metrics.mjs";
import {
  applyMeetingFilters,
  defaultMeetingFilters,
} from "./meeting-filters.mjs";
import {
  buildNoShowFrequency,
  distributionsFromMeetingRows,
  summarizeMeetingRows,
} from "./meeting-metrics.mjs";
import {
  compareDistributionCounts,
  compareMeetingRecordSets,
  compareMeetingsPayloads,
  diagnoseMeetingRecord,
  MEETINGS_FILTER_PRESETS,
} from "./meetings-fidelity.mjs";
import {
  defaultMechanismFilters,
  filterMechanismClients,
  expandMechanismSourceRows,
  filterPortfolio,
  portfolioSize,
} from "./mechanism-filters.mjs";
import { summarizeMechanismRows } from "./mechanism-metrics.mjs";
import {
  defaultPlanFilters,
  filterPlanClients,
  summarizeFilteredPlanClients,
} from "./patrimonial-plan-filters.mjs";
import { medianDays, meanDays } from "./patrimonial-plan.mjs";
import { programMatches } from "./filters/program.mjs";

export const MECHANISMS_DEFAULT_PRESET = {
  filters: defaultMechanismFilters(),
};

export const PLAN_DEFAULT_PRESET = {
  filters: defaultPlanFilters(),
};

export function summarizeMechanismsForProgram(v2Payload, program = "all") {
  const filters = { ...defaultMechanismFilters(), program };
  const rows = filterMechanismClients(v2Payload?.clients || [], filters);
  const sourceRows = expandMechanismSourceRows(rows, v2Payload?.clients || [], filters);
  const portfolio = filterPortfolio(v2Payload?.portfolio || [], filters);
  const meta = v2Payload?.metadata || {};
  const summary = summarizeMechanismRows(rows, {
    sourceRows,
    catalog: v2Payload?.catalog || [],
    portfolio,
    portfolioCount: portfolioSize(portfolio),
    consolidationQuality: meta.consolidationQuality || null,
    filters,
    pharusAvailable: meta.pharus?.status !== "unavailable" && meta.pharusConsulted !== false,
  });
  return { filters, rows, summary };
}

export function compareMechanismsPrograms(v2Payload) {
  return ["all", "Pharus", "Davos"].map((program) => {
    const { summary, rows } = summarizeMechanismsForProgram(v2Payload, program);
    return {
      program,
      clientsWithMechanisms: summary.displayedCombinedTotal,
      baseQv: summary.baseQvDisplayed,
      appPharus: summary.appPharusDisplayed,
      clientsImplemented: summary.clientsWithImplementedMechanism,
      linksImplemented: summary.implementedMechanisms,
      inProgress: summary.inProgressMechanisms,
      implementationRate: summary.mechanismImplementationRate,
      typesUsed: summary.typesUsed,
      typesUnused: summary.typesUnused,
      catalogSize: summary.catalogSize,
      topMechanism: summary.topMechanismName,
      topMechanismClients: summary.topMechanismClients,
      filteredRows: rows.length,
      deduplicatedUniquePeople: summary.deduplicatedUniquePeople,
    };
  });
}

function v1PlanMedianFromClients(clients, program = "all") {
  const filtered = (clients || []).filter((row) => programMatches(row, program));
  const days = filtered
    .map((row) => Number(row.daysToApproval))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return {
    median: medianDays(days),
    mean: meanDays(days),
    n: days.length,
    population: filtered.length,
  };
}

export function comparePlanApproval(v1PlanPayload, v2PlanPayload, program = "all") {
  const v1Clients = v1PlanPayload?.clients || v1PlanPayload?.approvalTime?.clients || [];
  const v2Clients = v2PlanPayload?.clients || [];
  const v1 = v1PlanMedianFromClients(v1Clients, program);
  const v2Rows = filterPlanClients(v2Clients, { ...defaultPlanFilters(), program });
  const v2 = summarizeFilteredPlanClients(v2Rows);
  const delta = v1.median != null && v2.value != null ? Math.round((v2.value - v1.median) * 10) / 10 : null;
  return {
    program,
    v1Median: v1.median,
    v1Mean: v1.mean,
    v1N: v1.n,
    v1Population: v1.population,
    v2Median: v2.value,
    v2Mean: v2.meanValue,
    v2N: v2.eligibleClients,
    v2Population: v2.totalPopulation,
    delta,
    status: v1.median === v2.value ? "PASS" : delta === 0 ? "PASS" : "FIXED",
    rule:
      "Proxy V1: data_inicio_ciclo → última reunião Central de Inteligência; UI V1 usa mediana; intervalos negativos excluídos.",
  };
}

export const GENERAL_ACQ_PRESET = {
  status: "active",
  acqRange: 6,
  filters: defaultGeneralFilters(),
};

export const JOURNEY_PRESET = {
  filters: defaultOnboardingFilters(),
};

export const MEETINGS_ALL_STATUS_PRESET = "all_history_all_status";

export function compareGeneralAcquisition(v1Clients, v2Clients, preset = GENERAL_ACQ_PRESET, now = new Date()) {
  const filters = { ...preset.filters, status: preset.status || preset.filters.status };
  const v1Rows = filterGeneralAcquisitionRows(v1Clients, filters, { now });
  const v2Rows = filterGeneralAcquisitionRows(v2Clients, filters, { now });
  const limit = preset.acqRange || 6;
  const v1Series = buildAcquisitionMonthSeries(v1Rows, limit, now);
  const v2Series = buildAcquisitionMonthSeries(v2Rows, limit, now);
  const v1Summary = acquisitionSummaryFromSeries(v1Series);
  const v2Summary = acquisitionSummaryFromSeries(v2Series);
  const months = v1Series.map((m) => m.month);
  const byMonth = months.map((month) => {
    const v1 = v1Series.find((m) => m.month === month)?.acquiredClients ?? 0;
    const v2 = v2Series.find((m) => m.month === month)?.acquiredClients ?? 0;
    return { month, v1, v2, delta: v2 - v1, status: v1 === v2 ? "PASS" : "FIXED" };
  });
  return {
    preset: filters,
    byMonth,
    cards: {
      latest: { v1: v1Summary.latestMonthAcquisitions, v2: v2Summary.latestMonthAcquisitions },
      average: { v1: v1Summary.averageMonthlyAcquisitions, v2: v2Summary.averageMonthlyAcquisitions },
      median: { v1: v1Summary.medianMonthlyAcquisitions, v2: v2Summary.medianMonthlyAcquisitions },
      variation: { v1: v1Summary.latestMonthChangePercent, v2: v2Summary.latestMonthChangePercent },
    },
    population: { v1: v1Rows.length, v2: v2Rows.length },
  };
}

export function compareJourneyCharts(v1Payload, v2Payload, preset = JOURNEY_PRESET, now = new Date()) {
  const v2Rows = filterOnboardingClients(v2Payload?.clients || [], preset.filters, { now });
  const v2Summary = summarizeOnboardingRows(v2Rows);
  const v2Dist = distributionsFromOnboardingRows(v2Rows);

  const v1Backend = {
    medianTotalOnboardingDays: v1Payload?.summary?.comparableTotalOnboardingMedianDays ?? null,
    medianFirstMeetingDays: v1Payload?.summary?.averageFirstMeetingDays ?? null,
    medianPlanDeliveryDays: v1Payload?.summary?.comparablePlanDeliveryMedianDays ?? null,
    comparableClients: v1Payload?.summary?.journeyKpiComparableClients ?? 0,
  };
  const v1Dist = v1Payload?.distributions || {};

  const charts = [
    {
      chart: "Tempo total de onboarding",
      v1Median: v1Backend.medianTotalOnboardingDays,
      v2Median: v2Summary.medianTotalOnboardingDays,
      v1N: v1Backend.comparableClients,
      v2N: v2Summary.comparableClients,
      buckets: compareDistributionCounts(v1Dist.totalOnboardingRanges, v2Dist.totalOnboarding),
      expectedDifference: false,
      note: "V1 gráfico usa coorte backend (carteira inteira). V2 recalcula no recorte Ativos.",
    },
    {
      chart: "Dias até entrega do plano patrimonial",
      v1Median: v1Backend.medianPlanDeliveryDays,
      v2Median: v2Summary.medianPlanDeliveryDays,
      v1N: v1Backend.comparableClients,
      v2N: v2Summary.comparableClients,
      buckets: compareDistributionCounts(v1Dist.planDeliveryRanges, v2Dist.planDelivery),
      expectedDifference: false,
      note: "Plano = 1ª reunião Central de Inteligência (client_meetings).",
    },
    {
      chart: "Dias até a primeira reunião",
      v1Median: v1Backend.medianFirstMeetingDays,
      v2Median: v2Summary.medianFirstMeetingDays,
      v1N: v1Backend.comparableClients,
      v2N: v2Summary.comparableClients,
      buckets: compareDistributionCounts(v1Dist.firstMeetingRanges, v2Dist.firstMeeting),
      expectedDifference: true,
      note: "EXPECTED: V2 exige compareceu; V1 usa menor start_time agendado.",
    },
  ].map((row) => {
    const delta =
      row.v1Median != null && row.v2Median != null ? Math.round((row.v2Median - row.v1Median) * 10) / 10 : null;
    let status = "PASS";
    if (row.v1Median !== row.v2Median || row.v1N !== row.v2N) {
      if (row.expectedDifference) status = "EXPECTED_DIFFERENCE";
      else if (row.v1N !== row.v2N) status = "SOURCE_DIFFERENCE";
      else status = delta === 0 ? "PASS" : "SOURCE_DIFFERENCE";
    }
    return { ...row, delta, status };
  });

  return { preset: preset.filters, charts, population: { v1Backend: v1Backend.comparableClients, v2: v2Rows.length } };
}

export function compareMeetingsFull(v1Payload, v2Payload, presetKey = "all_history_active", now = new Date()) {
  const preset = MEETINGS_FILTER_PRESETS[presetKey] || MEETINGS_FILTER_PRESETS.all_history_active;
  const summary = compareMeetingsPayloads(v1Payload, v2Payload, presetKey, { now });
  const v1Rows = applyMeetingFilters(v1Payload?.clients || [], preset.filters, { now });
  const v2Rows = applyMeetingFilters(v2Payload?.clients || [], preset.filters, { now });
  const v1Dist = distributionsFromMeetingRows(v1Rows);
  const v2Dist = distributionsFromMeetingRows(v2Rows);
  const meetingSets = compareMeetingRecordSets(v1Rows, v2Rows);

  return {
    ...summary,
    meetingSets,
    meetingDiagnostics: {
      onlyV1: meetingSets.onlyV1Records.map((r) => diagnoseMeetingRecord(r, "v1")),
      onlyV2: meetingSets.onlyV2Records.map((r) => diagnoseMeetingRecord(r, "v2")),
    },
    distributions: {
      frequency: compareDistributionCounts(v1Dist.meetingFrequency, v2Dist.meetingFrequency),
      recency: compareDistributionCounts(v1Dist.daysSinceLastMeeting, v2Dist.daysSinceLastMeeting),
      interval: compareDistributionCounts(v1Dist.intervalRanges, v2Dist.intervalRanges),
      engineer: compareDistributionCounts(v1Dist.meetingsByEngineer, v2Dist.meetingsByEngineer),
      noShowFrequency: compareDistributionCounts(
        buildNoShowFrequency(v1Rows).map((b) => ({ label: b.label, count: b.clients })),
        buildNoShowFrequency(v2Rows).map((b) => ({ label: b.label, count: b.clients })),
      ),
    },
  };
}
