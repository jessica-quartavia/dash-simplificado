/**
 * GET /api/analytics/snapshot — lê o snapshot. Não recalcula. Não escreve.
 */
import { getRequestAccessToken, redactSecrets, requireCorporateAuth } from "../auth.mjs";
import { analyticsCatalogConfigurationError } from "../env.mjs";
import { analyticsSnapshotStore } from "./snapshot/metric-snapshot-store.mjs";

function json(status, body, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

export function parseSnapshotQuery(searchParams) {
  const params = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || "");
  return {
    pageId: String(params.get("page") || "").trim() || null,
    metricId: String(params.get("metric_id") || "").trim() || null,
  };
}

export function toPublicSnapshot(row) {
  return {
    metric_id: row.metric_id,
    page_id: row.page_id,
    scope_key: row.scope_key,
    scope: row.scope || {},
    value: row.value,
    numerator: row.numerator ?? null,
    denominator: row.denominator ?? null,
    coverage: row.coverage ?? null,
    sample_size: row.sample_size ?? null,
    calculation_status: row.calculation_status,
    warning: row.warning ?? null,
    generated_at: row.generated_at,
    calculation_version: row.calculation_version ?? null,
  };
}

export async function handleMetricSnapshotRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  const authMs = Date.now() - startedAt;
  if (denied) return denied;

  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido. Use POST /api/analytics/snapshot/refresh para recalcular.", code: "METHOD_NOT_ALLOWED" });
  }

  const configError = (deps.analyticsCatalogConfigurationError || analyticsCatalogConfigurationError)();
  if (configError) return json(503, { error: configError, code: "config" });

  const store = deps.store || analyticsSnapshotStore;

  try {
    const query = parseSnapshotQuery(new URL(request.url).searchParams);
    const { rows, queryMs } = await store.read({
      ...query,
      accessToken: getRequestAccessToken(request),
    });
    const payload = {
      generated_at: new Date().toISOString(),
      snapshots: (rows || []).map(toPublicSnapshot),
    };
    const body = JSON.stringify(payload);
    const totalMs = Date.now() - startedAt;
    console.info(
      `[snapshot] status=200 auth=${authMs}ms query=${queryMs ?? "—"}ms total=${totalMs}ms bytes=${Buffer.byteLength(body)} count=${payload.snapshots.length}`,
    );
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Server-Timing": `auth;dur=${authMs}, db;dur=${queryMs ?? 0}, total;dur=${totalMs}`,
      },
    });
  } catch (error) {
    const code = error?.code || "snapshot_query_failed";
    const status = code === "snapshot_table_missing" ? 503 : 500;
    console.error("[snapshot] failed:", redactSecrets(error instanceof Error ? error.message : error));
    return json(status, {
      error: "Não foi possível ler o snapshot analítico.",
      code,
      detail: redactSecrets(error instanceof Error ? error.message : String(error)),
    });
  }
}
