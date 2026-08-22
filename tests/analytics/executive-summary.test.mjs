import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildExecutiveSections,
  buildExecutiveSummaryPayload,
  compareExecutiveWithSourcePages,
} from "../../lib/analytics/executive-summary.mjs";
import {
  buildExecutiveContexts,
  extractExecutiveMetrics,
} from "../../lib/analytics/executive-summary-extractors.mjs";
import {
  defaultExecutiveSummaryFilters,
  executiveFiltersToDomain,
  buildExecutiveSummaryApiUrl,
} from "../../lib/analytics/executive-summary-filters.mjs";
import {
  EXECUTIVE_METRIC_REGISTRY,
  EXECUTIVE_SECTIONS,
  RENEWAL_ELIGIBLE_RULE_STATUS,
  isCategorizedCancellationReason,
  topCategorizedCancellationReasons,
  topMechanismDistribution,
} from "../../lib/analytics/executive-summary-registry.mjs";
import { buildIntentionDestinationBranches } from "../../lib/analytics/cancellations-metrics.mjs";
import {
  renderRankingHeatmapTable,
  renderStatisticalMatrix,
} from "../../js/components/statistical-matrix.js";
import { getPageFilterContract } from "../../lib/analytics/filters/page-contracts.mjs";

const mockGeneralClients = [
  {
    clientId: "1",
    clientName: "A",
    analyticalStatus: "Ativo",
    engineer: "EP1",
    segmentLabel: "APEX",
    program: "Pharus",
    typicalStayDays: 100,
    monthlyIncome: 10000,
    lastContribution: 500,
    liquidityReserve: 20000,
    hasFinancialProfile: true,
    contractDate: "2026-01-15",
    acquisitionDate: "2026-01-15",
  },
  {
    clientId: "2",
    clientName: "B",
    analyticalStatus: "Congelado",
    engineer: "EP2",
    segmentLabel: "PRIVATE",
    program: "Davos",
    contractDate: "2025-12-01",
    acquisitionDate: "2025-12-01",
  },
];

const mockSources = {
  general: { clients: mockGeneralClients },
  journey: {
    clients: [
      {
        clientId: "1",
        analyticalStatus: "Ativo",
        completedOnboarding: true,
        daysToFirstMeeting: 10,
        daysToPlanDelivery: 20,
        totalOnboardingDays: 8,
        contractDate: "2026-01-15",
      },
    ],
  },
  meetings: {
    clients: [
      { clientId: "1", analyticalStatus: "Ativo", hasValidMeeting: true, meetings: [], absences: 0, reschedules: 0 },
      { clientId: "2", analyticalStatus: "Congelado", hasValidMeeting: false, meetings: [], absences: 0, reschedules: 0 },
    ],
  },
  financial_updates: {
    clients: [{ clientId: "1", analyticalStatus: "Ativo", hasFinancialData: true, daysFinancialToActivation: 12 }],
    summary: {},
  },
  mechanisms: {
    catalog: [{ id: "m1", name: "Previdência" }],
    clients: [{
      clientId: "1",
      analyticalStatus: "Ativo",
      mechanisms: [{ mechanismId: "m1", name: "Previdência", status: "Implementado" }],
      available: 2,
      implemented: 1,
      inProgress: 0,
    }],
  },
  satisfaction: {
    clients: [{ clientId: "1", latestNps: 9, npsResponses: 1, averageCsat: 5, csatResponses: 1 }],
    distributions: {},
  },
  cancellations: {
    clients: [],
    summary: {},
    distributions: { byMonthIntentionVsEffective: [], byCategory: [] },
  },
  renewal: {
    clients: [{ clientId: "1", cycleValid: true, renewed: true, renewalCount: 1, currentCycle: 2 }],
  },
  ep_performance: {
    engineers: [
      {
        engineer: "EP1",
        totalClients: 20,
        renewedClients: 10,
        renewedPortfolioPercentage: 50,
        clientsWithImplementedMechanisms: 12,
      },
      {
        engineer: "EP2",
        totalClients: 15,
        renewedClients: 3,
        renewedPortfolioPercentage: 20,
        clientsWithImplementedMechanisms: 10,
      },
    ],
  },
  temporal_indicators: {
    clients: [],
    activityRecency: [],
    preCancellation: {
      signals: [{ key: "s1", label: "Sinal A", count: 2, percent: 40, description: "Janela 30–60 dias" }],
      clients: [{ signalCount: 1 }, { signalCount: 0 }],
    },
    activeRisk: { signals: [], clients: [] },
  },
};

