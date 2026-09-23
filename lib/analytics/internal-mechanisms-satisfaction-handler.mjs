/**
 * Handler HTTP — Análise interna Mecanisms × Satisfação (Owner-only).
 */
import { dataConfigurationError } from "../env.mjs";
import { requirePageAccess, resolveRequestAccess } from "../access/require-page-access.mjs";
import { perfDebugFromRequest } from "./analytics-data-context.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";
import {
  computeInternalMechanismsSatisfactionPayload,
  parseInternalMechanismsSatisfactionFilters,
  toPublicInternalMechanismsSatisfactionPayload,
} from "./internal-mechanisms-satisfaction.mjs";

const PAGE_ID = "internal_mechanisms_satisfaction";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function envFlag(name) {
  return String(process.env[name] || "").trim() ? "present" : "missing";
}

function logImsEnvAudit() {
  console.info(
    `[IMS] env DATA_SUPABASE_URL=${envFlag("DATA_SUPABASE_URL")} DATA_SUPABASE_SERVICE_ROLE_KEY=${envFlag("DATA_SUPABASE_SERVICE_ROLE_KEY")} AUTH_SUPABASE_URL=${envFlag("AUTH_SUPABASE_URL")} AUTH_SUPABASE_ANON_KEY=${envFlag("AUTH_SUPABASE_ANON_KEY")} BUSINESS_DATA_SUPABASE_URL=${envFlag("BUSINESS_DATA_SUPABASE_URL")} PHARUS_SUPABASE_URL=${envFlag("PHARUS_SUPABASE_URL")} PHARUS_SUPABASE_ANON_KEY=${envFlag("PHARUS_SUPABASE_ANON_KEY")}`,
  );
}

function devLog(message, extra = {}) {
  const parts = Object.entries(extra)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${v}`);
  console.info(`[InternalAnalysis] ${message}${parts.length ? ` ${parts.join(" ")}` : ""}`);
}

export async function handleInternalMechanismsSatisfactionRequest(request, deps = {}) {
  const startedAt = Date.now();
  console.info("[IMS] start");
  logImsEnvAudit();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  const gate = deps.requirePageAccess || requirePageAccess;
  const denied = await gate(request, PAGE_ID, deps);
  if (denied) {
    devLog("auth=denied", { status: denied.status, ms: Date.now() - startedAt });
    return denied;
  }

  const resolveAccess = deps.resolveRequestAccess || resolveRequestAccess;
  const resolved = await resolveAccess(request, deps);
  if (resolved.error) {
    devLog("auth=failed", { ms: Date.now() - startedAt });
    return resolved.error;
  }
  devLog("auth=true", { owner: resolved.access?.isOwner === true, page: "mechanisms_satisfaction" });
  console.info(`[IMS] owner=${resolved.access?.isOwner === true}`);

  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) {
    console.info(`[IMS] error stage=config code=503 message=${configError}`);
    return json(503, { error: configError, code: "config" });
  }

  try {
    const url = new URL(request.url || "/", "http://localhost");
    const parseFilters = deps.parseInternalMechanismsSatisfactionFilters || parseInternalMechanismsSatisfactionFilters;
    const filters = parseFilters(url.searchParams);
    const includeDetail = url.searchParams.get("detail") === "1";
    const detailPage = url.searchParams.get("detailPage") || 1;
    const detailPageSize = url.searchParams.get("detailPageSize") || 25;
    const compute = deps.computeInternalMechanismsSatisfactionPayload || computeInternalMechanismsSatisfactionPayload;
    const force = parseForceRefresh(request);

    devLog("compute start", { detail: includeDetail, force: force ? "1" : "0" });
    console.info("[IMS] compute start");
    const computeStarted = Date.now();
    const { payload, cache } = await computeWithPageCache(
      PAGE_ID,
      () =>
        compute({
          filters,
          includeDetail,
          detailPage,
          detailPageSize,
          detailSort: url.searchParams.get("detailSort") || "npsScore",
          detailSortDir: url.searchParams.get("detailSortDir") || "desc",
          perfDebug: perfDebugFromRequest(request),
        }),
      { request, filters: { ...filters, includeDetail }, force },
    );
    devLog("compute end", {
      ms: Date.now() - computeStarted,
      clients: payload?.summary?.clientsAnalyzed ?? null,
      cache: cache.status,
    });

    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const publicPayload = toPublicInternalMechanismsSatisfactionPayload(payload);
    const responseBytes = JSON.stringify(publicPayload).length;
    const totalMs = Date.now() - startedAt;
    console.info(
      `[IMS] compute complete clientsWithNps=${payload?.summary?.clientsWithNps ?? "—"} response_bytes=${responseBytes} total_ms=${totalMs} cache=${cache.status}`,
    );
    console.info(
      `[internal-mechanisms-satisfaction] status=200 total=${totalMs}ms cache=${cache.status}`,
    );
    return json(200, publicPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error?.code === "config" ? "config" : "data_query_failed";
    console.info(`[IMS] error stage=compute code=${code} message=${message}`);
    devLog("error", { message });
    if (error?.code === "config") return json(503, { error: error.message, code: "config" });
    console.error("[Data] internal-mechanisms-satisfaction failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consultar a análise interna.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
