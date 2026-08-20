/**
 * GET /api/analytics/catalog — metadados do catálogo no Business Data.
 * Não consulta a BASE QV. Não escreve no catálogo.
 */
import { getRequestAccessToken, redactSecrets, requireCorporateAuth } from "../auth.mjs";
import { analyticsCatalogConfigurationError } from "../env.mjs";
import { fetchMetricCatalogRows } from "../data/analytics-catalog-rest.mjs";
import { buildCatalogResponse, parseCatalogQuery } from "./metric-catalog.mjs";

function json(status, body, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

export async function handleMetricCatalogRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";

  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  const authMs = Date.now() - startedAt;
  if (denied) {
    console.info(`[catalog] status=${denied.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return denied;
  }

  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  const configError = (deps.analyticsCatalogConfigurationError || analyticsCatalogConfigurationError)();
  if (configError) {
    console.info(`[catalog] status=503 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return json(503, { error: configError, code: "config" });
  }

  try {
    const url = new URL(request.url);
    const query = parseCatalogQuery(url.searchParams);
    const fetchRows = deps.fetchMetricCatalogRows || fetchMetricCatalogRows;
    const { rows, queryMs } = await fetchRows({
      ...query,
      accessToken: getRequestAccessToken(request),
    });
    const totalMs = Date.now() - startedAt;
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Server-Timing": `auth;dur=${authMs}, db;dur=${queryMs ?? 0}, total;dur=${totalMs}`,
        },
      });
    }
    const payload = buildCatalogResponse(rows);
    const body = JSON.stringify(payload);
    console.info(
      `[catalog] status=200 auth=${authMs}ms query=${queryMs ?? "—"}ms total=${totalMs}ms bytes=${Buffer.byteLength(body)} count=${payload.metrics.length}`,
    );
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Server-Timing": `auth;dur=${authMs}, db;dur=${queryMs ?? 0}, total;dur=${totalMs}`,
      },
    });
  } catch (error) {
    console.error("[catalog] failed:", redactSecrets(error instanceof Error ? error.message : error));
    console.info(`[catalog] status=500 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return json(500, {
      error: "Não foi possível ler o catálogo analítico.",
      code: "catalog_query_failed",
      detail: redactSecrets(error instanceof Error ? error.message : String(error)),
    });
  }
}