test("registry cobre 7 blocos e 32 indicadores", () => {
  assert.equal(EXECUTIVE_SECTIONS.length, 7);
  assert.equal(EXECUTIVE_METRIC_REGISTRY.length, 32);
  for (const section of EXECUTIVE_SECTIONS) {
    assert.ok(EXECUTIVE_METRIC_REGISTRY.some((item) => item.section === section));
  }
});

test("destino das intenções usa ramificação exclusiva oficial", () => {
  const rows = [
    { clientId: "1", hasIntentionOrPedido: true, hasEfetivado: true, isArchived: false, isRetido: false, inProcessCurrently: false },
    { clientId: "2", hasIntentionOrPedido: true, hasEfetivado: false, isArchived: true, isRetido: false, inProcessCurrently: true },
    { clientId: "3", hasIntentionOrPedido: true, hasEfetivado: false, isArchived: false, isRetido: true, inProcessCurrently: true },
    { clientId: "4", hasIntentionOrPedido: true, hasEfetivado: false, isArchived: false, isRetido: false, inProcessCurrently: true },
    { clientId: "5", hasIntentionOrPedido: false, hasEfetivado: true, isArchived: false, isRetido: false, inProcessCurrently: false },
  ];
  const result = buildIntentionDestinationBranches(rows);
  assert.equal(result.total, 4);
  assert.equal(result.branches.find((b) => b.key === "cancelado").count, 1);
  assert.equal(result.branches.find((b) => b.key === "arquivado").count, 1);
  assert.equal(result.branches.find((b) => b.key === "retido").count, 1);
  assert.equal(result.branches.find((b) => b.key === "em_processo").count, 1);
  assert.equal(result.closure?.matchesUniverse, true);
});

test("Resumo Executivo expõe filtro Programa na UI", () => {
  const contract = getPageFilterContract("executive_summary");
  assert.deepEqual(contract.uiFilters, ["program"]);
});

test("frozen_clients usa carteira total sem active-first", () => {
  const contexts = buildExecutiveContexts(mockSources, defaultExecutiveSummaryFilters());
  assert.equal(contexts.general.summary.frozenClients, 0);
  assert.equal(contexts.general.portfolioSummary.frozenClients, 1);
  const metrics = extractExecutiveMetrics(contexts);
  assert.equal(metrics.frozen_clients.value, 1);
  assert.equal(metrics.frozen_clients.scope, "all_clients");
});

test("ranking heatmap usa layout proporcional distinto da matriz simétrica", () => {
  const ranking = renderRankingHeatmapTable({
    columns: [
      { id: "association", label: "Correlação" },
      { id: "stdDiff", label: "Diferença" },
      { id: "aucAdjusted", label: "AUC ajust." },
      { id: "coveragePercent", label: "Cobertura" },
    ],
    rows: [
      {
        label: "Permanência longa com nome extenso para validar clamp",
        trailing: 120,
        cells: [
          { display: "0,42", bg: "#111", color: "#fff" },
          { display: "0,18", bg: "#222", color: "#fff" },
          { display: "0,61", bg: "#333", color: "#fff" },
          { display: "88%", bg: "#444", color: "#fff" },
        ],
      },
    ],
  });
  assert.match(ranking, /matrix-grid--ranking/);
  assert.match(ranking, /matrix-rank-cell/);
  assert.match(ranking, /Expandir matriz/);
  assert.match(ranking, /0,42/);
  assert.doesNotMatch(ranking, /matrix-grid--symmetric/);

  const symmetric = renderStatisticalMatrix({
    columns: [{ label: "A" }, { label: "B" }],
    rows: [{ label: "Linha", cells: [{ display: "1,00", bg: "#111", color: "#fff" }, { display: "-1,00", bg: "#222", color: "#fff" }] }],
  });
  assert.match(symmetric, /matrix-grid--symmetric/);
  assert.match(symmetric, /matrix-cell/);
  assert.doesNotMatch(symmetric, /matrix-rank-cell/);
});

test("motivos categorizados excluem Outros/Não informado", () => {
  assert.equal(isCategorizedCancellationReason("Outros motivos"), false);
  assert.equal(isCategorizedCancellationReason("Questões financeiras"), true);
  const top = topCategorizedCancellationReasons(
    [
      { label: "Outros motivos", count: 99 },
      { label: "Questões financeiras", count: 10 },
      { label: "Não informado", count: 50 },
    ],
    5,
  );
  assert.equal(top.length, 1);
  assert.equal(top[0].label, "Questões financeiras");
});

