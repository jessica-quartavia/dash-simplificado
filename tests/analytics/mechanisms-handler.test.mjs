import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { handleMechanismsRequest } from "../../lib/analytics/mechanisms-handler.mjs";

function request() {
  return new Request("http://localhost/api/mechanisms", {
    headers: { authorization: "Bearer x" },
  });
}

test("sem auth → 401", async () => {
  const response = await handleMechanismsRequest(new Request("http://localhost/api/mechanisms"), {
    requireCorporateAuth: async () =>
      Response.json({ error: "Sessão necessária.", code: "AUTH_REQUIRED" }, { status: 401 }),
  });
  assert.equal(response.status, 401);
});

test("env ausente → erro controlado", async () => {
  const response = await handleMechanismsRequest(request(), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => "Configure DATA_SUPABASE_URL e DATA_SUPABASE_SERVICE_ROLE_KEY.",
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "config");
});

test("erro de consulta encerra o fluxo com 500 (não fica em loading)", async () => {
  const response = await handleMechanismsRequest(request(), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => null,
    computeMechanismsPayload: async () => {
      throw new Error("REST timeout");
    },
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code, "data_query_failed");
  assert.ok(body.error);
  const ui = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../js/mechanisms.js"), "utf8");
  assert.equal(ui.includes("state.loading = false"), true);
  assert.equal(ui.includes("Tentar novamente"), true);
});

test("sucesso devolve payload enxuto com default Ativos", async () => {
  const response = await handleMechanismsRequest(request(), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => null,
    computeMechanismsPayload: async () => ({
      generatedAt: "2026-08-19T12:00:00.000Z",
      catalog: [{ id: "m1", name: "Previdência", dimension: "Proteção" }],
      portfolio: [{ engineer: "EP1", segment: "PRIVATE", analyticalStatus: "Ativo", count: 10 }],
      clients: [{
        clientId: "1",
        clientName: "Ana",
        analyticalStatus: "Ativo",
        available: 1,
        implemented: 1,
        mechanisms: [{ mechanismId: "m1", name: "Previdência", status: "Implementado", dimension: "Proteção", implementedMonth: "2026-08" }],
        daysToFirstImplementation: 12,
      }],
      timing: { totalMs: 12, pharusConsulted: false, pharusMs: 0 },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.defaultStatusFilter, "active");
  assert.equal(body.clients[0].clientId, "1");
  assert.equal(body.clients[0].daysToFirstImplementation, undefined);
  assert.equal(body.timing.pharusConsulted, false);
});
