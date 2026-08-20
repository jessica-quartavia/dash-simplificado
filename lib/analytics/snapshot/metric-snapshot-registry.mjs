/**
 * Extractors do snapshot. Não recalculam regra analítica.
 * Recebem o contexto já produzido pelos computes/summaries oficiais da V2.
 */
import { makeSnapshot, slimCategories, slimSeries } from "./metric-snapshot-scope.mjs";

function scalar(value, unit, extra = {}) {
  return { value: value ?? null, unit, ...extra };
}

function chart(categories) {
  return { categories: slimCategories(categories) };
}

function extractGeneral(metric, ctx) {
  const active = ctx.summaryActive || {};
  const all = ctx.summaryAll || {};
  const distActive = ctx.distActive || {};
  switch (metric.metric_id) {
    case "active_clients":
      return makeSnapshot({ metric, value: scalar(active.activeClients, "clients"), sampleSize: active.activeClients });
    case "total_clients":
      return makeSnapshot({ metric, value: scalar(all.totalClients, "clients"), sampleSize: all.totalClients });
    case "cancelled_clients":
      return makeSnapshot({ metric, value: scalar(all.cancelledWithConfirmedDate, "clients"), sampleSize: all.totalClients });
    case "cancelled_without_confirmed_date":
      return makeSnapshot({ metric, value: scalar(all.cancelledWithoutConfirmedDate, "clients"), sampleSize: all.totalClients });
    case "frozen_clients":
      return makeSnapshot({ metric, value: scalar(all.frozenClients, "clients"), sampleSize: all.totalClients });
    case "non_active_clients":
      return makeSnapshot({ metric, value: scalar(all.nonActiveClients, "clients"), sampleSize: all.totalClients });
    case "clients_with_financial_data":
      return makeSnapshot({
        metric,
        value: scalar(active.clientsWithFinancialProfile, "clients"),
        numerator: active.clientsWithFinancialProfile,
        denominator: active.totalClients,
        sampleSize: active.totalClients,
      });
    case "median_stay_days":
      return makeSnapshot({
        metric,
        value: scalar(active.typicalStayDays, "days", { calculation: "median" }),
        numerator: active.stayCalculatedClients,
        denominator: active.totalClients,
        sampleSize: active.stayCalculatedClients,
      });
    case "median_monthly_income":
      return makeSnapshot({
        metric,
        value: scalar(active.typicalMonthlyIncome, "currency", { calculation: "median" }),
        numerator: active.monthlyIncomeFilledCount,
        denominator: active.totalClients,
        sampleSize: active.monthlyIncomeFilledCount,
      });
    case "median_liquidity_reserve":
      return makeSnapshot({
        metric,
        value: scalar(active.typicalLiquidityReserve, "currency", { calculation: "median" }),
        numerator: active.liquidityReserveFilledCount,
        denominator: active.totalClients,
        sampleSize: active.liquidityReserveFilledCount,
      });
    case "median_last_contribution":
      return makeSnapshot({
        metric,
        value: scalar(active.typicalLastContribution, "currency", { calculation: "median" }),
        numerator: active.lastContributionFilledCount,
        denominator: active.totalClients,
        sampleSize: active.lastContributionFilledCount,
      });
    case "clients_by_segment":
      return makeSnapshot({ metric, value: chart(distActive.segments), sampleSize: active.totalClients });
    case "clients_by_status":
      return makeSnapshot({ metric, value: chart(distActive.status), sampleSize: active.totalClients });
    case "clients_by_engineer":
      return makeSnapshot({ metric, value: chart(distActive.engineers), sampleSize: active.totalClients });
    case "monthly_income_distribution":
      return makeSnapshot({ metric, value: chart(distActive.monthlyIncome), sampleSize: active.totalClients });
    case "liquidity_reserve_distribution":
      return makeSnapshot({ metric, value: chart(distActive.liquidityReserve), sampleSize: active.totalClients });
    case "financial_profile_distribution":
      return makeSnapshot({ metric, value: chart(distActive.financialProfile), sampleSize: active.totalClients });
    case "stay_duration_distribution":
      return makeSnapshot({ metric, value: chart(distActive.stayRanges), sampleSize: active.totalClients });
    case "client_acquisition_monthly":
      return makeSnapshot({
        metric,
        value: {
          series: slimSeries(ctx.acquisitionSeries, ["month", "acquiredClients"]),
        },
        sampleSize: (ctx.acquisitionSeries || []).reduce((sum, row) => sum + (row.acquiredClients || 0), 0),
      });
    default:
      return null;
  }
}

