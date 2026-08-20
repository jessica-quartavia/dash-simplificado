/**
 * Roteamento consolidado analytics (entrypoint api/analytics.js).
 */
import { handleMetricCatalogRequest } from "../analytics/metric-catalog-handler.mjs";
import { handleMetricSnapshotRequest } from "../analytics/snapshot-handler.mjs";
import { handleMetricSnapshotRefreshRequest } from "../analytics/snapshot-refresh-handler.mjs";
import { nodeToWebRequest, sendWebResponse } from "../http/node-fetch-bridge.mjs";

export const ANALYTICS_ACTION_HANDLERS = Object.freeze({
  catalog: { handler: handleMetricCatalogRequest, logPrefix: "catalog" },
  snapshot: { handler: handleMetricSnapshotRequest, logPrefix: "snapshot" },
  refresh: { handler: handleMetricSnapshotRefreshRequest, logPrefix: "snapshot-refresh" },
});

export const ANALYTICS_LEGACY_PATHS = Object.freeze({
  "/api/analytics/catalog": "catalog",
  "/api/analytics/snapshot": "snapshot",
  "/api/analytics/snapshot/refresh": "refresh",
});

function normalizePath(pathname) {
  const base = String(pathname || "/");
  if (base.length > 1 && base.endsWith("/")) return base.slice(0, -1);
  return base;
}

export function resolveAnalyticsAction(pathname, searchParams = new URLSearchParams()) {
  const path = normalizePath(pathname);
  const actionFromQuery = String(searchParams.get("action") || "").trim();
  if (actionFromQuery && ANALYTICS_ACTION_HANDLERS[actionFromQuery]) {
    return { action: actionFromQuery, ...ANALYTICS_ACTION_HANDLERS[actionFromQuery] };
  }
  const legacyAction = ANALYTICS_LEGACY_PATHS[path];
  if (legacyAction && ANALYTICS_ACTION_HANDLERS[legacyAction]) {
    return { action: legacyAction, ...ANALYTICS_ACTION_HANDLERS[legacyAction] };
  }
  return null;
}

export function analyticsNotFoundResponse(pathname) {
  return Response.json(
    {
      error: "Ação analítica não encontrada.",
      code: "ANALYTICS_NOT_FOUND",
      path: normalizePath(pathname),
    },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function runAnalyticsHandler(req, res, entry) {
  const request = await nodeToWebRequest(req);
  const hasAuth = Boolean(request.headers.get("authorization"));
  console.info(`[${entry.logPrefix}] incoming ${req.method || "GET"} authorization=${hasAuth ? "sim" : "não"}`);
  const response = await entry.handler(request);
  await sendWebResponse(res, response, { logPrefix: entry.logPrefix });
}

export async function handleAnalyticsApi(req, res) {
  const host = req.headers?.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  const entry = resolveAnalyticsAction(url.pathname, url.searchParams);
  if (!entry) {
    const response = analyticsNotFoundResponse(url.pathname);
    await sendWebResponse(res, response, { logPrefix: "analytics" });
    return;
  }
  await runAnalyticsHandler(req, res, entry);
}
