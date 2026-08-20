/**
 * Escopo default do snapshot. Não gera combinações de filtros.
 */
export function scopeFromPolicy(scopePolicy) {
  const policy = String(scopePolicy || "").trim();
  if (policy === "historical") {
    return { scope_key: "historical", scope: { scope: "historical" } };
  }
  if (policy === "all_clients") {
    return { scope_key: "all", scope: { status: "all" } };
  }
  return { scope_key: "active", scope: { status: "active" } };
}

export const CALCULATION_VERSION = "v2.snapshot.1";

export function coverageRatio(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return Math.round((n / d) * 10000) / 10000;
}

export function slimCategories(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    label: item?.label ?? item?.month ?? null,
    count: item?.count ?? item?.scheduled ?? item?.acquiredClients ?? 0,
    percent: item?.percent ?? null,
  }));
}

export function slimSeries(items, fields) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const row = {};
    for (const field of fields) {
      row[field] = item?.[field] ?? null;
    }
    return row;
  });
}

export function makeSnapshot({
  metric,
  value,
  numerator = null,
  denominator = null,
  coverage = null,
  sampleSize = null,
  status = null,
  warning = null,
  metadata = {},
  generatedAt = new Date().toISOString(),
}) {
  const scoped = scopeFromPolicy(metric?.scope_policy);
  const hasValue = value != null;
  return {
    metric_id: metric.metric_id,
    page_id: metric.page_id,
    scope_key: scoped.scope_key,
    scope: scoped.scope,
    value: hasValue ? value : { value: null },
    numerator: numerator == null ? null : Number(numerator),
    denominator: denominator == null ? null : Number(denominator),
    coverage:
      coverage == null
        ? coverageRatio(numerator, denominator)
        : Number(coverage),
    sample_size: sampleSize == null ? null : Number(sampleSize),
    calculation_status: status || (hasValue ? "ok" : "unavailable"),
    warning: warning || null,
    metadata: metadata || {},
    generated_at: generatedAt,
    expires_at: null,
    calculation_version: CALCULATION_VERSION,
  };
}