function extractJourney(metric, ctx) {
  const summary = ctx.summary || {};
  const dist = ctx.dist || {};
  if (metric.metric_id === "onboarding_completion_chart") {
    const cov = summary.completionCoverage || {};
    return makeSnapshot({
      metric,
      value: chart(dist.completion),
      numerator: cov.sample,
      denominator: cov.total,
      sampleSize: cov.sample,
    });
  }
  if (metric.metric_id === "total_onboarding_time_chart") {
    const cov = summary.comparableCoverage || {};
    return makeSnapshot({
      metric,
      value: chart(dist.totalOnboarding),
      numerator: cov.sample,
      denominator: cov.total,
      sampleSize: cov.sample,
      warning: "Cobertura parcial da coorte comparável.",
      status: cov.total && cov.sample < cov.total ? "partial" : "ok",
    });
  }
  return null;
}

function extractMeetings(metric, ctx) {
  const summary = ctx.summary || {};
  const dist = ctx.dist || {};
  switch (metric.metric_id) {
    case "total_meetings":
      return makeSnapshot({ metric, value: scalar(summary.totalMeetings, "meetings"), sampleSize: summary.filteredClients });
    case "average_meetings_per_month":
      return makeSnapshot({
        metric,
        value: scalar(summary.averageMeetingsPerMonth, "meetings_per_month"),
        sampleSize: summary.totalMeetings,
      });
    case "days_since_latest_meeting":
      return makeSnapshot({
        metric,
        value: scalar(summary.daysSinceLatestMeeting, "days"),
        sampleSize: summary.filteredClients,
      });
    case "average_interval_between_meetings":
      return makeSnapshot({
        metric,
        value: scalar(summary.averageIntervalDays, "days", { calculation: "mean" }),
        sampleSize: summary.intervalDaysStats?.validCount ?? null,
      });
    case "no_show_meetings":
      return makeSnapshot({ metric, value: scalar(summary.totalNoShows, "meetings"), sampleSize: summary.filteredClients });
    case "total_meeting_reschedules":
      return makeSnapshot({ metric, value: scalar(summary.totalReschedules, "meetings"), sampleSize: summary.filteredClients });
    case "attendance_rate":
      return makeSnapshot({
        metric,
        value: scalar(summary.attendanceRate, "percent"),
        numerator: summary.eligibleMeetings - summary.noShowsEligible,
        denominator: summary.eligibleMeetings,
        sampleSize: summary.eligibleMeetings,
        status: summary.attendanceInsufficientData ? "partial" : "ok",
        warning: summary.attendanceInsufficientData ? "Sem reuniões elegíveis no recorte." : null,
      });
    case "meeting_interval_chart":
      return makeSnapshot({ metric, value: chart(dist.intervalRanges), sampleSize: summary.filteredClients });
    case "meeting_status_chart":
      return makeSnapshot({ metric, value: chart(dist.attendanceStatus), sampleSize: summary.totalMeetings });
    case "meetings_by_engineer_chart":
      return makeSnapshot({ metric, value: chart(dist.meetingsByEngineer), sampleSize: summary.totalMeetings });
    case "meetings_by_month_chart":
      return makeSnapshot({
        metric,
        value: {
          series: slimSeries(dist.meetingsByMonth, ["month", "scheduled", "completed", "noShows"]),
        },
        sampleSize: summary.totalMeetings,
      });
    case "top_meeting_types": {
      const available = ctx.meetingTypes?.available === true;
      return makeSnapshot({
        metric,
        value: chart(ctx.meetingTypes?.byFamily || []),
        status: available ? "ok" : "partial",
        warning: available ? null : "Tipos de reunião indisponíveis nesta execução.",
      });
    }
    default:
      return null;
  }
}

function extractPlan(metric, ctx) {
  if (metric.metric_id !== "plan_days_to_approval") return null;
  const approval = ctx.approvalTime || {};
  return makeSnapshot({
    metric,
    value: scalar(approval.value ?? null, "days", { calculation: "mean" }),
    numerator: approval.eligibleClients,
    denominator: approval.totalPopulation,
    sampleSize: approval.eligibleClients,
    status: approval.value == null ? "unavailable" : "ok",
  });
}

