/**
 * Handler HTTP de Reuniões (Fetch Request → Response).
 * Autenticação corporativa obrigatória. Service role permanece no servidor.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import {
  computeMeetingClientDetail,
  computeMeetingsPayload,
  sanitizeMeetingsClientId,
  toPublicMeetingsPayload,
} from "./meetings.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requestUrl(request) {
  try {
    return new URL(request.url);
  } catch {
    return new URL(request.url || "/api/meetings", "http://localhost");
  }
}

export async function handleMeetingsRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  const authMs = Date.now() - startedAt;
  if (denied) {
    console.info(`[meetings] status=${denied.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return denied;
  }

  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) {
    console.info(`[meetings] status=503 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return json(503, { error: configError, code: "config" });
  }

  const clientIdRaw = requestUrl(request).searchParams.get("client_id");
  const clientId = clientIdRaw ? sanitizeMeetingsClientId(clientIdRaw) : null;
  if (clientIdRaw && !clientId) {
    return json(404, { error: "Cliente não encontrado.", code: "not_found" });
  }

  try {
    if (clientId) {
      const computeDetail = deps.computeMeetingClientDetail || computeMeetingClientDetail;
      const detail = await computeDetail(clientId);
      if (!detail) {
        console.info(`[meetings] status=404 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
        return json(404, { error: "Cliente não encontrado.", code: "not_found" });
      }
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
      }
      console.info(`[meetings] status=200 detail auth=${authMs}ms total=${Date.now() - startedAt}ms`);
      return json(200, { client: detail });
    }

    const force = parseForceRefresh(request);
    const compute = deps.computeMeetingsPayload || computeMeetingsPayload;
    const { payload, cache } = await computeWithPageCache("meetings", () => compute(), { request, force });
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const timing = payload?.timing || {};
    const publicPayload = toPublicMeetingsPayload(payload);
    console.info(
      `[meetings] status=200 auth=${authMs}ms baseQv=${timing.baseQvMs ?? "—"}ms calendly=${timing.calendlyTypesMs ?? "—"}ms cache=${cache.status} total=${Date.now() - startedAt}ms`,
    );
    return json(200, publicPayload);
  } catch (error) {
    if (error?.code === "config") {
      return json(503, { error: error.message, code: "config" });
    }
    console.error("[Data] meetings failed:", error instanceof Error ? error.message : error);
    console.info(`[meetings] status=500 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return json(500, {
      error: "Não foi possível consultar as reuniões.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
