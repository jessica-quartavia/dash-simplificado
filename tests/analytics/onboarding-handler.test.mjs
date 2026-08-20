import assert from "node:assert/strict";
import { test } from "node:test";
import { handleOnboardingRequest } from "../../lib/analytics/onboarding-handler.mjs";

function request() {
  return new Request("http://localhost/api/onboarding", {
    headers: { authorization: "Bearer x" },
  });
}

test("sem auth → 401", async () => {
  const response = await handleOnboardingRequest(new Request("http://localhost/api/onboarding"), {
    requireCorporateAuth: async () =>
      Response.json({ error: "Sessão necessária.", code: "AUTH_REQUIRED" }, { status: 401 }),
  });
  assert.equal(response.status, 401);
});

test("erro de consulta encerra o fluxo com 500 (não fica em loading)", async () => {
  const response = await handleOnboardingRequest(request(), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => null,
    computeOnboardingPayload: async () => {
      throw new Error("REST timeout");
    },
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code, "data_query_failed");
  assert.ok(body.error);
});

test("sucesso devolve payload enxuto", async () => {
  const response = await handleOnboardingRequest(request(), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => null,
    computeOnboardingPayload: async () => ({
      generatedAt: "2026-08-19T12:00:00.000Z",
      clients: [{
        clientId: "1",
        clientName: "Ana",
        analyticalStatus: "Ativo",
        completedOnboarding: true,
        meetings: [{ id: "should-not-leak" }],
      }],
      timing: { totalMs: 12 },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.defaultStatusFilter, "active");
  assert.equal(body.clients[0].clientId, "1");
  assert.equal(body.clients[0].meetings, undefined);
});
