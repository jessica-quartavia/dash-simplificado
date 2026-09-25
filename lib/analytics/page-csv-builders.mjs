/**
 * Adapters de exportação CSV por página — mesma lógica de compute das telas.
 */
import { getPageFilterContract } from "./filters/page-contracts.mjs";
import { buildPageFilterMetadata, contractSlugForExport, pageTitleForExport } from "./page-csv-filters.mjs";
import {
  buildDistributionSection,
  buildKpiSection,
  buildPageCsvDocument,
  buildTableSection,
  formatCsvValue,
  formatExtractedAt,
  normalizeFilename,
} from "../../js/export-csv.js";
import { EXECUTIVE_METRIC_REGISTRY, EXECUTIVE_SECTIONS } from "./executive-summary-registry.mjs";
import {
  filterGeneralAcquisitionRows,
  filterGeneralClients,
  sortGeneralClients,
} from "./general-filters.mjs";
import {
  summarizeGeneralRows,
  distributionsFromRows,
  buildAcquisitionMonthSeries,
  acquisitionSummaryFromSeries,
} from "./general-metrics.mjs";
import { applyMeetingFilters, resolveMeetingPeriod } from "./meeting-filters.mjs";
import { summarizeMeetingRows, distributionsFromMeetingRows } from "./meeting-metrics.mjs";
import { filterOnboardingClients } from "./onboarding-filters.mjs";
import { summarizeOnboardingRows } from "./onboarding-metrics.mjs";
import { filterPlanClients, summarizeFilteredPlanClients } from "./patrimonial-plan-filters.mjs";
import {
  expandMechanismSourceRows,
  filterMechanismClients,
  filterPortfolio,
  portfolioSize,
} from "./mechanism-filters.mjs";
import { summarizeMechanismRows } from "./mechanism-metrics.mjs";
import { filterFinancialUpdateClients } from "./financial-updates-filters.mjs";
import { summarizeFinancialUpdateRows } from "./financial-updates-metrics.mjs";
import {
  buildScopedSatisfactionView,
  filterSatisfactionClients,
} from "./satisfaction-filters.mjs";
import {
  resolveSatisfactionNpsKpi,
  summarizeSatisfactionRows,
  distributionsFromSatisfactionRows,
} from "./satisfaction-metrics.mjs";
import { filterCancellationClients } from "./cancellations-filters.mjs";
import {
  distributionsFromCancellationRows,
  summarizeCancellationRows,
} from "./cancellations-metrics.mjs";
import { filterRenewalClients } from "./renewal-filters.mjs";
import { distributionsFromRenewalRows, summarizeRenewalRows } from "./renewal-metrics.mjs";
import { filterEpEngineers, sortEpEngineers, summarizeFilteredEpEngineers } from "./ep-performance-filters.mjs";
import { summarizeFilteredTemporal } from "./temporal-indicators-filters.mjs";
import {
  defaultHealthScoreFilters,
  filterHealthScoreBaseClients,
  filterHealthScoreClients,
} from "./health-score-filters.mjs";
import {
  buildHealthScoreAnalysis,
  DEFAULT_MECHANISM_SLIDER,
  summarizeHealthScoreDistribution,
  weightSplitLabel,
  weightsFromMechanismSlider,
} from "./health-score-metrics.mjs";
import { filterPlatformUsageClients } from "./platform-usage-filters.mjs";
import { filterSupportTickets, summarizeFilteredSupport } from "./support-filters.mjs";

function pharusSourceUnavailable(metadata = {}) {
  return metadata?.pharus?.status === "unavailable" || metadata?.pharusConsulted === false;
}
import { filterPrincipalDiscoveries, rawDiscoveriesFromPayload } from "../../js/statistical-discoveries-ui.mjs";

