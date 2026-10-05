/**
 * Handler HTTP — Gargalos da Jornada (Owner + Produto).
 */
import { dataConfigurationError } from "../env.mjs";
import { requirePageAccess, resolveRequestAccess } from "../access/require-page-access.mjs";
import { perfDebugFromRequest } from "./analytics-data-context.mjs";
import { computeWithPageCache, parseForceRefresh } from "./handler-cache.mjs";
import {
  computeInternalJourneyBottlenecksPayload,
  parseInternalJourneyBottlenecksFilters,
  toPublicInternalJourneyBottlenecksPayload,
} from "./internal-journey-bottlenecks.mjs";
import { CALCULATION_VERSION } from "../cache/analytics-cache.mjs";
import { IJB_CALCULATION_VERSION, IJB_PAYLOAD_SCHEMA } from "./internal-journey-bottlenecks.mjs";

const PAGE_ID = "internal_journey_bottlenecks";

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleInternalJourneyBottlenecksRequest(request, deps = {}) {
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  const gate = deps.requirePageAccess || requirePageAccess;
  const denied = await gate(request, PAGE_ID, deps);
  if (denied) return denied;

  const resolveAccess = deps.resolveRequestAccess || resolveRequestAccess;
  const resolved = await resolveAccess(request, deps);
  if (resolved.error) return resolved.error;

  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) {
    return json(503, { error: configError, code: "config" });
  }

  try {
    const url = new URL(request.url || "/", "http://localhost");
    const parseFilters = deps.parseInternalJourneyBottlenecksFilters || parseInternalJourneyBottlenecksFilters;
    const filters = parseFilters(url.searchParams);
    const compute = deps.computeInternalJourneyBottlenecksPayload || computeInternalJourneyBottlenecksPayload;
    const force = parseForceRefresh(request);

    const { payload, cache } = await computeWithPageCache(
      PAGE_ID,
      () =>
        compute({
          filters,
          perfDebug: perfDebugFromRequest(request),
        }),
      {
        request,
        filters,
        force,
        cacheExtra: { ijb_calc: IJB_CALCULATION_VERSION, ijb_schema: IJB_PAYLOAD_SCHEMA },
      },
    );

    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const publicPayload = toPublicInternalJourneyBottlenecksPayload(payload);
    return json(200, {
      ok: true,
      page: PAGE_ID,
      calculationVersion: IJB_CALCULATION_VERSION,
      payload: publicPayload,
      cache: cache.status,
    });
  } catch (error) {
    console.error("[IJB] failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível carregar Gargalos da Jornada.",
      code: "compute_failed",
    });
  }
}
