/**
 * Monta contexto analítico compacto para o Gemini (metadados + snapshot/compute).
 */

export function buildAnalyticsContext({
  metric,
  valueResult = null,
  intent = "general",
  filterWarnings = [],
  appliedFilters = {},
} = {}) {
  if (!metric) {
    return {
      intent,
      metric: null,
      status: null,
      value: { available: false, data: null },
      contextBytes: 0,
    };
  }

  const value = buildValueSection(valueResult);
  const context = {
    intent,
    metric: {
      metric_id: metric.metric_id,
      label: metric.label,
      page_id: metric.page_id,
      page_label: metric.page_label,
      description: metric.description || null,
    },
    status: {
      validated_for_v2: Boolean(metric.validated_for_v2),
      dash_kids_status: metric.dash_kids_status ?? null,
      scope_policy: metric.scope_policy || null,
    },
    filters: {
      applied: appliedFilters,
      warnings: filterWarnings,
    },
    value,
    rule: metric.calculation_summary || null,
    population: metric.population_description || null,
    sources: {
      systems: Array.isArray(metric.source_systems) ? metric.source_systems : [],
      objects: Array.isArray(metric.source_objects) ? metric.source_objects : [],
    },
    limitations: Array.isArray(metric.limitations) ? metric.limitations : [],
    accepted_filters: Array.isArray(metric.accepted_filters) ? metric.accepted_filters : [],
  };

  const serialized = JSON.stringify(context);
  return { ...context, contextBytes: Buffer.byteLength(serialized, "utf8") };
}

function buildValueSection(valueResult) {
  if (!valueResult?.available) {
    return {
      available: false,
      data: null,
      source: valueResult?.source || null,
      reason: valueResult?.reason || null,
      formatted: valueResult?.formatted || null,
    };
  }

  let data = valueResult.data;
  if (data?.kind === "chart" || data?.top) {
    data = {
      kind: "chart_summary",
      total: data.total ?? null,
      top: (data.top || []).slice(0, 5),
      seriesPoints: data.seriesPoints ?? null,
    };
  }

  return {
    available: true,
    source: valueResult.source,
    data,
    formatted: valueResult.formatted || null,
    coverage: valueResult.coverage ?? null,
    sample_size: valueResult.sample_size ?? null,
    numerator: valueResult.numerator ?? null,
    denominator: valueResult.denominator ?? null,
    warning: valueResult.warning ?? null,
    generated_at: valueResult.generated_at ?? null,
    calculation_status: valueResult.calculation_status ?? null,
  };
}

export function buildGenericContext({ intent, candidates = [] } = {}) {
  const context = {
    intent,
    metric: null,
    candidates: candidates.slice(0, 5).map((entry) => ({
      metric_id: entry.metric_id,
      label: entry.metric?.label || entry.metric_id,
      page_label: entry.metric?.page_label || null,
      score: Number(entry.score?.toFixed?.(3) ?? entry.score),
    })),
    note: "Nenhuma métrica com confiança suficiente. Responda de forma genérica sobre o Analytics QuartaVia sem inventar números.",
  };
  const serialized = JSON.stringify(context);
  return { ...context, contextBytes: Buffer.byteLength(serialized, "utf8") };
}
