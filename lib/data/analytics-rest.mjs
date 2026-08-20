/**
 * Headers PostgREST para schema analytics no projeto Auth/Business Data.
 * apikey = AUTH_SUPABASE_ANON_KEY
 * Authorization = Bearer <JWT da sessão>
 * Nunca service role. Nunca BASE QV.
 */
import {
  analyticsCatalogConfigurationError,
  getAnalyticsEnv,
  isBaseQvUrl,
  isSameSupabaseProject,
} from "../env.mjs";

export function buildAnalyticsRestHeaders({ accessToken, write = false, env } = {}) {
  const source = env || process.env;
  const { url, anonKey, schema, dataUrl } = getAnalyticsEnv(source);
  if (isSameSupabaseProject(url, dataUrl) || isBaseQvUrl(url)) {
    const error = new Error("Recusou URL da BASE QV. Schema analytics vive no projeto Auth/Business Data.");
    error.code = "base_qv_refused";
    throw error;
  }
  const configError = analyticsCatalogConfigurationError(source);
  if (configError) {
    const error = new Error(configError);
    error.code = "config";
    throw error;
  }
  const token = String(accessToken || "").trim();
  if (!token) {
    const error = new Error("Sessão corporativa necessária para o schema analytics.");
    error.code = "unauthenticated";
    throw error;
  }
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Accept-Profile": schema,
  };
  if (write) {
    headers["Content-Type"] = "application/json";
    headers["Content-Profile"] = schema;
  }
  return {
    url: String(url || "").replace(/\/$/, ""),
    schema,
    anonKey,
    headers,
  };
}
