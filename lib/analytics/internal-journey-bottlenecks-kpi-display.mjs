/** Formatação pt-BR de percentual (0–100) para cards IJB. */

export function formatPctPtBr(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function buildKpiPctPrimaryCard({ pctVal, suffix = "da base" }) {
  const main = formatPctPtBr(pctVal);
  const sub = String(suffix);
  return { main, sub, htmlSnippet: `<span class="ijb-kpi-count">${main}</span><span class="ijb-kpi-pct">${sub}</span>` };
}
