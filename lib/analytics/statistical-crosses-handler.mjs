/**
 * Handler HTTP — Análises Estatísticas.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import {
  computeStatisticalCrossesPayload,
  parseStatisticalCrossesFilters,
  toPublicStatisticalCrossesPayload,
} from "./statistical-crosses.mjs";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleStatisticalCrossesRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  if (denied) {
    console.info(`[statistical-crosses] status=${denied.status} auth=${Date.now() - startedAt}ms`);
    return denied;
  }
  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) return json(503, { error: configError, code: "config" });
  try {
    const parseFilters = deps.parseStatisticalCrossesFilters || parseStatisticalCrossesFilters;
    const compute = deps.computeStatisticalCrossesPayload || computeStatisticalCrossesPayload;
    const url = new URL(request.url || "/", "http://localhost");
    const filters = parseFilters(url.searchParams);
    const payload = await compute({ filters });
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    console.info(`[statistical-crosses] status=200 total=${Date.now() - startedAt}ms`);
    return json(200, toPublicStatisticalCrossesPayload(payload));
  } catch (error) {
    if (error?.code === "config") return json(503, { error: error.message, code: "config" });
    console.error("[Data] statistical-crosses failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consultar análises estatísticas.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
