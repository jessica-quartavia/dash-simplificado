/**
 * Handler HTTP — Indicadores Temporais.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import { computeTemporalIndicatorsPayload, toPublicTemporalIndicatorsPayload } from "./temporal-indicators.mjs";
import { perfDebugFromRequest } from "./analytics-data-context.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleTemporalIndicatorsRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  if (denied) {
    console.info(`[temporal-indicators] status=${denied.status} auth=${Date.now() - startedAt}ms`);
    return denied;
  }
  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) return json(503, { error: configError, code: "config" });
  try {
    const force = parseForceRefresh(request);
    const compute = deps.computeTemporalIndicatorsPayload || computeTemporalIndicatorsPayload;
    const { payload, cache } = await computeWithPageCache(
      "temporal_indicators",
      () => compute({ perfDebug: perfDebugFromRequest(request) }),
      { request, force },
    );
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    console.info(`[temporal-indicators] status=200 total=${Date.now() - startedAt}ms cache=${cache.hit ? "hit" : cache.coalesced ? "coalesced" : "miss"}`);
    return json(200, toPublicTemporalIndicatorsPayload(payload));
  } catch (error) {
    if (error?.code === "config") return json(503, { error: error.message, code: "config" });
    console.error("[Data] temporal-indicators failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consultar indicadores temporais.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
