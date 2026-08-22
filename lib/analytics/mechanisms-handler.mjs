/**
 * Handler HTTP de Implementação de Mecanismos.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import { getAnalyticsCache } from "../cache/analytics-cache.mjs";
import { clearExecutiveSummaryCache } from "./executive-summary.mjs";
import { computeMechanismsPayload, toPublicMechanismsPayload } from "./mechanisms.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";

export function clearMechanismsHandlerCache() {
  getAnalyticsCache().clear("analytics:v2:mechanisms:");
}

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleMechanismsRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  const authMs = Date.now() - startedAt;
  if (denied) {
    console.info(`[mechanisms] status=${denied.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return denied;
  }
  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) {
    return json(503, { error: configError, code: "config" });
  }
  try {
    const force = parseForceRefresh(request);
    if (force) clearExecutiveSummaryCache();
    const compute = deps.computeMechanismsPayload || computeMechanismsPayload;
    const { payload, cache } = await computeWithPageCache("mechanisms", () => compute(), { request, force });
    const pharusPartial = payload?.metadata?.status === "partial" || payload?.metadata?.pharusConsulted === false;
    if (pharusPartial && cache.key) {
      await getAnalyticsCache().del(cache.key);
    }
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const timing = payload?.timing || {};
    console.info(
      `[mechanisms] status=200 auth=${authMs}ms qv=${timing.baseQvMs ?? timing.totalMs ?? "—"}ms cache=${cache.status} total=${Date.now() - startedAt}ms`,
    );
    return json(200, toPublicMechanismsPayload(payload));
  } catch (error) {
    if (error?.code === "config") return json(503, { error: error.message, code: "config" });
    console.error("[Data] mechanisms failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consultar os mecanismos.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
