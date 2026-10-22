/**
 * Gráficos executivos (Resumo) — SVG responsivo, sem alterar métricas upstream.
 */
import { normalizeCancellationIntentionMonthSeries } from "../lib/analytics/cancellations-metrics.mjs";
import { escapeHtml, monthShortLabel } from "./general-charts.mjs";

const fmt = new Intl.NumberFormat("pt-BR");
const pctFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function visibleSeries(series, limit = 12) {
  const list = Array.isArray(series) ? series : [];
  return list.slice(-limit);
}

function niceCeil(value) {
  const v = Math.max(0, Number(value) || 0);
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function balanceOf(row) {
  if (row.balance != null && Number.isFinite(Number(row.balance))) return Number(row.balance);
  return (row.acquisitions ?? 0) - (row.churn ?? 0);
}

function yTicks(yMin, yMax, count = 4) {
  const span = yMax - yMin || 1;
  const out = [];
  for (let i = 0; i <= count; i += 1) {
    out.push(yMin + (span * i) / count);
  }
  return out;
}

function svgTooltip(lines) {
  return lines.filter(Boolean).join("\n");
}

const BAR_VALUE_OFFSET = 5;
const FLOW_SERIES_NOTE =
  "As séries são independentes por data de cada estágio e não representam necessariamente a conversão do mesmo cliente.";

function intPtBr(value) {
  return fmt.format(Math.round(Number(value) || 0));
}

function formatBalance(value) {
  const n = Math.round(Number(value) || 0);
  if (n > 0) return `+${fmt.format(n)}`;
  return fmt.format(n);
}

function monthTipLabel(ym, longMonths) {
  return `Mês: ${monthShortLabel(ym, true)}`;
}

/** Rótulo acima da barra (centro x); omitir zero quando showWhenZero=false. */
function barValueLabel(x, barTopY, value, { showWhenZero = false, baselineY = null } = {}) {
  const v = Math.round(Number(value) || 0);
  if (!showWhenZero && v <= 0) return "";
  const barH = baselineY != null ? baselineY - barTopY : 999;
  let y = barTopY - BAR_VALUE_OFFSET;
  if (barH < 6 && baselineY != null) {
    y = baselineY - BAR_VALUE_OFFSET - 1;
  }
  y = Math.max(11, y);
  return `<text class="exec-chart-bar-value" x="${x}" y="${y}" text-anchor="middle">${escapeHtml(intPtBr(v))}</text>`;
}

function execChartKpiRow(items) {
  const cells = items
    .map(
      (item) => `
      <div class="exec-chart-kpi${item.emphasis ? " exec-chart-kpi--emphasis" : ""}"${item.title ? ` title="${escapeAttr(item.title)}"` : ""}>
        <span class="exec-chart-kpi__label">${escapeHtml(item.label)}</span>
        <strong class="exec-chart-kpi__value">${item.value}</strong>
        ${item.note ? `<span class="exec-chart-kpi__note">${escapeHtml(item.note)}</span>` : ""}
      </div>`,
    )
    .join("");
  return `<div class="exec-chart-kpis">${cells}</div>`;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function execLegend(items) {
  return `<ul class="exec-chart-legend" aria-hidden="true">${items
    .map(
      (item) =>
        `<li><span class="exec-chart-legend__swatch exec-chart-legend__swatch--${item.kind}"></span>${escapeHtml(item.label)}</li>`,
    )
    .join("")}</ul>`;
}

/** Barras agrupadas (aquisição + churn) + linha de balança. */
export function acquisitionChurnBalanceCombo(series, limit = 12) {
  const visible = visibleSeries(series, limit);
  if (!visible.length) {
    return `<p class="placeholder-note">Sem meses históricos para exibir.</p>`;
  }

  const longMonths = visible.length >= 10;
  const totalAcquisitions = visible.reduce((s, r) => s + (r.acquisitions ?? 0), 0);
  const totalChurn = visible.reduce((s, r) => s + (r.churn ?? 0), 0);
  const balanceAccum = visible.reduce((s, r) => s + balanceOf(r), 0);

  const balances = visible.map(balanceOf);
  const yMin = Math.min(0, ...balances);
  const yMax = niceCeil(
    Math.max(
      ...visible.flatMap((r) => [r.acquisitions ?? 0, r.churn ?? 0]),
      ...balances.map((b) => Math.abs(b)),
      1,
    ),
  );
  const yTop = yMax;
  const yBottom = yMin < 0 ? -niceCeil(Math.abs(yMin)) : 0;
  const span = yTop - yBottom || 1;

  const W = 880;
  const H = 272;
  const pad = { l: 48, r: 16, t: 28, b: 36 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const n = visible.length;
  const slot = plotW / n;
  const barW = Math.min(20, Math.max(10, slot * 0.26));
  const gap = 4;
  const denseLabels = n >= 10 || slot < 58;

  const yPx = (v) => pad.t + plotH - ((v - yBottom) / span) * plotH;
  const zeroY = yPx(0);

  const gridLines = yTicks(yBottom, yTop, 4)
    .map((tick) => {
      const y = yPx(tick);
      return `<line class="exec-chart-gridline" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" />
        <text class="exec-chart-axis-y" x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${fmt.format(Math.round(tick))}</text>`;
    })
    .join("");

  const bars = [];
  const linePts = [];
  visible.forEach((row, i) => {
    const acq = row.acquisitions ?? 0;
    const churn = row.churn ?? 0;
    const bal = balanceOf(row);
    const cx = pad.l + slot * (i + 0.5);
    const acqX = cx - barW - gap / 2;
    const churnX = cx + gap / 2;
    const acqH = zeroY - yPx(acq);
    const churnH = zeroY - yPx(churn);
    const monthLabel = monthShortLabel(row.month, longMonths);
    const tip = svgTooltip([
      monthTipLabel(row.month, longMonths),
      `Aquisições: ${fmt.format(acq)}`,
      `Churns: ${fmt.format(churn)}`,
      `Balança: ${formatBalance(bal)}`,
    ]);

    const acqTop = yPx(acq);
    const churnTop = yPx(churn);
    bars.push(`<g class="exec-chart-bar-group">
      <rect class="exec-chart-bar exec-chart-bar--acq" x="${acqX}" y="${acqTop}" width="${barW}" height="${Math.max(0, acqH)}" rx="2">
        <title>${escapeHtml(tip)}</title>
      </rect>
      ${barValueLabel(acqX + barW / 2, acqTop, acq, { baselineY: zeroY })}
      <rect class="exec-chart-bar exec-chart-bar--churn" x="${churnX}" y="${churnTop}" width="${barW}" height="${Math.max(0, churnH)}" rx="2">
        <title>${escapeHtml(tip)}</title>
      </rect>
      ${barValueLabel(churnX + barW / 2, churnTop, churn, { baselineY: zeroY })}
      <text class="exec-chart-axis-x" x="${cx}" y="${H - 12}" text-anchor="middle">${escapeHtml(monthLabel)}</text>
    </g>`);

    linePts.push({ x: cx, y: yPx(bal), tip, bal, month: monthLabel });
  });

  const polyline = linePts.map((p) => `${p.x},${p.y}`).join(" ");
  const balanceDots = linePts
    .map(
      (p, idx) => `<circle class="exec-chart-line-dot" cx="${p.x}" cy="${p.y}" r="2.5" tabindex="0">
        <title>${escapeHtml(p.tip)}</title>
      </circle>${idx === linePts.length - 1 ? `<text class="exec-chart-line-label" x="${p.x}" y="${p.y - 8}" text-anchor="middle">${formatBalance(p.bal)}</text>` : ""}`,
    )
    .join("");

  const accumLabel = formatBalance(balanceAccum);

  return `
    ${execChartKpiRow([
      { label: "Aquisições (12m)", value: fmt.format(totalAcquisitions), note: "Novos clientes no período" },
      { label: "Churns (12m)", value: fmt.format(totalChurn), emphasis: true, note: "Data analítica de churn" },
      { label: "Balança acumulada", value: accumLabel, note: "Soma mensal (aquisição − churn)" },
    ])}
    <div class="exec-combo-chart${denseLabels ? " exec-combo-chart--dense-labels" : ""}">
      ${execLegend([
        { kind: "acq", label: "Aquisições" },
        { kind: "churn", label: "Churns" },
        { kind: "balance", label: "Balança (linha)" },
      ])}
      <div class="exec-combo-chart__scroll">
        <svg class="exec-combo-chart__svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de aquisição, churn e balança por mês">
          ${gridLines}
          <line class="exec-chart-zero" x1="${pad.l}" y1="${zeroY}" x2="${W - pad.r}" y2="${zeroY}" />
          ${bars.join("")}
          <polyline class="exec-chart-balance-line" points="${polyline}" fill="none" />
          ${balanceDots}
        </svg>
      </div>
      <p class="exec-chart-footnote">Balança = aquisições − churn no mês. Churn mensal usa data analítica (effectiveCancellationDate).</p>
    </div>`;
}

function pctRatio(num, den) {
  if (!den) return "—";
  return `${pctFmt.format((num / den) * 100)}%`;
}

/** Barras agrupadas: intenções, pedidos, churn efetivo. */
export function cancellationFlowGrouped(series, limit = 12, referenceDate = new Date()) {
  const normalized = normalizeCancellationIntentionMonthSeries(series, referenceDate, limit);
  const visible = visibleSeries(normalized, limit);
  if (!visible.length) {
    return `<p class="placeholder-note">Sem meses históricos para exibir.</p>`;
  }

  const longMonths = visible.length >= 10;
  const totalIntentions = visible.reduce((s, r) => s + (r.intentions ?? 0), 0);
  const totalPedidos = visible.reduce((s, r) => s + (r.pedidos ?? 0), 0);
  const totalEffective = visible.reduce((s, r) => s + (r.effective ?? r.effectiveCancellations ?? 0), 0);

  const yMax = niceCeil(
    Math.max(...visible.flatMap((r) => [r.intentions ?? 0, r.pedidos ?? 0, r.effective ?? r.effectiveCancellations ?? 0]), 1),
  );

  const W = 880;
  const H = 272;
  const pad = { l: 48, r: 16, t: 28, b: 36 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const n = visible.length;
  const slot = plotW / n;
  const barW = Math.min(16, Math.max(8, slot * 0.2));
  const innerGap = 4;
  const baselineY = pad.t + plotH;
  const svgMinWidth = Math.max(640, n * 68);
  const denseLabels = n >= 10 || slot < 52;

  const yPx = (v) => pad.t + plotH - (v / yMax) * plotH;

  const gridLines = yTicks(0, yMax, 4)
    .map((tick) => {
      const y = yPx(tick);
      return `<line class="exec-chart-gridline" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" />
        <text class="exec-chart-axis-y" x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${fmt.format(Math.round(tick))}</text>`;
    })
    .join("");

  const groups = visible.map((row, i) => {
    const intentions = row.intentions ?? 0;
    const pedidos = row.pedidos ?? 0;
    const effective = row.effective ?? row.effectiveCancellations ?? 0;
    const cx = pad.l + slot * (i + 0.5);
    const totalW = barW * 3 + innerGap * 2;
    const x0 = cx - totalW / 2;
    const monthKey = row.month || row.label;
    const monthLabel = monthShortLabel(monthKey, longMonths);
    const tip = svgTooltip([
      monthTipLabel(monthKey, longMonths),
      `Intenções: ${fmt.format(intentions)}`,
      `Pedidos: ${fmt.format(pedidos)}`,
      `Churn efetivo: ${fmt.format(effective)}`,
    ]);

    const bar = (x, value, cls) => {
      const top = yPx(value);
      return `<rect class="exec-chart-bar ${cls}" x="${x}" y="${top}" width="${barW}" height="${Math.max(0, baselineY - top)}" rx="2">
        <title>${escapeHtml(tip)}</title>
      </rect>
      ${barValueLabel(x + barW / 2, top, value, { baselineY })}`;
    };

    return `<g class="exec-chart-bar-group">
      ${bar(x0, intentions, "exec-chart-bar--intention")}
      ${bar(x0 + barW + innerGap, pedidos, "exec-chart-bar--pedido")}
      ${bar(x0 + (barW + innerGap) * 2, effective, "exec-chart-bar--churn")}
      <rect class="exec-chart-hit" x="${x0 - 4}" y="${pad.t}" width="${totalW + 8}" height="${plotH}" fill="transparent">
        <title>${escapeHtml(tip)}</title>
      </rect>
      <text class="exec-chart-axis-x" x="${cx}" y="${H - 12}" text-anchor="middle">${escapeHtml(monthLabel)}</text>
    </g>`;
  });

  return `
    ${execChartKpiRow([
      { label: "Intenções", value: fmt.format(totalIntentions), note: "12 meses exibidos" },
      { label: "Pedidos", value: fmt.format(totalPedidos), note: "12 meses exibidos" },
      { label: "Churn efetivo", value: fmt.format(totalEffective), emphasis: true, note: "Data analítica" },
      {
        label: "Pedidos / Intenções",
        value: pctRatio(totalPedidos, totalIntentions),
        note: "Razão agregada no período",
        title:
          "Razão agregada entre a quantidade de pedidos e intenções no período. Não representa necessariamente conversão do mesmo cliente.",
      },
    ])}
    <p class="exec-chart-series-note">${escapeHtml(FLOW_SERIES_NOTE)}</p>
    <div class="exec-combo-chart exec-combo-chart--flow${denseLabels ? " exec-combo-chart--dense-labels" : ""}">
      ${execLegend([
        { kind: "intention", label: "Intenções" },
        { kind: "pedido", label: "Pedidos" },
        { kind: "churn", label: "Churn efetivo" },
      ])}
      <div class="exec-combo-chart__scroll">
        <svg class="exec-combo-chart__svg" style="min-width:${svgMinWidth}px" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de intenções, pedidos e churn efetivo por mês">
          ${gridLines}
          <line class="exec-chart-baseline" x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" />
          ${groups.join("")}
        </svg>
      </div>
      <p class="exec-chart-footnote">Churn efetivo usa a mesma data analítica da aba Cancelamentos.</p>
    </div>`;
}
