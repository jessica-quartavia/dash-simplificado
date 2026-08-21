/**
 * Contextos filtrados e extractors oficiais — espelham as páginas fonte V2.
 */
import { filterGeneralClients, filterGeneralAcquisitionRows } from "./general-filters.mjs";
import { filterOnboardingClients } from "./onboarding-filters.mjs";
import { applyMeetingFilters } from "./meeting-filters.mjs";
import { filterFinancialUpdateClients } from "./financial-updates-filters.mjs";
import { filterMechanismClients } from "./mechanism-filters.mjs";
import { filterSatisfactionClients, buildScopedSatisfactionView } from "./satisfaction-filters.mjs";
import { filterCancellationClients } from "./cancellations-filters.mjs";
import { filterRenewalClients } from "./renewal-filters.mjs";
import { filterEpEngineers } from "./ep-performance-filters.mjs";
import { summarizeFilteredTemporal, buildActiveRiskSignalCountDistribution } from "./temporal-indicators-filters.mjs";
import { executiveFiltersToDomain } from "./executive-summary-filters.mjs";
import {
  summarizeGeneralRows,
  distributionsFromRows,
  buildAcquisitionMonthSeries,
} from "./general-metrics.mjs";
import { summarizeOnboardingRows } from "./onboarding-metrics.mjs";
import { summarizeMeetingRows } from "./meeting-metrics.mjs";
import { summarizeMechanismRows } from "./mechanism-metrics.mjs";
import { summarizeFinancialUpdateRows } from "./financial-updates-metrics.mjs";
import { summarizeSatisfactionRows, distributionsFromSatisfactionRows } from "./satisfaction-metrics.mjs";
import {
  summarizeCancellationRows,
  distributionsFromCancellationRows,
  buildIntentionDestinationBranches,
  topCancellationReasonsFromDistribution,
} from "./cancellations-metrics.mjs";
import { summarizeRenewalRows } from "./renewal-metrics.mjs";
import {
  EXECUTIVE_METRIC_REGISTRY,
  topMechanismDistribution,
} from "./executive-summary-registry.mjs";

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function metricValue(value, extra = {}) {
  return { value, ...extra };
}

function cancellationReasonsForExecutive(byCategory = []) {
  return topCancellationReasonsFromDistribution(byCategory, 10);
}

function pickTopEp(engineers, field, minSample = 10) {
  const eligible = engineers.filter((e) => (e.totalClients || 0) >= minSample);
  if (!eligible.length) return null;
  const sorted = [...eligible].sort((a, b) => (b[field] ?? -1) - (a[field] ?? -1));
  const topValue = sorted[0]?.[field];
  const tied = sorted.filter((e) => e[field] === topValue);
  return { top: sorted[0], tied, minSample };
}

