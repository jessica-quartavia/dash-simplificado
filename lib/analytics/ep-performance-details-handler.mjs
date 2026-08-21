/**
 * Lazy detail — Performance EP (renewalClients, mechanismsMatrix).
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import { computeEpPerformancePayload, extractEpPerformanceDetails } from "./ep-performance.mjs";
import { perfDebugFromRequest } from "./analytics-data-context.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleEpPerformanceDetailsRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  if (denied) {
    console.info(`[ep-performance-details] status=${denied.status} auth=${Date.now() - startedAt}ms`);
    return denied;
  }
  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) return json(503, { error: configError, code: "config" });
  try {
    const url = new URL(request.url || "http://local/", "http://local");
    const section = String(url.searchParams.get("section") || "renewalClients").trim();
    const force = parseForceRefresh(request);
    const compute = deps.computeEpPerformancePayload || computeEpPerformancePayload;
    const { payload } = await computeWithPageCache(
      "ep_performance",
      () => compute({ perfDebug: perfDebugFromRequest(request) }),
      { request, force },
    );
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const detail = extractEpPerformanceDetails(payload, section);
    if (detail.error) return json(400, detail);
    console.info(`[ep-performance-details] status=200 section=${section} total=${Date.now() - startedAt}ms`);
    return json(200, detail);
  } catch (error) {
    if (error?.code === "config") return json(503, { error: error.message, code: "config" });
    console.error("[Data] ep-performance-details failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consultar detalhes de performance dos EPs.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
