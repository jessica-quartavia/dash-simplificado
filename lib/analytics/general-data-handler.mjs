/**
 * Handler HTTP de Dados Gerais (Fetch Request → Response).
 * Autenticação corporativa obrigatória. Service role permanece no servidor.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import { computeGeneralDataPayload } from "./general-data.mjs";

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handleGeneralDataRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  const authMs = Date.now() - startedAt;
  if (denied) {
    console.info(`[general-data] status=${denied.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return denied;
  }

  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) {
    console.info(`[general-data] status=503 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return json(503, { error: configError, code: "config" });
  }

  try {
    const compute = deps.computeGeneralDataPayload || computeGeneralDataPayload;
    const payload = await compute();
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const response = json(200, payload);
    console.info(`[general-data] status=200 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return response;
  } catch (error) {
    if (error?.code === "config") {
      return json(503, { error: error.message, code: "config" });
    }
    console.error("[Data] general-data failed:", error instanceof Error ? error.message : error);
    console.info(`[general-data] status=500 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return json(500, {
      error: "Não foi possível consultar a base de dados.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
