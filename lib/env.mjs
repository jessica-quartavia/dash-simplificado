/**
 * Variáveis de ambiente.
 * AUTH e Business Data são o MESMO projeto Supabase.
 * BASE QV (DATA_*) é outro projeto e é somente leitura.
 *
 * Analytics (schema analytics) usa:
 *   URL = BUSINESS_DATA_SUPABASE_URL || AUTH_SUPABASE_URL
 *   apikey = AUTH_SUPABASE_ANON_KEY
 *   Authorization = Bearer <JWT da sessão corporativa>
 *
 * Não exige BUSINESS_DATA_SUPABASE_ANON_KEY nem service role.
 */

export const CORPORATE_DOMAIN = "quartavia.com.br";

function trimEnv(value) {
  return String(value || "").trim();
}

function trimUrl(value) {
  return trimEnv(value).replace(/\/$/, "");
}

function httpsError(url, name) {
  if (!url) return null;
  try {
    if (new URL(url).protocol !== "https:") return `${name} deve usar HTTPS.`;
  } catch {
    return `${name} inválida.`;
  }
  return null;
}

export function getAuthEnv() {
  const url = trimUrl(process.env.AUTH_SUPABASE_URL);
  const anonKey = trimEnv(process.env.AUTH_SUPABASE_ANON_KEY);
  return { url, anonKey };
}

export function buildAuthConfigResult() {
  const { url, anonKey } = getAuthEnv();
  const headers = { "Cache-Control": "no-store" };

  if (!url || !anonKey) {
    return {
      status: 503,
      headers,
      body: {
        error: "Configuração de autenticação ausente.",
        code: "AUTH_CONFIG_MISSING",
        detail: "Configure AUTH_SUPABASE_URL e AUTH_SUPABASE_ANON_KEY no ambiente.",
      },
    };
  }

  if (!/^https:\/\//i.test(url)) {
    return {
      status: 503,
      headers,
      body: {
        error: "AUTH_SUPABASE_URL deve usar HTTPS.",
        code: "AUTH_CONFIG_INVALID",
      },
    };
  }

  if (/service_role/i.test(anonKey)) {
    return {
      status: 503,
      headers,
      body: {
        error: "Chave de serviço não pode ser exposta ao navegador. Use AUTH_SUPABASE_ANON_KEY.",
        code: "AUTH_CONFIG_INVALID",
      },
    };
  }

  return {
    status: 200,
    headers,
    body: {
      authSupabaseUrl: url,
      authSupabaseAnonKey: anonKey,
      corporateDomain: CORPORATE_DOMAIN,
    },
  };
}

