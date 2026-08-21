/**
 * Handler HTTP — Performance do Engenheiro Patrimonial.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import { computeEpPerformancePayload, toPublicEpPerformancePayload } from "./ep-performance.mjs";
import { perfDebugFromRequest } from "./analytics-data-context.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleEpPerformanceRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  if (denied) {
    console.info(`[ep-performance] status=${denied.status} auth=${Date.now() - startedAt}ms`);
    return denied;
  }
  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) return json(503, { error: configError, code: "config" });
  try {
    const force = parseForceRefresh(request);
    const compute = deps.computeEpPerformancePayload || computeEpPerformancePayload;
    const { payload, cache } = await computeWithPageCache(
      "ep_performance",
      () => compute({ perfDebug: perfDebugFromRequest(request) }),
      { request, force },
    );
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    console.info(`[ep-performance] status=200 total=${Date.now() - startedAt}ms cache=${cache.hit ? "hit" : cache.coalesced ? "coalesced" : "miss"}`);
    return json(200, toPublicEpPerformancePayload(payload));
  } catch (error) {
    if (error?.code === "config") return json(503, { error: error.message, code: "config" });
    console.error("[Data] ep-performance failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consultar performance dos EPs.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
