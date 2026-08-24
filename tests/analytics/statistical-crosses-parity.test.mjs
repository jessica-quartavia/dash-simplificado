import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { STATISTICAL_SECTIONS } from "../../lib/analytics/statistical-sections.mjs";
import { STATISTICAL_SECTIONS_REGISTRY } from "../../lib/analytics/statistical-sections-registry.mjs";
import {
  buildStatisticalCrossesApiUrl,
  defaultStatisticalCrossesFilters,
  SC_STATUS_FILTER_OPTIONS,
  statisticalCrossesFiltersToSearchParams,
} from "../../lib/analytics/statistical-crosses-filters.mjs";
import { getPageFilterContract, pageShowsPeriodUi } from "../../lib/analytics/filters/page-contracts.mjs";
import { runPageBehavior } from "../../lib/analytics/filters/filter-check.mjs";
import { renderActiveCancelledDiffChart, SC_DIFF_UNIT_OPTIONS } from "../../js/components/statistical-diff-chart.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scJs = readFileSync(resolve(root, "js/statistical-crosses.js"), "utf8");
const matrixJs = readFileSync(resolve(root, "js/components/statistical-matrix.js"), "utf8");

test("ordem V1 — registry com 17 seções principais", () => {
  assert.equal(STATISTICAL_SECTIONS.length, 17);
  assert.equal(STATISTICAL_SECTIONS_REGISTRY.length, 17);
  assert.equal(STATISTICAL_SECTIONS[0].id, "scSecResumo");
  assert.equal(STATISTICAL_SECTIONS[2].id, "scSecCancel");
  assert.equal(STATISTICAL_SECTIONS[9].id, "scSecSurvival");
  assert.equal(STATISTICAL_SECTIONS[13].id, "scSecTop");
  assert.equal(STATISTICAL_SECTIONS[16].id, "scSecQuality");
});

test("frontend renderiza todas as seções V1 na ordem", () => {
  const ids = STATISTICAL_SECTIONS.map((s) => s.id);
  let lastIndex = -1;
  for (const id of ids) {
    assert.match(scJs, new RegExp(`id="${id}"`));
    const idx = scJs.indexOf(`id="${id}"`);
    assert.ok(idx > lastIndex, `${id} fora de ordem`);
    lastIndex = idx;
  }
});

test("filtros — busca, EP, status, programa, período (sem fonte/segmento)", () => {
  assert.equal(pageShowsPeriodUi("statistical_crosses"), true);
  const contract = getPageFilterContract("statistical_crosses");
  assert.deepEqual(contract.uiFilters.slice(0, 5), ["search", "engineer", "status", "program", "period"]);
  assert.ok(!contract.uiFilters.includes("segment"));
  assert.ok(!contract.uiFilters.includes("source"));
  assert.match(scJs, /mountPageFilters\(\{/);
  assert.match(scJs, /pageId: "statistical_crosses"/);
  assert.match(scJs, /host,\s*\n\s*pageId: "statistical_crosses"/);
  assert.match(scJs, /id: "scSearch"/);
  assert.match(scJs, /id: "scEngineer"/);
  assert.match(scJs, /id: "scStatus"/);
  assert.match(scJs, /id: "scProgram"/);
  assert.match(scJs, /id: "scPeriod"/);
  assert.match(scJs, /Engenheiro Patrimonial/);
  assert.match(scJs, /label: "Programa"/);
  assert.doesNotMatch(scJs, /hostId:/);
});

test("período e busca mapeiam params na API", () => {
  const params = statisticalCrossesFiltersToSearchParams({
    ...defaultStatisticalCrossesFilters(),
    period: "last_12m",
    search: "codigo-1",
  });
  assert.ok(params.get("hireFrom"));
  assert.equal(params.get("search"), "codigo-1");
});

test("status inclui opções analíticas oficiais", () => {
  const labels = SC_STATUS_FILTER_OPTIONS.map((o) => o.label);
  assert.ok(labels.includes("Ativo"));
  assert.ok(labels.includes("Congelado"));
  assert.ok(labels.includes("Outros/inativos"));
});

test("gráfico ativos×cancelados — componente mantido, removido da página", () => {
  const html = renderActiveCancelledDiffChart([
    {
      id: "daysToFirstMeeting",
      label: "Dias até primeira reunião",
      medianActive: 34,
      medianCancelled: 347,
      nActive: 120,
      nCancelled: 40,
      coveragePercent: 43.6,
    },
  ], "time", { summary: { activeClients: 120, confirmedCancellations: 40 } });
  assert.match(html, /sc-diff-bar--active/);
  assert.match(html, /Base válida/);
  assert.doesNotMatch(scJs, /scDiffChartHost/);
  assert.doesNotMatch(scJs, /renderActiveCancelledDiffChart/);
  assert.match(scJs, /Ver dados de cancelamento \(diferenças\)/);
  assert.equal(SC_DIFF_UNIT_OPTIONS.length, 5);
});

test("componentes críticos presentes no frontend", () => {
  for (const needle of [
    "Curva de sobrevivência",
    "Análise de cohort",
    "Ranking preditivo de cancelamento",
    "Clientes ativos com sinais detectados",
    "Top clientes — Pharus",
    "Matriz comparativa NPS",
  ]) {
    assert.match(scJs, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(matrixJs, /Heatmap/);
  assert.match(matrixJs, /Expandir/);
});

test("filter-check statistical_crosses passa", () => {
  const checks = runPageBehavior("statistical_crosses");
  const failed = checks.filter((c) => !c.ok);
  assert.equal(failed.length, 0, failed.map((f) => f.id).join(", "));
});

test("URL API inclui programa quando filtrado", () => {
  const url = buildStatisticalCrossesApiUrl({ ...defaultStatisticalCrossesFilters(), program: "Pharus" });
  assert.match(url, /program=Pharus/);
});
