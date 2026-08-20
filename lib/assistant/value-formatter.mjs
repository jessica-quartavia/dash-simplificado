/**
 * Formatação centralizada de valores do Assistente por unit.
 */
const PT = "pt-BR";

export function formatNumber(value, decimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(PT, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(value, decimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct.toLocaleString(PT, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

export function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(PT, { style: "currency", currency: "BRL" });
}

export function formatDays(value, decimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const text = n.toLocaleString(PT, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${text} ${Math.abs(n) === 1 ? "dia" : "dias"}`;
}

export function summarizeChartValue(valueObj) {
  const categories = valueObj?.categories || valueObj?.series || [];
  if (!Array.isArray(categories) || categories.length === 0) {
    return { kind: "chart", total: null, top: [], seriesPoints: 0 };
  }
  const normalized = categories.map((item) => ({
    label: item?.label ?? item?.month ?? "—",
    count: Number(item?.count ?? item?.scheduled ?? item?.acquiredClients ?? 0),
    percent: item?.percent ?? null,
  }));
  const total = normalized.reduce((sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0), 0);
  const top = [...normalized].sort((a, b) => b.count - a.count).slice(0, 5);
  return { kind: "chart", total, top, seriesPoints: normalized.length };
}

export function formatMetricValue(snapshotLike, metric) {
  const valueObj = snapshotLike?.value;
  const unit = valueObj?.unit || metric?.unit || null;
  const raw = valueObj?.value;

  if (raw != null && typeof raw === "object" && (raw.categories || raw.series)) {
    const summary = summarizeChartValue(raw);
    const topText = summary.top
      .slice(0, 3)
      .map((item) => `${item.label}: ${formatNumber(item.count)}`)
      .join("; ");
    return {
      formatted: topText ? `Distribuição (${formatNumber(summary.total)} no total). Destaques: ${topText}.` : null,
      summary,
      scalar: null,
    };
  }

  if (raw != null && typeof raw === "object" && raw.label != null) {
    const label = raw.label;
    const clients = raw.clients ?? raw.count ?? null;
    const formatted = clients != null
      ? `${label} (${formatNumber(clients)} clientes)`
      : String(label);
    return { formatted, summary: null, scalar: raw };
  }

  let formatted = null;
  if (unit === "percent") formatted = formatPercent(raw);
  else if (unit === "currency") formatted = formatCurrency(raw);
  else if (unit === "days") formatted = formatDays(raw);
  else if (unit === "clients" || unit === "meetings" || unit === "records") {
    const n = formatNumber(raw);
    formatted = n ? `${n} ${unit === "clients" ? "clientes" : unit === "meetings" ? "reuniões" : "registros"}` : null;
  } else if (raw != null) formatted = formatNumber(raw, unit === "percent" ? 1 : 0);

  return { formatted, summary: null, scalar: raw };
}

export function formatCoverageNote({ coverage, sampleSize, numerator, denominator, metricLabel }) {
  const parts = [];
  if (Number.isFinite(coverage) && coverage < 0.2) {
    parts.push(`Cobertura baixa (${formatPercent(coverage)}).`);
  }
  if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
    parts.push(`${formatNumber(numerator)} de ${formatNumber(denominator)} na base de ${metricLabel || "indicador"}.`);
  } else if (Number.isFinite(sampleSize)) {
    parts.push(`Amostra: ${formatNumber(sampleSize)}.`);
  }
  return parts.join(" ");
}