function tableFromContract(pageId, rows) {
  const columns = getPageFilterContract(pageId)?.exportColumns || [];
  if (!columns.length) return null;
  const projected = (rows || []).map((row) => {
    const out = {};
    for (const col of columns) {
      const raw = typeof col.value === "function" ? col.value(row) : row?.[col.key];
      out[col.key] = formatCsvValue(raw, { type: col.type, nullLabel: col.type === "boolean" ? false : "Não informado" });
    }
    return out;
  });
  return buildTableSection("DETALHES", columns, projected);
}

function formatExecutiveValue(metric) {
  if (!metric) return "—";
  const v = metric.value;
  if (v == null) return metric.status === "unavailable" ? "Indisponível" : "—";
  if (Array.isArray(v)) {
    return v
      .filter((item) => item && (item.count > 0 || item.label))
      .slice(0, 12)
      .map((item) => `${item.label}: ${item.count ?? ""}`)
      .join(" · ");
  }
  if (typeof v === "object") return "—";
  if (typeof v === "number") {
    if (metric.id?.includes("rate") || metric.id?.includes("percent") || String(metric.label || "").includes("%")) {
      return formatCsvValue(v, { type: "percent" });
    }
    return formatCsvValue(v, { type: "number" });
  }
  return formatCsvValue(v);
}

export function buildExecutiveSummaryCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const kpis = [];
  for (const section of EXECUTIVE_SECTIONS) {
    const block = payload?.[section];
    if (!block?.metrics) continue;
    for (const def of EXECUTIVE_METRIC_REGISTRY.filter((d) => d.section === section)) {
      const metric = block.metrics[def.id];
      if (!metric) continue;
      kpis.push({ metric: def.label, value: formatExecutiveValue({ ...def, ...metric }) });
    }
  }
  return {
    sections: [buildKpiSection("KPIS", kpis)],
    filterRows: buildPageFilterMetadata("executive_summary", filters),
  };
}

export function buildGeneralDataCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const clients = payload?.clients || [];
  const rows = sortGeneralClients(filterGeneralClients(clients, filters), "clientName", "asc");
  const summary = summarizeGeneralRows(rows);
  const dist = distributionsFromRows(rows);
  const acqRows = filterGeneralAcquisitionRows(clients, filters);
  const acqSeries = buildAcquisitionMonthSeries(acqRows, ctx.acqRange || 6);
  const acqSummary = acquisitionSummaryFromSeries(acqSeries);

  const kpis = [
    { metric: "Clientes no recorte", value: formatCsvValue(summary.totalClients, { type: "number" }) },
    { metric: "Clientes ativos", value: formatCsvValue(summary.activeClients, { type: "number" }) },
    { metric: "Permanência mediana (dias)", value: formatCsvValue(summary.typicalStayDays, { type: "number" }) },
    { metric: "Com perfil financeiro", value: formatCsvValue(summary.clientsWithFinancialProfile, { type: "number" }) },
    { metric: "Aquisição mês recente", value: formatCsvValue(acqSummary.latestMonthAcquisitions, { type: "number" }) },
  ];

  const sections = [
    buildKpiSection("KPIS", kpis),
    buildDistributionSection("DISTRIBUIÇÃO POR STATUS", dist.status || []),
    buildDistributionSection("DISTRIBUIÇÃO POR SEGMENTO", dist.segments || []),
    tableFromContract("general", rows),
  ].filter(Boolean);

  return { sections, filterRows: buildPageFilterMetadata("general", filters) };
}

