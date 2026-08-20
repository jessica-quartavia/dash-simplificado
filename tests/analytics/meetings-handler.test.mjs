import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMeetingsRequest } from "../../lib/analytics/meetings-handler.mjs";

function request(headers = {}) {
  return new Request("http://localhost/api/meetings", { headers });
}

test("sem auth → 401", async () => {
  const response = await handleMeetingsRequest(request(), {
    requireCorporateAuth: async () =>
      Response.json({ error: "Sessão necessária.", code: "AUTH_REQUIRED" }, { status: 401 }),
  });
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.code, "AUTH_REQUIRED");
});

test("sem env → erro controlado 503", async () => {
  const response = await handleMeetingsRequest(request({ authorization: "Bearer x" }), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => "Configure DATA_SUPABASE_URL e DATA_SUPABASE_SERVICE_ROLE_KEY.",
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "config");
});

test("sucesso encerra o fluxo com payload", async () => {
  const response = await handleMeetingsRequest(request({ authorization: "Bearer x" }), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => null,
    computeMeetingsPayload: async () => ({
      generatedAt: "2026-08-19T12:00:00.000Z",
      clients: [{ clientId: "1" }],
      summary: { totalMeetings: 1 },
      timing: { baseQvMs: 10, calendlyTypesMs: 5, transformMs: 2, totalMs: 20 },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.clients.length, 1);
});

test("falha de consulta retorna 500 controlado", async () => {
  const response = await handleMeetingsRequest(request({ authorization: "Bearer x" }), {
    requireCorporateAuth: async () => null,
    dataConfigurationError: () => null,
    computeMeetingsPayload: async () => {
      throw new Error("REST timeout");
    },
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code, "data_query_failed");
});

test("client_id inválido → 404", async () => {
  const response = await handleMeetingsRequest(
    new Request("http://localhost/api/meetings?client_id=../x", { headers: { authorization: "Bearer x" } }),
    {
      requireCorporateAuth: async () => null,
      dataConfigurationError: () => null,
    },
  );
  assert.equal(response.status, 404);
});

test("detalhe do cliente sob demanda", async () => {
  const response = await handleMeetingsRequest(
    new Request("http://localhost/api/meetings?client_id=abc-1", { headers: { authorization: "Bearer x" } }),
    {
      requireCorporateAuth: async () => null,
      dataConfigurationError: () => null,
      computeMeetingClientDetail: async (id) => ({
        clientId: id,
        meetings: [{ title: "Checkpoint", startTime: "2024-02-01T12:00:00.000Z", source: "calendly" }],
      }),
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.client.clientId, "abc-1");
  assert.equal(body.client.meetings[0].title, "Checkpoint");
});
