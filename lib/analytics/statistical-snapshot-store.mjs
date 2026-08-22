/**
 * Persistência analytics.statistical_client_features + snapshot_runs (Business Data).
 * Leitura/escrita: AUTH_SUPABASE_ANON_KEY + Bearer JWT (role authenticated + RLS).
 */
import { buildAnalyticsRestHeaders } from "../data/analytics-rest.mjs";
import { snapshotRowToClient } from "./statistical-snapshot.mjs";

const FEATURES_TABLE = "statistical_client_features";
const RUNS_TABLE = "statistical_snapshot_runs";
const PAGE_SIZE = 1000;

function requireAccessToken(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) {
    const error = new Error("Sessão autenticada necessária para ler/escrever snapshot estatístico.");
    error.code = "unauthenticated";
    throw error;
  }
  return token;
}

function isMissingTableError(status, detail = "") {
  return status === 404
    || /PGRST205|PGRST106|does not exist|schema must be/i.test(detail);
}

async function restGet(url, headers, params = {}) {
  const endpoint = new URL(`/rest/v1/${params.table}`, url);
  if (params.select) endpoint.searchParams.set("select", params.select);
  if (params.filters) {
    for (const [k, v] of Object.entries(params.filters)) endpoint.searchParams.set(k, v);
  }
  if (params.order) endpoint.searchParams.set("order", params.order);
  if (params.limit != null) endpoint.searchParams.set("limit", String(params.limit));
  const response = await fetch(endpoint, { method: "GET", headers });
  const detail = await response.text();
  if (!response.ok) {
    const error = new Error(`${params.table} GET: HTTP ${response.status} ${detail.slice(0, 240)}`);
    error.status = response.status;
    error.code = isMissingTableError(response.status, detail) ? "snapshot_table_missing" : "snapshot_read_failed";
    throw error;
  }
  return JSON.parse(detail || "[]");
}