export function buildMeetingsCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const rows = applyMeetingFilters(payload?.clients || [], filters, { sortKey: "clientName", sortDir: "asc" });
  const period = resolveMeetingPeriod(filters);
  const summary = summarizeMeetingRows(rows, { periodActive: period.active, periodDivisor: period.divisor });
  const dist = distributionsFromMeetingRows(rows);

  const kpis = [
    { metric: "Total de reuniões", value: formatCsvValue(summary.totalMeetings, { type: "number" }) },
    { metric: "Clientes com reunião", value: formatCsvValue(summary.clientsWithMeeting, { type: "number" }) },
    { metric: "Clientes sem reunião", value: formatCsvValue(summary.clientsWithoutMeeting, { type: "number" }) },
    { metric: "Dias desde última reunião (média)", value: formatCsvValue(summary.averageDaysSinceLastMeeting, { type: "number" }) },
    { metric: "Intervalo médio entre reuniões", value: formatCsvValue(summary.averageIntervalDays, { type: "number" }) },
    { metric: "Taxa de comparecimento", value: formatCsvValue(summary.attendanceRate, { type: "percent" }) },
    { metric: "Taxa no-show", value: formatCsvValue(summary.noShowRate, { type: "percent" }) },
    { metric: "No-shows", value: formatCsvValue(summary.totalNoShows, { type: "number" }) },
    { metric: "Remarcações", value: formatCsvValue(summary.totalReschedules, { type: "number" }) },
  ];

  const sections = [
    buildKpiSection("KPIS", kpis),
    buildDistributionSection("RECÊNCIA", dist.byRecency || dist.recency || []),
    buildDistributionSection("FREQUÊNCIA", dist.byFrequency || []),
    tableFromContract("meetings", rows),
  ].filter(Boolean);

  const extras = [];
  if (filters.attendance && filters.attendance !== "all") extras.push({ label: "Comparecimento", value: filters.attendance });
  return { sections, filterRows: buildPageFilterMetadata("meetings", filters, extras) };
}

export function buildJourneyCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const rows = filterOnboardingClients(payload?.clients || [], filters);
  const summary = summarizeOnboardingRows(rows);
  const kpis = [
    { metric: "Clientes no recorte", value: formatCsvValue(summary.totalClients, { type: "number" }) },
    { metric: "Onboarding concluído (%)", value: formatCsvValue(summary.completedPercent, { type: "percent" }) },
    { metric: "Mediana dias onboarding", value: formatCsvValue(summary.medianTotalOnboardingDays, { type: "number" }) },
    { metric: "Mediana até 1ª reunião", value: formatCsvValue(summary.medianFirstMeetingDays, { type: "number" }) },
  ];
  return {
    sections: [buildKpiSection("KPIS", kpis), tableFromContract("journey", rows)].filter(Boolean),
    filterRows: buildPageFilterMetadata("journey", filters),
  };
}

export function buildPatrimonialPlanCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const rows = filterPlanClients(payload?.clients || [], filters);
  const summary = summarizeFilteredPlanClients(rows);
  const kpis = [
    { metric: "Clientes no recorte", value: formatCsvValue(summary.totalPopulation, { type: "number" }) },
    { metric: "Elegíveis (dias até aprovação)", value: formatCsvValue(summary.eligibleClients, { type: "number" }) },
    { metric: "Mediana dias até aprovação", value: formatCsvValue(summary.value, { type: "number" }) },
  ];
  return {
    sections: [buildKpiSection("KPIS", kpis), tableFromContract("patrimonial_plan", rows)].filter(Boolean),
    filterRows: buildPageFilterMetadata("patrimonial_plan", filters),
  };
}

export function buildMechanismsCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const rows = filterMechanismClients(payload?.clients || [], filters);
  const allClients = payload?.clients || [];
  const sourceRows = expandMechanismSourceRows(rows, allClients, filters);
  const portfolio = filterPortfolio(payload?.portfolio || [], filters);
  const meta = payload?.metadata || {};
  const summary = summarizeMechanismRows(rows, {
    sourceRows,
    catalog: payload?.catalog || [],
    portfolio,
    portfolioCount: portfolioSize(portfolio),
    consolidationQuality: meta.consolidationQuality || null,
    filters,
    pharusAvailable: !pharusSourceUnavailable(meta),
  });

  const kpis = [
    { metric: "Clientes com vínculo", value: formatCsvValue(summary.displayedClients ?? summary.clientsWithMechanisms, { type: "number" }) },
    { metric: "Clientes com implementado", value: formatCsvValue(summary.displayedImplementedClients ?? summary.clientsWithImplementedMechanism, { type: "number" }) },
    { metric: "% implementação (clientes)", value: formatCsvValue(summary.displayedImplementationRate ?? summary.implementationPercent, { type: "percent" }) },
  ];

  const typeUsage = (summary.typeUsage || []).filter((t) => t.count > 0).slice(0, 15);

  return {
    sections: [
      buildKpiSection("KPIS", kpis),
      buildDistributionSection(
        "TIPOS DE MECANISMO",
        typeUsage.map((t) => ({ label: t.label || t.type, count: t.count, percent: t.percent })),
      ),
      buildDistributionSection("COBERTURA POR FONTE", [
        { label: "BASE QV", count: summary.baseQvDisplayed, percent: null },
        { label: "App Pharus", count: summary.appPharusDisplayed, percent: null },
      ]),
      tableFromContract("mechanisms", rows),
    ].filter(Boolean),
    filterRows: buildPageFilterMetadata("mechanisms", filters),
  };
}

