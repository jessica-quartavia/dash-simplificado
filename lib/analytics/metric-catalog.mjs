/**
 * Formatação pública do catálogo analítico V2.
 * Não calcula valores dinâmicos e não consulta a BASE QV.
 */

export const VALIDATED_V2_PAGES = Object.freeze([
  "general",
  "journey",
  "meetings",
  "patrimonial_plan",
  "mechanisms",
]);

export function parseCatalogQuery(searchParams) {
  const params = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || "");
  const page = String(params.get("page") || "").trim();
  const validatedRaw = String(params.get("validated") || "").trim().toLowerCase();
  return {
    pageId: page || null,
    validated: validatedRaw === "true" ? true : validatedRaw === "false" ? false : null,
  };
}

export function toPublicCatalogMetric(row) {
  const systems = Array.isArray(row?.source_systems) ? row.source_systems : [];
  const filters = Array.isArray(row?.accepted_filters) ? row.accepted_filters : [];
  const aliases = Array.isArray(row?.aliases) ? row.aliases : [];
  return {
    metric_id: row?.metric_id || null,
    page_id: row?.page_id || null,
    page_label: row?.page_label || null,
    label: row?.label || null,
    description: row?.description || null,
    dash_kids_status: row?.dash_kids_status ?? null,
    validated_for_v2: Boolean(row?.validated_for_v2),
    scope_policy: row?.scope_policy || null,
    sources: systems,
    filters,
    aliases,
  };
}

export function buildCatalogResponse(rows, { generatedAt = new Date().toISOString() } = {}) {
  const metrics = (rows || []).map(toPublicCatalogMetric);
  return {
    generated_at: generatedAt,
    metrics,
  };
}

export function catalogInvariantIssues(metrics) {
  const issues = [];
  const seen = new Set();
  for (const metric of metrics || []) {
    if (!metric?.metric_id) {
      issues.push("metric_id ausente");
      continue;
    }
    if (seen.has(metric.metric_id)) issues.push(`duplicado:${metric.metric_id}`);
    seen.add(metric.metric_id);
    const dash = String(metric.dash_kids_status || "");
    if (/n[aã]o levar/i.test(dash) && metric.validated_for_v2) {
      issues.push(`nao_levar_validada:${metric.metric_id}`);
    }
    if (metric.validated_for_v2 && !VALIDATED_V2_PAGES.includes(metric.page_id)) {
      issues.push(`pagina_nao_validada:${metric.metric_id}`);
    }
    if (metric.validated_for_v2 && dash !== "Sim") {
      issues.push(`validada_sem_sim:${metric.metric_id}`);
    }
  }
  return issues;
}
