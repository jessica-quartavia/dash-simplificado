/**
 * Disparo autenticado do refresh de snapshot estatístico (POC).
 * Uso: import { refreshStatisticalSnapshot } from "./statistical-snapshot-refresh.mjs"
 */
import { authenticatedFetch } from "../auth.mjs";

export async function refreshStatisticalSnapshot(fetchImpl = authenticatedFetch) {
  const response = await fetchImpl("/api/analytics?action=refresh-statistical-snapshot", {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = body?.code || "stat_snapshot_refresh_failed";
    throw error;
  }
  return body;
}
