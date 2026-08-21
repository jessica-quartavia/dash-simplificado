/**
 * Handler HTTP — Acionamentos (Business Data, read-only).
 */
import { requireCorporateAuth } from "../auth.mjs";
import { computeSupportPayload } from "./support.mjs";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function extractBearerToken(request) {
  const header =
    request?.headers?.get?.("authorization")
    || request?.headers?.get?.("Authorization")
    || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export async function handleSupportRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  if (denied) {
    console.info(`[support] status=${denied.status} total=${Date.now() - startedAt}ms`);
    return denied;
  }
  try {
    const compute = deps.computeSupportPayload || computeSupportPayload;
    const accessToken = extractBearerToken(request);
    const payload = await compute({ accessToken, allowN8nFallback: true });
    if (payload?.source === "unavailable") {
      return json(503, { error: payload.summary?.note || "Fonte indisponível.", code: "config" });
    }
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    console.info(`[support] status=200 total=${Date.now() - startedAt}ms tickets=${payload?.summary?.totalTickets ?? 0}`);
    return json(200, payload);
  } catch (error) {
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
    console.error("[Data] support failed:", error instanceof Error ? error.message : error);
    return json(status, {
      error: "Não foi possível consultar os acionamentos.",
      code: error?.code || "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
