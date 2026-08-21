import { sortDistributionUnknownLast, sortUnknownLast } from "../lib/analytics/filters/sort-categories.mjs";

const STATUS_COLORS = {
  Ativo: "#0a0a0a",
  Congelado: "#d18426",
  "Cancelado confirmado": "#737373",
  "Cancelado efetivado sem data": "#a3a3a3",
  "Marcado como cancelado sem confirmação": "#c4c4c4",
  "Não informado": "#e5e5e5",
  Apto: "#c4c4c4",
  "Em andamento": "#d18426",
  Implementado: "#0a0a0a",
  "Tipos utilizados": "#0a0a0a",
  "Tipos sem utilização": "#c4c4c4",
  Sim: "#0a0a0a",
  Não: "#737373",
  Compareceu: "#0a0a0a",
  "No-show": "#e85d3a",
  Cancelada: "#737373",
  "Sem confirmação": "#c4c4c4",
  Promotores: "#0a0a0a",
  Neutros: "#c4c4c4",
  Detratores: "#e85d3a",
  "Satisfeitos (5)": "#0a0a0a",
  "Não satisfeitos (1-4)": "#737373",
  Resolvido: "#0a0a0a",
  Aberto: "#d18426",
  Pendente: "#c4c4c4",
  Novo: "#737373",
  Urgente: "#e85d3a",
  Alta: "#d18426",
  Média: "#737373",
  Baixa: "#c4c4c4",
  "App Pharus": "#0a0a0a",
  "QV360 Web": "#737373",
  Offboarding: "#d18426",
  "Cancelamento efetivado": "#737373",
  Retenção: "#0a0a0a",
  "Intenção/pedido": "#e85d3a",
  "Intenção ou pedido": "#e85d3a",
  "Nenhuma etapa": "#c4c4c4",
  Efetivado: "#737373",
  "Em retenção": "#0a0a0a",
};

export const CHART_CATEGORICAL_PALETTE = [
  "#e85d3a",
  "#0a0a0a",
  "#737373",
  "#d18426",
  "#4b5563",
  "#9ca3af",
  "#1f2937",
  "#cbd5e1",
  "#64748b",
  "#334155",
];

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colorForLabel(label, index = 0) {
  if (STATUS_COLORS[label]) return STATUS_COLORS[label];
  return CHART_CATEGORICAL_PALETTE[index % CHART_CATEGORICAL_PALETTE.length];
}

export function chartColorForLabel(label, index = 0) {
  return colorForLabel(label, index);
}

/** Botão padrão Ver todos / Ver menos para gráficos densos. */
export function chartExpandButton(chartId, { expanded = false, hidden = false, expandLabel = "Ver todos" } = {}) {
  if (hidden) return "";
  return `<button type="button" class="btn btn-chart btn-chart-expand" data-chart-expand="${escapeHtml(chartId)}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "Ver menos" : escapeHtml(expandLabel)}</button>`;
}

/** Renderiza hBars com limite inicial e metadados para expansão. */
export function hBarsExpandable(items, chartId, { limit = 8, expanded = false, compact = false } = {}) {
  const list = Array.isArray(items) ? items : [];
  const canExpand = list.length > limit;
  const visible = expanded || !canExpand ? list : list.slice(0, limit);
  return {
    html: hBars(visible, { compact, wrapLabels: true }),
    canExpand,
    total: list.length,
    limit,
    chartId,
    buttonHtml: chartExpandButton(chartId, { expanded, hidden: !canExpand }),
  };
}

/** Distribuição de mecanismos — nome, barra e métrica na mesma linha (referência V1). */
export function mechanismDistributionBars(items, { limit = 8, expanded = false, chartId = "mech-dist" } = {}) {
  const sorted = sortDistributionUnknownLast(
    (Array.isArray(items) ? items : []).map((item) => ({
      label: item.label,
      count: item.count ?? item.clients ?? item.linkedCount ?? 0,
      percent: item.percent ?? 0,
    })),
  );
  if (!sorted.length) return `<p class="placeholder-note">Sem dados</p>`;
  const canExpand = sorted.length > limit;
  const visible = expanded || !canExpand ? sorted : sorted.slice(0, limit);
  const max = Math.max(...visible.map((i) => i.count), 1);
  const rows = visible
    .map((item) => {
      const metric = `${item.count.toLocaleString("pt-BR")} · ${Number(item.percent).toLocaleString("pt-BR")}%`;
      const width = (item.count / max) * 100;
      return `<div class="mech-dist-row" title="${escapeHtml(item.label)}: ${escapeHtml(metric)}">
        <div class="mech-dist-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</div>
        <div class="mech-dist-track"><span style="width:${width}%"></span></div>
        <div class="mech-dist-val">${escapeHtml(metric)}</div>
      </div>`;
    })
    .join("");
  const button = chartExpandButton(chartId, { expanded, hidden: !canExpand });
  return `<div class="mech-dist-list">${rows}</div>${button}`;
}

