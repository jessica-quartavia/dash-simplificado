/** Gráficos leves — Projeção Mecanismos × Renovação */
import { escapeHtml, donut, vBars, hBars, acquisitionColumns, chartColorForLabel } from "./general-charts.mjs";

export function imrChartCard(title, bodyHtml, { legend = "", note = "", className = "" } = {}) {
  return `<article class="imr-chart-card chart-card ${className}">
    <h4 class="imr-chart-title">${escapeHtml(title)}</h4>
    ${note ? `<p class="imr-chart-note note-muted">${escapeHtml(note)}</p>` : ""}
    <div class="imr-chart-body">${bodyHtml}</div>
    ${legend ? `<p class="imr-chart-legend">${escapeHtml(legend)}</p>` : ""}
  </article>`;
}

export function renewalRateSideBySide(comVsSem) {
  const w = comVsSem?.withMechanism || {};
  const wo = comVsSem?.withoutMechanism || {};
  const diff = comVsSem?.diffPct;
  const items = [
    {
      label: "Com mecanismo",
      rate: w.ratePct,
      tip: `Total elegíveis: ${w.eligible ?? "—"} · Renovados: ${w.renewed ?? "—"} · Taxa: ${w.ratePct ?? "—"}%`,
    },
    {
      label: "Sem mecanismo",
      rate: wo.ratePct,
      tip: `Total elegíveis: ${wo.eligible ?? "—"} · Renovados: ${wo.renewed ?? "—"} · Taxa: ${wo.ratePct ?? "—"}% · Diferença vs com: ${diff != null ? `${diff} p.p.` : "—"}`,
    },
  ];
  const max = Math.max(...items.map((i) => Number(i.rate) || 0), 1);
  const plotH = 160;
  return `<div class="imr-renewal-compare-bars">${items
    .map((item) => {
      const rate = Number(item.rate) || 0;
      const h = Math.max(rate > 0 ? 8 : 0, Math.round((rate / max) * plotH));
      return `<div class="imr-renewal-compare-col" title="${escapeHtml(item.tip)}">
        <div class="imr-renewal-compare-value">${rate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</div>
        <div class="imr-renewal-compare-track"><div class="imr-renewal-compare-fill" style="height:${h}px"></div></div>
        <div class="imr-renewal-compare-label">${escapeHtml(item.label)}</div>
      </div>`;
    })
    .join("")}</div>`;
}

export function mechanismRankingChart(rows = [], minSample = 30, limit = 15) {
  const list = (rows || [])
    .filter((r) => !r.smallSample && (r.eligible ?? 0) >= minSample && r.renewalRatePct != null)
    .sort((a, b) => (b.renewalRatePct ?? -1) - (a.renewalRatePct ?? -1))
    .slice(0, limit);
  if (!list.length) return `<p class="placeholder-note">Sem mecanismos com amostra mínima.</p>`;
  const max = Math.max(...list.map((r) => r.renewalRatePct), 1);
  return `<div class="hbar-list imr-mech-rank-chart">${list
    .map((r) => {
      const w = ((r.renewalRatePct ?? 0) / max) * 100;
      const tip = `${r.mechanismName} · N=${r.eligible} · renovados ${r.renewed} · taxa ${r.renewalRatePct}% · sem mec. ${r.withoutMechanismRatePct ?? "—"}% · Δ ${r.diffVsWithoutMechanismPp ?? "—"} p.p.`;
      return `<div class="hbar" title="${escapeHtml(tip)}"><div class="hbar-label">${escapeHtml(r.mechanismName)}</div><div class="hbar-track"><span style="width:${w}%"></span></div><div class="hbar-val">${Number(r.renewalRatePct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</div></div>`;
    })
    .join("")}</div>`;
}

export function mechanismBandBusinessChart(bands = []) {
  const items = (bands || [])
    .filter((b) => (b.clients ?? 0) > 0)
    .map((b) => ({
      label: b.band === "4+" ? "4+" : String(b.band),
      count: b.renewalRatePct ?? 0,
      percent: b.renewalRatePct ?? 0,
      title: `N=${b.clients} · renovados ${b.renewed} · taxa ${b.renewalRatePct ?? "—"}%`,
    }));
  if (!items.length) return `<p class="placeholder-note">Sem faixas.</p>`;
  return `<div class="imr-band-business">${items
    .map(
      (b) =>
        `<div class="imr-band-business-col" title="${escapeHtml(b.title)}"><div class="imr-band-business-rate">${Number(b.count).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</div><div class="imr-band-business-label">${escapeHtml(b.label)} mec.</div></div>`,
    )
    .join("")}</div>`;
}

export function bandRateChart(bands = []) {
  const items = (bands || [])
    .filter((b) => b.clients > 0)
    .map((b) => ({
      label: `${b.band} mec.`,
      count: b.clients,
      percent: b.renewalRatePct ?? 0,
      sub: b.renewalRatePct != null ? `taxa ${b.renewalRatePct}%` : "",
    }));
  if (!items.length) return `<p class="placeholder-note">Sem dados.</p>`;
  return `<div class="imr-band-grid">${items
    .map(
      (item) =>
        `<div class="imr-band-item" title="N=${item.count} · ${item.sub}">
        <div class="imr-band-label">${escapeHtml(item.label)}</div>
        <div class="imr-band-count">${item.count.toLocaleString("pt-BR")} clientes</div>
        <div class="imr-band-rate">${item.renewalRatePct != null ? `${item.percent}% renov.` : "—"}</div>
      </div>`,
    )
    .join("")}</div>`;
}

export function mechanismBandCombo(bands = []) {
  const vol = (bands || []).map((b) => ({
    label: b.band === "4+" ? "4+" : b.band,
    count: b.clients || 0,
    percent: b.clients
      ? Math.round(((b.clients || 0) / Math.max(1, bands.reduce((a, x) => a + (x.clients || 0), 0))) * 1000) / 10
      : 0,
  }));
  const rateBars = (bands || [])
    .filter((b) => b.clients > 0)
    .map((b, i) => ({
      label: b.band === "4+" ? "4+" : b.band,
      count: b.renewalRatePct ?? 0,
      percent: b.renewalRatePct ?? 0,
      color: chartColorForLabel(String(b.band), i),
    }));
  return `<div class="imr-combo-charts">
    ${imrChartCard("Volume por faixa", vBars(vol), { note: "Quantidade de clientes (ciclo válido)." })}
    ${imrChartCard("Taxa de renovação por faixa", vBars(rateBars.map((r) => ({ ...r, count: r.count || 0.1 }))), {
      legend: "Percentual que já renovou na população da faixa.",
    })}
  </div>`;
}

export function groupedMetricCompare(metricKeys, mA, mB, rowLabels) {
  const mapKey = (k) =>
    ({
      roc_auc: "rocAuc",
      pr_auc: "prAuc",
      balanced_accuracy: "balancedAccuracy",
      recall: "recall",
      f1: "f1",
    })[k] || k;
  const rows = (metricKeys || [])
    .map((key) => {
      const prop = mapKey(key);
      const a = mA?.[prop];
      const b = mB?.[prop];
      if (a == null && b == null) return null;
      const label = rowLabels?.find((r) => r.metric === key)?.label || key;
      return { label, a: Number(a) || 0, b: Number(b) || 0 };
    })
    .filter(Boolean);
  if (!rows.length) return `<p class="placeholder-note">Sem métricas comparáveis.</p>`;
  const max = Math.max(0.01, ...rows.flatMap((r) => [r.a, r.b]));
  return `<div class="imr-grouped-metrics">${rows
    .map((r) => {
      const wA = Math.round((r.a / max) * 100);
      const wB = Math.round((r.b / max) * 100);
      return `<div class="imr-gm-row" title="A: ${(r.a * 100).toFixed(1)}% · B: ${(r.b * 100).toFixed(1)}%">
        <div class="imr-gm-label">${escapeHtml(r.label)}</div>
        <div class="imr-gm-bars">
          <span class="imr-gm-tag imr-tag-a">A</span><div class="imr-gm-track"><i class="imr-bar-a" style="width:${wA}%"></i></div>
          <span class="imr-gm-tag imr-tag-b">B</span><div class="imr-gm-track"><i class="imr-bar-b" style="width:${wB}%"></i></div>
        </div>
      </div>`;
    })
    .join("")}</div>`;
}

export function brierCompareChart(mA, mB) {
  const items = [
    { label: "Brier A", count: Math.round((mA.brier ?? 0) * 1000) / 10, raw: mA.brier },
    { label: "Brier B", count: Math.round((mB.brier ?? 0) * 1000) / 10, raw: mB.brier },
    { label: "Baseline A", count: Math.round((mA.baselineBrier ?? 0) * 1000) / 10, raw: mA.baselineBrier },
    { label: "Baseline B", count: Math.round((mB.baselineBrier ?? 0) * 1000) / 10, raw: mB.baselineBrier },
  ].filter((i) => i.raw != null);
  if (!items.length) return `<p class="placeholder-note">Sem Brier.</p>`;
  const max = Math.max(...items.map((i) => i.count), 0.01);
  return `<div class="hbar-list">${items
    .map((i) => {
      const w = (i.count / max) * 100;
      return `<div class="hbar"><div class="hbar-label">${escapeHtml(i.label)}</div><div class="hbar-track"><span style="width:${w}%"></span></div><div class="hbar-val">${i.raw.toFixed(3)}</div></div>`;
    })
    .join("")}</div>`;
}

export function mechanismHorizontalBars(rows = [], limit = 12) {
  const list = (rows || [])
    .filter((r) => r.renewalRatePct != null)
    .slice(0, limit)
    .map((r) => ({
      label: r.mechanismName,
      count: r.renewalRatePct,
      percent: r.renewalRatePct,
      title: `N=${r.clients ?? r.eligible} · renovados ${r.renewed ?? "—"} · Δ ${r.diffVsWithoutMechanismPct ?? "—"} pp`,
    }));
  if (!list.length) return `<p class="placeholder-note">Sem mecanismos com amostra mínima.</p>`;
  const max = Math.max(...list.map((i) => i.count), 1);
  return `<div class="hbar-list">${list
    .map((i) => {
      const w = (i.count / max) * 100;
      return `<div class="hbar" title="${escapeHtml(i.title)}"><div class="hbar-label">${escapeHtml(i.label)}</div><div class="hbar-track"><span style="width:${w}%"></span></div><div class="hbar-val">${i.count}%</div></div>`;
    })
    .join("")}</div>`;
}

const fmtInt = new Intl.NumberFormat("pt-BR");

export function horizonMonthColumnChart(monthRows, monthLabels, horizonTotal) {
  if (!monthRows?.length) return `<p class="placeholder-note">Sem meses no horizonte.</p>`;
  const max = Math.max(1, ...monthRows.map((m) => m.count || 0));
  const plotH = 168;
  return `<div class="imr-horizon-month-chart">${monthRows
    .map((m) => {
      const label = monthLabels[m.month] || m.label || m.month;
      const count = m.count ?? 0;
      const share =
        horizonTotal > 0 ? Math.round((count / horizonTotal) * 1000) / 10 : null;
      const tip = `Mês: ${label} · Quantidade: ${fmtInt.format(count)} · Participação no horizonte: ${share != null ? `${share}%` : "—"}`;
      const h = Math.max(count > 0 ? 10 : 0, Math.round((count / max) * plotH));
      return `<div class="imr-horizon-month-col" title="${escapeHtml(tip)}">
        <div class="imr-horizon-month-val">${fmtInt.format(count)}</div>
        <div class="imr-horizon-month-track" role="presentation"><div class="imr-horizon-month-fill" style="height:${h}px"></div></div>
        <div class="imr-horizon-month-lbl">${escapeHtml(label)}</div>
      </div>`;
    })
    .join("")}</div>`;
}

export function projectionTopMechanismsHBars(mechanisms = []) {
  const list = (mechanisms || []).filter((m) => m.historicalRatePct != null);
  if (!list.length) return `<p class="placeholder-note">Sem mecanismos.</p>`;
  const max = Math.max(...list.map((m) => m.historicalRatePct ?? 0), 1);
  return `<div class="hbar-list imr-proj-top-hbars">${list
    .map((m) => {
      const rate = m.historicalRatePct ?? 0;
      const w = (rate / max) * 100;
      const diff =
        m.diffPp != null ? `${m.diffPp >= 0 ? "+" : ""}${Number(m.diffPp).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.` : "—";
      const tip = `${m.mechanismName} · Taxa: ${rate}% · N: ${m.historicalN ?? "—"} · Δ: ${diff} · Horizonte: ${m.horizonClientsWithEndDate ?? 0}`;
      return `<div class="hbar" title="${escapeHtml(tip)}">
        <div class="hbar-label">${escapeHtml(m.mechanismName)}</div>
        <div class="hbar-track"><span style="width:${w}%"></span></div>
        <div class="hbar-val">${Number(rate).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</div>
      </div>`;
    })
    .join("")}</div>`;
}

export function scatterSampleQuality(points = []) {
  if (!points.length) return `<p class="placeholder-note">Sem pontos.</p>`;
  const maxN = Math.max(...points.map((p) => p.n), 1);
  const maxY = Math.max(...points.map((p) => p.ratePct ?? 0), 1);
  const w = 320;
  const h = 200;
  const dots = points
    .map((p) => {
      const x = 24 + ((p.n / maxN) * (w - 48));
      const y = h - 24 - ((p.ratePct ?? 0) / maxY) * (h - 48);
      return `<circle cx="${x}" cy="${y}" r="5" class="imr-scatter-dot" title="${escapeHtml(p.name)} · N=${p.n} · ${p.ratePct}%"><title>${escapeHtml(p.name)} · N=${p.n} · taxa ${p.ratePct}%</title></circle>`;
    })
    .join("");
  return `<svg class="imr-scatter" viewBox="0 0 ${w} ${h}" role="img" aria-label="Taxa versus tamanho da amostra">
    <text x="12" y="${h - 4}" class="imr-scatter-axis">N clientes →</text>
    <text x="4" y="16" class="imr-scatter-axis">Taxa ↑</text>
    ${dots}
  </svg>`;
}

export function adoptionTimelineChart(monthly = [], firstDate = null) {
  const series = (monthly || []).slice(-24).map((m) => ({
    month: m.month,
    acquiredClients: m.clientsFirstImplementation ?? 0,
  }));
  if (!series.length) return `<p class="placeholder-note">Sem série de adoção.</p>`;
  const mark = firstDate ? `<p class="note-muted">Primeira implementação registrada: <strong>${escapeHtml(String(firstDate).slice(0, 10))}</strong></p>` : "";
  return `${mark}${acquisitionColumns(series, 12)}`;
}

export { donut, vBars, hBars };
