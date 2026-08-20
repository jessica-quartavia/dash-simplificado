import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { redactSecrets } from "../../lib/auth.mjs";
import {
  analyticsCatalogConfigurationError,
  getAnalyticsEnv,
} from "../../lib/env.mjs";
import { buildAnalyticsRestHeaders } from "../../lib/data/analytics-rest.mjs";
import { analyticsSnapshotStore } from "../../lib/analytics/snapshot/metric-snapshot-store.mjs";
import { buildMetricSnapshots } from "../../lib/analytics/snapshot/metric-snapshot-builder.mjs";
import { mockComputes } from "./snapshot-fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sql004 = readFileSync(resolve(root, "sql/analytics/004_authenticated_access.sql"), "utf8");
const seed = JSON.parse(readFileSync(resolve(root, "lib/analytics/metric-catalog-seed.json"), "utf8"));

const AUTH_URL = "https://rckpuebaiswrxzmywllv.supabase.co";
const BASE_QV = "https://lacinxsvjdwalkchxyeo.supabase.co";
const ANON = "test-anon-key";

test("analytics usa AUTH anon key e não exige service role Business Data", () => {
  const env = {
    AUTH_SUPABASE_URL: AUTH_URL,
    AUTH_SUPABASE_ANON_KEY: ANON,
    BUSINESS_DATA_SUPABASE_URL: AUTH_URL,
    DATA_SUPABASE_URL: BASE_QV,
    BUSINESS_DATA_SUPABASE_SERVICE_ROLE_KEY: "should-be-ignored",
    AUTH_SUPABASE_SERVICE_ROLE_KEY: "should-be-ignored",
  };
  const resolved = getAnalyticsEnv(env);
  assert.equal(resolved.url, AUTH_URL);
  assert.equal(resolved.anonKey, ANON);
  assert.equal(resolved.schema, "analytics");
  assert.equal(analyticsCatalogConfigurationError(env), null);
  assert.equal("serviceRoleKey" in resolved, false);
});

test("writer recusa BASE QV", () => {
  assert.throws(
    () => buildAnalyticsRestHeaders({
      accessToken: "user-jwt",
      env: {
        AUTH_SUPABASE_URL: BASE_QV,
        AUTH_SUPABASE_ANON_KEY: ANON,
      },
    }),
    (error) => error.code === "base_qv_refused",
  );
});

test("chamada PostgREST usa anon key + JWT, nunca service role", () => {
  const { headers } = buildAnalyticsRestHeaders({
    accessToken: "user-jwt",
    write: true,
    env: {
      AUTH_SUPABASE_URL: AUTH_URL,
      AUTH_SUPABASE_ANON_KEY: ANON,
      DATA_SUPABASE_URL: BASE_QV,
    },
  });
  assert.equal(headers.apikey, ANON);
  assert.equal(headers.Authorization, "Bearer user-jwt");
  assert.equal(headers["Content-Profile"], "analytics");
  assert.equal(headers["Accept-Profile"], "analytics");
  assert.equal(String(headers.apikey).includes("should-be-ignored"), false);
});

test("sem JWT não há escrita no snapshot", async () => {
  await assert.rejects(
    () => analyticsSnapshotStore.upsert([{ metric_id: "active_clients", calculation_status: "ok", value: { value: 1 } }]),
    (error) => error.code === "unauthenticated" || error.code === "config",
  );
});

test("store de snapshot não implementa DELETE", () => {
  assert.equal(typeof analyticsSnapshotStore.delete, "undefined");
});

test("SQL 004 concede SELECT autenticado e não libera anon/DELETE", () => {
  const grants = sql004.match(/^GRANT\b[^;]*;/gim) || [];
  assert.match(sql004, /GRANT SELECT ON TABLE analytics\.metric_catalog TO authenticated/);
  assert.match(sql004, /GRANT SELECT, INSERT, UPDATE ON TABLE analytics\.metric_snapshot TO authenticated/);
  assert.match(sql004, /metric_catalog_authenticated_read/);
  assert.match(sql004, /metric_snapshot_authenticated_read/);
  assert.match(sql004, /metric_snapshot_authenticated_insert/);
  assert.match(sql004, /metric_snapshot_authenticated_update/);
  assert.equal(grants.some((grant) => /\bTO anon\b/i.test(grant)), false);
  assert.equal(grants.some((grant) => /\bDELETE\b/i.test(grant)), false);
  assert.equal(grants.some((grant) => /\bTO service_role\b/i.test(grant)), false);
  assert.equal(/\bFOR ALL\b/i.test(sql004), false);
});

test("JWT é omitido de logs", () => {
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InRlc3RAcXVhcnRhdmlhLmNvbS5iciJ9.sig";
  const redacted = redactSecrets(`Bearer ${jwt} falhou`);
  assert.equal(redacted.includes(jwt), false);
  assert.equal(redacted.includes("eyJ"), false);
  assert.match(redacted, /\[redacted/);
});

test("49 snapshots continuam idênticos após a correção de auth", async () => {
  const result = await buildMetricSnapshots({
    catalogRows: seed.metrics,
    computes: mockComputes(),
  });
  assert.equal(result.snapshots.length, 49);
  assert.equal(result.comparison.every((row) => row.match), true);
});
