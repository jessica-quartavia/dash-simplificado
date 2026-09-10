/**
 * POST /api/assistant — Assistente da Jornada V2 (Gemini direto, sem n8n).
 */
import { randomUUID } from "node:crypto";
import { getRequestAccessToken, redactSecrets, requireCorporateAuth } from "../auth.mjs";
import { analyticsCatalogConfigurationError } from "../env.mjs";
import { resolveRequestAccess } from "../access/require-page-access.mjs";
import { runAssistant } from "./assistant-service.mjs";

function json(status, body, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

export async function handleAssistantRequest(request, deps = {}) {
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const method = request?.method || "GET";

  console.info(`[assistant] request start id=${requestId} method=${method}`);

  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  const authMs = Date.now() - startedAt;
  if (denied) {
    console.info(
      `[assistant] auth denied id=${requestId} status=${denied.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`,
    );
    return denied;
  }
  console.info(`[assistant] auth ok id=${requestId} auth=${authMs}ms`);

  if (deps.skipAccessGate !== true) {
    const resolved = await (deps.resolveRequestAccess || resolveRequestAccess)(request, deps);
    if (resolved.error) return resolved.error;
  }

  if (method !== "POST") {
    return json(405, {
      error: "Método não permitido.",
      code: "METHOD_NOT_ALLOWED",
      error_category: "route_error",
      request_id: requestId,
    });
  }

  const catalogError = (deps.analyticsCatalogConfigurationError || analyticsCatalogConfigurationError)();
  if (catalogError) {
    console.info(`[assistant] catalog config error id=${requestId}`);
    return json(503, {
      error: catalogError,
      code: "config",
      error_category: "catalog_error",
      request_id: requestId,
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, {
      error: "JSON inválido.",
      code: "invalid_json",
      error_category: "route_error",
      request_id: requestId,
    });
  }

  const message = String(payload?.message || "").trim();
  if (!message) {
    return json(400, {
      error: "Informe a pergunta em message.",
      code: "message_required",
      error_category: "route_error",
      request_id: requestId,
    });
  }

  try {
    const result = await (deps.runAssistant || runAssistant)({
      message,
      history: payload?.history,
      accessToken: getRequestAccessToken(request),
      requestId,
      deps,
    });

    const totalMs = Date.now() - startedAt;
    const body = result.body || {};
    const metricIds = (body.matched_metrics || []).map((item) => item.metric_id).join(",") || "—";
    console.info(
      `[assistant] request complete id=${requestId} status=${result.status} auth=${authMs}ms intent=${body.intent || "—"} metrics=${metricIds} snapshot=${body.meta?.used_snapshot ? "sim" : "não"} compute=${body.meta?.used_compute ? "sim" : "não"} cache=${body.meta?.compute_cache_hit ? "sim" : "não"} gemini=${body.meta?.used_gemini ? "sim" : "não"} deterministic=${body.meta?.deterministic ? "sim" : "não"} ctx=${body.meta?.context_bytes ?? 0}B total=${totalMs}ms`,
    );

    return json(result.status, body, {
      "Server-Timing": `auth;dur=${authMs}, total;dur=${totalMs}`,
    });
  } catch (error) {
    console.error(
      `[assistant] failed id=${requestId}:`,
      redactSecrets(error instanceof Error ? error.message : error),
    );
    return json(500, {
      error: "Não foi possível processar a pergunta agora.",
      code: "assistant_unavailable",
      error_category: "route_error",
      request_id: requestId,
    });
  }
}