function extractMechanisms(metric, ctx) {
  const summary = ctx.summary || {};
  const coverage = summary.coverage || {};
  switch (metric.metric_id) {
    case "clients_with_mechanisms":
      return makeSnapshot({
        metric,
        value: scalar(summary.clientsWithMechanisms, "clients"),
        numerator: coverage.sample ?? summary.clientsWithMechanisms,
        denominator: coverage.total,
        sampleSize: coverage.sample ?? summary.clientsWithMechanisms,
      });
    case "types_used":
      return makeSnapshot({ metric, value: scalar(summary.typesUsed, "types"), sampleSize: summary.catalogSize });
    case "types_unused":
      return makeSnapshot({ metric, value: scalar(summary.typesUnused, "types"), sampleSize: summary.catalogSize });
    case "most_used_mechanism":
      return makeSnapshot({
        metric,
        value: { label: summary.topMechanismName || null, clients: summary.topMechanismClients || 0 },
        sampleSize: summary.clientsWithMechanisms,
      });
    case "implemented_mechanisms":
      return makeSnapshot({
        metric,
        value: scalar(summary.implementedMechanisms, "links"),
        numerator: summary.implementedMechanisms,
        denominator: summary.availableMechanisms,
        sampleSize: summary.availableMechanisms,
      });
    case "in_progress_mechanisms":
      return makeSnapshot({ metric, value: scalar(summary.inProgressMechanisms, "links"), sampleSize: summary.availableMechanisms });
    case "implementation_rate":
      return makeSnapshot({
        metric,
        value: scalar(summary.implementationPercent, "percent"),
        numerator: summary.implementedMechanisms,
        denominator: summary.availableMechanisms,
        sampleSize: summary.availableMechanisms,
      });
    case "clients_with_recent_implementation":
      return makeSnapshot({
        metric,
        value: scalar(summary.recentClients, "clients"),
        sampleSize: summary.clientsWithMechanisms,
        warning: "Datas podem conter preenchimento retroativo.",
      });
    case "mechanism_status_chart":
      return makeSnapshot({ metric, value: chart(summary.statusDist), sampleSize: summary.availableMechanisms });
    case "mechanisms_per_client_chart":
      return makeSnapshot({ metric, value: chart(summary.countDist), sampleSize: summary.clientsWithMechanisms });
    case "catalog_coverage_chart":
      return makeSnapshot({ metric, value: chart(summary.catalogDist), sampleSize: summary.catalogSize });
    case "mechanism_type_usage_chart":
      return makeSnapshot({ metric, value: chart(summary.typeUsage), sampleSize: summary.availableMechanisms });
    case "implementations_by_month_chart":
      return makeSnapshot({
        metric,
        value: { series: slimSeries(summary.months, ["label", "count"]) },
        sampleSize: summary.implementedMechanisms,
        warning: "Datas podem conter preenchimento retroativo.",
      });
    case "implemented_by_segment_chart":
      return makeSnapshot({ metric, value: chart(summary.bySegment), sampleSize: summary.implementedMechanisms });
    case "implemented_by_engineer_chart":
      return makeSnapshot({ metric, value: chart(summary.byEngineer), sampleSize: coverage.total });
    default:
      return null;
  }
}

const PAGE_EXTRACTORS = {
  general: extractGeneral,
  journey: extractJourney,
  meetings: extractMeetings,
  patrimonial_plan: extractPlan,
  mechanisms: extractMechanisms,
};

export function extractorPageIds() {
  return Object.keys(PAGE_EXTRACTORS);
}

export function extractSnapshot(metric, pageCtx) {
  const fn = PAGE_EXTRACTORS[metric?.page_id];
  if (!fn) return null;
  return fn(metric, pageCtx);
}

export function listExtractorMetricIds() {
  return [
    "active_clients",
    "cancelled_clients",
    "cancelled_without_confirmed_date",
    "client_acquisition_monthly",
    "clients_by_engineer",
    "clients_by_segment",
    "clients_by_status",
    "clients_with_financial_data",
    "financial_profile_distribution",
    "frozen_clients",
    "liquidity_reserve_distribution",
    "median_last_contribution",
    "median_liquidity_reserve",
    "median_monthly_income",
    "median_stay_days",
    "monthly_income_distribution",
    "non_active_clients",
    "stay_duration_distribution",
    "total_clients",
    "onboarding_completion_chart",
    "total_onboarding_time_chart",
    "attendance_rate",
    "average_interval_between_meetings",
    "average_meetings_per_month",
    "days_since_latest_meeting",
    "meeting_interval_chart",
    "meeting_status_chart",
    "meetings_by_engineer_chart",
    "meetings_by_month_chart",
    "no_show_meetings",
    "top_meeting_types",
    "total_meeting_reschedules",
    "total_meetings",
    "plan_days_to_approval",
    "catalog_coverage_chart",
    "clients_with_mechanisms",
    "clients_with_recent_implementation",
    "implementation_rate",
    "implementations_by_month_chart",
    "implemented_by_engineer_chart",
    "implemented_by_segment_chart",
    "implemented_mechanisms",
    "in_progress_mechanisms",
    "mechanism_status_chart",
    "mechanism_type_usage_chart",
    "mechanisms_per_client_chart",
    "most_used_mechanism",
    "types_unused",
    "types_used",
  ];
}
