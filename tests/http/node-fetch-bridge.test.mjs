import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { nodeToWebRequest } from "../../lib/http/node-fetch-bridge.mjs";
import { handleAssistantRequest } from "../../lib/assistant/assistant-handler.mjs";

function mockIncomingMessage({ method = "POST", url = "/api/assistant", headers = {}, body = "" } = {}) {
  const payload = typeof body === "string" ? Buffer.from(body) : body;
  const req = Readable.from([payload]);
  req.method = method;
  req.url = url;
  req.headers = {
    host: "localhost:3000",
    "content-type": "application/json; charset=utf-8",
    authorization: "Bearer test-token",
    ...headers,
  };
  return req;
}

test("nodeToWebRequest repassa body JSON em POST", async () => {
  const req = mockIncomingMessage({
    body: JSON.stringify({ message: "Quantos clientes ativos temos?" }),
  });
  const request = await nodeToWebRequest(req);
  assert.equal(request.method, "POST");
  const payload = await request.json();
  assert.equal(payload.message, "Quantos clientes ativos temos?");
});

test("POST /api/assistant via bridge recebe message e não retorna 400 por body vazio", async () => {
  const req = mockIncomingMessage({
    body: JSON.stringify({ message: "Quantos clientes ativos temos?" }),
  });
  const request = await nodeToWebRequest(req);
  const response = await handleAssistantRequest(request, {
    requireCorporateAuth: async () => null,
    analyticsCatalogConfigurationError: () => null,
    runAssistant: async ({ message }) => ({
      status: 200,
      body: {
        answer: "1.775 clientes ativos.",
        matched_metrics: [{ metric_id: "active_clients", score: 0.99, label: "Clientes ativos" }],
        intent: "value",
        page: { page_id: "general", page_label: "Dados Gerais", validated_for_v2: true },
        meta: { used_snapshot: false, used_compute: true, used_gemini: false, deterministic: true },
      },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /1\.775/);
  assert.equal(body.matched_metrics[0].metric_id, "active_clients");
});