export function buildFinancialUpdatesCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const rows = filterFinancialUpdateClients(payload?.clients || [], filters);
  const summary = summarizeFinancialUpdateRows(rows, payload?.summary || {});
  const kpis = [
    { metric: "Clientes no recorte", value: formatCsvValue(summary.totalClients, { type: "number" }) },
    { metric: "Com dados financeiros", value: formatCsvValue(summary.clientsWithFinancialData, { type: "number" }) },
    { metric: "Atualizados últimos 30d", value: formatCsvValue(summary.updatedLast30Days, { type: "number" }) },
    { metric: "Desatualizados > 90d", value: formatCsvValue(summary.outdatedOver90Days ?? summary.outdated90Days, { type: "number" }) },
    { metric: "Mediana dias desde atualização", value: formatCsvValue(summary.medianDaysSinceUpdate, { type: "number" }) },
  ];
  return {
    sections: [buildKpiSection("KPIS", kpis), tableFromContract("financial_updates", rows)].filter(Boolean),
    filterRows: buildPageFilterMetadata("financial_updates", filters),
  };
}

export function buildSatisfactionCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const scoped = buildScopedSatisfactionView(payload, filters);
  const rows = filterSatisfactionClients(scoped.clients, filters);
  const population = payload?.population?.totalClients ?? (payload?.clients || []).length;
  const csatSummary = summarizeSatisfactionRows(rows, population);
  const npsKpi = resolveSatisfactionNpsKpi(payload, scoped);
  const summary = { ...csatSummary, ...npsKpi };
  const dist = distributionsFromSatisfactionRows(rows, payload?.distributions || {}, npsKpi);

  const kpis = [
    { metric: "NPS", value: formatCsvValue(summary.nps, { type: "number" }) },
    { metric: "Promotores", value: formatCsvValue(summary.promoters, { type: "number" }) },
    { metric: "Neutros", value: formatCsvValue(summary.neutrals, { type: "number" }) },
    { metric: "Detratores", value: formatCsvValue(summary.detractors, { type: "number" }) },
    { metric: "CSAT médio", value: formatCsvValue(summary.csatAverage, { type: "number" }) },
    { metric: "CSAT satisfeitos (%)", value: formatCsvValue(summary.csatSatisfiedPercent, { type: "percent" }) },
    { metric: "Cobertura NPS (%)", value: formatCsvValue(summary.npsCoveragePercent, { type: "percent" }) },
    { metric: "Clientes com feedback", value: formatCsvValue(summary.clientsWithFeedback, { type: "number" }) },
  ];

  return {
    sections: [
      buildKpiSection("KPIS", kpis),
      buildDistributionSection("CLASSIFICAÇÃO NPS", dist.npsClassification || dist.byNps || []),
      tableFromContract("satisfaction", rows),
    ].filter(Boolean),
    filterRows: buildPageFilterMetadata("satisfaction", filters),
  };
}