test("top mecanismos agrupa Outros", () => {
  const grouped = topMechanismDistribution(
    [
      { label: "M1", count: 10 },
      { label: "M2", count: 8 },
      { label: "M3", count: 6 },
      { label: "M4", count: 4 },
      { label: "M5", count: 3 },
      { label: "M6", count: 2 },
      { label: "M7", count: 1 },
      { label: "M8", count: 1 },
    ],
    5,
  );
  assert.equal(grouped.top.at(-1).label, "Outros");
  assert.ok(grouped.top.at(-1).count >= 4);
});

test("executive summary API url e filtros sem período", () => {
  assert.match(buildExecutiveSummaryApiUrl({ program: "pharus" }), /program=Pharus/);
  assert.match(buildExecutiveSummaryApiUrl({}, { force: true }), /force=1/);
  const contract = getPageFilterContract("executive_summary");
  assert.ok(contract);
  assert.equal(contract.period.required, false);
  assert.deepEqual(contract.uiFilters, ["program"]);
});

test("payload estruturado por blocos sem sources brutos", () => {
  const filters = defaultExecutiveSummaryFilters();
  const payload = buildExecutiveSummaryPayload(mockSources, filters);
  assert.ok(payload.baseClients?.metrics?.active_clients);
  assert.ok(payload.onboarding?.metrics?.onboarding_completion_rate);
  assert.ok(payload.engagement?.metrics?.clients_without_meeting);
  assert.ok(payload.valueDelivery?.metrics?.clients_implementation_rate);
  assert.ok(payload.clientHealth?.metrics?.renewal_eligible_clients);
  assert.ok(payload.ep?.metrics?.top_ep_renewed_share);
  assert.ok(payload.temporal?.metrics?.temporal_top_signals);
  assert.equal(payload.baseClients.metrics.active_clients.value, 1);
  assert.equal(payload.valueDelivery.metrics.clients_with_implemented_mechanisms.value, 1);
  assert.equal(typeof payload.comparison.pass, "boolean");
  assert.ok(payload.filterOptions?.segments?.length >= 1);
  assert.equal("sources" in payload, false);
});

test("comparação executivo × fonte passa para métricas escalares", () => {
  const filters = defaultExecutiveSummaryFilters();
  const comparison = compareExecutiveWithSourcePages(mockSources, filters);
  assert.ok(Array.isArray(comparison.rows));
  assert.equal(comparison.rows.length, 32);
  const active = comparison.rows.find((row) => row.metricId === "active_clients");
  assert.equal(active.match, true);
  assert.equal(active.executiveValue, 1);
  const pending = comparison.rows.find((row) => row.metricId === "renewal_eligible_clients");
  assert.equal(pending.match, true);
  assert.equal(pending.pending, false);
});

test("buildExecutiveSections mantém compatibilidade de blocos", () => {
  const filters = defaultExecutiveSummaryFilters();
  const built = buildExecutiveSections(mockSources, filters);
  assert.equal(built.sections.base.status, "ok");
  assert.equal(built.sections.base.data.active_clients, 1);
  assert.equal(built.sections.onboarding.data.onboarding_completion_rate, 100);
});

test("clientes aptos para renovação permanece pendente", () => {
  assert.equal(RENEWAL_ELIGIBLE_RULE_STATUS.found, false);
  assert.match(RENEWAL_ELIGIBLE_RULE_STATUS.message, /NOT FOUND/);
});

test("filtro Programa afeta população geral via clients.programa", () => {
  const pharusOnly = buildExecutiveContexts(mockSources, { ...defaultExecutiveSummaryFilters(), program: "Pharus" });
  assert.equal(pharusOnly.general.summary.activeClients, 1);
  const davosOnly = buildExecutiveContexts(mockSources, { ...defaultExecutiveSummaryFilters(), program: "Davos" });
  assert.equal(davosOnly.general.summary.activeClients, 0);
  assert.equal(davosOnly.general.portfolioSummary.frozenClients, 1);
});

test("EP renovação expõe maior e menor no recorte", () => {
  const metrics = extractExecutiveMetrics(buildExecutiveContexts(mockSources, defaultExecutiveSummaryFilters()));
  assert.equal(metrics.top_ep_renewed_share.value.high.engineer, "EP1");
  assert.equal(metrics.top_ep_renewed_share.value.low.engineer, "EP2");
  assert.equal(metrics.top_ep_implementation_share.value.high.engineer, "EP2");
  assert.equal(metrics.top_ep_implementation_share.value.low.engineer, "EP1");
});

test("executiveFiltersToDomain não inclui período global", () => {
  const domain = executiveFiltersToDomain(defaultExecutiveSummaryFilters(), "general");
  assert.equal(domain.periodPreset, "all");
  assert.equal(domain.periodFrom, "");
});