export function buildExecutiveContexts(sources = {}, filters = {}) {
  const contexts = {
    filters,
    general: null,
    journey: null,
    meetings: null,
    financial: null,
    mechanisms: null,
    satisfaction: null,
    cancellations: null,
    renewal: null,
    ep: null,
    temporal: null,
    errors: {},
  };

  try {
    if (sources.general?.clients) {
      const gf = executiveFiltersToDomain(filters, "general");
      const rows = filterGeneralClients(sources.general.clients, gf);
      const portfolioFilters = { ...gf, status: "all" };
      const portfolioRows = filterGeneralClients(sources.general.clients, portfolioFilters);
      const summary = summarizeGeneralRows(rows);
      const portfolioSummary = summarizeGeneralRows(portfolioRows);
      const dist = distributionsFromRows(rows);
      const activeRows = rows.filter((r) => r.analyticalStatus === "Ativo");
      const activeDist = distributionsFromRows(activeRows);
      const acquisitionRows = filterGeneralAcquisitionRows(sources.general.clients, gf);
      const acquisitionSeries = buildAcquisitionMonthSeries(acquisitionRows, 3);
      contexts.general = {
        rows,
        summary,
        portfolioRows,
        portfolioSummary,
        dist,
        activeRows,
        activeDist,
        acquisitionSeries,
      };
    }
  } catch (error) {
    contexts.errors.general = error;
  }

  try {
    if (sources.journey?.clients) {
      const rows = filterOnboardingClients(sources.journey.clients, executiveFiltersToDomain(filters, "journey"));
      contexts.journey = { rows, summary: summarizeOnboardingRows(rows) };
    }
  } catch (error) {
    contexts.errors.journey = error;
  }

  try {
    if (sources.meetings?.clients) {
      const rows = applyMeetingFilters(sources.meetings.clients, executiveFiltersToDomain(filters, "meetings"));
      contexts.meetings = { rows, summary: summarizeMeetingRows(rows) };
    }
  } catch (error) {
    contexts.errors.meetings = error;
  }

  try {
    if (sources.financial_updates?.clients) {
      const rows = filterFinancialUpdateClients(
        sources.financial_updates.clients,
        executiveFiltersToDomain(filters, "financial_updates"),
      );
      contexts.financial = {
        rows,
        summary: summarizeFinancialUpdateRows(rows, sources.financial_updates.summary || {}),
      };
    }
  } catch (error) {
    contexts.errors.financial = error;
  }

  try {
    if (sources.mechanisms?.clients) {
      const rows = filterMechanismClients(sources.mechanisms.clients, executiveFiltersToDomain(filters, "mechanisms"));
      const summary = summarizeMechanismRows(rows, {
        catalog: sources.mechanisms.catalog || [],
        portfolioCount: rows.length,
        consolidationQuality: sources.mechanisms.metadata?.consolidationQuality || null,
      });
      contexts.mechanisms = {
        rows,
        catalog: sources.mechanisms.catalog || [],
        summary,
      };
    }
  } catch (error) {
    contexts.errors.mechanisms = error;
  }

  try {
    if (sources.satisfaction?.clients || sources.satisfaction?.scopeInputs) {
      const domainFilters = executiveFiltersToDomain(filters, "satisfaction");
      const scoped = buildScopedSatisfactionView(sources.satisfaction, { ...domainFilters, quarter: "latest" });
      const rows = filterSatisfactionClients(scoped.clients, domainFilters);
      const populationTotal = sources.satisfaction.population?.totalClients ?? sources.satisfaction.scopeInputs?.totalClients;
      contexts.satisfaction = {
        rows,
        summary: summarizeSatisfactionRows(rows, populationTotal),
        dist: distributionsFromSatisfactionRows(rows, sources.satisfaction.distributions || {}),
        selectedQuarter: scoped.selectedQuarter,
      };
    }
  } catch (error) {
    contexts.errors.satisfaction = error;
  }

  try {
    if (sources.cancellations?.clients) {
      const rows = filterCancellationClients(
        sources.cancellations.clients,
        executiveFiltersToDomain(filters, "cancellations"),
      );
      contexts.cancellations = {
        rows,
        summary: summarizeCancellationRows(rows, sources.cancellations.summary || {}),
        dist: distributionsFromCancellationRows(
          rows,
          sources.cancellations.distributions || {},
          sources.cancellations.summary || {},
        ),
      };
    }
  } catch (error) {
    contexts.errors.cancellations = error;
  }

  try {
    if (sources.renewal?.clients) {
      const rows = filterRenewalClients(sources.renewal.clients, executiveFiltersToDomain(filters, "renewal"));
      contexts.renewal = { rows, summary: summarizeRenewalRows(rows) };
    }
  } catch (error) {
    contexts.errors.renewal = error;
  }

  try {
    if (sources.ep_performance?.engineers) {
      const engineers = filterEpEngineers(
        sources.ep_performance.engineers,
        executiveFiltersToDomain(filters, "ep_performance"),
      );
      contexts.ep = {
        engineers: engineers.map((e) => ({
          ...e,
          implementationShare: e.totalClients
            ? pct(e.clientsWithImplementedMechanisms || 0, e.totalClients)
            : null,
        })),
      };
    }
  } catch (error) {
    contexts.errors.ep = error;
  }

  try {
    if (sources.temporal_indicators) {
      contexts.temporal = summarizeFilteredTemporal(
        sources.temporal_indicators,
        executiveFiltersToDomain(filters, "temporal_indicators"),
      );
    }
  } catch (error) {
    contexts.errors.temporal = error;
  }

  return contexts;
}

