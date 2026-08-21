/**
 * Handler HTTP de Implementação de Mecanismos.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import { clearExecutiveSummaryCache } from "./executive-summary.mjs";
import { computeMechanismsPayload, toPublicMechanismsPayload } from "./mechanisms.mjs";

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedPayload = null;
let cachedAt = 0;

export function clearMechanismsHandlerCache() {
  cachedPayload = null;
  cachedAt = 0;
}

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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
    console.info(`[mechanisms] status=503 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return json(503, { error: configError, code: "config" });
  }

  try {
    const url = new URL(request.url || "/", "http://localhost");
    const force = url.searchParams.get("force") === "1";
    const compute = deps.computeMechanismsPayload || computeMechanismsPayload;
    const now = Date.now();
    if (force) {
      clearMechanismsHandlerCache();
      clearExecutiveSummaryCache();
    }
    if (!force && cachedPayload && now - cachedAt < CACHE_TTL_MS) {
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
      }
      return json(200, toPublicMechanismsPayload(cachedPayload));
    }
    const payload = await compute();
    const pharusPartial = payload?.metadata?.status === "partial" || payload?.metadata?.pharusConsulted === false;
    if (!pharusPartial) {
      cachedPayload = payload;
      cachedAt = now;
    } else {
      cachedPayload = null;
      cachedAt = 0;
    }
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const publicPayload = toPublicMechanismsPayload(payload);
    const timing = payload?.timing || {};
    console.info(
      `[mechanisms] status=200 auth=${authMs}ms qv=${timing.baseQvMs ?? timing.totalMs ?? "—"}ms pharus=${timing.pharusConsulted ? `${timing.pharusMs}ms` : "não"} transform=${timing.transformMs ?? "—"}ms total=${Date.now() - startedAt}ms`,
    );
    return json(200, publicPayload);
  } catch (error) {
    if (error?.code === "config") {
      return json(503, { error: error.message, code: "config" });
    }
    console.error("[Data] mechanisms failed:", error instanceof Error ? error.message : error);
    console.info(`[mechanisms] status=500 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return json(500, {
      error: "Não foi possível consultar os mecanismos.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