/** BASE QV — dashboards operacionais. Somente leitura nas próximas etapas. */
export function getDataEnv() {
  const url = trimUrl(process.env.DATA_SUPABASE_URL || process.env.SUPABASE_URL);
  const serviceRoleKey = trimEnv(
    process.env.DATA_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  return { url, serviceRoleKey };
}

export function dataConfigurationError() {
  const { url, serviceRoleKey } = getDataEnv();
  if (!url || !serviceRoleKey) {
    return "Configure DATA_SUPABASE_URL e DATA_SUPABASE_SERVICE_ROLE_KEY.";
  }
  return httpsError(url, "DATA_SUPABASE_URL");
}

/** App Pharus — mecanismos e eventos. */
export function getPharusEnv() {
  const url = trimUrl(process.env.PHARUS_SUPABASE_URL || process.env.APP_PHARUS_SUPABASE_URL);
  const anonKey = trimEnv(process.env.PHARUS_SUPABASE_ANON_KEY || process.env.APP_PHARUS_SUPABASE_ANON_KEY);
  const serviceRoleKey = trimEnv(
    process.env.PHARUS_SUPABASE_SERVICE_ROLE_KEY
    || process.env.APP_PHARUS_SUPABASE_SERVICE_ROLE_KEY,
  );
  const schema = trimEnv(process.env.PHARUS_SUPABASE_SCHEMA || process.env.APP_PHARUS_SUPABASE_SCHEMA) || "core";
  return {
    url,
    anonKey,
    serviceRoleKey,
    restKey: serviceRoleKey || anonKey,
    schema,
  };
}

export function pharusConfigurationError() {
  const { url, anonKey, serviceRoleKey } = getPharusEnv();
  if (!url) return "Configure PHARUS_SUPABASE_URL.";
  if (!anonKey && !serviceRoleKey) {
    return "Configure PHARUS_SUPABASE_SERVICE_ROLE_KEY ou PHARUS_SUPABASE_ANON_KEY.";
  }
  return httpsError(url, "PHARUS_SUPABASE_URL");
}

/** QV360 — usado no Plano Patrimonial da V1. */
export function getQv360Env() {
  const url = trimUrl(process.env.QV360_SUPABASE_URL || process.env.SUPABASE_QV360_URL);
  const anonKey = trimEnv(process.env.QV360_SUPABASE_ANON_KEY);
  const serviceRoleKey = trimEnv(
    process.env.QV360_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_QV360_SERVICE_ROLE_KEY,
  );
  const schema = trimEnv(process.env.QV360_SUPABASE_SCHEMA) || "public";
  return { url, anonKey, serviceRoleKey, schema };
}

export function qv360ConfigurationError() {
  const { url, anonKey, serviceRoleKey } = getQv360Env();
  if (!url) return "Configure QV360_SUPABASE_URL.";
  if (!anonKey && !serviceRoleKey) {
    return "Configure QV360_SUPABASE_SERVICE_ROLE_KEY ou QV360_SUPABASE_ANON_KEY.";
  }
  return httpsError(url, "QV360_SUPABASE_URL");
}

/** Business Data — acionamentos / Calendly. */
export function getBusinessDataEnv() {
  const url = trimUrl(process.env.BUSINESS_DATA_SUPABASE_URL);
  const serviceRoleKey = trimEnv(process.env.BUSINESS_DATA_SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = trimEnv(process.env.BUSINESS_DATA_SUPABASE_ANON_KEY);
  const schema = trimEnv(process.env.BUSINESS_DATA_SUPABASE_SCHEMA) || "research";
  return { url, serviceRoleKey, anonKey, schema };
}

export function businessDataConfigurationError() {
  const { url, serviceRoleKey, anonKey } = getBusinessDataEnv();
  if (!url) return "Configure BUSINESS_DATA_SUPABASE_URL.";
  if (!serviceRoleKey && !anonKey) {
    return "Configure BUSINESS_DATA_SUPABASE_SERVICE_ROLE_KEY ou BUSINESS_DATA_SUPABASE_ANON_KEY.";
  }
  return httpsError(url, "BUSINESS_DATA_SUPABASE_URL");
}

/** Schema do catálogo/snapshot analítico V2. Não reutilizar o default `research`. */
export const ANALYTICS_CATALOG_SCHEMA = "analytics";

/**
 * Business Data / Auth — schema analytics.
 * Nunca usa BASE QV nem service role.
 */
export function getAnalyticsEnv(source = process.env) {
  const url = trimUrl(source.BUSINESS_DATA_SUPABASE_URL || source.AUTH_SUPABASE_URL);
  const anonKey = trimEnv(source.AUTH_SUPABASE_ANON_KEY);
  const dataUrl = trimUrl(source.DATA_SUPABASE_URL || source.SUPABASE_URL);
  return { url, anonKey, schema: ANALYTICS_CATALOG_SCHEMA, dataUrl };
}

export function getAnalyticsCatalogEnv(source = process.env) {
  return getAnalyticsEnv(source);
}

export function isSameSupabaseProject(left, right) {
  const a = trimUrl(left);
  const b = trimUrl(right);
  return Boolean(a && b && a === b);
}

/** Host conhecido da BASE QV neste projeto. Somente leitura. */
export const BASE_QV_HOST = "lacinxsvjdwalkchxyeo.supabase.co";

export function isBaseQvUrl(url) {
  const trimmed = trimUrl(url);
  if (!trimmed) return false;
  try {
    return new URL(trimmed).hostname === BASE_QV_HOST;
  } catch {
    return trimmed.includes(BASE_QV_HOST);
  }
}

export function analyticsCatalogConfigurationError(source = process.env) {
  const { url, anonKey, dataUrl } = getAnalyticsEnv(source);
  if (!url) return "Configure AUTH_SUPABASE_URL ou BUSINESS_DATA_SUPABASE_URL.";
  if (!anonKey) return "Configure AUTH_SUPABASE_ANON_KEY.";
  if (/service_role/i.test(anonKey)) {
    return "Use AUTH_SUPABASE_ANON_KEY. O schema analytics não aceita service role.";
  }
  if (isSameSupabaseProject(url, dataUrl) || isBaseQvUrl(url)) {
    return "O catálogo analítico deve usar o Business Data/Auth, não a BASE QV.";
  }
  return httpsError(url, "AUTH_SUPABASE_URL");
}

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const DEFAULT_GEMINI_TIMEOUT_MS = 25_000;

/** Gemini — exclusivamente server-side. Nunca expor ao frontend. */
export function getGeminiEnv(source = process.env) {
  const apiKey = trimEnv(source.GEMINI_API_KEY);
  const rawModel = trimEnv(source.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
  const timeoutMs = Number(source.GEMINI_TIMEOUT_MS || DEFAULT_GEMINI_TIMEOUT_MS);
  return {
    apiKey,
    model: rawModel,
    defaultModel: DEFAULT_GEMINI_MODEL,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_GEMINI_TIMEOUT_MS,
  };
}

export function geminiConfigurationError(source = process.env) {
  const { apiKey, model } = getGeminiEnv(source);
  if (!apiKey) return "Configure GEMINI_API_KEY no ambiente do servidor.";
  if (!model) return "Configure GEMINI_MODEL com um modelo Gemini válido.";
  return null;
}
