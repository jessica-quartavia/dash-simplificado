/**
 * Camada única de leitura REST do App Pharus (backend only).
 * Fidelidade V1: PHARUS_SUPABASE_ANON_KEY, headers PostgREST, schema explícito por chamada.
 * Nunca usa JWT do Auth/Business Data.
 */
import { getPharusEnv, pharusConfigurationError as envPharusConfigurationError } from "../env.mjs";

export const PHARUS_DEFAULT_TIMEOUT_MS = 25_000;

const DEFAULT_PROBE_TABLES = [
  { schema: "core", table: "mechanisms", select: "id" },
  { schema: "core", table: "user_mechanisms", select: "id" },
  { schema: "core", table: "personal_info", select: "user_id" },
  { schema: "core", table: "pre_registrations", select: "user_id" },
  { schema: "metrics", table: "events", select: "id" },
];

function trimUrl(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

export function getPharusRestConfig() {
  const { url, anonKey, restKey } = getPharusEnv();
  if (!url) return { ok: false, error: "Configure PHARUS_SUPABASE_URL." };
  if (!restKey) return { ok: false, error: "Configure PHARUS_SUPABASE_ANON_KEY." };
  if (/service_role/i.test(anonKey)) {
    return { ok: false, error: "PHARUS_SUPABASE_ANON_KEY não pode ser service role." };
  }
  return {
    ok: true,
    url: trimUrl(url),
    restKey,
    authMode: "anon",
  };
}

export function pharusRestConfigurationError() {
  return envPharusConfigurationError();
}

function buildHeaders(restKey, schema, { countExact = false, head = false } = {}) {
  const headers = {
    apikey: restKey,
    Authorization: `Bearer ${restKey}`,
    Accept: "application/json",
    "Accept-Profile": schema,
    "Content-Profile": schema,
  };
  if (countExact) headers.Prefer = head ? "count=exact" : "count=exact";
  if (head) {
    headers.Range = "0-0";
    headers.Prefer = "count=exact";
  }
  return headers;
}

function parsePostgrestBody(text) {
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : (data == null ? [] : [data]);
  } catch {
    return [];
  }
}

function parsePostgrestError(text) {
  try {
    const parsed = JSON.parse(text || "{}");
    return {
      code: parsed.code || null,
      message: parsed.message || null,
      details: parsed.details || null,
      hint: parsed.hint || null,
    };
  } catch {
    return { code: null, message: (text || "").slice(0, 240) || null, details: null, hint: null };
  }
}

/**
 * GET read-only contra PostgREST do App Pharus.
 * @param {string} table
 * @param {{ schema?: string, select?: string, filters?: object, limit?: number|null, offset?: number|null, countExact?: boolean, head?: boolean, timeoutMs?: number }} opts
 */
