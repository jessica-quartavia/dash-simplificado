import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChurnMonthSeries } from "../../lib/analytics/general-metrics.mjs";
import { buildIntentionVsEffectiveMonthSeries } from "../../lib/analytics/cancellations-metrics.mjs";
import { buildExecutiveContexts } from "../../lib/analytics/executive-summary-extractors.mjs";
import { defaultExecutiveSummaryFilters } from "../../lib/analytics/executive-summary-filters.mjs";
import { filterCancellationClients } from "../../lib/analytics/cancellations-filters.mjs";
import {
  buildAnalyticalChurnMonthSeries,
  buildCanonicalAnalyticalChurnRows,
} from "../../lib/analytics/canonical-churn-series.mjs";

const efetivado = (id, analytical, extra = {}) => ({
  clientId: id,
  hasEfetivado: true,
  hasConfirmedDate: true,
  operationalCancellationDate: analytical,
  cancellationDate: analytical,
  analyticalCancellationDate: analytical,
  effectiveCancellationDate: analytical,
  analyticalStatus: "Cancelado confirmado",
  isArchived: false,
  ...extra,
});

test("churn mensal — dedupe por client_id no mesmo mês", () => {
  const now = new Date("2026-03-15T12:00:00Z");
  const rows = [
    efetivado("dup", "2026-03-10"),
    { ...efetivado("dup", "2026-03-10"), cancellationDateSource: "duplicate_row" },
  ];
  const series = buildChurnMonthSeries(rows, 12, now);
  const mar = series.find((r) => r.month === "2026-03");
  assert.equal(mar?.churnClients, 1);
});

test("archived excluído — não entra na série (filtro padrão)", () => {
  const now = new Date("2026-03-15T12:00:00Z");
  const rows = [
    efetivado("live", "2026-03-05"),
    efetivado("arch", "2026-03-08", { isArchived: true, hasArchivedRecord: true }),
  ];
  const filtered = filterCancellationClients(rows, { archived: "no", status: "all" });
  const series = buildChurnMonthSeries(filtered, 12, now);
  const mar = series.find((r) => r.month === "2026-03");
  assert.equal(mar?.churnClients, 1);
});

test("distrato Assinado sem data — fora da série mensal", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const rows = [
    {
      clientId: "no-date",
      hasEfetivado: true,
      hasConfirmedDate: false,
      effectiveWithoutConfirmedDate: true,
      analyticalStatus: "Cancelado confirmado",
    },
  ];
  assert.equal(buildChurnMonthSeries(rows, 12, now).reduce((s, r) => s + r.churnClients, 0), 0);
});

test("churn > fim de ciclo usa fim de ciclo no bucket mensal", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const rows = [
    {
      clientId: "c1",
      hasEfetivado: true,
      hasConfirmedDate: true,
      operationalCancellationDate: "2026-05-20",
      cancellationDate: "2026-05-20",
      cycleEndDate: "2026-03-31",
      effectiveCancellationDate: "2026-03-31",
      analyticalCancellationDate: "2026-03-31",
      analyticalStatus: "Cancelado confirmado",
    },
  ];
  const series = buildChurnMonthSeries(rows, 12, now);
  assert.equal(series.find((r) => r.month === "2026-03")?.churnClients, 1);
  assert.equal(series.find((r) => r.month === "2026-05")?.churnClients ?? 0, 0);
});

test("gráfico Cancelamentos effective == buildChurnMonthSeries (mesma população)", () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const rows = [
    efetivado("a", "2026-03-12"),
    efetivado("b", "2026-05-02"),
    efetivado("c", "2026-05-18"),
  ];
  const churn = buildChurnMonthSeries(rows, 12, now);
  const intention = buildIntentionVsEffectiveMonthSeries(rows, { active: false }, now);
  for (const month of churn.map((r) => r.month)) {
    const c = churn.find((r) => r.month === month)?.churnClients ?? 0;
    const e = intention.find((r) => r.month === month)?.effective ?? 0;
    assert.equal(e, c, `mês ${month}`);
  }
});

test("população canônica — archived não entra (legacy archived:all contaria a mais)", () => {
  const filters = defaultExecutiveSummaryFilters();
  const row = {
    clientId: "arch-1",
    hasEfetivado: true,
    hasConfirmedDate: true,
    effectiveCancellationDate: "2026-05-10",
    analyticalCancellationDate: "2026-05-10",
    isArchived: true,
    analyticalStatus: "Cancelado confirmado",
  };
  const sources = { cancellations: { clients: [row] } };
  const canonical = buildCanonicalAnalyticalChurnRows(sources, filters);
  const legacyAll = filterCancellationClients(sources.cancellations.clients, {
    ...filters,
    status: "all",
    archived: "all",
    periodPreset: "all",
  });
  const now = new Date("2026-06-01T12:00:00Z");
  assert.equal(buildAnalyticalChurnMonthSeries(canonical, 12, now).reduce((s, r) => s + r.churnClients, 0), 0);
  assert.equal(buildAnalyticalChurnMonthSeries(legacyAll, 12, now).reduce((s, r) => s + r.churnClients, 0), 1);
});

test("Executivo churn 12m == effective do gráfico Cancelamentos (filtros equivalentes)", () => {
  const filters = defaultExecutiveSummaryFilters();
  const cancellations = {
    clients: [
      efetivado("y", "2026-05-20"),
      efetivado("z", "2026-05-22", { isArchived: true }),
    ],
    summary: {},
    distributions: {},
  };
  const contexts = buildExecutiveContexts({ general: { clients: [] }, cancellations }, filters);
  const execChurn = contexts.general.churnMonthSeries;
  const chart = contexts.cancellations.dist.byMonthIntentionVsEffective;
  for (const row of execChurn) {
    const effective = chart.find((r) => r.month === row.month)?.effective ?? 0;
    assert.equal(row.churnClients, effective, row.month);
  }
});