export function buildCancellationsCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const rows = filterCancellationClients(payload?.clients || [], filters);
  const options = {
    filters,
    allRows: filterCancellationClients(payload?.clients || [], { ...filters, period: "all", from: "", to: "" }),
  };
  const summary = summarizeCancellationRows(rows, payload?.summary || {}, options);
  const dist = distributionsFromCancellationRows(rows, payload?.distributions || {}, payload?.summary || {}, options);

  const kpis = [
    { metric: "Efetivados no recorte", value: formatCsvValue(summary.effectiveCancellations, { type: "number" }) },
    { metric: "Em processo", value: formatCsvValue(summary.clientsInCancellationProcess, { type: "number" }) },
    { metric: "Casos críticos", value: formatCsvValue(summary.criticalCount, { type: "number" }) },
    { metric: "Intenções/pedidos", value: formatCsvValue(summary.intentionsOrOrdersRegistered, { type: "number" }) },
  ];

  return {
    sections: [
      buildKpiSection("KPIS", kpis),
      buildDistributionSection("MOTIVOS", (dist.byCategory || []).filter((d) => d.count > 0).slice(0, 20)),
      buildDistributionSection("ETAPAS", dist.byExclusiveStage || []),
      tableFromContract("cancellations", rows),
    ].filter(Boolean),
    filterRows: buildPageFilterMetadata("cancellations", filters),
  };
}

export function buildRenewalCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const rows = filterRenewalClients(payload?.clients || [], filters);
  const summary = summarizeRenewalRows(rows, payload?.summary || {});
  const dist = distributionsFromRenewalRows(rows, payload?.distributions || {});

  const kpis = [
    { metric: "Clientes no recorte", value: formatCsvValue(summary.totalClients, { type: "number" }) },
    { metric: "Clientes renovados", value: formatCsvValue(summary.renewedClients, { type: "number" }) },
    { metric: "Taxa em ativos (%)", value: formatCsvValue(summary.renewedActiveRate, { type: "percent" }) },
    { metric: "Clientes ativos", value: formatCsvValue(summary.activeClients, { type: "number" }) },
  ];

  return {
    sections: [
      buildKpiSection("KPIS", kpis),
      buildDistributionSection("DISTRIBUIÇÃO POR CICLO", dist.renewalCountBands || dist.renewedYesNo || []),
      tableFromContract("renewal", rows),
    ].filter(Boolean),
    filterRows: buildPageFilterMetadata("renewal", filters),
  };
}

export function buildEpPerformanceCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const engineers = sortEpEngineers(filterEpEngineers(payload?.engineers || [], filters), "engineer", "asc");
  const summary = summarizeFilteredEpEngineers(engineers);

  const kpis = [
    { metric: "EPs no recorte", value: formatCsvValue(summary.advisorsWithPortfolio, { type: "number" }) },
    { metric: "Clientes na carteira", value: formatCsvValue(summary.totalClients, { type: "number" }) },
    { metric: "Cobertura reuniões (%)", value: formatCsvValue(summary.meetingCoverage, { type: "percent" }) },
    { metric: "Renovação na carteira (%)", value: formatCsvValue(summary.renewedPortfolioPercentage, { type: "percent" }) },
  ];

  return {
    sections: [buildKpiSection("KPIS", kpis), tableFromContract("ep_performance", engineers)].filter(Boolean),
    filterRows: buildPageFilterMetadata("ep_performance", filters),
  };
}

export function buildTemporalIndicatorsCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const effective = ctx.monthlyClients?.length ? { ...payload, clients: ctx.monthlyClients } : payload;
  const view = summarizeFilteredTemporal(effective || {}, filters);
  const summary = view.summary || {};

  const kpis = [
    { metric: "Assuntos na base", value: formatCsvValue(summary.baseClients, { type: "number" }) },
    { metric: "Usuários App Pharus", value: formatCsvValue(summary.appPharusUsers, { type: "number" }) },
    { metric: "Logins no recorte", value: formatCsvValue(summary.totalLogins, { type: "number" }) },
    { metric: "Clientes com sinais (ativos)", value: formatCsvValue(view.activeRisk?.clientsWithSignals, { type: "number" }) },
  ];

  const preSignals = (view.preCancellation?.signals || []).filter((s) => s.count > 0);
  const activeSignals = (view.activeRisk?.signals || []).filter((s) => s.count > 0);
  const buckets = view.activeRisk?.signalCountDistribution || [];
  const recencyRows = view.recency || [];

  return {
    sections: [
      buildKpiSection("KPIS", kpis),
      buildDistributionSection("SINAIS PRÉ-CANCELAMENTO", preSignals),
      buildDistributionSection("SINAIS EM CLIENTES ATIVOS", activeSignals),
      buildDistributionSection("INTENSIDADE DE SINAIS", buckets),
      tableFromContract("temporal_indicators", recencyRows),
    ].filter(Boolean),
    filterRows: buildPageFilterMetadata("temporal_indicators", filters),
  };
}

