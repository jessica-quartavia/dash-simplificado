import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { handleAssistantRequest } from "../../lib/assistant/assistant-handler.mjs";
import { runAssistant } from "../../lib/assistant/assistant-service.mjs";
import { buildAnalyticsContext } from "../../lib/assistant/analytics-context-builder.mjs";
import { resolveMetricValue, isSnapshotUsable, snapshotToValueResult } from "../../lib/assistant/compute/assistant-value-extractor.mjs";
import { clearAssistantComputeCache, runAssistantPageCompute } from "../../lib/assistant/compute/assistant-compute-runner.mjs";
import { parseAssistantFilters } from "../../lib/assistant/filter-parser.mjs";
import { validateAssistantFilters } from "../../lib/assistant/metric-filter-contract.mjs";
import { formatMetricValue } from "../../lib/assistant/value-formatter.mjs";
import { VALIDATED_COMPUTE_METRICS } from "../../lib/assistant/compute/assistant-compute-registry.mjs";

const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../lib/analytics/metric-catalog-seed.json");
const seedCatalog = JSON.parse(readFileSync(SEED_PATH, "utf8")).metrics;

function metric(id) {
  return seedCatalog.find((row) => row.metric_id === id);
}

function post(body, headers = { authorization: "Bearer test-token" }) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function mockGeneralContext(activeClients = 1775, engineer = "Nícolas Alves") {
  return {
    summaryActive: {
      activeClients,
      totalClients: activeClients,
    },
    summaryAll: { totalClients: activeClients + 10 },
    distActive: { engineers: [{ label: engineer, count: activeClients }] },
    acquisitionSeries: [],
  };
}

function mockMeetingsContext(totalMeetings = 4200) {
  return {
    summary: {
      totalMeetings,
      attendanceRate: 0.934,
      totalNoShows: 120,
      eligibleMeetings: 4000,
    },
    dist: {},
    meetingTypes: { available: false, byFamily: [] },
  };
}

function mockMechanismsContext(implemented = 900, rate = 12.5) {
  return {
    summary: {
      implementedMechanisms: implemented,
      availableMechanisms: 7200,
      implementationPercent: rate,
      clientsWithMechanisms: 77,
      coverage: 0.043,
      topMechanismName: "Reserva de liquidez",
      topMechanismClients: 21,
    },
  };
}

function mockDeps(overrides = {}) {
  return {
    requireCorporateAuth: async () => null,
    skipAccessGate: true,
    analyticsCatalogConfigurationError: () => null,
    loadAssistantCatalog: async () => ({ rows: seedCatalog, source: "seed", queryMs: 0 }),
    analyticsSnapshotStore: { read: async () => ({ rows: [] }) },
    generateAssistantReply: async () => ({
      text: "Resposta mock do assistente com base no contexto.",
      model: "mock-gemini",
      latencyMs: 1,
    }),
    runAssistantPageCompute: async ({ pageId, metricId }) => {
      if (pageId === "general") {
        return { pageId, payload: {}, context: mockGeneralContext(), cacheHit: false, computeMs: 3 };
      }
      if (pageId === "meetings") {
        const includeTypes = metricId === "top_meeting_types";
        return {
          pageId,
          payload: { meetingTypes: { available: includeTypes, byFamily: includeTypes ? [{ label: "Central", count: 10 }] : [] } },
          context: mockMeetingsContext(),
          cacheHit: false,
          computeMs: 5,
        };
      }
      if (pageId === "mechanisms") {
        return { pageId, payload: {}, context: mockMechanismsContext(), cacheHit: false, computeMs: 4 };
      }
      if (pageId === "journey") {
        return {
          pageId,
          payload: {},
          context: {
            summary: { completionCoverage: 1, comparableCoverage: 0.8 },
            dist: { completion: [{ label: "Sim", count: 1200 }, { label: "Não", count: 300 }] },
          },
          cacheHit: false,
          computeMs: 4,
        };
      }
      if (pageId === "patrimonial_plan") {
        return {
          pageId,
          payload: {},
          context: { approvalTime: { value: 48.16, eligibleClients: 200, totalPopulation: 500 } },
          cacheHit: false,
          computeMs: 2,
        };
      }
      throw new Error(`page ${pageId}`);
    },
    ...overrides,
  };
}

test("registry cobre 49 métricas validadas", () => {
  assert.equal(VALIDATED_COMPUTE_METRICS.size, 49);
});

test("prioridade snapshot > compute", async () => {
  const row = {
    metric_id: "active_clients",
    calculation_status: "ok",
    value: { value: 999, unit: "clients" },
    coverage: 1,
    sample_size: 999,
  };
  assert.equal(isSnapshotUsable(row), true);
  const fromSnapshot = snapshotToValueResult(row, metric("active_clients"));
  assert.equal(fromSnapshot.source, "snapshot");
  assert.equal(fromSnapshot.data.value, 999);

  const fromCompute = await resolveMetricValue({
    metric: metric("active_clients"),
    snapshotRow: row,
    deps: mockDeps(),
  });
  assert.equal(fromCompute.source, "snapshot");
});