export function extractExecutiveMetrics(contexts = {}) {
  const g = contexts.general;
  const j = contexts.journey;
  const m = contexts.meetings;
  const f = contexts.financial;
  const mech = contexts.mechanisms;
  const sat = contexts.satisfaction;
  const can = contexts.cancellations;
  const ren = contexts.renewal;
  const ep = contexts.ep;
  const ti = contexts.temporal;

  const clientsWithImplemented = mech?.summary?.clientsWithImplementedMechanism ?? null;
  const mechPopulation = mech?.summary?.clientsWithMechanisms ?? null;
  const mechDist = topMechanismDistribution(mech?.summary?.typeUsage || [], 5);

  const activeClients = g?.summary?.activeClients ?? null;
  const totalRenewals = ren?.summary?.totalRenewals ?? null;

  const epRenewed = ep?.engineers ? pickTopEp(ep.engineers, "renewedPortfolioPercentage") : null;
  const epImpl = ep?.engineers ? pickTopEp(ep.engineers, "implementationShare") : null;

  const temporalSignals = (ti?.preCancellation?.signals || [])
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((s) => ({
      label: s.label,
      count: s.count,
      percent: s.percent,
      description: s.description || null,
    }));

  return {
    active_clients: g ? metricValue(g.summary.activeClients, { coverage: { denominator: g.summary.totalClients } }) : null,
    frozen_clients: g
      ? metricValue((g.portfolioSummary || g.summary).frozenClients, {
          coverage: { denominator: (g.portfolioSummary || g.summary).totalClients },
          scope: "all_clients",
        })
      : null,
    median_stay_days: g
      ? metricValue(g.summary.typicalStayDays, {
          calculation: "median",
          coverage: { numerator: g.summary.stayCalculatedClients, denominator: g.summary.totalClients, percent: g.summary.stayCoveragePercent },
        })
      : null,
    active_segment_distribution: g
      ? metricValue(
          (g.activeDist.segments || []).filter((item) => item.count > 0),
          { coverage: { denominator: g.activeRows.length } },
        )
      : null,
    median_monthly_income: g
      ? metricValue(g.summary.typicalMonthlyIncome, {
          calculation: "median",
          coverage: { numerator: g.summary.monthlyIncomeFilledCount, denominator: g.summary.totalClients },
        })
      : null,
    median_last_contribution: g
      ? metricValue(g.summary.typicalLastContribution, {
          calculation: "median",
          coverage: { numerator: g.summary.lastContributionFilledCount, denominator: g.summary.totalClients },
        })
      : null,
    median_liquidity_reserve: g
      ? metricValue(g.summary.typicalLiquidityReserve, {
          calculation: "median",
          coverage: { numerator: g.summary.liquidityReserveFilledCount, denominator: g.summary.totalClients },
        })
      : null,
    acquisition_last_3_months: g ? metricValue(g.acquisitionSeries.slice(-3)) : null,

    onboarding_completion_rate: j
      ? metricValue(j.summary.completedPercent, {
          coverage: j.summary.completionCoverage,
          numerator: j.summary.completedOnboarding,
          denominator: j.summary.completionBaseClients,
        })
      : null,
    median_first_meeting_days: j
      ? metricValue(j.summary.medianFirstMeetingDays, {
          calculation: "median",
          coverage: j.summary.firstMeetingCoverage,
        })
      : null,

    clients_without_meeting: m ? metricValue(m.summary.clientsWithoutMeeting, { coverage: { denominator: m.summary.filteredClients } }) : null,
    average_interval_between_meetings: m
      ? metricValue(m.summary.averageIntervalDays, {
          calculation: "mean",
          median: m.summary.typicalIntervalDays,
          coverage: { numerator: m.summary.intervalDaysStats?.validCount, denominator: m.summary.filteredClients },
        })
      : null,
    days_to_first_meeting: j
      ? metricValue(j.summary.medianFirstMeetingDays, { calculation: "median", coverage: j.summary.firstMeetingCoverage })
      : null,
    days_financial_to_activation: f
      ? metricValue(f.summary.medianDaysFinancialToActivation, {
          calculation: "median",
          coverage: f.summary.financialToActivationCoverage,
          sampleSize: f.summary.financialToActivationSample,
        })
      : null,
    days_to_central_intelligence: j
      ? metricValue(j.summary.medianPlanDeliveryDays, {
          calculation: "median",
          coverage: j.summary.planDeliveryCoverage,
        })
      : null,
    clients_without_financial_diagnosis: g
      ? metricValue(Math.max(0, g.summary.totalClients - g.summary.clientsWithFinancialProfile), {
          coverage: { numerator: g.summary.clientsWithFinancialProfile, denominator: g.summary.totalClients },
          rule: "total filtrado − clientes com diagnóstico financeiro",
        })
      : null,

    clients_with_implemented_mechanisms: mech ? metricValue(clientsWithImplemented, { coverage: { denominator: mechPopulation } }) : null,
    clients_implementation_rate: mech
      ? metricValue(mech.summary?.implementationPercent ?? null, {
          rule: "clientes com mecanismo implementado ÷ clientes com mecanismos",
          numerator: clientsWithImplemented,
          denominator: mechPopulation,
          note: "Mesma métrica A da página Implementação de Mecanismos. Distinto de implementationPercentLinks (vínculos).",
        })
      : null,
    mechanism_type_distribution: mech ? metricValue(mechDist) : null,

    nps: sat
      ? metricValue(sat.summary.nps, {
          coverage: { percent: sat.summary.npsCoveragePercent, denominator: sat.rows.length },
        })
      : null,
    promoters_detractors_share: sat
      ? metricValue({
          promoters: sat.dist.npsClassification?.find((x) => x.label === "Promotores") ?? null,
          detractors: sat.dist.npsClassification?.find((x) => x.label === "Detratores") ?? null,
          neutrals: sat.dist.npsClassification?.find((x) => x.label === "Neutros") ?? null,
        })
      : null,
    csat_average: sat
      ? metricValue(sat.summary.csatAverage, {
          coverage: { responses: sat.summary.csatResponses, satisfiedPercent: sat.summary.csatSatisfiedPercent },
        })
      : null,
    cancellation_intention_vs_effective: can
      ? metricValue(can.dist.byMonthIntentionVsEffective || [])
      : null,
    top_cancellation_reasons: can
      ? metricValue(cancellationReasonsForExecutive(can.dist.byCategory || []), {
          note: "Mesmo agrupamento da página Cancelamento (byCategory, top 10 com count > 0).",
        })
      : null,
    intention_destination_branches: can
      ? (() => {
          const destination = buildIntentionDestinationBranches(can.rows);
          return metricValue(destination, { rule: destination.rule });
        })()
      : null,
    total_renewals: ren ? metricValue(totalRenewals, { coverage: { eligible: ren.summary.eligibleClients } }) : null,
    renewal_eligible_clients: ren
      ? metricValue(ren.summary?.eligibleClients ?? null, {
          rule: "Clientes com ciclo válido (> 0) no recorte — population.eligibleClients / summarizeRenewalRows",
          coverage: { denominator: ren.summary?.totalClients },
        })
      : null,
    renewals_per_active_client:
      totalRenewals != null && activeClients
        ? metricValue(Math.round((totalRenewals / activeClients) * 1000) / 1000, {
            numerator: totalRenewals,
            denominator: activeClients,
            rule: "totalRenewals ÷ activeClients",
          })
        : null,

    top_ep_renewed_share: epRenewed?.top
      ? metricValue({
          engineer: epRenewed.top.engineer,
          percent: epRenewed.top.renewedPortfolioPercentage,
          renewed: epRenewed.top.renewedClients,
          base: epRenewed.top.totalClients,
          tied: epRenewed.tied.length > 1 ? epRenewed.tied.map((e) => e.engineer) : null,
        })
      : null,
    top_ep_implementation_share: epImpl?.top
      ? metricValue({
          engineer: epImpl.top.engineer,
          percent: epImpl.top.implementationShare,
          implementedClients: epImpl.top.clientsWithImplementedMechanisms,
          base: epImpl.top.totalClients,
          tied: epImpl.tied.length > 1 ? epImpl.tied.map((e) => e.engineer) : null,
        })
      : null,

    temporal_top_signals: ti ? metricValue(temporalSignals) : null,
    temporal_signal_distribution: ti
      ? metricValue(
          ti.activeRisk?.signalCountDistribution
            || buildActiveRiskSignalCountDistribution(ti.activeRisk?.clients || []),
        )
      : null,
  };
}