export function buildStatisticalCrossesCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const s = payload?.summary || {};
  const pop = payload?.population || payload?.metadata?.population || {};

  const kpis = [
    { metric: "Clientes analisados", value: formatCsvValue(s.analyzedClients ?? pop.total, { type: "number" }) },
    { metric: "Clientes ativos", value: formatCsvValue(s.activeClients ?? pop.active, { type: "number" }) },
    { metric: "Cancelamentos efetivados", value: formatCsvValue(s.confirmedCancellations ?? pop.cancelled, { type: "number" }) },
    { metric: "Clientes renovados", value: formatCsvValue(s.renewedClients, { type: "number" }) },
    { metric: "Cobertura média (%)", value: formatCsvValue(s.averageCoverage, { type: "percent" }) },
  ];

  const discoveries = filterPrincipalDiscoveries(rawDiscoveriesFromPayload(payload)).slice(0, 15).map((d) => ({
    metric: d.title || d.headline || d.id || "Descoberta",
    value: d.summary || d.text || d.technical || "—",
  }));

  const rankingCancel = (payload.discoveryRankings?.cancellation || []).slice(0, 15).map((r, i) => ({
    rotulo: r.label || r.variable,
    posicao: i + 1,
    associacao: formatCsvValue(r.association, { type: "number" }),
    cobertura: formatCsvValue(r.coverage, { type: "percent" }),
  }));

  const survival = payload.survival?.curves?.overall;
  const survivalRows = (survival?.points || []).slice(0, 24).map((p) => ({
    tempo: p.time ?? p.month,
    sobrevivencia: formatCsvValue(p.survival ?? p.value, { type: "percent" }),
    em_risco: formatCsvValue(p.atRisk, { type: "number" }),
  }));

  const topClients = payload.topClients?.cancellation || payload.topClients?.risk || [];
  const topRows = (Array.isArray(topClients) ? topClients : []).slice(0, 25).map((c) => ({
    cliente: c.clientName || c.name,
    ep: c.engineer,
    score: c.score ?? c.riskScore,
  }));

  const sections = [
    buildKpiSection("KPIS", kpis),
    buildKpiSection("PRINCIPAIS DESCOBERTAS", discoveries),
    buildTableSection("RANKING CANCELAMENTO", ["rotulo", "posicao", "associacao", "cobertura"], rankingCancel),
    buildTableSection("SOBREVIVÊNCIA (AMOSTRA)", ["tempo", "sobrevivencia", "em_risco"], survivalRows),
    buildTableSection("TOP CLIENTES", ["cliente", "ep", "score"], topRows),
  ].filter(Boolean);

  return { sections, filterRows: buildPageFilterMetadata("statistical_crosses", filters) };
}

