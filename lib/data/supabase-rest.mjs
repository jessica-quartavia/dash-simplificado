/**
 * Cliente REST somente leitura da BASE QV (PostgREST GET).
 *
 * Permite apenas SELECT paginado. Não implementa INSERT, UPDATE, DELETE,
 * UPSERT, RPC, DDL, RLS, policies, triggers nem grants.
 */
import { getDataEnv } from "../env.mjs";

const MAX_OFFSET = 200_000;
const runtimeEnv = typeof process !== "undefined" && process.env ? process.env : {};
const DEFAULT_PAGE_SIZE = Number(runtimeEnv.DATA_REST_PAGE_SIZE || 1000) || 1000;

function assertReadOnlyTable(table) {
  const name = String(table || "").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error("Nome de tabela inválido para leitura.");
  }
  return name;
}

/**
 * GET paginado em /rest/v1/{table} — implementação raw (sem dedup).
 */
export async function fetchAllRowsImpl(opts) {
  const table = assertReadOnlyTable(opts?.table);
  const select = String(opts?.select || "*");
  const pageSize = opts?.pageSize || DEFAULT_PAGE_SIZE;
  const dataEnv = getDataEnv();
  const url = String(opts?.url || dataEnv.url || "").replace(/\/$/, "");
  const restKey = String(opts?.restKey || dataEnv.serviceRoleKey || "").trim();
  const schema = String(opts?.schema || "public").trim() || "public";
  const maxOffset = opts?.maxOffset || MAX_OFFSET;
  if (!url || !restKey) {
    throw new Error("Configure DATA_SUPABASE_URL e DATA_SUPABASE_SERVICE_ROLE_KEY.");
  }

  const rows = [];
  let offset = 0;
  const order = opts?.order === null ? null : opts?.order || "id.asc";

  while (true) {
    const endpoint = new URL(`/rest/v1/${table}`, url);
    endpoint.searchParams.set("select", select);
    if (order) endpoint.searchParams.set("order", order);
    if (opts?.filters) {
      for (const [key, value] of Object.entries(opts.filters)) {
        endpoint.searchParams.set(key, value);
      }
    }

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: restKey,
        Authorization: `Bearer ${restKey}`,
        Accept: "application/json",
        "Accept-Profile": schema,
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${table}: HTTP ${response.status} ${detail.slice(0, 200)}`);
    }

    const batch = await response.json();
    if (!Array.isArray(batch)) {
      throw new Error(`${table}: resposta REST inválida.`);
    }
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (offset > maxOffset) break;
  }

  return rows;
}

/**
 * GET paginado — usa AnalyticsDataContext quando ativo na request.
 */
export async function fetchAllRows(opts) {
  try {
    const { getAnalyticsDataContext } = await import("../analytics/analytics-data-context.mjs");
    const ctx = getAnalyticsDataContext();
    if (ctx) return ctx.fetchAllRows(opts);
  } catch {
    // contexto indisponível — fallback raw
  }
  return fetchAllRowsImpl(opts);
}