function comparableScalar(value) {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object" && "value" in value) return comparableScalar(value.value);
  return JSON.stringify(value);
}

export function compareExecutiveMetrics(executiveMetrics = {}, sourceMetrics = {}) {
  const rows = EXECUTIVE_METRIC_REGISTRY.map((def) => {
    const executive = executiveMetrics[def.id];
    const source = sourceMetrics[def.id];
    const executiveValue = comparableScalar(executive?.value ?? executive);
    const sourceValue = comparableScalar(source?.value ?? source);
    const match = Object.is(executiveValue, sourceValue);
    return {
      metricId: def.id,
      label: def.label,
      sourcePage: def.sourcePage,
      sourceMetricId: def.sourceMetricId,
      executiveValue,
      sourceValue,
      match: def.id === "renewal_eligible_clients" ? executiveValue === sourceValue : match,
      pending: false,
    };
  });
  return {
    pass: rows.every((row) => row.match),
    rows,
  };
}

const SECTION_DOMAIN_ERRORS = Object.freeze({
  baseClients: ["general"],
  onboarding: ["journey"],
  engagement: ["meetings", "journey", "financial", "general"],
  valueDelivery: ["mechanisms"],
  clientHealth: ["satisfaction", "cancellations", "renewal"],
  ep: ["ep"],
  temporal: ["temporal"],
});

