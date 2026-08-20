/**
 * Leitura e UPSERT de Business Data.analytics.metric_snapshot.
 * apikey = AUTH_SUPABASE_ANON_KEY; Authorization = JWT da sessão.
 * Recusa BASE QV. Não apaga último valor válido em caso de erro.
 */
import { buildAnalyticsRestHeaders } from "../../data/analytics-rest.mjs";

const TABLE = "metric_snapshot";
const WRITABLE_STATUSES = new Set(["ok", "partial", "unavailable"]);
const PUBLIC_SELECT = [
  "metric_id",
  "page_id",
  "scope_key",
  "scope",
  "value",
  "numerator",
  "denominator",
  "coverage",
  "sample_size",
  "calculation_status",
  "warning",
  "generated_at",
  "calculation_version",
].join(",");

export function persistableSnapshotRows(rows) {
  return (rows || []).filter((row) => WRITABLE_STATUSES.has(row?.calculation_status));
}

export function skippedErrorSnapshotRows(rows) {
  return (rows || []).filter((row) => row?.calculation_status === "error");
}

function snapshotBody(row) {
  return {
    metric_id: row.metric_id,
    page_id: row.page_id,
    scope_key: row.scope_key,
    scope: row.scope,
    value: row.value,
    numerator: row.numerator,
    denominator: row.denominator,
    coverage: row.coverage,
    sample_size: row.sample_size,
    calculation_status: row.calculation_status,
    warning: row.warning,
    metadata: row.metadata || {},
    generated_at: row.generated_at,
    expires_at: row.expires_at,
    calculation_version: row.calculation_version,
  };
}

export const analyticsSnapshotStore = {
  async read({ pageId = null, metricId = null, accessToken } = {}) {
    const { url, headers } = buildAnalyticsRestHeaders({ accessToken, write: false });
    const started = Date.now();
    const rows = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const endpoint = new URL(`/rest/v1/${TABLE}`, url);
      endpoint.searchParams.set("select", PUBLIC_SELECT);
      endpoint.searchParams.set("order", "page_id.asc,metric_id.asc");
      if (pageId) endpoint.searchParams.set("page_id", `eq.${pageId}`);
      if (metricId) endpoint.searchParams.set("metric_id", `eq.${metricId}`);
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          ...headers,
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      });
      if (!response.ok) {
        const detail = await response.text();
        const error = new Error(`metric_snapshot: HTTP ${response.status} ${detail.slice(0, 240)}`);
        error.status = response.status;
        error.code = response.status === 404 || /PGRST205|PGRST106|does not exist/i.test(detail)
          ? "snapshot_table_missing"
          : "snapshot_query_failed";
        throw error;
      }
      const batch = await response.json();
      if (!Array.isArray(batch)) throw new Error("metric_snapshot: resposta REST inválida.");
      rows.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
      if (offset > 20_000) break;
    }
    return { rows, queryMs: Date.now() - started };
  },

  /**
   * UPSERT em (metric_id, scope_key) com a sessão autenticada.
   * Ignora status=error para não sobrescrever o último snapshot válido.
   * Não implementa DELETE.
   */
  async upsert(rows, { accessToken } = {}) {
    const skipped = skippedErrorSnapshotRows(rows);
    const payload = persistableSnapshotRows(rows);
    if (!payload.length) {
      return { persisted: 0, skipped_errors: skipped.length, queryMs: 0 };
    }
    const { url, headers } = buildAnalyticsRestHeaders({ accessToken, write: true });
    const started = Date.now();
    const endpoint = new URL(`/rest/v1/${TABLE}`, url);
    endpoint.searchParams.set("on_conflict", "metric_id,scope_key");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(payload.map(snapshotBody)),
    });
    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`metric_snapshot upsert: HTTP ${response.status} ${detail.slice(0, 240)}`);
      error.status = response.status;
      error.code = /PGRST205|PGRST106|does not exist|schema must be/i.test(detail)
        ? "snapshot_table_missing"
        : "snapshot_upsert_failed";
      throw error;
    }
    return {
      persisted: payload.length,
      skipped_errors: skipped.length,
      queryMs: Date.now() - started,
    };
  },
};
