/**
 * Consolidação Vercel Hobby — entrypoints api/ e roteamento.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DASHBOARD_LEGACY_PATHS,
  DASHBOARD_PAGE_HANDLERS,
  resolveDashboardPage,
} from "../../lib/api/dashboard-router.mjs";
import {
  ANALYTICS_ACTION_HANDLERS,
  ANALYTICS_LEGACY_PATHS,
  resolveAnalyticsAction,
} from "../../lib/api/analytics-router.mjs";
import { handleGeneralDataRequest } from "../../lib/analytics/general-data-handler.mjs";
import { handleMeetingsRequest } from "../../lib/analytics/meetings-handler.mjs";
import { handleMetricCatalogRequest } from "../../lib/analytics/metric-catalog-handler.mjs";
import { handleMetricSnapshotRefreshRequest } from "../../lib/analytics/snapshot-refresh-handler.mjs";
import { handleStatisticalSnapshotRefreshRequest } from "../../lib/analytics/statistical-snapshot-refresh-handler.mjs";
import { handleReportsRequest } from "../../lib/analytics/reports-handler.mjs";
import dashboardHandler from "../../api/dashboard.js";
import analyticsHandler from "../../api/analytics.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function listApiFunctions(dir = join(root, "api"), acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      listApiFunctions(full, acc);
      continue;
    }
    if (name.endsWith(".js")) acc.push(full.slice(root.length + 1).replace(/\\/g, "/"));
  }
  return acc.sort();
}

test("api/ contém no máximo 8 Serverless Functions", () => {
  const files = listApiFunctions();
  assert.ok(files.length <= 8, `esperado <= 8, encontrado ${files.length}: ${files.join(", ")}`);
  assert.equal(files.length, 5);
});

test("lista final de entrypoints Vercel", () => {
  assert.deepEqual(listApiFunctions(), [
    "api/analytics.js",
    "api/assistant.js",
    "api/auth-config.js",
    "api/dashboard.js",
    "api/reports.js",
  ]);
});

test("vercel.json rewrites preservam URLs legadas de dashboard", () => {
  const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
  const rewrites = Object.fromEntries((vercel.rewrites || []).map((item) => [item.source, item.destination]));
  assert.equal(rewrites["/api/general-data"], "/api/dashboard?page=general");
  assert.equal(rewrites["/api/meetings"], "/api/dashboard?page=meetings");
  assert.equal(rewrites["/api/onboarding"], "/api/dashboard?page=journey");
  assert.equal(rewrites["/api/renewal"], "/api/dashboard?page=renewal");
});

test("vercel.json rewrites preservam URLs legadas de analytics", () => {
  const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
  const rewrites = Object.fromEntries((vercel.rewrites || []).map((item) => [item.source, item.destination]));
  assert.equal(rewrites["/api/analytics/catalog"], "/api/analytics?action=catalog");
  assert.equal(rewrites["/api/analytics/snapshot"], "/api/analytics?action=snapshot");
  assert.equal(rewrites["/api/analytics/snapshot/refresh"], "/api/analytics?action=refresh");
  assert.equal(
    rewrites["/api/analytics/statistical-snapshot/refresh"],
    "/api/analytics?action=refresh-statistical-snapshot",
  );
});

test("dashboard resolve todas as páginas legadas", () => {
  for (const [path, page] of Object.entries(DASHBOARD_LEGACY_PATHS)) {
    const entry = resolveDashboardPage(path, new URLSearchParams());
    assert.equal(entry?.page, page, path);
    assert.equal(typeof entry?.handler, "function");
  }
});

test("dashboard resolve ?page= e retorna 404 para página inexistente", async () => {
  assert.equal(resolveDashboardPage("/api/dashboard", new URLSearchParams("page=general"))?.page, "general");
  assert.equal(resolveDashboardPage("/api/dashboard", new URLSearchParams("page=unknown")), null);

  const res = {
    headersSent: false,
    statusCode: 0,
    body: null,
    writeHead(status) { this.statusCode = status; this.headersSent = true; },
    end(payload) { this.body = payload; },
  };
  await dashboardHandler({ method: "GET", url: "/api/dashboard?page=nope", headers: { host: "localhost" } }, res);
  assert.equal(res.statusCode, 404);
});

test("analytics resolve catalog, snapshot, refresh e statistical refresh", () => {
  assert.equal(resolveAnalyticsAction("/api/analytics/catalog", new URLSearchParams())?.action, "catalog");
  assert.equal(resolveAnalyticsAction("/api/analytics/snapshot", new URLSearchParams())?.action, "snapshot");
  assert.equal(resolveAnalyticsAction("/api/analytics/snapshot/refresh", new URLSearchParams())?.action, "refresh");
  assert.equal(
    resolveAnalyticsAction("/api/analytics/statistical-snapshot/refresh", new URLSearchParams())?.action,
    "refresh-statistical-snapshot",
  );
  assert.equal(resolveAnalyticsAction("/api/analytics", new URLSearchParams("action=refresh"))?.action, "refresh");
  assert.equal(
    resolveAnalyticsAction("/api/analytics", new URLSearchParams("action=refresh-statistical-snapshot"))?.action,
    "refresh-statistical-snapshot",
  );
});

test("analytics retorna 404 para action inexistente", async () => {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: null,
    writeHead(status) { this.statusCode = status; this.headersSent = true; },
    end(payload) { this.body = payload; },
  };
  await analyticsHandler({ method: "GET", url: "/api/analytics?action=unknown", headers: { host: "localhost" } }, res);
  assert.equal(res.statusCode, 404);
});

test("dashboard handlers map é explícito (sem import dinâmico arbitrário)", () => {
  assert.equal(DASHBOARD_PAGE_HANDLERS.general.handler, handleGeneralDataRequest);
  assert.equal(DASHBOARD_PAGE_HANDLERS.meetings.handler, handleMeetingsRequest);
  assert.equal(Object.keys(DASHBOARD_PAGE_HANDLERS).length, 17);
  assert.equal(DASHBOARD_LEGACY_PATHS["/api/ep-performance"], "ep_performance");
  assert.equal(DASHBOARD_LEGACY_PATHS["/api/temporal-indicators"], "temporal_indicators");
  assert.equal(DASHBOARD_LEGACY_PATHS["/api/statistical-crosses"], "statistical_crosses");
  assert.equal(DASHBOARD_LEGACY_PATHS["/api/health-score"], "health_score");
  assert.equal(DASHBOARD_LEGACY_PATHS["/api/quality"], "quality");
  assert.equal(DASHBOARD_LEGACY_PATHS["/api/platform-usage"], "platform_usage");
  assert.equal(DASHBOARD_LEGACY_PATHS["/api/support"], "support");
  assert.equal(Object.keys(ANALYTICS_ACTION_HANDLERS).length, 4);
});

test("general-data via dashboard entry retorna 401 sem auth", async () => {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: null,
    writeHead(status) { this.statusCode = status; this.headersSent = true; },
    end(payload) { this.body = payload; },
  };
  await dashboardHandler({ method: "GET", url: "/api/general-data", headers: { host: "localhost" } }, res);
  assert.equal(res.statusCode, 401);
});

test("catalog via analytics entry retorna 401 sem auth", async () => {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: null,
    writeHead(status) { this.statusCode = status; this.headersSent = true; },
    end(payload) { this.body = payload; },
  };
  await analyticsHandler({ method: "GET", url: "/api/analytics/catalog", headers: { host: "localhost" } }, res);
  assert.equal(res.statusCode, 401);
});

test("reports e assistant permanecem entrypoints dedicados", () => {
  const files = listApiFunctions();
  assert.ok(files.includes("api/reports.js"));
  assert.ok(files.includes("api/assistant.js"));
  assert.ok(!files.includes("api/general-data.js"));
  assert.ok(!files.includes("api/analytics/catalog.js"));
});

test("metric snapshot refresh via analytics exige POST no handler", async () => {
  const response = await handleMetricSnapshotRefreshRequest(
    new Request("http://localhost/api/analytics/snapshot/refresh", { method: "GET" }),
    { requireCorporateAuth: async () => null },
  );
  assert.equal(response.status, 405);
});

test("statistical snapshot refresh via analytics exige POST no handler", async () => {
  const response = await handleStatisticalSnapshotRefreshRequest(
    new Request("http://localhost/api/analytics?action=refresh-statistical-snapshot", { method: "GET" }),
    { requireCorporateAuth: async () => null },
  );
  assert.equal(response.status, 405);
});

test("reports GET exige auth", async () => {
  const response = await handleReportsRequest(new Request("http://localhost/api/reports"), {
    requireCorporateAuthUser: async () => ({
      error: Response.json({ error: "Não autenticado.", code: "unauthenticated" }, { status: 401 }),
    }),
  });
  assert.equal(response.status, 401);
});

test("catalog POST continua bloqueado", async () => {
  const response = await handleMetricCatalogRequest(new Request("http://localhost/api/analytics/catalog", { method: "POST" }), {
    requireCorporateAuth: async () => null,
  });
  assert.equal(response.status, 405);
});
