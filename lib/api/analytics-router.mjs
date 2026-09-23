/**
 * Roteamento consolidado analytics (entrypoint api/analytics.js).
 */
import { handleMetricCatalogRequest } from "../analytics/metric-catalog-handler.mjs";
import { handleMetricSnapshotRequest } from "../analytics/snapshot-handler.mjs";
import { handleMetricSnapshotRefreshRequest } from "../analytics/snapshot-refresh-handler.mjs";
import { handleStatisticalSnapshotRefreshRequest } from "../analytics/statistical-snapshot-refresh-handler.mjs";
import { handleAccessRequest } from "../access/access-handler.mjs";
import { handleReportsRequest } from "../analytics/reports-handler.mjs";
import { requirePageAccess } from "../access/require-page-access.mjs";
import { API_PAGE_MAP } from "../access/access-policy.mjs";
import { nodeToWebRequest, sendWebResponse } from "../http/node-fetch-bridge.mjs";

export const ANALYTICS_ACTION_HANDLERS = Object.freeze({
  catalog: { handler: handleMetricCatalogRequest, logPrefix: "catalog" },
  snapshot: { handler: handleMetricSnapshotRequest, logPrefix: "snapshot" },
  refresh: { handler: handleMetricSnapshotRefreshRequest, logPrefix: "snapshot-refresh" },
  "refresh-statistical-snapshot": {
    handler: handleStatisticalSnapshotRefreshRequest,
    logPrefix: "stat-snapshot-refresh",
  },
  access: { handler: handleAccessRequest, logPrefix: "access" },
  reports: { handler: handleReportsRequest, logPrefix: "reports", pageId: "reports" },
  "reports-list": { handler: handleReportsRequest, logPrefix: "reports", pageId: "reports" },
  "reports-create": { handler: handleReportsRequest, logPrefix: "reports", pageId: "reports" },
  "reports-delete": { handler: handleReportsRequest, logPrefix: "reports", pageId: "reports" },
  "reports-download": { handler: handleReportsRequest, logPrefix: "reports", pageId: "reports" },
});

export const ANALYTICS_LEGACY_PATHS = Object.freeze({
  "/api/analytics/catalog": "catalog",
  "/api/analytics/snapshot": "snapshot",
  "/api/analytics/snapshot/refresh": "refresh",
  "/api/analytics/statistical-snapshot/refresh": "refresh-statistical-snapshot",
  "/api/analytics/reports": "reports",
});

function normalizePath(pathname) {
  const base = String(pathname || "/");
  if (base.length > 1 && base.endsWith("/")) return base.slice(0, -1);
  return base;
}

/** Une query de req.url e req.query (Vercel repassa ?action= via req.query). */
export function analyticsRequestContext(req) {
  const host = req.headers?.host || "localhost";
  const raw = String(req.url || "/");
  const absolute = raw.startsWith("http") ? raw : `http://${host}${raw.startsWith("/") ? raw : `/${raw}`}`;
  const url = new URL(absolute);
  const searchParams = new URLSearchParams(url.search);
  const query = req.query;
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item != null) searchParams.set(key, String(item));
        }
      } else {
        searchParams.set(key, String(value));
      }
    }
  }
  return { pathname: normalizePath(url.pathname), searchParams };
}

export function resolveAnalyticsAction(pathname, searchParams = new URLSearchParams()) {
  const path = normalizePath(pathname);
  const legacyAction = ANALYTICS_LEGACY_PATHS[path];
  if (legacyAction && ANALYTICS_ACTION_HANDLERS[legacyAction]) {
    return { action: legacyAction, ...ANALYTICS_ACTION_HANDLERS[legacyAction] };
  }
  const actionFromQuery = String(searchParams.get("action") || "").trim();
  if (actionFromQuery && ANALYTICS_ACTION_HANDLERS[actionFromQuery]) {
    return { action: actionFromQuery, ...ANALYTICS_ACTION_HANDLERS[actionFromQuery] };
  }
  return null;
}

export function analyticsNotFoundResponse(pathname, searchParams = new URLSearchParams()) {
  const action = String(searchParams.get("action") || "").trim() || null;
  return Response.json(
    {
      error: "Ação analítica não encontrada.",
      code: "ANALYTICS_NOT_FOUND",
      path: normalizePath(pathname),
      action,
    },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function runAnalyticsHandler(req, res, entry) {
  const request = await nodeToWebRequest(req);
  const hasAuth = Boolean(request.headers.get("authorization"));
  console.info(`[${entry.logPrefix}] incoming ${req.method || "GET"} authorization=${hasAuth ? "sim" : "não"}`);
  const pageId = entry.pageId || API_PAGE_MAP[entry.action];
  if (pageId) {
    const denied = await requirePageAccess(request, pageId);
    if (denied) {
      await sendWebResponse(res, denied, { logPrefix: entry.logPrefix });
      return;
    }
  }
  const response = await entry.handler(request);
  await sendWebResponse(res, response, { logPrefix: entry.logPrefix });
}

export async function handleAnalyticsApi(req, res) {
  const { pathname, searchParams } = analyticsRequestContext(req);
  const method = req.method || "GET";
  const actionParam = String(searchParams.get("action") || "").trim();
  const entry = resolveAnalyticsAction(pathname, searchParams);
  const reportsLike = actionParam.includes("report") || pathname.includes("/reports");
  if (reportsLike) {
    console.info(
      `[Reports] request pathname=${pathname} action=${actionParam || "(legacy path)"} method=${method} handler found=${Boolean(entry)}`,
    );
  }
  if (!entry) {
    const response = analyticsNotFoundResponse(pathname, searchParams);
    await sendWebResponse(res, response, { logPrefix: "analytics" });
    return;
  }
  if (entry.action === "reports" || String(entry.action).startsWith("reports-")) {
    const accessHint = "pending";
    console.info(`[Reports] action=${entry.action} method=${method} access=${accessHint}`);
  }
  await runAnalyticsHandler(req, res, entry);
}
