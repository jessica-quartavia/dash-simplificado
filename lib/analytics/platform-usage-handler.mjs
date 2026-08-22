/**
 * Handler HTTP — Uso da Plataforma (App Pharus, read-only).
 */
import { requireCorporateAuth } from "../auth.mjs";
import { pharusConfigurationError } from "../env.mjs";
import { computePlatformUsagePayload, toPublicPlatformUsagePayload } from "./platform-usage.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handlePlatformUsageRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  if (denied) {
    console.info(`[platform-usage] status=${denied.status} total=${Date.now() - startedAt}ms`);
    return denied;
  }
  const configError = (deps.pharusConfigurationError || pharusConfigurationError)();
  if (configError) {
    return json(503, { error: configError, code: "config" });
  }
  try {
    const force = parseForceRefresh(request);
    const compute = deps.computePlatformUsagePayload || computePlatformUsagePayload;
    const { payload, cache } = await computeWithPageCache("platform_usage", () => compute(), { request, force });
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    console.info(`[platform-usage] status=200 total=${Date.now() - startedAt}ms cache=${cache.status} events=${payload?.summary?.eventsLoaded ?? payload?.summary?.appPharusEvents ?? 0}`);
    return json(200, toPublicPlatformUsagePayload(payload));
  } catch (error) {
    if (error?.code === "pharus_config" || error?.code === "config") {
      return json(503, { error: error.message, code: "config" });
    }
    console.error("[Data] platform-usage failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consultar o uso da plataforma.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
