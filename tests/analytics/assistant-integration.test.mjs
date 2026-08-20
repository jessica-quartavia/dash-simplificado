import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { handleAssistantRequest } from "../../lib/assistant/assistant-handler.mjs";
import { runAssistant } from "../../lib/assistant/assistant-service.mjs";

const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../lib/analytics/metric-catalog-seed.json");
const seedCatalog = JSON.parse(readFileSync(SEED_PATH, "utf8")).metrics;

function post(body, headers = { authorization: "Bearer test-token" }) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function mockGeneralContext(activeClients = 1775) {
  return {
    summaryActive: { activeClients, totalClients: activeClients },
    summaryAll: { totalClients: activeClients + 10 },
    distActive: { engineers: [{ label: "Nícolas Alves", count: activeClients }] },
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
    analyticsCatalogConfigurationError: () => null,
    loadAssistantCatalog: async () => ({ rows: seedCatalog, source: "seed", queryMs: 0 }),
    analyticsSnapshotStore: { read: async () => ({ rows: [] }) },
    generateAssistantReply: async () => ({
      text: "A permanência mede quanto tempo o cliente permanece ativo na carteira.",
      model: "mock-gemini",
      latencyMs: 3,
    }),
    runAssistantPageCompute: async ({ pageId, metricId }) => {
      if (pageId === "general") {
        return { pageId, payload: {}, context: mockGeneralContext(), cacheHit: false, computeMs: 3 };
      }
      if (pageId === "meetings") {
        return {
          pageId,
          payload: {},
          context: mockMeetingsContext(),
          cacheHit: false,
          computeMs: 5,
        };
      }
      if (pageId === "mechanisms") {
        return { pageId, payload: {}, context: mockMechanismsContext(), cacheHit: false, computeMs: 4 };
      }
      throw new Error(`page ${pageId} metric ${metricId}`);
    },
    ...overrides,
  };
}

test("Quantos clientes ativos temos? → determinístico com compute", async () => {
  const response = await handleAssistantRequest(
    post({ message: "Quantos clientes ativos temos?" }),
    mockDeps(),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /1\.775 clientes/);
  assert.equal(body.matched_metrics[0].metric_id, "active_clients");
  assert.equal(body.intent, "value");
  assert.equal(body.meta.used_gemini, false);
  assert.equal(body.meta.used_compute, true);
  assert.equal(body.meta.deterministic, true);
});

test("Qual o total de clientes? → determinístico", async () => {
  const result = await runAssistant({
    message: "Qual o total de clientes?",
    accessToken: "x",
    deps: mockDeps(),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.matched_metrics[0].metric_id, "total_clients");
  assert.equal(result.body.meta.used_gemini, false);
  assert.match(result.body.answer, /clientes/);
});

test("Qual a taxa de comparecimento? → compute meetings", async () => {
  const result = await runAssistant({
    message: "Qual a taxa de comparecimento?",
    accessToken: "x",
    deps: mockDeps(),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.matched_metrics[0].metric_id, "attendance_rate");
  assert.equal(result.body.meta.used_compute, true);
  assert.equal(result.body.meta.used_gemini, false);
});

test("Qual o mecanismo mais utilizado? → determinístico", async () => {
  const result = await runAssistant({
    message: "Qual o mecanismo mais utilizado?",
    accessToken: "x",
    deps: mockDeps(),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.matched_metrics[0].metric_id, "most_used_mechanism");
  assert.match(result.body.answer, /Reserva de liquidez/);
  assert.equal(result.body.meta.used_gemini, false);
});

test("Como é calculada a permanência? → regra sem Gemini", async () => {
  const result = await runAssistant({
    message: "Como é calculada a permanência?",
    accessToken: "x",
    deps: mockDeps({
      generateAssistantReply: async () => {
        throw Object.assign(new Error("Gemini indisponível"), { code: "gemini_unavailable" });
      },
    }),
  });
  assert.equal(result.status, 200);
  assert.match(result.body.answer, /Regra de "Mediana de permanência"|permanência/i);
  assert.equal(result.body.meta.used_gemini, false);
});

test("Explique a permanência de forma simples → Gemini quando disponível", async () => {
  const result = await runAssistant({
    message: "Explique a permanência de forma simples",
    accessToken: "x",
    deps: mockDeps(),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.meta.used_gemini, true);
  assert.match(result.body.answer, /permanência/i);
});

test("snapshot vazio → compute funciona", async () => {
  const result = await runAssistant({
    message: "Quantos clientes ativos temos?",
    accessToken: "x",
    deps: mockDeps({
      analyticsSnapshotStore: { read: async () => ({ rows: [] }) },
    }),
  });
  assert.equal(result.body.meta.used_snapshot, false);
  assert.equal(result.body.meta.used_compute, true);
  assert.match(result.body.answer, /1\.775 clientes/);
});

test("Gemini indisponível → valores simples continuam", async () => {
  const result = await runAssistant({
    message: "Quantos clientes ativos temos?",
    accessToken: "x",
    deps: mockDeps({
      generateAssistantReply: async () => {
        throw Object.assign(new Error("Gemini indisponível"), { code: "gemini_unavailable" });
      },
    }),
  });
  assert.equal(result.status, 200);
  assert.match(result.body.answer, /1\.775 clientes/);
  assert.equal(result.body.meta.used_gemini, false);
});

test("sem auth → 401", async () => {
  const response = await handleAssistantRequest(post({ message: "Quantos clientes ativos temos?" }), {
    requireCorporateAuth: async () =>
      Response.json({ error: "Sessão necessária.", code: "AUTH_REQUIRED" }, { status: 401 }),
  });
  assert.equal(response.status, 401);
});

test("erro compute → resposta conceitual quando possível", async () => {
  const result = await runAssistant({
    message: "Quantos clientes ativos temos?",
    accessToken: "x",
    deps: mockDeps({
      runAssistantPageCompute: async () => {
        throw Object.assign(new Error("timeout"), { code: "compute_timeout" });
      },
      generateAssistantReply: async () => {
        throw Object.assign(new Error("Gemini indisponível"), { code: "gemini_unavailable" });
      },
    }),
  });
  assert.equal(result.status, 200);
  assert.match(result.body.answer, /Clientes ativos|não consegui calcular|não está carregado/i);
  assert.equal(result.body.meta.used_gemini, false);
});
