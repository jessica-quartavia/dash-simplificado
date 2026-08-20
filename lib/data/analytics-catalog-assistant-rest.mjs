/**
 * Leitura expandida de analytics.metric_catalog para o Assistente V2.
 * Inclui campos de regra, fonte e limitações ausentes do SELECT público.
 */
import { buildAnalyticsRestHeaders } from "./analytics-rest.mjs";

const PAGE_SIZE = 1000;
const ASSISTANT_SELECT = [
  "metric_id",
  "page_id",
  "page_label",
  "label",
  "description",
  "calculation_summary",
  "population_description",
  "source_systems",
  "source_objects",
  "accepted_filters",
  "aliases",
  "limitations",
  "scope_policy",
  "dash_kids_status",
  "validated_for_v2",
].join(",");

export async function fetchAssistantMetricCatalogRows({ accessToken } = {}) {
  const { url, headers } = buildAnalyticsRestHeaders({ accessToken, write: false });
  const rows = [];
  let offset = 0;
  const started = Date.now();

  while (true) {
    const endpoint = new URL("/rest/v1/metric_catalog", url);
    endpoint.searchParams.set("select", ASSISTANT_SELECT);
    endpoint.searchParams.set("order", "page_id.asc,metric_id.asc");

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        ...headers,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`metric_catalog (assistant): HTTP ${response.status} ${detail.slice(0, 240)}`);
      error.status = response.status;
      throw error;
    }

    const batch = await response.json();
    if (!Array.isArray(batch)) {
      throw new Error("metric_catalog (assistant): resposta REST inválida.");
    }
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (offset > 20_000) break;
  }

  return { rows, queryMs: Date.now() - started };
}
