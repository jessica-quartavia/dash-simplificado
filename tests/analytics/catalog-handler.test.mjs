import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMetricCatalogRequest } from "../../lib/analytics/metric-catalog-handler.mjs";

function request(path = "/api/analytics/catalog") {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: "Bearer x" },
  });
}

const sampleRows = [
  {
    metric_id: "active_clients",
    page_id: "general",
    page_label: "Dados Gerais",
    label: "Clientes ativos",
    description: "Clientes com status analítico Ativo.",
    dash_kids_status: "Sim",
    validated_for_v2: true,
    scope_policy: "active_first",
    source_systems: ["BASE QV"],
    accepted_filters: ["status", "segment", "engineer", "program"],
    aliases: ["clientes ativos", "carteira ativa"],
  },
  {
    metric_id: "clients_with_meeting",
    page_id: "meetings",
    page_label: "Reuniões",
    label: "Clientes com reunião",
    description: "Clientes com pelo menos uma reunião válida.",
    dash_kids_status: "Avaliar",
    validated_for_v2: false,
    scope_policy: "active_first",
    source_systems: ["BASE QV"],
    accepted_filters: ["status", "engineer"],
    aliases: [],
  },
  {
    metric_id: "plan_approved_clients",
    page_id: "patrimonial_plan",
    page_label: "Plano Patrimonial",
    label: "Plano aprovado",
    description: "Proxy de plano aprovado.",
    dash_kids_status: "Recomendação: Não Levar",
    validated_for_v2: false,
    scope_policy: "historical",
    source_systems: ["BASE QV"],
    accepted_filters: [],
    aliases: [],
  },
];

test("sem auth → 401", async () => {
  const response = await handleMetricCatalogRequest(new Request("http://localhost/api/analytics/catalog"), {
    requireCorporateAuth: async () =>
      Response.json({ error: "Sessão necessária.", code: "AUTH_REQUIRED" }, { status: 401 }),
  });
  assert.equal(response.status, 401);
});

test("POST sem auth → 401", async () => {
  const response = await handleMetricCatalogRequest(new Request("http://localhost/api/analytics/catalog", { method: "POST" }), {
    requireCorporateAuth: async () =>
      Response.json({ error: "Sessão necessária.", code: "AUTH_REQUIRED" }, { status: 401 }),
  });
  assert.equal(response.status, 401);
});

test("env ausente → 503", async () => {
  const response = await handleMetricCatalogRequest(request(), {
    requireCorporateAuth: async () => null,
    analyticsCatalogConfigurationError: () => "Configure AUTH_SUPABASE_ANON_KEY.",
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "config");
});

test("POST não é permitido", async () => {
  const response = await handleMetricCatalogRequest(new Request("http://localhost/api/analytics/catalog", { method: "POST" }), {
    requireCorporateAuth: async () => null,
    analyticsCatalogConfigurationError: () => null,
  });
  assert.equal(response.status, 405);
});

test("catálogo retorna somente JSON esperado", async () => {
  const response = await handleMetricCatalogRequest(request(), {
    requireCorporateAuth: async () => null,
    analyticsCatalogConfigurationError: () => null,
    fetchMetricCatalogRows: async () => ({ rows: sampleRows, queryMs: 4 }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.generated_at, "string");
  assert.equal(body.metrics.length, 3);
  const first = body.metrics[0];
  assert.deepEqual(Object.keys(first).sort(), [
    "aliases",
    "dash_kids_status",
    "description",
    "filters",
    "label",
    "metric_id",
    "page_id",
    "page_label",
    "scope_policy",
    "sources",
    "validated_for_v2",
  ].sort());
  assert.equal(first.source_objects, undefined);
  assert.equal(first.calculation_summary, undefined);
  assert.equal(body.metrics[0].dash_kids_status, "Sim");
  assert.equal(body.metrics[1].dash_kids_status, "Avaliar");
  assert.equal(body.metrics[2].dash_kids_status, "Recomendação: Não Levar");
});

test("filtro por página", async () => {
  let received = null;
  const response = await handleMetricCatalogRequest(request("/api/analytics/catalog?page=general"), {
    requireCorporateAuth: async () => null,
    analyticsCatalogConfigurationError: () => null,
    fetchMetricCatalogRows: async (query) => {
      received = query;
      return { rows: sampleRows.filter((m) => m.page_id === "general"), queryMs: 2 };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(received.pageId, "general");
  assert.equal(received.accessToken, "x");
  const body = await response.json();
  assert.equal(body.metrics.length, 1);
  assert.equal(body.metrics[0].metric_id, "active_clients");
});

test("filtro validated=true", async () => {
  let received = null;
  const response = await handleMetricCatalogRequest(request("/api/analytics/catalog?validated=true"), {
    requireCorporateAuth: async () => null,
    analyticsCatalogConfigurationError: () => null,
    fetchMetricCatalogRows: async (query) => {
      received = query;
      return { rows: sampleRows.filter((m) => m.validated_for_v2), queryMs: 2 };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(received.validated, true);
  const body = await response.json();
  assert.equal(body.metrics.length, 1);
  assert.equal(body.metrics[0].validated_for_v2, true);
});
