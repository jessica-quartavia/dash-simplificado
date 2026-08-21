import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultGeneralFilters, filterGeneralAcquisitionRows } from "../../lib/analytics/general-filters.mjs";
import {
  acquisitionSummaryFromSeries,
  buildAcquisitionMonthSeries,
} from "../../lib/analytics/general-metrics.mjs";

const NOW = new Date("2026-08-21T15:00:00.000Z");

const rows = [
  {
    clientId: "1",
    analyticalStatus: "Ativo",
    acquisitionDate: "2026-03-15T00:00:00.000Z",
    acquisitionDateSource: "cycle_start",
    contractDate: "2026-03-15T00:00:00.000Z",
  },
  {
    clientId: "2",
    analyticalStatus: "Cancelado confirmado",
    acquisitionDate: "2026-03-20T00:00:00.000Z",
    acquisitionDateSource: "cycle_start",
    contractDate: "2026-03-20T00:00:00.000Z",
  },
  {
    clientId: "3",
    analyticalStatus: "Ativo",
    acquisitionDate: "2026-04-10T00:00:00.000Z",
    acquisitionDateSource: "cycle_start",
    contractDate: "2026-04-10T00:00:00.000Z",
  },
];

test("aquisição com status Ativos exclui cancelados adquiridos no mesmo mês (regra V1)", () => {
  const activeOnly = filterGeneralAcquisitionRows(rows, defaultGeneralFilters(), { now: NOW });
  const allStatus = filterGeneralAcquisitionRows(rows, { ...defaultGeneralFilters(), status: "all" }, { now: NOW });
  assert.equal(activeOnly.length, 2);
  assert.equal(allStatus.length, 3);
  const seriesActive = buildAcquisitionMonthSeries(activeOnly, 6, NOW);
  const march = seriesActive.find((m) => m.month === "2026-03");
  assert.equal(march?.acquiredClients, 1);
  const seriesAll = buildAcquisitionMonthSeries(allStatus, 6, NOW);
  const marchAll = seriesAll.find((m) => m.month === "2026-03");
  assert.equal(marchAll?.acquiredClients, 2);
});

test("cards derivam da mesma série da janela", () => {
  const series = buildAcquisitionMonthSeries(rows.slice(0, 2), 6, NOW);
  const summary = acquisitionSummaryFromSeries(series);
  const last = series[series.length - 1];
  assert.equal(summary.latestMonthAcquisitions, last.acquiredClients);
  assert.ok(summary.averageMonthlyAcquisitions != null);
});
