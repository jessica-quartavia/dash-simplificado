import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { handleAssistantRequest } from "../../lib/assistant/assistant-handler.mjs";
import { runAssistant } from "../../lib/assistant/assistant-service.mjs";
import { buildAnalyticsContext } from "../../lib/assistant/analytics-context-builder.mjs";

const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../lib/analytics/metric-catalog-seed.json");
const seedCatalog = JSON.parse(readFileSync(SEED_PATH, "utf8")).metrics;

function post(body, headers = { authorization: "Bearer test-token" }) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const mockDeps = {
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
  runAssistantPageCompute: async ({ pageId }) => ({
    pageId,
    payload: {},
    context: pageId === "general"
      ? { summaryActive: { activeClients: 100, totalClients: 100 }, summaryAll: {}, distActive: {}, acquisitionSeries: [] }
      : { summary: { totalMeetings: 50, attendanceRate: 0.9 }, dist: {}, meetingTypes: { available: false, byFamily: [] } },
    cacheHit: false,
    computeMs: 1,
  }),
};

test("sem auth → 401", async () => {
  const response = await handleAssistantRequest(post({ message: "quantos clientes ativos?" }), {
    requireCorporateAuth: async () =>
      Response.json({ error: "Sessão necessária.", code: "AUTH_REQUIRED" }, { status: 401 }),
  });
  assert.equal(response.status, 401);
});

test("GET → 405", async () => {
  const response = await handleAssistantRequest(
    new Request("http://localhost/api/assistant", { headers: { authorization: "Bearer x" } }),
    mockDeps,
  );
  assert.equal(response.status, 405);
});

test("message vazia → 400", async () => {
  const response = await handleAssistantRequest(post({ message: "  " }), mockDeps);
  assert.equal(response.status, 400);
});

test("location determinístico sem Gemini", async () => {
  const response = await handleAssistantRequest(post({ message: "onde vejo clientes ativos?" }), mockDeps);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /Dados Gerais/);
  assert.equal(body.meta.used_gemini, false);
});

test("source determinístico sem Gemini", async () => {
  const response = await handleAssistantRequest(post({ message: "de onde vem reuniões por tipo?" }), mockDeps);
  const body = await response.json();
  assert.match(body.answer, /Business Data|Calendly/);
  assert.equal(body.meta.used_gemini, false);
});

test("fallback Gemini indisponível — regra determinística", async () => {
  const result = await runAssistant({
    message: "como calculam clientes ativos?",
    accessToken: "x",
    deps: {
      ...mockDeps,
      generateAssistantReply: async () => {
        throw Object.assign(new Error("Gemini indisponível"), { code: "gemini_unavailable" });
      },
    },
  });
  assert.match(result.body.answer, /Regra de "Clientes ativos"/);
});

test("contexto compacto sem PII", () => {
  const metric = seedCatalog.find((row) => row.metric_id === "active_clients");
  const context = buildAnalyticsContext({ metric, valueResult: { available: false }, intent: "value" });
  assert.ok(context.contextBytes < 8000);
  assert.equal(context.value.available, false);
});

test("renewal_rate não validada no contexto", () => {
  const metric = seedCatalog.find((row) => row.metric_id === "renewal_rate");
  const context = buildAnalyticsContext({ metric, intent: "value" });
  assert.equal(context.status.validated_for_v2, false);
});