export function hBars(items, limitOrOptions) {
  const options =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions || {};
  const list = options.limit ? items.slice(0, options.limit) : items;
  const max = Math.max(...list.map((i) => i.count), 1);
  if (!list.length) return `<p class="placeholder-note">Sem dados</p>`;
  const layoutClass = options.compact ? " hbar-layout--compact" : " hbar-layout--wide";
  const wrapLabels = options.wrapLabels !== false;
  return `<div class="hbar-list${layoutClass}">${list
    .map((i) => {
      const metric = `${i.count.toLocaleString("pt-BR")} · ${Number(i.percent).toLocaleString("pt-BR")}%`;
      const width = (i.count / max) * 100;
      const labelClass = wrapLabels ? "hbar-label hbar-label--wrap" : "hbar-label";
      return `<div class="hbar" title="${escapeHtml(i.label)}: ${escapeHtml(metric)}">
        <div class="${labelClass}" title="${escapeHtml(i.label)}">${escapeHtml(i.label)}</div>
        <div class="hbar-track"><span style="width:${width}%"></span></div>
        <div class="hbar-val">${escapeHtml(metric)}</div>
      </div>`;
    })
    .join("")}</div>`;
}

/** Barras verticais categóricas — mesma linguagem visual de acquisitionColumns / dualColumns. */
export function vBars(items, options = {}) {
  const list = Array.isArray(items) ? items.filter((item) => (item?.count || 0) > 0) : [];
  if (!list.length) return `<p class="placeholder-note">Sem dados</p>`;
  const plotH = options.height ?? 180;
  const max = Math.max(...list.map((item) => item.count), 1);
  return `<div class="acq-chart-scroll"><div class="acq-chart-grid vbar-chart" data-cols="${list.length}">${list
    .map((item, index) => {
      const count = Number(item.count) || 0;
      const percent = item.percent != null ? Number(item.percent) : null;
      const barPx = count > 0 ? Math.max(Math.round((count / max) * plotH), 6) : 0;
      const color = colorForLabel(item.label, index);
      const metric =
        percent != null && Number.isFinite(percent)
          ? `${count.toLocaleString("pt-BR")} · ${percent.toLocaleString("pt-BR")}%`
          : count.toLocaleString("pt-BR");
      return `<div class="acq-col vbar-col" title="${escapeHtml(item.label)}: ${escapeHtml(metric)}">
        <div class="acq-col-value">${count.toLocaleString("pt-BR")}</div>
        ${percent != null && Number.isFinite(percent) ? `<div class="acq-col-sub">${percent.toLocaleString("pt-BR")}%</div>` : ""}
        <div class="vbar-track"><div class="acq-col-bar" style="height:${barPx}px;background:${color}"></div></div>
        <div class="acq-col-label">${escapeHtml(item.label)}</div>
      </div>`;
    })
    .join("")}</div></div>`;
}

export function rankedBars(items, { limit = 3, note = "" } = {}) {
  const list = (items || []).slice(0, limit);
  if (!list.length) return `<p class="placeholder-note">Sem dados</p>`;
  const max = Math.max(...list.map((i) => i.count), 1);
  return `<ol class="ranked-bar-list">${list
    .map((item, index) => {
      const width = (item.count / max) * 100;
      const metric = `${Number(item.count).toLocaleString("pt-BR")} · ${Number(item.percent ?? 0).toLocaleString("pt-BR")}%`;
      return `<li class="ranked-bar-item">
        <span class="ranked-bar-item__rank">${index + 1}</span>
        <div class="ranked-bar-item__body">
          <div class="ranked-bar-item__head">
            <span class="ranked-bar-item__label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
            <strong class="ranked-bar-item__metric">${escapeHtml(metric)}</strong>
          </div>
          <div class="ranked-bar-item__track"><span style="width:${width}%"></span></div>
        </div>
      </li>`;
    })
    .join("")}</ol>${note ? `<p class="chart-note">${escapeHtml(note)}</p>` : ""}`;
}

