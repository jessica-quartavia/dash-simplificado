/**
 * Atendimento — operacional: research.acionamentos
 * Identificação: research.v_acionamentos_tratados
 * Qualidade: research.v_acionamentos_qualidade_email
 *
 * REST: Bearer da sessão + apikey anon + Accept-Profile: research.
 * Fallback: ponte n8n (Postgres) quando research não está exposto no PostgREST.
 */
import { dataConfigurationError } from "../env.mjs";
import { getAuthEnv } from "../env.mjs";
import { buildSupportAnalyticsPayload } from "./support-analytics.mjs";

const ACIONAMENTOS_TABLE = "acionamentos";
const TRATADOS_TABLE = "v_acionamentos_tratados";
const QUALIDADE_TABLE = "v_acionamentos_qualidade_email";

function getBusinessDataEnv() {
  const auth = getAuthEnv();
  const url = (
    process.env.BUSINESS_DATA_SUPABASE_URL
    || process.env.BUSINESS_SUPABASE_URL
    || auth.url
    || ""
  ).trim().replace(/\/$/, "");
  const anonKey = (
    process.env.BUSINESS_DATA_SUPABASE_ANON_KEY
    || auth.anonKey
    || ""
  ).trim();
  const schema = (process.env.BUSINESS_DATA_SUPABASE_SCHEMA || "research").trim() || "research";
  return { url, anonKey, schema, projectRef: projectRefFromUrl(url) };
}

function projectRefFromUrl(url) {
  try {
    return new URL(url).host.split(".")[0] || null;
  } catch {
    return null;
  }
}

function extractBearerToken(request) {
  const header =
    request?.headers?.get?.("authorization")
    || request?.headers?.get?.("Authorization")
    || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function businessDataConfigurationError() {
  const { url, anonKey } = getBusinessDataEnv();
  if (!url) return "Configure AUTH_SUPABASE_URL / BUSINESS_DATA_SUPABASE_URL.";
  if (!anonKey && !(process.env.N8N_SUPPORT_ACIONAMENTOS_WEBHOOK_URL || "").trim()) {
    return "Configure AUTH_SUPABASE_ANON_KEY (Business Data) para ler research.*.";
  }
  try {
    if (new URL(url).protocol !== "https:") return "URL do Business Data deve usar HTTPS";
  } catch {
    return "URL do Business Data inválida";
  }
  return null;
}

function parsePostgrestError(status, bodyText) {
  let code = null;
  let message = null;
  let details = null;
  let hint = null;
  try {
    const parsed = JSON.parse(bodyText || "{}");
    code = parsed.code || null;
    message = parsed.message || null;
    details = parsed.details || null;
    hint = parsed.hint || null;
  } catch {
    message = (bodyText || "").slice(0, 240) || null;
  }
  return { status, code, message, details, hint };
}

function logSupportRestFailure(context, meta) {
  console.error("[Support REST]", {
    project: context.projectRef,
    schema: context.schema,
    table: context.table,
    status: meta.status,
    code: meta.code,
    message: meta.message,
    details: meta.details,
    hint: meta.hint,
  });
}

async function restFetchTable({ accessToken, table, select = "*", offset = 0, limit = null }) {
  const { url, anonKey, schema, projectRef } = getBusinessDataEnv();
  if (!url || !anonKey) {
    const err = new Error("AUTH_SUPABASE_URL/ANON_KEY ausentes para Business Data.");
    err.code = "config";
    throw err;
  }
  if (!accessToken) {
    const err = new Error(`Token de sessão ausente para consultar research.${table}.`);
    err.status = 401;
    err.code = "unauthenticated";
    throw err;
  }

  const endpoint = new URL(`/rest/v1/${table}`, url);
  endpoint.searchParams.set("select", select);
  if (limit != null) endpoint.searchParams.set("limit", String(limit));

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    "Accept-Profile": schema,
    "Content-Profile": schema,
  };
  if (limit == null) {
    const pageSize = 1000;
    headers.Range = `${offset}-${offset + pageSize - 1}`;
  }

  const response = await fetch(endpoint, { headers });
  const bodyText = await response.text().catch(() => "");
  const meta = parsePostgrestError(response.status, bodyText);
  if (!response.ok) {
    logSupportRestFailure({ projectRef, schema, table }, meta);
    const err = new Error(meta.message || `research.${table}: HTTP ${response.status}`);
    err.status = response.status;
    err.code = meta.code;
    err.details = meta.details;
    err.hint = meta.hint;
    err.postgrest = meta;
    err.projectRef = projectRef;
    err.schema = schema;
    err.table = table;
    throw err;
  }

  let rows = [];
  try {
    rows = bodyText ? JSON.parse(bodyText) : [];
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows)) rows = rows && typeof rows === "object" ? [rows] : [];
  return { rows, projectRef, schema };
}

