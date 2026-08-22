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

/** Page size por tabela — reduz requests PostgREST sem alterar regras analíticas. */
export const TABLE_PAGE_SIZES = {
  clients: 5000,
  client_meetings: 5000,
  meeting_attendance: 5000,
  client_financial_data: 5000,
  client_journeys: 5000,
  manual_meetings: 2000,
  client_mecanismos: 2000,
  nps_responses: 2000,
  csat_responses: 2000,
  cancellations: 1000,
  nps_sends: 1000,
  mecanismos: 1000,
  client_implementation_meeting_date: 1000,
  cancellation_statuses: 500,
};

const POSTGREST_RANGE_MAX = Number(runtimeEnv.DATA_REST_RANGE_MAX || 1000) || 1000;

export function resolveRestPageSize(table, override) {
  if (override != null && Number(override) > 0) return Number(override);
  const envOverride = Number(runtimeEnv.DATA_REST_PAGE_SIZE || 0);
  if (envOverride > 0) return envOverride;
  return TABLE_PAGE_SIZES[table] || DEFAULT_PAGE_SIZE;
}

/** Tamanho efetivo do header Range — respeita o teto do PostgREST (default 1000). */
export function resolveRestRangeSize(table, override) {
  return Math.min(resolveRestPageSize(table, override), POSTGREST_RANGE_MAX);
}

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
  const pageSize = resolveRestPageSize(table, opts?.pageSize);
  const rangeSize = resolveRestRangeSize(table, opts?.pageSize);
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
        Range: `${offset}-${offset + rangeSize - 1}`,
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
    if (!batch.length || batch.length < rangeSize) break;
    offset += batch.length;
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
