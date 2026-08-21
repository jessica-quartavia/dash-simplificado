import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildStatisticalCrossesApiUrl,
  defaultStatisticalCrossesFilters,
  normalizeMinCoverage,
  normalizeMinSample,
  scPassMin,
  statisticalCrossesFiltersToSearchParams,
} from "../../lib/analytics/statistical-crosses-filters.mjs";
import {
  defaultTemporalIndicatorsFilters,
  formatTemporalMonthLabel,
  sortTemporalMonthsDesc,
  summarizeFilteredTemporal,
  temporalCancelWindowMatches,
  temporalMonthMatches,
  temporalSourceMatches,
} from "../../lib/analytics/temporal-indicators-filters.mjs";
import { renderStatisticalMatrix, renderRankingHeatmapTable } from "../../js/components/statistical-matrix.js";
import { buildQualityViabilitySections } from "../../lib/analytics/quality-matrices.mjs";
import { DASHBOARD_LEGACY_PATHS } from "../../lib/api/dashboard-router.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("SC filters enviam cobertura e amostra para API", () => {
  const params = statisticalCrossesFiltersToSearchParams({
    ...defaultStatisticalCrossesFilters(),
    minCoverage: 30,
    minSample: 5,
  });
  assert.equal(params.get("minCoverage"), "30");
  assert.equal(params.get("minSample"), "5");
  assert.match(buildStatisticalCrossesApiUrl({ minCoverage: 40, minSample: 8 }), /minCoverage=40/);
});

test("scPassMin reproduz regra V1", () => {
  assert.equal(scPassMin({ coveragePercent: 50, nActive: 10, nCancelled: 10 }, 30, 5), true);
  assert.equal(scPassMin({ coveragePercent: 20, nActive: 10, nCancelled: 10 }, 30, 5), false);
  assert.equal(scPassMin({ coveragePercent: 90, nActive: 2, nCancelled: 10 }, 30, 5), false);
  assert.equal(scPassMin({ status: "constant", coveragePercent: 100, n: 100 }, 30, 5), false);
});

test("normalizeMinCoverage e normalizeMinSample", () => {
  assert.equal(normalizeMinCoverage("45.6"), 46);
  assert.equal(normalizeMinCoverage("abc", 30), 30);
  assert.equal(normalizeMinSample("5.9"), 5);
  assert.equal(normalizeMinSample("-1", 5), 5);
});

test("matrix render preserva valores formatados (simétrica)", () => {
  const html = renderStatisticalMatrix({
    columns: [{ label: "A" }, { label: "B" }],
    rows: [
      {
        label: "Linha",
        cells: [
          { display: "-0,35", bg: "#111", color: "#fff", tooltip: "tip" },
          { display: "1,00", bg: "#222", color: "#fff" },
        ],
      },
    ],
    compact: true,
  });
  assert.match(html, /-0,35/);
  assert.match(html, /1,00/);
  assert.match(html, /matrix-scroll/);
  assert.match(html, /matrix-grid--symmetric/);
});

test("ranking heatmap preserva valores e layout analítico", () => {
  const html = renderRankingHeatmapTable({
    columns: [{ id: "association", label: "Correlação" }, { id: "coveragePercent", label: "Cobertura" }],
    rows: [{
      label: "Variável X",
      cells: [{ display: "0,55", bg: "#111", color: "#fff" }, { display: "90%", bg: "#222", color: "#fff" }],
    }],
  });
  assert.match(html, /matrix-grid--ranking/);
  assert.match(html, /0,55/);
  assert.match(html, /matrix-rank-cell/);
});

test("Temporal — fonte, mês e cancelamento", () => {
  assert.equal(temporalSourceMatches("BASE QV+App Pharus", "BASE QV"), true);
  assert.equal(temporalSourceMatches("App Pharus", "BASE QV"), false);
  assert.equal(temporalMonthMatches({ month: "2026-08" }, "2026-08"), true);
  assert.equal(temporalCancelWindowMatches({ monthsToCancellation: 0, cancellationDate: "2026-01-01" }, "pre30"), true);
  assert.equal(temporalCancelWindowMatches({ cancellationDate: "2026-01-01" }, "none"), false);
  assert.equal(formatTemporalMonthLabel("2026-08"), "Ago/2026");
  const months = sortTemporalMonthsDesc(["2026-06", "2026-08", "2026-07"], "2026-08");
  assert.deepEqual(months, ["2026-08", "2026-07", "2026-06"]);
});

test("Temporal summarize aplica filtros em AND", () => {
  const payload = {
    months: ["2026-08"],
    clients: [
      { subjectId: "1", month: "2026-08", source: "BASE QV", program: "Pharus", logins: 2, meetings: 1, financialUpdates: 0, npsResponses: 0 },
      { subjectId: "2", month: "2026-08", source: "App Pharus", program: "Pharus", logins: 5, meetings: 0, financialUpdates: 0, npsResponses: 0 },
    ],
    activityRecency: [
      { subjectId: "1", name: "A", source: "BASE QV", program: "Pharus", status: "ativo" },
      { subjectId: "2", name: "B", source: "App Pharus", program: "Pharus", status: "ativo" },
    ],
    preCancellation: { clients: [], signals: [] },
    activeRisk: { clients: [], signals: [] },
  };
  const filtered = summarizeFilteredTemporal(payload, {
    ...defaultTemporalIndicatorsFilters(),
    source: "BASE QV",
    month: "2026-08",
  });
  assert.equal(filtered.recency.length, 1);
  assert.equal(filtered.summary.totalLogins, 2);
});

test("Sidebar navigation usa accordion acessível", () => {
  const nav = readFileSync(resolve(root, "js/navigation.js"), "utf8");
  assert.match(nav, /nav-group-toggle/);
  assert.match(nav, /aria-expanded/);
  assert.match(nav, /aria-controls/);
  assert.match(nav, /openNavGroups/);
});

test("Quality V1 fidelity — seções de matriz preservadas", () => {
  const sections = buildQualityViabilitySections({});
  const ids = sections.map((s) => s.id);
  for (const id of [
    "general",
    "onboarding",
    "plan",
    "meetings",
    "mechanisms",
    "pharus",
    "financial",
    "engagement",
    "platform",
    "support",
    "cancellations",
    "satisfaction",
    "renewal",
    "ep",
    "temporal",
  ]) {
    assert.ok(ids.includes(id), `missing matrix section ${id}`);
  }
  assert.ok(sections.every((s) => Array.isArray(s.rows) && s.rows.length > 0), "each section has rows");
});

test("Quality endpoint registrado no router", () => {
  assert.equal(DASHBOARD_LEGACY_PATHS["/api/quality"], "quality");
});