export function buildHealthScoreCsv(ctx) {
  const payload = ctx.payload;
  const filters = { ...defaultHealthScoreFilters(), ...(ctx.filters || {}) };
  const slider = ctx.mechanismSlider ?? DEFAULT_MECHANISM_SLIDER;
  const weights = weightsFromMechanismSlider(slider);
  const baseRows = filterHealthScoreBaseClients(payload?.clients || [], filters);
  const analysis = buildHealthScoreAnalysis(baseRows, weights);
  const clients = filterHealthScoreClients(analysis.clients, filters);
  const summary = summarizeHealthScoreDistribution(clients);
  const classCount = (key) => summary.distribution?.find((d) => d.key === key)?.count ?? 0;

  const kpis = [
    { metric: "Peso reuniões / mecanismos (%)", value: weightSplitLabel(weights) },
    { metric: "Score médio", value: formatCsvValue(summary.averageScore, { type: "number" }) },
    { metric: "Saudáveis", value: formatCsvValue(classCount("healthy"), { type: "number" }) },
    { metric: "Atenção", value: formatCsvValue(classCount("attention"), { type: "number" }) },
    { metric: "Críticos", value: formatCsvValue(classCount("critical"), { type: "number" }) },
  ];

  return {
    sections: [
      buildKpiSection("KPIS E PESOS", kpis),
      buildDistributionSection("DISTRIBUIÇÃO REUNIÕES", analysis.meetingDistribution || []),
      buildDistributionSection("POSSUI MECANISMO", analysis.mechanismDistribution || []),
      tableFromContract("health_score", clients),
    ].filter(Boolean),
    filterRows: buildPageFilterMetadata("health_score", filters, [
      { label: "Peso mecanismos (slider)", value: String(slider) },
    ]),
  };
}