async function fetchAllTableRest(accessToken, table) {
  const pageSize = 1000;
  let offset = 0;
  const rows = [];
  while (true) {
    const { rows: batch } = await restFetchTable({
      accessToken,
      table,
      select: "*",
      offset,
    });
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (offset > 200000) break;
  }
  return rows;
}

async function fetchQualidadeRest(accessToken) {
  const { rows } = await restFetchTable({
    accessToken,
    table: QUALIDADE_TABLE,
    select: "*",
    limit: 1,
  });
  return rows[0] || null;
}

async function fetchViaN8nWebhook() {
  const webhook = (process.env.N8N_SUPPORT_ACIONAMENTOS_WEBHOOK_URL || "").trim();
  if (!webhook) return null;
  const token = (process.env.N8N_INTERNAL_API_TOKEN || "").trim();
  const response = await fetch(webhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": token,
    },
    body: JSON.stringify({
      source: "portal-support",
      views: ["acionamentos", "v_acionamentos_tratados", "v_acionamentos_qualidade_email"],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Webhook acionamentos: HTTP ${response.status} ${detail.slice(0, 160)}`);
  }
  const payload = await response.json();
  if (!payload?.success) {
    throw new Error("Webhook acionamentos retornou payload inválido.");
  }

  const acionamentos = Array.isArray(payload.acionamentos) ? payload.acionamentos : [];
  const tratados = Array.isArray(payload.tratados)
    ? payload.tratados
    : (Array.isArray(payload.rows) && !acionamentos.length ? payload.rows : []);
  const qualidade = payload.qualidade && typeof payload.qualidade === "object"
    ? payload.qualidade
    : null;

  return {
    acionamentos,
    tratados,
    qualidade,
    source: payload.source || "n8n:research.acionamentos+v_acionamentos_tratados",
  };
}

async function fetchSupportSourcesResilient(options = {}) {
  const warnings = [];
  const { accessToken = "", allowN8nFallback = true } = options;
  const { schema, projectRef } = getBusinessDataEnv();

  if (accessToken) {
    try {
      const [acionamentos, tratados, qualidade] = await Promise.all([
        fetchAllTableRest(accessToken, ACIONAMENTOS_TABLE),
        fetchAllTableRest(accessToken, TRATADOS_TABLE),
        fetchQualidadeRest(accessToken),
      ]);
      return {
        acionamentos,
        tratados,
        qualidade,
        warnings,
        source: `rest:${schema}.${ACIONAMENTOS_TABLE}+${TRATADOS_TABLE}`,
        projectRef,
        schema,
      };
    } catch (error) {
      const meta = error?.postgrest || {
        status: error?.status,
        code: error?.code,
        message: error instanceof Error ? error.message : String(error),
        details: error?.details,
        hint: error?.hint,
      };
      logSupportRestFailure({ projectRef, schema, table: error?.table || ACIONAMENTOS_TABLE }, meta);
      warnings.push(
        `REST research.${error?.table || ACIONAMENTOS_TABLE} falhou (${meta.code || meta.status || "erro"}: ${String(meta.message || "").slice(0, 140)}).`,
      );
      if (!allowN8nFallback) throw error;
      warnings.push("Tentando ponte n8n (Postgres Business Data) como fallback.");
    }
  } else {
    warnings.push("Sem access token de sessão; REST autenticado indisponível.");
  }

  if (allowN8nFallback) {
    const viaWebhook = await fetchViaN8nWebhook();
    if (viaWebhook) {
      warnings.push("Dados carregados via ponte n8n (Postgres Business Data).");
      return {
        acionamentos: viaWebhook.acionamentos,
        tratados: viaWebhook.tratados,
        qualidade: viaWebhook.qualidade,
        warnings,
        source: viaWebhook.source,
        projectRef,
        schema,
      };
    }
  }

  const err = new Error(
    "Não foi possível ler research.acionamentos / v_acionamentos_tratados. Verifique Exposed schemas (research), GRANT/RLS ou a ponte n8n.",
  );
  err.code = "data_query_failed";
  throw err;
}

/**
 * @param {{ accessToken?: string, allowN8nFallback?: boolean }} [options]
 */
export async function computeSupportPayload(options = {}) {
  const cfgError = businessDataConfigurationError();
  if (cfgError) {
    const payload = buildSupportAnalyticsPayload({
      acionamentos: [],
      tratados: [],
      qualidade: null,
      fetchWarnings: [cfgError],
      source: "unavailable",
    });
    payload.summary.note = cfgError;
    return payload;
  }

  const {
    acionamentos,
    tratados,
    qualidade,
    warnings,
    source,
    projectRef,
    schema,
  } = await fetchSupportSourcesResilient(options);

  const payload = buildSupportAnalyticsPayload({
    acionamentos,
    tratados,
    qualidade,
    fetchWarnings: warnings,
    source,
  });

  payload.meta = {
    ...(payload.meta || {}),
    projectRef: projectRef || null,
    schema: schema || "research",
    table: ACIONAMENTOS_TABLE,
    treatedTable: TRATADOS_TABLE,
    qualityTable: QUALIDADE_TABLE,
    rowCount: payload.summary?.totalTickets ?? 0,
    rowCountAcionamentos: acionamentos.length,
    rowCountTratados: tratados.length,
  };
  return payload;
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }
  if (request.method !== "GET") {
    return Response.json({ error: "Método não permitido" }, { status: 405 });
  }

  const denied = await requireCorporateAuth(request);
  if (denied) return denied;

  const bizCfg = businessDataConfigurationError();
  if (bizCfg) {
    return Response.json({ error: bizCfg, code: "config" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const accessToken = extractBearerToken(request);
  const { projectRef, schema } = getBusinessDataEnv();
  console.error("[Support] projeto:", projectRef, "schema:", schema, "tables:", ACIONAMENTOS_TABLE, TRATADOS_TABLE, "bearer:", Boolean(accessToken));

  try {
    const payload = await computeSupportPayload({
      accessToken,
      allowN8nFallback: true,
    });
    if (payload?.source === "unavailable") {
      return Response.json(
        { error: payload.summary?.note || "Fonte indisponível.", code: "config" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
    console.error("[Support]", {
      project: error?.projectRef || projectRef,
      schema: error?.schema || schema,
      table: error?.table || ACIONAMENTOS_TABLE,
      status: error?.status || status,
      code: error?.code || null,
      message: error instanceof Error ? error.message : String(error),
      details: error?.details || null,
      hint: error?.hint || null,
    });
    return Response.json(
      {
        error: "Não foi possível consultar a base de dados.",
        code: error?.code || "data_query_failed",
        diagnostic: {
          project: error?.projectRef || projectRef || null,
          schema: error?.schema || schema,
          table: error?.table || ACIONAMENTOS_TABLE,
          httpStatus: error?.status || status,
          postgrestCode: error?.code || null,
          message: error instanceof Error ? error.message : String(error),
          hint: error?.hint || null,
        },
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
};
