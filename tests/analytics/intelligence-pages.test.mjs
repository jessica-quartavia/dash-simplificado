import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  defaultEpPerformanceFilters,
  filterEpEngineers,
  summarizeFilteredEpEngineers,
} from "../../lib/analytics/ep-performance-filters.mjs";
import {
  buildPreCancellationInsights,
  defaultTemporalIndicatorsFilters,
  filterTemporalActivityRecency,
} from "../../lib/analytics/temporal-indicators-filters.mjs";
import {
  buildStatisticalCrossesApiUrl,
  defaultStatisticalCrossesFilters,
  statisticalCrossesFiltersToSearchParams,
} from "../../lib/analytics/statistical-crosses-filters.mjs";
import {
  DASHBOARD_LEGACY_PATHS,
  DASHBOARD_PAGE_HANDLERS,
} from "../../lib/api/dashboard-router.mjs";
import {
  getPageFilterContract,
  implementedPageIds,
  pageShowsPeriodUi,
} from "../../lib/analytics/filters/page-contracts.mjs";
import { associationStrength, chiSquareIndependence } from "../../lib/analytics/stats-tests.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const EP_ROWS = [
  {
    engineer: "EP A",
    totalClients: 40,
    activeClients: 30,
    confirmedCancelledClients: 4,
    cancelledShareOfPortfolio: 10,
    meetingCoverage: 75,
    totalMeetings: 120,
    averageMeetingsPerClient: 3,
    programBreakdown: { Pharus: 25, Davos: 15 },
    segmentBreakdown: { PRIVATE: 20, APEX: 20 },
  },
  {
    engineer: "EP B",
    totalClients: 8,
    activeClients: 6,
    confirmedCancelledClients: 1,
    cancelledShareOfPortfolio: 12.5,
    meetingCoverage: 50,
    totalMeetings: 10,
    averageMeetingsPerClient: 1.25,
    programBreakdown: { Davos: 8 },
    segmentBreakdown: { PRIVATE: 8 },
  },
];

test("EP filters respeitam busca por nome", () => {
  const filtered = filterEpEngineers(EP_ROWS, {
    ...defaultEpPerformanceFilters(),
    search: "EP A",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].engineer, "EP A");
});

test("EP summary recalcula denominadores", () => {
  const filtered = filterEpEngineers(EP_ROWS, defaultEpPerformanceFilters());
  const summary = summarizeFilteredEpEngineers(filtered);
  assert.equal(summary.advisorsWithPortfolio, 2);
  assert.equal(summary.totalClients, 48);
  assert.ok(summary.meetingCoverage != null);
});

test("Temporal insights não usam linguagem causal", () => {
  const insights = buildPreCancellationInsights({
    preCancellation: {
      signalCounts: {
        no_meeting_60: 40,
        no_financial_60: 25,
        login_drop: 10,
      },
      analyzedClients: 50,
      baselineCounts: { no_meeting_60: 10 },
    },
  });
  for (const line of insights) {
    assert.doesNotMatch(String(line), /causa|causam|provoca/i);
    assert.match(String(line), /associ|frequente|sinal|antes|monitoramento/i);
  }
});

test("Temporal recency filtra por programa", () => {
  const rows = [
    { subjectName: "Ana", program: "Pharus", subjectCode: "A1" },
    { subjectName: "João", program: "Davos", subjectCode: "B2" },
  ];
  const filtered = filterTemporalActivityRecency(rows, {
    ...defaultTemporalIndicatorsFilters(),
    program: "Pharus",
  });
  assert.equal(filtered.length, 1);
});

test("Statistical API URL inclui filtros", () => {
  const url = buildStatisticalCrossesApiUrl({
    ...defaultStatisticalCrossesFilters(),
    engineer: "EP A",
    program: "Pharus",
  });
  assert.match(url, /engineer=/);
  assert.match(url, /program=Pharus/);
});

test("Statistical filters mapeiam programa", () => {
  const params = statisticalCrossesFiltersToSearchParams({
    ...defaultStatisticalCrossesFilters(),
    program: "Davos",
  });
  assert.equal(params.get("program"), "Davos");
});

test("stats-tests preserva V de Cramér", () => {
  const result = chiSquareIndependence([[10, 5], [8, 12]]);
  assert.ok(result.cramersV >= 0 && result.cramersV <= 1);
  const label = associationStrength(result.cramersV, "cramers_v");
  assert.match(label, /fraca|moderada|forte|muito fraca/i);
});

test("dashboard router registra novas páginas", () => {
  assert.ok(DASHBOARD_PAGE_HANDLERS.ep_performance);
  assert.ok(DASHBOARD_PAGE_HANDLERS.temporal_indicators);
  assert.ok(DASHBOARD_PAGE_HANDLERS.statistical_crosses);
  assert.equal(DASHBOARD_LEGACY_PATHS["/api/ep-performance"], "ep_performance");
});

test("page contracts — EP com período; temporal/statistical sem período global", () => {
  assert.equal(pageShowsPeriodUi("ep_performance"), true);
  assert.equal(pageShowsPeriodUi("temporal_indicators"), false);
  assert.equal(pageShowsPeriodUi("statistical_crosses"), false);
  for (const pageId of ["ep_performance", "temporal_indicators", "statistical_crosses"]) {
    assert.ok(getPageFilterContract(pageId));
  }
  assert.ok(implementedPageIds().includes("ep_performance"));
  assert.ok(implementedPageIds().includes("temporal_indicators"));
  assert.ok(implementedPageIds().includes("statistical_crosses"));
});

test("Statistical V1 fidelity checklist presente no frontend", () => {
  const js = readFileSync(resolve(root, "js/statistical-crosses.js"), "utf8");
  assert.match(js, /Principais pontos de atenção/i);
  assert.match(js, /Kaplan|sobreviv/i);
  assert.match(js, /correla/i);
  assert.match(js, /coorte|cohort/i);
  assert.match(js, /causalidade|causal/i);
});