export function buildQualityCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const rows = (payload?.data || [])
    .filter((row) => {
      const q = (filters.search || "").trim().toLowerCase();
      if (filters.domain !== "all" && row.domain !== filters.domain) return false;
      if (q && !`${row.table} ${row.column}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .map((row) => {
      const filled = (row.totalRows || 0) - (row.missingRows || 0);
      const fillPercent = row.totalRows ? (filled / row.totalRows) * 100 : 0;
      return {
        ...row,
        filled,
        fillPercent,
        tableLabel: `${row.schema || "public"}.${row.table}`,
      };
    });

  const totals = rows.reduce(
    (acc, row) => {
      acc.rows += row.totalRows || 0;
      acc.filled += row.filled || 0;
      return acc;
    },
    { rows: 0, filled: 0 },
  );
  const completion = totals.rows ? (totals.filled / totals.rows) * 100 : 0;

  const kpis = [
    { metric: "Linhas analisadas", value: formatCsvValue(totals.rows, { type: "number" }) },
    { metric: "Colunas auditadas", value: formatCsvValue(rows.length, { type: "number" }) },
    { metric: "Completude geral (%)", value: formatCsvValue(completion, { type: "percent" }) },
  ];

  return {
    sections: [buildKpiSection("KPIS", kpis), tableFromContract("quality", rows)].filter(Boolean),
    filterRows: buildPageFilterMetadata("quality", filters),
  };
}

export function buildPlatformUsageCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const rows = filterPlatformUsageClients(payload?.clients || [], filters);
  const summary = payload?.summary || {};
  const kpis = [
    { metric: "Usuários App Pharus", value: formatCsvValue(summary.totalUsers, { type: "number" }) },
    { metric: "Com login realizado", value: formatCsvValue(summary.usersWithLogin, { type: "number" }) },
    { metric: "Cobertura login (%)", value: formatCsvValue(summary.loginCoverage, { type: "percent" }) },
  ];
  return {
    sections: [buildKpiSection("KPIS", kpis), tableFromContract("platform_usage", rows)].filter(Boolean),
    filterRows: buildPageFilterMetadata("platform_usage", filters),
  };
}

export function buildSupportCsv(ctx) {
  const payload = ctx.payload;
  const filters = ctx.filters || {};
  const rows = filterSupportTickets(payload?.tickets || [], filters);
  const summary = summarizeFilteredSupport(rows, payload?.summary || {});
  const kpis = [
    { metric: "Tickets no recorte", value: formatCsvValue(summary.totalTickets ?? rows.length, { type: "number" }) },
    { metric: "Com cliente identificado", value: formatCsvValue(summary.ticketsWithClient, { type: "number" }) },
    { metric: "Taxa identificação (%)", value: formatCsvValue(summary.identificationCoverage, { type: "percent" }) },
  ];
  return {
    sections: [buildKpiSection("KPIS", kpis), tableFromContract("support", rows)].filter(Boolean),
    filterRows: buildPageFilterMetadata("support", filters),
  };
}

export function buildInternalMechanismsSatisfactionCsv(ctx) {
  const rows = ctx.payload?.npsClientExportRows || ctx.payload?.npsClientsAll || ctx.payload?.detail?.rows || [];
  const filters = ctx.filters || {};
  return {
    sections: [tableFromContract("internal_mechanisms_satisfaction", rows)].filter(Boolean),
    filterRows: buildPageFilterMetadata("internal_mechanisms_satisfaction", filters),
  };
}

export function buildInternalMechanismsRenewalProjectionCsv(ctx) {
  const p = ctx.payload || {};
  const comparison = (p.comparison?.rows || []).map((r) => ({
    metrica: r.label || r.metric,
    modelo_a: r.a,
    modelo_b: r.b,
  }));
  const sensitivity = (p.historicalComparablePopulation?.sensitivity || []).map((s) => ({
    corte: s.cutoff?.id,
    N: s.summary?.total,
    roc_auc: s.metrics?.rocAuc,
    pr_auc: s.metrics?.prAuc,
    brier: s.metrics?.brier,
  }));
  const popA = Object.entries(p.modelA?.population || {}).map(([k, v]) => ({ campo: k, valor: v }));
  const popB = Object.entries(p.modelB?.population || {}).map(([k, v]) => ({ campo: k, valor: v }));
  return {
    sections: [
      buildTableSection("Comparacao_A_B", ["metrica", "modelo_a", "modelo_b"], comparison),
      buildTableSection("Populacao_A", ["campo", "valor"], popA),
      buildTableSection("Populacao_B", ["campo", "valor"], popB),
      buildTableSection("Sensibilidade_temporal_aux", ["corte", "N", "roc_auc", "pr_auc", "brier"], sensitivity),
    ].filter(Boolean),
    filterRows: buildPageFilterMetadata("internal_mechanisms_renewal_projection", ctx.filters || {}),
  };
}

export const PAGE_EXPORT_BUILDERS = Object.freeze({
  executive_summary: buildExecutiveSummaryCsv,
  general: buildGeneralDataCsv,
  journey: buildJourneyCsv,
  meetings: buildMeetingsCsv,
  patrimonial_plan: buildPatrimonialPlanCsv,
  mechanisms: buildMechanismsCsv,
  platform_usage: buildPlatformUsageCsv,
  financial_updates: buildFinancialUpdatesCsv,
  satisfaction: buildSatisfactionCsv,
  cancellations: buildCancellationsCsv,
  renewal: buildRenewalCsv,
  ep_performance: buildEpPerformanceCsv,
  temporal_indicators: buildTemporalIndicatorsCsv,
  statistical_crosses: buildStatisticalCrossesCsv,
  internal_mechanisms_satisfaction: buildInternalMechanismsSatisfactionCsv,
  internal_mechanisms_renewal_projection: buildInternalMechanismsRenewalProjectionCsv,
  health_score: buildHealthScoreCsv,
  quality: buildQualityCsv,
  support: buildSupportCsv,
});

export function buildPageCsvExport(pageId, ctx) {
  const builder = PAGE_EXPORT_BUILDERS[pageId];
  if (!builder) throw new Error("Exportação não disponível para esta página.");
  return builder(ctx || {});
}

export function composePageCsvDownload(pageId, ctx, now = new Date()) {
  const built = buildPageCsvExport(pageId, ctx);
  const extractedAt = formatExtractedAt(now);
  const slug = contractSlugForExport(pageId);
  const csv = buildPageCsvDocument({
    pageId,
    pageTitle: pageTitleForExport(pageId),
    slug,
    extractedAt,
    filterRows: built.filterRows || [],
    sections: built.sections || [],
  });
  const filename = normalizeFilename(slug, now);
  return { csv, filename };
}
