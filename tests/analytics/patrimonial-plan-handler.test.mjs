import assert from "node:assert/strict";
import { test } from "node:test";
import { handlePatrimonialPlanRequest } from "../../lib/analytics/patrimonial-plan-handler.mjs";

function request() {
  return new Request("http://localhost/api/patrimonial-plan", {
    headers: { authorization: "Bearer x" },
  });
}

test("sem auth → 401", async () => {
  const response = await handlePatrimonialPlanRequest(new Request("http://localhost/api/patrimonial-plan"), {
    requireCorporateAuth: async () =>
      Response.json({ error: "Sessão necessária.", code: "AUTH_REQUIRED" }, { status: 401 }),
  });
  assert.equal(response.status, 401);
});

test("sem env da fonte necessária → erro controlado", async () => {
  const response = await handlePatrimonialPlanRequest(request(), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => "Configure DATA_SUPABASE_URL e DATA_SUPABASE_SERVICE_ROLE_KEY.",
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "config");
});

test("erro de consulta encerra o fluxo com 500 (não fica em loading)", async () => {
  const response = await handlePatrimonialPlanRequest(request(), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => null,
    computePatrimonialPlanPayload: async () => {
      throw new Error("REST timeout");
    },
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code, "data_query_failed");
  assert.ok(body.error);
});

test("sucesso devolve payload enxuto", async () => {
  const response = await handlePatrimonialPlanRequest(request(), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => null,
    computePatrimonialPlanPayload: async () => ({
      generatedAt: "2026-08-19T12:00:00.000Z",
      approvalTime: {
        value: 41.2,
        eligibleClients: 375,
        totalPopulation: 3415,
        coveragePercent: 11,
      },
      clients: [{ id: "should-not-leak", planApproved: true }],
      timing: { totalMs: 12 },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.approvalTime.calculation, "mean");
  assert.equal(body.approvalTime.value, 41.2);
  assert.equal(Array.isArray(body.clients), true);
  assert.equal(body.clients[0].planApproved, undefined);
  assert.equal(body.clients[0].id, undefined);
  assert.equal(body.planApproved, undefined);
});