test("compute fallback active_clients", async () => {
  const result = await resolveMetricValue({
    metric: metric("active_clients"),
    snapshotRow: null,
    deps: mockDeps(),
  });
  assert.equal(result.available, true);
  assert.equal(result.source, "compute");
  assert.equal(result.compute_page, "general");
  assert.match(result.formatted, /1\.775 clientes/);
});

test("compute fallback total_meetings sem Calendly types", async () => {
  let includeTypesCalls = 0;
  const deps = mockDeps({
    runAssistantPageCompute: async ({ pageId, metricId }) => {
      includeTypesCalls += 1;
      assert.equal(metricId, "total_meetings");
      return {
        pageId,
        payload: {},
        context: mockMeetingsContext(4300),
        cacheHit: false,
        computeMs: 5,
      };
    },
  });
  const result = await resolveMetricValue({ metric: metric("total_meetings"), deps });
  assert.equal(result.available, true);
  assert.equal(result.data.value, 4300);
  assert.equal(includeTypesCalls, 1);
});

test("renewal_rate não executa compute automático", async () => {
  let computeCalls = 0;
  const result = await runAssistant({
    message: "qual a taxa de renovação?",
    accessToken: "x",
    deps: mockDeps({
      runAssistantPageCompute: async () => {
        computeCalls += 1;
        throw new Error("não deveria calcular");
      },
    }),
  });
  assert.equal(computeCalls, 0);
  assert.equal(result.body.matched_metrics[0].metric_id, "renewal_rate");
  assert.equal(result.body.meta.used_compute, false);
});

test("value determinístico com compute fallback", async () => {
  const result = await runAssistant({
    message: "quantos clientes ativos temos?",
    accessToken: "x",
    deps: mockDeps(),
  });
  assert.equal(result.status, 200);
  assert.match(result.body.answer, /1\.775 clientes/);
  assert.equal(result.body.meta.used_compute, true);
  assert.equal(result.body.meta.used_gemini, false);
  assert.equal(result.body.meta.deterministic, true);
});

test("snapshot disponível não chama compute", async () => {
  let computeCalls = 0;
  const result = await runAssistant({
    message: "quantos clientes ativos temos?",
    accessToken: "x",
    deps: mockDeps({
      analyticsSnapshotStore: {
        read: async () => ({
          rows: [{
            metric_id: "active_clients",
            calculation_status: "ok",
            value: { value: 888, unit: "clients" },
          }],
        }),
      },
      runAssistantPageCompute: async () => {
        computeCalls += 1;
        throw new Error("compute não deveria rodar");
      },
    }),
  });
  assert.equal(computeCalls, 0);
  assert.equal(result.body.meta.used_snapshot, true);
  assert.equal(result.body.meta.used_compute, false);
  assert.match(result.body.answer, /888 clientes/);
});

test("cache de compute evita recomputar", async () => {
  clearAssistantComputeCache();
  let calls = 0;
  const deps = mockDeps({
    computeGeneralDataPayload: async () => {
      calls += 1;
      return { clients: [] };
    },
  });
  await runAssistantPageCompute({ pageId: "general", metricId: "active_clients", filters: {}, deps });
  await runAssistantPageCompute({ pageId: "general", metricId: "active_clients", filters: {}, deps });
  assert.equal(calls, 1);
});

test("timeout de compute retorna indisponível", async () => {
  const result = await resolveMetricValue({
    metric: metric("active_clients"),
    deps: mockDeps({
      runAssistantPageCompute: async () => {
        const error = new Error("timeout");
        error.code = "compute_timeout";
        throw error;
      },
    }),
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, "compute_timeout");
});

test("filtro EP parseado", () => {
  const parsed = parseAssistantFilters("quantos clientes ativos do EP Nícolas Alves?");
  assert.equal(parsed.hints.engineerQuery, "Nícolas Alves");
});

test("filtro segmento parseado", () => {
  const parsed = parseAssistantFilters("quantos mecanismos implementados do segmento PRIVATE?");
  assert.ok(parsed.hints.segmentQuery);
});

test("período inválido para KPI stock gera warning", () => {
  const { warnings } = validateAssistantFilters(metric("active_clients"), { period: "last_30" });
  assert.ok(warnings.some((item) => /periodSensitive=false/i.test(item) || /fotografia atual/i.test(item)));
});

test("compute error ainda responde regra", async () => {
  const result = await runAssistant({
    message: "como é calculada a taxa de comparecimento?",
    accessToken: "x",
    deps: mockDeps({
      generateAssistantReply: async () => {
        throw new Error("gemini down");
      },
      runAssistantPageCompute: async () => {
        throw new Error("source down");
      },
    }),
  });
  assert.match(result.body.answer, /Regra de "Taxa de comparecimento"/);
});

test("handler — value com compute", async () => {
  const response = await handleAssistantRequest(
    post({ message: "quantas reuniões temos?" }),
    mockDeps(),
  );
  const body = await response.json();
  assert.equal(body.meta.used_compute, true);
  assert.equal(body.meta.compute_page, "meetings");
});

test("format percentual", () => {
  const formatted = formatMetricValue({ value: { value: 0.934, unit: "percent" } }, metric("attendance_rate"));
  assert.match(formatted.formatted, /93,4%/);
});
