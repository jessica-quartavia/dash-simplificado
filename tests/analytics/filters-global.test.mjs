import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesSearch, foldSearchText } from "../../lib/analytics/filters/search.mjs";
import { resolvePeriod, inPeriod, PERIOD_PRESETS } from "../../lib/analytics/filters/period.mjs";
import { buildCsv, buildExcelBuffer, projectExportRows } from "../../js/utils/table-export.js";
import { runFilterCheck } from "../../lib/analytics/filters/filter-check.mjs";
import { getPageFilterContract, pagesMissingFilterContract } from "../../lib/analytics/filters/page-contracts.mjs";
import { filterGeneralAcquisitionRows, filterGeneralClients, defaultGeneralFilters } from "../../lib/analytics/general-filters.mjs";
import { filterMechanismClients, filterMechanismMonthSeries, defaultMechanismFilters } from "../../lib/analytics/mechanism-filters.mjs";

const NOW = new Date("2026-08-19T12:00:00.000Z");

const ROW = {
  clientId: "42",
  clientName: "João Silva",
  clientCode: "QV-001",
};

test("busca por nome", () => {
  assert.equal(matchesSearch(ROW, "joão"), true);
  assert.equal(matchesSearch(ROW, "silva"), true);
});

test("busca accent insensitive", () => {
  assert.equal(matchesSearch(ROW, "Joao"), true);
  assert.equal(foldSearchText("João") === foldSearchText("joao"), true);
});

test("busca por ID e código", () => {
  assert.equal(matchesSearch(ROW, "42"), true);
  assert.equal(matchesSearch(ROW, "QV-001"), true);
  assert.equal(matchesSearch(ROW, "qv-00"), true);
});

test("período preset e personalizado", () => {
  assert.equal(PERIOD_PRESETS.some((p) => p.value === "last_6m"), true);
  const preset = resolvePeriod({ period: "last_6m" }, NOW);
  assert.equal(preset.active, true);
  const custom = resolvePeriod({ period: "custom", from: "2026-01-01", to: "2026-06-30" }, NOW);
  assert.equal(custom.active, true);
  assert.equal(inPeriod("2026-03-15", custom), true);
  assert.equal(inPeriod("2025-12-01", custom), false);
});

test("start > end é corrigido automaticamente", () => {
  const corrected = resolvePeriod({ period: "custom", from: "2026-08-01", to: "2026-01-01" }, NOW);
  assert.equal(corrected.invalid, false);
  assert.equal(corrected.active, true);
});

test("datas futuras são rejeitadas", () => {
  const future = resolvePeriod({ period: "custom", from: "2027-08-19", to: "2026-08-20" }, NOW);
  assert.equal(future.invalid, true);
  assert.equal(future.active, false);
});

test("combinação de filtros (general)", () => {
  const rows = [
    { clientId: "1", clientName: "Ana", clientCode: "A1", analyticalStatus: "Ativo", engineer: "EP1", segmentLabel: "PRIVATE", contractDate: "2026-07-01" },
    { clientId: "2", clientName: "João", clientCode: "B2", analyticalStatus: "Ativo", engineer: "EP2", segmentLabel: "APEX", contractDate: "2024-01-01" },
  ];
  const combined = filterGeneralClients(rows, {
    ...defaultGeneralFilters(),
    status: "all",
    engineer: "EP1",
    search: "Ana",
  });
  assert.equal(combined.length, 1);
  assert.equal(combined[0].clientId, "1");
});

test("periodSensitive=false não recorta estoque (general)", () => {
  const rows = [
    { clientId: "1", clientName: "Ana", clientCode: "A1", analyticalStatus: "Ativo", engineer: "EP1", segmentLabel: "PRIVATE", contractDate: "2026-07-01" },
    { clientId: "2", clientName: "João", clientCode: "B2", analyticalStatus: "Ativo", engineer: "EP2", segmentLabel: "APEX", contractDate: "2024-01-01" },
  ];
  const stock = filterGeneralClients(rows, { ...defaultGeneralFilters(), status: "all", period: "last_6m" }, { now: NOW });
  const acq = filterGeneralAcquisitionRows(rows, { ...defaultGeneralFilters(), status: "all", period: "last_6m" }, { now: NOW });
  assert.equal(stock.length, 2);
  assert.equal(acq.length, 1);
});

test("periodSensitive=true recorta gráfico mensal (mechanisms)", () => {
  const clients = [
    {
      clientId: "1",
      clientName: "Ana",
      clientCode: "A1",
      analyticalStatus: "Ativo",
      engineer: "EP1",
      segment: "PRIVATE",
      mechanisms: [
        { status: "Implementado", implementedMonth: "2026-07", implementedAt: "2026-07-10T00:00:00.000Z" },
        { status: "Implementado", implementedMonth: "2024-01", implementedAt: "2024-01-10T00:00:00.000Z" },
      ],
    },
  ];
  const all = filterMechanismMonthSeries(clients, defaultMechanismFilters(), { now: NOW });
  const period = filterMechanismMonthSeries(clients, { ...defaultMechanismFilters(), period: "last_6m" }, { now: NOW });
  assert.equal(all.length, 2);
  assert.equal(period.length, 1);
  assert.equal(period[0].label, "2026-07");
});

test("CSV e XLSX contêm só filtrados e allowlist", () => {
  const columns = getPageFilterContract("general").exportColumns;
  const rows = [
    { clientId: "1", clientName: "Ana", clientCode: "A1", analyticalStatus: "Ativo", segmentLabel: "PRIVATE", engineer: "EP1", contractDate: "2026-01-01", stayDays: 100 },
  ];
  const csv = buildCsv({ rows, columns });
  assert.match(csv, /Ana/);
  assert.equal(csv.includes("clientId"), false);
  const projected = projectExportRows(rows, columns);
  assert.equal(Object.keys(projected[0]).every((key) => columns.some((col) => col.header === key)), true);
  const xlsx = buildExcelBuffer({ rows, columns, filters: [{ label: "EP", value: "EP1" }] });
  assert.equal(xlsx[0], 0x50);
  assert.equal(xlsx[1], 0x4b);
});

test("Filter Check global PASS", () => {
  const result = runFilterCheck();
  assert.equal(pagesMissingFilterContract().length, 0);
  for (const [pageId, pageResult] of Object.entries(result.pages)) {
    const failed = pageResult.checks.filter((item) => !item.ok);
    assert.equal(failed.length, 0, `${pageId}: ${failed.map((f) => f.id).join(", ")}`);
  }
  assert.equal(result.dateRange.ok, true);
  assert.equal(result.ux.ok, true);
  assert.equal(result.ok, true);
});

test("nova página sem contract falha o check", () => {
  assert.equal(getPageFilterContract("pagina_inexistente"), null);
});