export function donut(items) {
  if (!items.length) return `<p class="placeholder-note">Sem dados</p>`;
  const total = items.reduce((a, i) => a + i.count, 0) || 1;
  let offset = 0;
  const radius = 42;
  const c = 2 * Math.PI * radius;
  const arcs = items
    .map((item, index) => {
      const len = (item.count / total) * c;
      const stroke = colorForLabel(item.label, index);
      const circle = `<circle cx="60" cy="60" r="${radius}" fill="none" stroke="${stroke}" stroke-width="14" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"></circle>`;
      offset += len;
      return circle;
    })
    .join("");
  const legend = items
    .map((item, index) => {
      const color = colorForLabel(item.label, index);
      return `<div><i style="background:${color}"></i>${escapeHtml(item.label)} — ${item.count.toLocaleString("pt-BR")} (${Number(item.percent).toLocaleString("pt-BR")}%)</div>`;
    })
    .join("");
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">${arcs}<circle cx="60" cy="60" r="28" fill="#ffffff"></circle></svg><div class="legend">${legend}</div></div>`;
}

function monthShortLabel(ym, long) {
  const [y, m] = String(ym).split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const idx = Number(m) - 1;
  if (!y || idx < 0 || idx > 11) return ym;
  return long ? `${names[idx]}/${String(y).slice(2)}` : names[idx];
}

export function acquisitionColumns(series, limit) {
  if (!series.length) {
    return `<p class="placeholder-note">Sem meses históricos de aquisição para exibir.</p>`;
  }
  const maxValue = Math.max(...series.map((i) => i.acquiredClients), 0);
  const plotH = 180;
  const long = Number(limit) >= 12;
  return `<div class="acq-chart-scroll"><div class="acq-chart-grid" data-cols="${series.length}">${series
    .map((i, idx) => {
      const heightPct = maxValue > 0 ? (i.acquiredClients / maxValue) * 100 : 0;
      const barPx = i.acquiredClients > 0 ? Math.max(Math.round((heightPct / 100) * plotH), 6) : 0;
      const latest = idx === series.length - 1;
      return `<div class="acq-col${latest ? " is-latest" : ""}" title="${escapeHtml(i.month)}: ${i.acquiredClients}">
        <div class="acq-col-value">${i.acquiredClients.toLocaleString("pt-BR")}</div>
        <div class="acq-col-bar" style="height:${barPx}px"></div>
        <div class="acq-col-label">${escapeHtml(monthShortLabel(i.month, long))}</div>
      </div>`;
    })
    .join("")}</div></div>`;
}

function dualGroupedColumns(series, {
  limit = 12,
  primaryKey = "scheduled",
  secondaryKey = "completed",
  primaryLabel = "Agend.",
  secondaryLabel = "Real.",
  primaryClass = "scheduled",
  secondaryClass = "completed",
  legendPrimary = "Agendadas",
  legendSecondary = "Realizadas",
  emptyNote = "Sem meses históricos para exibir.",
} = {}) {
  if (!series.length) {
    return `<p class="placeholder-note">${escapeHtml(emptyNote)}</p>`;
  }
  const visible = series.slice(-limit);
  const maxValue = Math.max(...visible.flatMap((i) => [i[primaryKey] || 0, i[secondaryKey] || 0]), 0);
  const plotH = 180;
  const long = Number(limit) >= 12;
  const minCol = 56;
  return `<div class="acq-chart-scroll"><div class="acq-chart-grid dual-chart" style="min-width:${visible.length * minCol}px" data-cols="${visible.length}">${visible
    .map((i) => {
      const primary = Number(i[primaryKey] || 0);
      const secondary = Number(i[secondaryKey] || 0);
      const primaryPx = maxValue > 0 && primary ? Math.max(Math.round((primary / maxValue) * plotH), 6) : 0;
      const secondaryPx = maxValue > 0 && secondary ? Math.max(Math.round((secondary / maxValue) * plotH), 6) : 0;
      return `<div class="acq-col dual-col" title="${escapeHtml(i.month)}: ${primary.toLocaleString("pt-BR")} · ${secondary.toLocaleString("pt-BR")}">
        <div class="dual-bars">
          <div class="dual-bar-group">
            <div class="acq-col-value">${primary.toLocaleString("pt-BR")}</div>
            <div class="acq-col-bar dual-bar ${primaryClass}" style="height:${primaryPx}px"></div>
            <div class="dual-bar-series-label">${escapeHtml(primaryLabel)}</div>
          </div>
          <div class="dual-bar-group">
            <div class="acq-col-value">${secondary.toLocaleString("pt-BR")}</div>
            <div class="acq-col-bar dual-bar ${secondaryClass}" style="height:${secondaryPx}px"></div>
            <div class="dual-bar-series-label">${escapeHtml(secondaryLabel)}</div>
          </div>
        </div>
        <div class="acq-col-label">${escapeHtml(monthShortLabel(i.month, long))}</div>
      </div>`;
    })
    .join("")}</div></div>
    <p class="chart-legend-note"><span class="swatch ${primaryClass}"></span> ${escapeHtml(legendPrimary)} <span class="swatch ${secondaryClass}"></span> ${escapeHtml(legendSecondary)}</p>`;
}