function blockStatusFromMetrics(metrics = {}, sectionDefs = [], contexts = {}, section) {
  const domainErrors = (SECTION_DOMAIN_ERRORS[section] || []).filter((key) => contexts.errors?.[key]);
  const values = sectionDefs.map((def) => metrics[def.id]);
  const available = values.filter((v) => v != null);
  if (!available.length) return domainErrors.length ? "error" : "partial";
  if (available.length < values.length || domainErrors.length) return "partial";
  if (values.some((v) => v?.status === "pending_rule")) return "partial";
  return "ok";
}

export function buildOfficialSourceMetrics(contexts = {}) {
  const executive = extractExecutiveMetrics(contexts);
  const g = contexts.general;
  const j = contexts.journey;
  const m = contexts.meetings;
  const mech = contexts.mechanisms;
  const clientsWithImplemented = mech?.summary?.clientsWithImplementedMechanism ?? null;
  const mechPopulation = mech?.summary?.clientsWithMechanisms ?? null;

  return {
    active_clients: g?.summary?.activeClients ?? null,
    frozen_clients: g?.portfolioSummary?.frozenClients ?? g?.summary?.frozenClients ?? null,
    median_stay_days: g?.summary?.typicalStayDays ?? null,
    active_segment_distribution: g
      ? (g.activeDist?.segments || []).filter((item) => item.count > 0)
      : null,
    median_monthly_income: g?.summary?.typicalMonthlyIncome ?? null,
    median_last_contribution: g?.summary?.typicalLastContribution ?? null,
    median_liquidity_reserve: g?.summary?.typicalLiquidityReserve ?? null,
    acquisition_last_3_months: g ? g.acquisitionSeries.slice(-3) : null,
    onboarding_completion_rate: j?.summary?.completedPercent ?? null,
    median_first_meeting_days: j?.summary?.medianFirstMeetingDays ?? null,
    clients_without_meeting: m?.summary?.clientsWithoutMeeting ?? null,
    average_interval_between_meetings: m?.summary?.averageIntervalDays ?? null,
    days_to_first_meeting: j?.summary?.medianFirstMeetingDays ?? null,
    days_financial_to_activation: contexts.financial?.summary?.medianDaysFinancialToActivation ?? null,
    days_to_central_intelligence: j?.summary?.medianPlanDeliveryDays ?? null,
    clients_without_financial_diagnosis:
      g?.summary?.totalClients != null
        ? Math.max(0, g.summary.totalClients - g.summary.clientsWithFinancialProfile)
        : null,
    clients_with_implemented_mechanisms: clientsWithImplemented,
    clients_implementation_rate:
      mech?.summary?.implementationPercent ?? (mechPopulation ? pct(clientsWithImplemented, mechPopulation) : null),
    mechanism_type_distribution: mech ? topMechanismDistribution(mech.summary?.typeUsage || [], 5) : null,
    nps: contexts.satisfaction?.summary?.nps ?? null,
    promoters_detractors_share: contexts.satisfaction
      ? {
          promoters: contexts.satisfaction.dist?.npsClassification?.find((x) => x.label === "Promotores") ?? null,
          detractors: contexts.satisfaction.dist?.npsClassification?.find((x) => x.label === "Detratores") ?? null,
          neutrals: contexts.satisfaction.dist?.npsClassification?.find((x) => x.label === "Neutros") ?? null,
        }
      : null,
    csat_average: contexts.satisfaction?.summary?.csatAverage ?? null,
    cancellation_intention_vs_effective: contexts.cancellations?.dist?.byMonthIntentionVsEffective ?? null,
    top_cancellation_reasons: contexts.cancellations
      ? cancellationReasonsForExecutive(contexts.cancellations.dist?.byCategory || [])
      : null,
    intention_destination_branches: contexts.cancellations
      ? buildIntentionDestinationBranches(contexts.cancellations.rows || [])
      : null,
    total_renewals: contexts.renewal?.summary?.totalRenewals ?? null,
    renewal_eligible_clients: contexts.renewal?.summary?.eligibleClients ?? null,
    renewals_per_active_client:
      contexts.renewal?.summary?.totalRenewals != null && contexts.general?.summary?.activeClients
        ? Math.round((contexts.renewal.summary.totalRenewals / contexts.general.summary.activeClients) * 1000) / 1000
        : null,
    top_ep_renewed_share: executive.top_ep_renewed_share?.value ?? null,
    top_ep_implementation_share: executive.top_ep_implementation_share?.value ?? null,
    temporal_top_signals: executive.temporal_top_signals?.value ?? null,
    temporal_signal_distribution:
      contexts.temporal?.activeRisk?.signalCountDistribution
      || buildActiveRiskSignalCountDistribution(contexts.temporal?.activeRisk?.clients || []),
  };
}

export function buildExecutiveBlocks(metrics = {}, contexts = {}) {
  const blocks = {};
  for (const section of ["baseClients", "onboarding", "engagement", "valueDelivery", "clientHealth", "ep", "temporal"]) {
    const defs = EXECUTIVE_METRIC_REGISTRY.filter((d) => d.section === section);
    const sectionMetrics = {};
    for (const def of defs) {
      sectionMetrics[def.id] = {
        ...def,
        ...(metrics[def.id] || { value: null, status: "unavailable" }),
      };
    }
    blocks[section] = {
      status: blockStatusFromMetrics(metrics, defs, contexts, section),
      metrics: sectionMetrics,
    };
  }
  return blocks;
}

export { buildActiveRiskSignalCountDistribution as signalCountDistribution };
