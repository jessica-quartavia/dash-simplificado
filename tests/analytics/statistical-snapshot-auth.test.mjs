import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAnalyticsRestHeaders } from "../../lib/data/analytics-rest.mjs";
import { assertAuthenticatedAnalyticsAccess } from "../../lib/data/business-data-service-rest.mjs";
import { statisticalSnapshotStore } from "../../lib/analytics/statistical-snapshot-store.mjs";
import { handleStatisticalSnapshotRefreshRequest } from "../../lib/analytics/statistical-snapshot-refresh-handler.mjs";
import { pickStatisticalClientFeatures } from "../../lib/analytics/statistical-feature-registry.mjs";
import { clientToSnapshotRow } from "../../lib/analytics/statistical-snapshot.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sql011 = readFileSync(resolve(root, "sql/analytics/011_statistical_client_features.sql"), "utf8");
const AUTH_URL = "https://rckpuebaiswrxzmywllv.supabase.co";
const ANON = "test-anon-key";

test("sem JWT não há escrita no statistical snapshot store", async () => {
  await assert.rejects(
    () => statisticalSnapshotStore.publishSnapshot({
      rows: [],
      runMeta: { snapshot_version: "v1" },
      accessToken: null,
    }),
    (error) => error.code === "unauthenticated",
  );
});

test("store usa anon key + JWT, nunca service role", () => {
  const { headers } = buildAnalyticsRestHeaders({
    accessToken: "user-jwt",
    write: true,
    env: {
      AUTH_SUPABASE_URL: AUTH_URL,
      AUTH_SUPABASE_ANON_KEY: ANON,
      DATA_SUPABASE_URL: "https://lacinxsvjdwalkchxyeo.supabase.co",
    },
  });
  assert.equal(headers.apikey, ANON);
  assert.equal(headers.Authorization, "Bearer user-jwt");
  assert.notEqual(headers.Authorization, `Bearer ${ANON}`);
});

test("CLI sem access token retorna mensagem clara", () => {
  const env = {
    AUTH_SUPABASE_URL: AUTH_URL,
    AUTH_SUPABASE_ANON_KEY: ANON,
    DATA_SUPABASE_URL: "https://lacinxsvjdwalkchxyeo.supabase.co",
  };
  const prev = { ...process.env };
  Object.assign(process.env, env);
  try {
    const msg = assertAuthenticatedAnalyticsAccess("");
    assert.match(msg, /authenticated user session/i);
    assert.doesNotMatch(msg, /service role/i);
  } finally {
    for (const key of Object.keys(env)) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
});

test("endpoint refresh retorna 401 sem Authorization", async () => {
  const response = await handleStatisticalSnapshotRefreshRequest(
    new Request("http://localhost/api/analytics?action=refresh-statistical-snapshot", { method: "POST" }),
    {
      requireCorporateAuth: async () =>
        Response.json({ error: "Não autenticado.", code: "unauthenticated" }, { status: 401 }),
    },
  );
  assert.equal(response.status, 401);
});

test("endpoint refresh retorna 405 em GET", async () => {
  const response = await handleStatisticalSnapshotRefreshRequest(
    new Request("http://localhost/api/analytics?action=refresh-statistical-snapshot", {
      method: "GET",
      headers: { Authorization: "Bearer test-jwt" },
    }),
    { requireCorporateAuth: async () => null },
  );
  assert.equal(response.status, 405);
});

test("endpoint refresh retorna 403 para domínio inválido", async () => {
  const response = await handleStatisticalSnapshotRefreshRequest(
    new Request("http://localhost/api/analytics?action=refresh-statistical-snapshot", {
      method: "POST",
      headers: { Authorization: "Bearer test-jwt" },
    }),
    {
      requireCorporateAuth: async () =>
        Response.json(
          { error: "O acesso é permitido somente para contas @quartavia.com.br.", code: "invalid_domain" },
          { status: 403 },
        ),
    },
  );
  assert.equal(response.status, 403);
});

test("publishSnapshot não ativa versão incompleta", async () => {
  const calls = [];
  const version = "sc-test";
  const generatedAt = new Date().toISOString();
  const baseClient = { clientId: "1", clientCode: "A", clientName: "T", analyticalStatus: "active", isActive: true, isCancelled: false, isFrozen: false, hasMeeting: true, hasMechanism: true, hasFinancialData: true, hasRenewed: true, hasNps: true, npsPredictiveOk: true, survivalValid: true, firstMeetingCompleted: true, hasFirstImplementation: true, renewedValid: true };
  const clients = [baseClient, { ...baseClient, clientId: "2", clientCode: "B" }];
  const rows = clients.map((c) => clientToSnapshotRow(c, version, generatedAt));
  const mockStore = {
    tableExists: async () => true,
    publishSnapshot: async ({ rows, runMeta, accessToken }) => {
      calls.push({ op: "publish", rows: rows.length, version: runMeta.snapshot_version, accessToken });
      throw new Error("Contagem divergente no upsert: esperado 2, persistido 1");
    },
  };
  const response = await handleStatisticalSnapshotRefreshRequest(
    new Request("http://localhost/api/analytics?action=refresh-statistical-snapshot", {
      method: "POST",
      headers: { Authorization: "Bearer corp-jwt" },
    }),
    {
      requireCorporateAuth: async () => null,
      analyticsCatalogConfigurationError: () => null,
      store: mockStore,
      buildLiveStatisticalFeatureSnapshot: async () => ({
        clients,
        snapshotVersion: version,
        generatedAt,
        rows,
        runMeta: { snapshot_version: version, feature_count: Object.keys(pickStatisticalClientFeatures(clients[0])).length },
        sourceStats: { rest_requests: 29 },
      }),
    },
  );
  assert.equal(response.status, 500);
  assert.equal(calls.length, 1);
});

test("SQL 011 concede authenticated SELECT/INSERT/UPDATE e não libera anon/DELETE/service_role", () => {
  const grants = sql011.match(/^GRANT\b[^;]*;/gim) || [];
  assert.match(sql011, /GRANT SELECT, INSERT, UPDATE ON TABLE analytics\.statistical_snapshot_runs TO authenticated/);
  assert.match(sql011, /GRANT SELECT, INSERT, UPDATE ON TABLE analytics\.statistical_client_features TO authenticated/);
  assert.match(sql011, /statistical_snapshot_runs_authenticated_insert/);
  assert.match(sql011, /statistical_client_features_authenticated_update/);
  assert.equal(grants.some((grant) => /\bTO anon\b/i.test(grant)), false);
  assert.equal(grants.some((grant) => /\bTO service_role\b/i.test(grant)), false);
  assert.equal(grants.some((grant) => /\bDELETE\b/i.test(grant)), false);
});

test("markRunFailed exige JWT", async () => {
  await assert.rejects(
    () => statisticalSnapshotStore.markRunFailed({ accessToken: "", snapshotVersion: "v1" }),
    (error) => error.code === "unauthenticated",
  );
});
