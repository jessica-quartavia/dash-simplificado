import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMetricSnapshotRequest } from "../../lib/analytics/snapshot-handler.mjs";
import { handleMetricSnapshotRefreshRequest } from "../../lib/analytics/snapshot-refresh-handler.mjs";
import { mockComputes } from "./snapshot-fixtures.mjs";

function authDenied() {
  return {
    requireCorporateAuth: async () =>
      Response.json({ error: "Sessão necessária.", code: "AUTH_REQUIRED" }, { status: 401 }),
  };
}

test("GET snapshot sem auth → 401", async () => {
  const response = await handleMetricSnapshotRequest(new Request("http://localhost/api/analytics/snapshot"), authDenied());
  assert.equal(response.status, 401);
});

test("POST refresh sem auth → 401", async () => {
  const response = await handleMetricSnapshotRefreshRequest(
    new Request("http://localhost/api/analytics/snapshot/refresh", { method: "POST" }),
    authDenied(),
  );
  assert.equal(response.status, 401);
});

test("GET não escreve", async () => {
  let wrote = false;
  const response = await handleMetricSnapshotRequest(
    new Request("http://localhost/api/analytics/snapshot?page=general", {
      headers: { authorization: "Bearer x" },
    }),
    {
      requireCorporateAuth: async () => null,
      analyticsCatalogConfigurationError: () => null,
      store: {
        async read(query) {
          assert.equal(query.pageId, "general");
          assert.equal(query.accessToken, "x");
          return { rows: [], queryMs: 1 };
        },
        async upsert() {
          wrote = true;
          throw new Error("GET não deveria persistir");
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(wrote, false);
  const body = await response.json();
  assert.equal(Array.isArray(body.snapshots), true);
});

test("refresh calcula e persiste somente validadas", async () => {
  const upserted = [];
  let persistOpts = null;
  const response = await handleMetricSnapshotRefreshRequest(
    new Request("http://localhost/api/analytics/snapshot/refresh", {
      method: "POST",
      headers: { authorization: "Bearer user-jwt" },
    }),
    {
      requireCorporateAuth: async () => null,
      analyticsCatalogConfigurationError: () => null,
      fetchMetricCatalogRows: async (query) => {
        assert.equal(query.accessToken, "user-jwt");
        return {
          rows: [
            { metric_id: "active_clients", page_id: "general", validated_for_v2: true, scope_policy: "active_first" },
            { metric_id: "clients_with_meeting", page_id: "meetings", validated_for_v2: false, scope_policy: "active_first" },
          ],
        };
      },
      computes: {
        ...mockComputes(),
        meetings: async () => {
          throw new Error("não deveria calcular reuniões");
        },
      },
      store: {
        async upsert(rows, options) {
          persistOpts = options;
          upserted.push(...rows);
          return { persisted: rows.length, skipped_errors: 0, queryMs: 2 };
        },
      },
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.calculated, 1);
  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].metric_id, "active_clients");
  assert.equal(persistOpts.accessToken, "user-jwt");
});