async function restWrite(url, headers, { table, method, body, onConflict = null, prefer = "return=minimal" }) {
  const endpoint = new URL(`/rest/v1/${table}`, url);
  if (onConflict) endpoint.searchParams.set("on_conflict", onConflict);
  const response = await fetch(endpoint, {
    method,
    headers: {
      ...headers,
      Prefer: prefer,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const detail = await response.text();
  if (!response.ok) {
    const error = new Error(`${table} ${method}: HTTP ${response.status} ${detail.slice(0, 240)}`);
    error.status = response.status;
    error.code = isMissingTableError(response.status, detail) ? "snapshot_table_missing" : "snapshot_write_failed";
    throw error;
  }
  return detail ? JSON.parse(detail) : null;
}

export const statisticalSnapshotStore = {
  async readActiveRun({ accessToken } = {}) {
    const token = requireAccessToken(accessToken);
    const { url, headers } = buildAnalyticsRestHeaders({ accessToken: token, write: false });

    const runs = await restGet(url, headers, {
      table: RUNS_TABLE,
      select: "snapshot_version,calculation_version,client_count,feature_count,source_row_counts,rest_requests,rest_rows,snapshot_generated_at,status,is_active,nps_join",
      filters: { is_active: "eq.true", status: "eq.complete" },
      order: "snapshot_generated_at.desc",
      limit: 1,
    });
    return Array.isArray(runs) && runs.length ? runs[0] : null;
  },

  async loadActiveClientFeatures({ accessToken } = {}) {
    const meta = await this.readActiveRun({ accessToken });
    if (!meta?.snapshot_version) {
      const error = new Error("Nenhum snapshot ativo encontrado.");
      error.code = "snapshot_not_found";
      throw error;
    }

    const token = requireAccessToken(accessToken);
    const { url, headers } = buildAnalyticsRestHeaders({ accessToken: token, write: false });

    const clients = [];
    let offset = 0;
    while (true) {
      const endpoint = new URL(`/rest/v1/${FEATURES_TABLE}`, url);
      endpoint.searchParams.set("select", "client_id,features,snapshot_version,generated_at");
      endpoint.searchParams.set("snapshot_version", `eq.${meta.snapshot_version}`);
      endpoint.searchParams.set("order", "client_id.asc");
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { ...headers, Range: `${offset}-${offset + PAGE_SIZE - 1}` },
      });
      const detail = await response.text();
      if (!response.ok) {
        const error = new Error(`statistical_client_features GET: HTTP ${response.status} ${detail.slice(0, 240)}`);
        error.status = response.status;
        error.code = isMissingTableError(response.status, detail) ? "snapshot_table_missing" : "snapshot_read_failed";
        throw error;
      }
      const batch = JSON.parse(detail || "[]");
      if (!Array.isArray(batch)) throw new Error("Resposta inválida ao ler snapshot.");
      for (const row of batch) clients.push(snapshotRowToClient(row));
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (offset > 50_000) break;
    }

    return {
      meta: {
        ...meta,
        generated_at: meta.snapshot_generated_at,
      },
      clients,
    };
  },

  async tableExists({ accessToken } = {}) {
    try {
      const token = requireAccessToken(accessToken);
      const { url, headers } = buildAnalyticsRestHeaders({ accessToken: token, write: false });
      await restGet(url, headers, {
        table: RUNS_TABLE,
        select: "snapshot_version",
        limit: 1,
      });
      return true;
    } catch (error) {
      if (error.code === "snapshot_table_missing") return false;
      if (error.code === "unauthenticated") return false;
      throw error;
    }
  },

  /**
   * Refresh seguro: registrar run (building) → upsert features → validar → ativar versão.
   * JWT obrigatório. Não faz DELETE global.
   */
  async publishSnapshot({ rows, runMeta, accessToken }) {
    const token = requireAccessToken(accessToken);
    const { url, headers } = buildAnalyticsRestHeaders({ accessToken: token, write: true });
    const version = runMeta.snapshot_version;
    if (!version) throw new Error("snapshot_version obrigatório.");

    const buildingMeta = { ...runMeta, status: "building", is_active: false };
    await restWrite(url, headers, {
      table: RUNS_TABLE,
      method: "POST",
      body: [buildingMeta],
      onConflict: "snapshot_version",
      prefer: "resolution=merge-duplicates,return=minimal",
    });

    const batchSize = 200;
    let persisted = 0;
    try {
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        await restWrite(url, headers, {
          table: FEATURES_TABLE,
          method: "POST",
          body: chunk,
          onConflict: "snapshot_version,client_id",
          prefer: "resolution=merge-duplicates,return=minimal",
        });
        persisted += chunk.length;
      }
    } catch (error) {
      await this.markRunFailed({ accessToken: token, snapshotVersion: version }).catch(() => null);
      throw error;
    }

    if (persisted !== rows.length) {
      await this.markRunFailed({ accessToken: token, snapshotVersion: version }).catch(() => null);
      throw new Error(`Contagem divergente no upsert: esperado ${rows.length}, persistido ${persisted}`);
    }

    const endpointDeactivate = new URL(`/rest/v1/${RUNS_TABLE}`, url);
    endpointDeactivate.searchParams.set("is_active", "eq.true");
    await fetch(endpointDeactivate, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ is_active: false }),
    });

    const endpointActivate = new URL(`/rest/v1/${RUNS_TABLE}`, url);
    endpointActivate.searchParams.set("snapshot_version", `eq.${version}`);
    await fetch(endpointActivate, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "complete", is_active: true }),
    });

    return { persisted, snapshot_version: version };
  },

  async markRunFailed({ accessToken, snapshotVersion }) {
    const token = requireAccessToken(accessToken);
    const { url, headers } = buildAnalyticsRestHeaders({ accessToken: token, write: true });
    const endpoint = new URL(`/rest/v1/${RUNS_TABLE}`, url);
    endpoint.searchParams.set("snapshot_version", `eq.${snapshotVersion}`);
    await fetch(endpoint, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", is_active: false }),
    });
  },
};
