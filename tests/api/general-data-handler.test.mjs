import assert from "node:assert/strict";
import { test } from "node:test";
import { handleGeneralDataRequest } from "../../lib/analytics/general-data-handler.mjs";

test("GET /api/general-data sem Authorization → 401", async () => {
  const response = await handleGeneralDataRequest(
    new Request("http://localhost/api/general-data"),
  );
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.code, "unauthenticated");
});

test("GET /api/general-data sem env DATA → 503 controlado", async () => {
  const response = await handleGeneralDataRequest(
    new Request("http://localhost/api/general-data", {
      headers: { Authorization: "Bearer fake" },
    }),
    {
      requireCorporateAuth: async () => null,
      dataConfigurationError: () => "Configure DATA_SUPABASE_URL e DATA_SUPABASE_SERVICE_ROLE_KEY.",
    },
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "config");
  assert.match(body.error, /DATA_SUPABASE/);
});

test("GET /api/general-data autenticado devolve payload", async () => {
  const payload = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    defaultStatusFilter: "active",
    summary: { totalClients: 1, activeClients: 1 },
    distributions: { status: [] },
    clients: [{ clientId: "1", analyticalStatus: "Ativo" }],
  };
  const response = await handleGeneralDataRequest(
    new Request("http://localhost/api/general-data"),
    {
      requireCorporateAuth: async () => null,
      dataConfigurationError: () => null,
      computeGeneralDataPayload: async () => payload,
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.defaultStatusFilter, "active");
  assert.equal(body.clients[0].analyticalStatus, "Ativo");
});
