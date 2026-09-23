/**
 * PostgREST no schema public (RPC) — Business Data / Auth.
 * Usado quando analytics não está em Exposed schemas (PGRST106).
 */
import {
  analyticsCatalogConfigurationError,
  getAnalyticsEnv,
  isBaseQvUrl,
  isSameSupabaseProject,
} from "../env.mjs";

export function buildPublicRestHeaders({ accessToken, write = false, env } = {}) {
  const source = env || process.env;
  const { url, anonKey, dataUrl } = getAnalyticsEnv(source);
  if (isSameSupabaseProject(url, dataUrl) || isBaseQvUrl(url)) {
    const error = new Error("Recusou URL da BASE QV. RPC de relatórios vive no projeto Auth/Business Data.");
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
    const error = new Error("Sessão corporativa necessária.");
    error.code = "unauthenticated";
    throw error;
  }
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (write) {
    headers["Content-Type"] = "application/json";
  }
  return {
    url: String(url || "").replace(/\/$/, ""),
    anonKey,
    headers,
  };
}
