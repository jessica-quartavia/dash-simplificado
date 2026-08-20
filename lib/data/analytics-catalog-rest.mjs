/**
 * Leitura GET-only de analytics.metric_catalog.
 * apikey = AUTH_SUPABASE_ANON_KEY; Authorization = JWT da sessão.
 * Não consulta a BASE QV. Não implementa escrita.
 */
import { buildAnalyticsRestHeaders } from "./analytics-rest.mjs";

const PAGE_SIZE = 1000;
const PUBLIC_SELECT = [
  "metric_id",
  "page_id",
  "page_label",
  "label",
  "description",
  "dash_kids_status",
  "validated_for_v2",
  "scope_policy",
  "source_systems",
  "accepted_filters",
  "aliases",
].join(",");

function assertCatalogTable(table) {
  const name = String(table || "").trim();
  if (name !== "metric_catalog") {
    throw new Error("Somente analytics.metric_catalog pode ser lida por este cliente.");
  }
  return name;
}

export async function fetchMetricCatalogRows({
  pageId = null,
  validated = null,
  accessToken,
} = {}) {
  assertCatalogTable("metric_catalog");
  const { url, headers } = buildAnalyticsRestHeaders({ accessToken, write: false });

  const rows = [];
  let offset = 0;
  const started = Date.now();

  while (true) {
    const endpoint = new URL("/rest/v1/metric_catalog", url);
    endpoint.searchParams.set("select", PUBLIC_SELECT);
    endpoint.searchParams.set("order", "page_id.asc,metric_id.asc");
    if (pageId) endpoint.searchParams.set("page_id", `eq.${pageId}`);
    if (validated === true) endpoint.searchParams.set("validated_for_v2", "eq.true");
    if (validated === false) endpoint.searchParams.set("validated_for_v2", "eq.false");

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        ...headers,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`metric_catalog: HTTP ${response.status} ${detail.slice(0, 240)}`);
      error.status = response.status;
      throw error;
    }

    const batch = await response.json();
    if (!Array.isArray(batch)) {
      throw new Error("metric_catalog: resposta REST inválida.");
    }
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (offset > 20_000) break;
  }

  return { rows, queryMs: Date.now() - started };
}
