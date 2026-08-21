/**
 * Lazy detail — Indicadores Temporais (matriz mensal clients).
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import { computeTemporalIndicatorsPayload } from "./temporal-indicators.mjs";
import { perfDebugFromRequest } from "./analytics-data-context.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";

const TEMPORAL_MONTHLY_PUBLIC_FIELDS = [
  "subjectId",
  "month",
  "source",
  "program",
  "cancellationDate",
  "monthsToCancellation",
  "logins",
  "meetings",
  "implementations",
  "financialUpdates",
  "npsResponses",
  "npsAverage",
  "daysWithoutActivity",
  "patrimony",
];

function slimTemporalMonthlyRow(row) {
  if (!row || typeof row !== "object") return row;
  const slim = {};
  for (const key of TEMPORAL_MONTHLY_PUBLIC_FIELDS) {
    if (row[key] !== undefined) slim[key] = row[key];
  }
  return slim;
}

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleTemporalIndicatorsDetailsRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  if (denied) {
    console.info(`[temporal-indicators-details] status=${denied.status} auth=${Date.now() - startedAt}ms`);
    return denied;
  }
  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) return json(503, { error: configError, code: "config" });
  try {
    const force = parseForceRefresh(request);
    const compute = deps.computeTemporalIndicatorsPayload || computeTemporalIndicatorsPayload;
    const { payload } = await computeWithPageCache(
      "temporal_indicators",
      () => compute({ perfDebug: perfDebugFromRequest(request) }),
      { request, force },
    );
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const clients = (payload.clients || []).map(slimTemporalMonthlyRow);
    console.info(`[temporal-indicators-details] status=200 rows=${clients.length} total=${Date.now() - startedAt}ms`);
    return json(200, { clients });
  } catch (error) {
    if (error?.code === "config") return json(503, { error: error.message, code: "config" });
    console.error("[Data] temporal-indicators-details failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consultar detalhes temporais.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
