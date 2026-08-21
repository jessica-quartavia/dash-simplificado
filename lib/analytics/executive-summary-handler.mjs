/**
 * Handler HTTP — Resumo Executivo.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import {
  computeExecutiveSummaryPayload,
  toPublicExecutiveSummaryPayload,
} from "./executive-summary.mjs";
import { defaultExecutiveSummaryFilters } from "./executive-summary-filters.mjs";
import { DEFAULT_STATUS_FILTER } from "./general-filters.mjs";
import { normalizeProgramFilter } from "./filters/program.mjs";

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function filtersFromRequest(request) {
  const url = new URL(request.url || "/", "http://localhost");
  return {
    search: url.searchParams.get("search") || "",
    program: normalizeProgramFilter(url.searchParams.get("program") || "all"),
    engineer: url.searchParams.get("engineer") || "all",
    segment: url.searchParams.get("segment") || "all",
    status: url.searchParams.get("status") || DEFAULT_STATUS_FILTER,
  };
}

export async function handleExecutiveSummaryRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  if (denied) {
    console.info(`[executive-summary] status=${denied.status} total=${Date.now() - startedAt}ms`);
    return denied;
  }

  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) return json(503, { error: configError, code: "config" });

  try {
    const url = new URL(request.url || "/", "http://localhost");
    const filters = filtersFromRequest(request);
    const force =
      url.searchParams.get("force") === "1" ||
      url.searchParams.get("refresh") === "1" ||
      request.headers?.get("x-force-refresh") === "1";
    const compute = deps.computeExecutiveSummaryPayload || computeExecutiveSummaryPayload;
    const payload = await compute(filters, deps, { force });
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const publicPayload = (deps.toPublicExecutiveSummaryPayload || toPublicExecutiveSummaryPayload)(payload);
    console.info(
      `[executive-summary] status=200 total=${Date.now() - startedAt}ms domains=${Object.keys(payload.performance?.domains || {}).length}`,
    );
    return json(200, publicPayload);
  } catch (error) {
    if (error?.code === "config") return json(503, { error: error.message, code: "config" });
    console.error("[Data] executive-summary failed:", error instanceof Error ? error.message : error);
    return json(500, {
      error: "Não foi possível consolidar o resumo executivo.",
      code: "executive_summary_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export { defaultExecutiveSummaryFilters };
