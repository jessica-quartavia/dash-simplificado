/**
 * Handler HTTP de Pesquisa de Satisfação.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import { computeSatisfactionPayload, toPublicSatisfactionPayload } from "./satisfaction.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleSatisfactionRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  const authMs = Date.now() - startedAt;
  if (denied) {
    console.info(`[satisfaction] status=${denied.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return denied;
  }
  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) {
    return json(503, { error: configError, code: "config" });
  }
  try {
    const force = parseForceRefresh(request);
    const compute = deps.computeSatisfactionPayload || computeSatisfactionPayload;
    const { payload, cache } = await computeWithPageCache("satisfaction", () => compute(), { request, force });
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    console.info(`[satisfaction] status=200 auth=${authMs}ms total=${Date.now() - startedAt}ms cache=${cache.status}`);
    return json(200, toPublicSatisfactionPayload(payload));
  } catch (error) {
    if (error?.code === "config") return json(503, { error: error.message, code: "config" });
    console.error("[Data] satisfaction failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consultar a pesquisa de satisfação.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
