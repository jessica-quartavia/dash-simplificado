/**
 * POST /api/analytics/snapshot/refresh — calcula e persiste.
 * GET nunca deve chamar este handler.
 */
import { getRequestAccessToken, redactSecrets, requireCorporateAuth } from "../auth.mjs";
import { analyticsCatalogConfigurationError } from "../env.mjs";
import { fetchMetricCatalogRows } from "../data/analytics-catalog-rest.mjs";
import { buildMetricSnapshots } from "./snapshot/metric-snapshot-builder.mjs";
import { analyticsSnapshotStore } from "./snapshot/metric-snapshot-store.mjs";

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handleMetricSnapshotRefreshRequest(request, deps = {}) {
  const startedAt = Date.now();
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  if (denied) return denied;

  const method = request?.method || "GET";
  if (method !== "POST") {
    return json(405, { error: "Use POST para atualizar o snapshot.", code: "METHOD_NOT_ALLOWED" });
  }

  const configError = (deps.analyticsCatalogConfigurationError || analyticsCatalogConfigurationError)();
  if (configError) return json(503, { error: configError, code: "config" });

  try {
    const accessToken = getRequestAccessToken(request);
    const fetchCatalog = deps.fetchMetricCatalogRows || fetchMetricCatalogRows;
    const { rows: catalogRows } = await fetchCatalog({ validated: true, accessToken });
    const build = deps.buildMetricSnapshots || buildMetricSnapshots;
    const result = await build({ catalogRows, computes: deps.computes });
    const persistable = result.snapshots || [];
    let persist = { persisted: 0, skipped_errors: 0, queryMs: 0 };
    const store = deps.store || analyticsSnapshotStore;
    try {
      persist = await store.upsert(persistable, { accessToken });
    } catch (error) {
      if (error?.code === "snapshot_table_missing") {
        return json(503, {
          error: "Tabela analytics.metric_snapshot ainda não está disponível no Business Data.",
          code: "snapshot_table_missing",
          detail: redactSecrets(error.message),
          calculated: persistable.length,
          expected_total: result.expected_total,
        });
      }
      throw error;
    }

    const body = JSON.stringify(result.snapshots || []);
    return json(200, {
      generated_at: result.generated_at,
      calculation_version: result.calculation_version,
      expected_total: result.expected_total,
      calculated: persistable.length,
      persisted: persist.persisted,
      skipped_errors: persist.skipped_errors,
      counts: result.counts,
      page_errors: result.page_errors,
      comparison: result.comparison,
      timings: { ...result.timings, persist_ms: persist.queryMs, total_ms: Date.now() - startedAt },
      bytes: Buffer.byteLength(body),
    });
  } catch (error) {
    if (error?.code === "missing_snapshot_extractor") {
      return json(422, {
        error: error.message,
        code: "missing_snapshot_extractor",
        missing: error.missing || [],
      });
    }
    console.error("[snapshot-refresh] failed:", redactSecrets(error instanceof Error ? error.message : error));
    return json(500, {
      error: "Não foi possível atualizar o snapshot analítico.",
      code: error?.code || "snapshot_refresh_failed",
      detail: redactSecrets(error instanceof Error ? error.message : String(error)),
    });
  }
}
