/**
 * Headers PostgREST — Business Data schema analytics (anon + JWT).
 * apikey = AUTH_SUPABASE_ANON_KEY; Authorization = Bearer <JWT sessão>.
 * Nunca service role. Nunca BASE QV.
 */
import { buildAnalyticsRestHeaders } from "./analytics-rest.mjs";
import { analyticsCatalogConfigurationError } from "../env.mjs";

export function buildBusinessDataAuthenticatedHeaders({ accessToken, write = false } = {}) {
  const configError = analyticsCatalogConfigurationError();
  if (configError) {
    const error = new Error(configError);
    error.code = "config";
    throw error;
  }
  const token = String(accessToken || "").trim();
  if (!token) {
    const error = new Error("Sessão autenticada necessária para operações no Business Data (schema analytics).");
    error.code = "unauthenticated";
    throw error;
  }
  return buildAnalyticsRestHeaders({ accessToken: token, write });
}

export function assertAuthenticatedAnalyticsAccess(accessToken) {
  const configError = analyticsCatalogConfigurationError();
  if (configError) return configError;
  if (!String(accessToken || "").trim()) {
    return "Snapshot persistence requires an authenticated user session. Use the authenticated refresh endpoint.";
  }
  return null;
}

/** @deprecated use assertAuthenticatedAnalyticsAccess */
export function assertBusinessDataServiceConfigured(accessToken) {
  return assertAuthenticatedAnalyticsAccess(accessToken);
}
