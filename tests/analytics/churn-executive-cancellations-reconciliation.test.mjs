import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChurnMonthSeries } from "../../lib/analytics/general-metrics.mjs";
import { buildExecutiveContexts } from "../../lib/analytics/executive-summary-extractors.mjs";
import { defaultExecutiveSummaryFilters } from "../../lib/analytics/executive-summary-filters.mjs";

const efetivado = (id, operational, analytical, cycleEnd = null) => ({
  clientId: id,
  hasEfetivado: true,
  hasConfirmedDate: true,
  operationalCancellationDate: operational,
  cancellationDate: operational,
  analyticalCancellationDate: analytical,
  effectiveCancellationDate: analytical,
  cycleEndDate: cycleEnd,
  analyticalStatus: "Cancelado confirmado",
});

test("Caso D/E — Executivo e Cancelamentos mesma série mensal (12m)", () => {
  const rows = [
    efetivado("a", "2026-06-10", "2026-05-25", "2026-05-25"),
    efetivado("b", "2026-06-15", "2026-06-15", "2026-09-30"),
    efetivado("c", "2026-01-20", "2026-01-20", null),
  ];
  const now = new Date("2026-06-15T15:00:00-03:00");
  const execSeries = buildChurnMonthSeries(rows, 12, now);
  const cancelSeries = buildChurnMonthSeries(rows, 12, now);
  assert.equal(JSON.stringify(execSeries), JSON.stringify(cancelSeries));
  const may = execSeries.find((r) => r.month === "2026-05");
  const jun = execSeries.find((r) => r.month === "2026-06");
  assert.equal(may?.churnClients, 1);
  assert.equal(jun?.churnClients, 1);
  const totalExec = execSeries.reduce((s, r) => s + r.churnClients, 0);
  const totalCancel = cancelSeries.reduce((s, r) => s + r.churnClients, 0);
  assert.equal(totalExec, totalCancel);
  assert.equal(totalExec, 3);
});

test("Executivo usa fonte Cancelamentos para churn quando disponível", () => {
  const filters = defaultExecutiveSummaryFilters();
  const general = {
    clients: [
      {
        clientId: "x",
        analyticalStatus: "Ativo",
        cancellationDate: "2026-06-01",
        effectiveCancellationDate: "2026-06-01",
      },
    ],
  };
  const cancellations = {
    clients: [efetivado("y", "2026-05-20", "2026-05-20", "2026-05-31")],
    summary: {},
    distributions: {},
  };
  const contexts = buildExecutiveContexts(
    { general, cancellations },
    filters,
  );
  const series = contexts.general.churnMonthSeries;
  const may = series.find((r) => r.month === "2026-05");
  assert.equal(may?.churnClients, 1);
  const jun = series.find((r) => r.month === "2026-06");
  assert.equal(jun?.churnClients ?? 0, 0);
});

test("archived=true não entra no Executivo nem no gráfico de Cancelamentos", () => {
  const filters = defaultExecutiveSummaryFilters();
  const live = {
    clientId: "live",
    hasEfetivado: true,
    hasConfirmedDate: true,
    effectiveCancellationDate: "2026-05-10",
    analyticalCancellationDate: "2026-05-10",
    isArchived: false,
    analyticalStatus: "Cancelado confirmado",
  };
  const archived = {
    clientId: "arch",
    hasEfetivado: true,
    hasConfirmedDate: true,
    effectiveCancellationDate: "2026-05-12",
    analyticalCancellationDate: "2026-05-12",
    isArchived: true,
    hasArchivedRecord: true,
    analyticalStatus: "Cancelado confirmado",
  };
  const sources = { general: { clients: [] }, cancellations: { clients: [live, archived], summary: {}, distributions: {} } };
  const contexts = buildExecutiveContexts(sources, filters);
  const totalExec = contexts.general.churnMonthSeries.reduce((s, r) => s + r.churnClients, 0);
  const totalChart = contexts.cancellations.dist.byMonthIntentionVsEffective.reduce(
    (s, r) => s + (r.effective ?? 0),
    0,
  );
  assert.equal(totalExec, 1);
  assert.equal(totalChart, 1);
});

test("Executivo churn mensal == série effective do bloco Cancelamentos", () => {
  const filters = defaultExecutiveSummaryFilters();
  const cancellations = {
    clients: [
      efetivado("a", "2026-03-01"),
      efetivado("b", "2026-05-15"),
    ],
    summary: {},
    distributions: {},
  };
  const contexts = buildExecutiveContexts(
    { general: { clients: [{ clientId: "x", analyticalStatus: "Ativo" }] }, cancellations },
    filters,
  );
  const exec = contexts.general.churnMonthSeries;
  const chart = contexts.cancellations.dist.byMonthIntentionVsEffective;
  for (const row of exec) {
    const eff = chart.find((m) => m.month === row.month)?.effective ?? 0;
    assert.equal(row.churnClients, eff, `mês ${row.month}`);
  }
});