export async function pharusRestFetch(
  table,
  {
    schema = "core",
    select = "*",
    filters = {},
    limit = null,
    offset = null,
    countExact = false,
    head = false,
    timeoutMs = PHARUS_DEFAULT_TIMEOUT_MS,
  } = {},
) {
  const cfg = getPharusRestConfig();
  if (!cfg.ok) {
    const err = new Error(cfg.error);
    err.code = "pharus_config";
    throw err;
  }

  const endpoint = new URL(`/rest/v1/${table}`, cfg.url);
  endpoint.searchParams.set("select", select);
  for (const [key, value] of Object.entries(filters || {})) {
    if (value == null || value === "") continue;
    endpoint.searchParams.set(key, String(value));
  }
  if (limit != null) endpoint.searchParams.set("limit", String(limit));
  if (offset != null) endpoint.searchParams.set("offset", String(offset));

  const headers = buildHeaders(cfg.restKey, schema, { countExact, head });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(endpoint, { method: "GET", headers, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const err = new Error(`${schema}.${table}: timeout após ${timeoutMs}ms`);
      err.code = "pharus_timeout";
      err.status = 504;
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await response.text().catch(() => "");
  const meta = parsePostgrestError(bodyText);
  const contentRange = response.headers.get("content-range") || "";
  const totalMatch = contentRange.match(/\/(\d+|\*)\s*$/);
  const total = totalMatch && totalMatch[1] !== "*" ? Number(totalMatch[1]) : null;

  return {
    ok: response.ok,
    status: response.status,
    data: head ? [] : parsePostgrestBody(bodyText),
    raw: bodyText,
    total,
    schema,
    table,
    postgrest: meta,
  };
}

export async function pharusRestFetchAll(
  table,
  select = "*",
  { schema = "core", filters = {}, pageSize = 1000, maxRows = 200_000, timeoutMs = PHARUS_DEFAULT_TIMEOUT_MS } = {},
) {
  const rows = [];
  let offset = 0;
  while (offset < maxRows) {
    const page = await pharusRestFetch(table, {
      schema,
      select,
      filters,
      limit: pageSize,
      offset,
      countExact: offset === 0,
      timeoutMs,
    });
    if (!page.ok) {
      const err = new Error(`${schema}.${table}: HTTP ${page.status} ${page.postgrest?.message || ""}`.trim());
      err.status = page.status;
      err.code = page.postgrest?.code || "pharus_rest_error";
      err.postgrest = page.postgrest;
      err.raw = (page.raw || "").slice(0, 240);
      throw err;
    }
    rows.push(...page.data);
    if (page.data.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

/** Alias explícito pedido no diagnóstico. */
export async function pharusFetch({ schema, table, path, select = "*", filters = {}, limit = null, offset = null, countExact = false, head = false, timeoutMs = PHARUS_DEFAULT_TIMEOUT_MS } = {}) {
  const targetTable = table || path;
  if (!targetTable) {
    const err = new Error("pharusFetch exige table ou path.");
    err.code = "pharus_config";
    throw err;
  }
  if (!schema) {
    const err = new Error("pharusFetch exige schema explícito.");
    err.code = "pharus_config";
    throw err;
  }
  return pharusRestFetch(targetTable, { schema, select, filters, limit, offset, countExact, head, timeoutMs });
}

/**
 * Diagnóstico read-only — não loga anon key.
 */
export async function probePharusAccess(tables = DEFAULT_PROBE_TABLES) {
  const cfg = getPharusRestConfig();
  if (!cfg.ok) {
    return {
      ok: false,
      configured: false,
      error: cfg.error,
      tables: [],
    };
  }

  const results = [];
  for (const target of tables) {
    try {
      const page = await pharusRestFetch(target.table, {
        schema: target.schema,
        select: target.select || "id",
        limit: 1,
        countExact: true,
        head: false,
      });
      results.push({
        schema: target.schema,
        table: target.table,
        httpStatus: page.status,
        accessible: page.ok,
        rowSample: page.ok ? page.data.length : 0,
        total: page.total,
        postgrestCode: page.postgrest?.code || null,
        message: page.ok ? null : page.postgrest?.message || `HTTP ${page.status}`,
      });
    } catch (error) {
      results.push({
        schema: target.schema,
        table: target.table,
        httpStatus: error.status || 0,
        accessible: false,
        rowSample: 0,
        total: null,
        postgrestCode: error.code || null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: results.some((r) => r.accessible),
    configured: true,
    urlHost: (() => {
      try {
        return new URL(cfg.url).host;
      } catch {
        return null;
      }
    })(),
    authMode: cfg.authMode || "anon",
    tables: results,
  };
}

/** Compatibilidade com código legado que usa getPharusSupabaseClient() — fidelidade V1. */
export function createPharusRestClient(options = {}) {
  const env = getPharusEnv();
  const schema = (options.schema || env.schema || "public").trim() || "public";
  return {
    url: env.url,
    projectId: env.projectId,
    schema,
    rest: (table, opts = {}) => pharusRestFetch(table, { ...opts, schema: opts.schema || schema }),
    fetchAll: (table, select = "*", opts = {}) =>
      pharusRestFetchAll(table, select, { ...opts, schema: opts.schema || schema }),
  };
}