export function dualColumns(series, limit = 6) {
  return dualGroupedColumns(series, { limit });
}

/** Intenções vs efetivados por mês — colunas verticais agrupadas (estilo V1). */
export function intentionEffectiveColumns(series, limit = 12) {
  return dualGroupedColumns(
    series.map((item) => ({
      month: item.month,
      intentions: item.intentions || 0,
      effective: item.effective || 0,
    })),
    {
      limit,
      primaryKey: "intentions",
      secondaryKey: "effective",
      primaryLabel: "Int.",
      secondaryLabel: "Efet.",
      primaryClass: "intention",
      secondaryClass: "effective",
      legendPrimary: "Intenções/pedidos",
      legendSecondary: "Efetivados",
      emptyNote: "Sem meses históricos para exibir.",
    },
  );
}

/** Utilização por tipo — duas barras horizontais empilhadas (estilo V1). */
export function mechanismTypeDualBars(items, { limit = 8, expanded = false } = {}) {
  const list = sortUnknownLast(Array.isArray(items) ? items : [], (item) => item.label, (a, b) => {
    const linkedDiff = (b.linkedCount ?? b.count ?? 0) - (a.linkedCount ?? a.count ?? 0);
    return linkedDiff || String(a.label).localeCompare(String(b.label), "pt-BR");
  });
  if (!list.length) return `<p class="placeholder-note">Sem tipos no catálogo</p>`;
  const canExpand = list.length > limit;
  const visible = expanded || !canExpand ? list : list.slice(0, limit);
  const maxLinked = Math.max(...visible.map((i) => i.linkedCount ?? i.count ?? 0), 1);
  const rows = visible
    .map((item) => {
      const linked = item.linkedCount ?? item.count ?? 0;
      const implemented = item.implementedCount ?? 0;
      const pctVal =
        item.implementationPercent != null && Number.isFinite(Number(item.implementationPercent))
          ? `${Number(item.implementationPercent).toLocaleString("pt-BR")}%`
          : linked
            ? `${Math.round((implemented / linked) * 1000) / 10}%`.replace(".", ",")
            : "—";
      const wLinked = (linked / maxLinked) * 100;
      const wImpl = linked ? (implemented / maxLinked) * 100 : 0;
      const meta = `${linked.toLocaleString("pt-BR")} vinculados · ${implemented.toLocaleString("pt-BR")} impl.`;
      return `<div class="type-stat-row" title="${escapeHtml(item.label)}: ${escapeHtml(meta)} · ${escapeHtml(pctVal)}">
        <div class="type-stat-label truncate" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</div>
        <div class="type-stat-bars">
          <div class="type-stat-track"><span class="type-stat-fill-linked" style="width:${wLinked}%"></span></div>
          <div class="type-stat-track"><span class="type-stat-fill-impl" style="width:${wImpl}%"></span></div>
          <div class="type-stat-meta">${escapeHtml(meta)}</div>
        </div>
        <div class="type-stat-pct">${escapeHtml(pctVal)}</div>
      </div>`;
    })
    .join("");
  const button = canExpand
    ? `<button type="button" class="btn btn-chart btn-chart-expand" data-mk-types-expand aria-expanded="${expanded ? "true" : "false"}">${expanded ? "Ver menos" : "Ver todos"}</button>`
    : "";
  return `${rows}${button}`;
}
