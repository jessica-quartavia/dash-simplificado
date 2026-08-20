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
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function hBars(items, limit) {
  const list = limit ? items.slice(0, limit) : items;
  const max = Math.max(...list.map((i) => i.count), 1);
  if (!list.length) return `<p class="placeholder-note">Sem dados</p>`;
  return list
    .map((i) => {
      const metric = `${i.count.toLocaleString("pt-BR")} · ${Number(i.percent).toLocaleString("pt-BR")}%`;
      const width = (i.count / max) * 100;
      return `<div class="hbar" title="${escapeHtml(i.label)}: ${escapeHtml(metric)}">
        <div class="hbar-label" title="${escapeHtml(i.label)}">${escapeHtml(i.label)}</div>
        <div class="hbar-track"><span style="width:${width}%"></span></div>
        <div class="hbar-val">${escapeHtml(metric)}</div>
      </div>`;
    })
    .join("");
}

export function donut(items) {
  if (!items.length) return `<p class="placeholder-note">Sem dados</p>`;
  const total = items.reduce((a, i) => a + i.count, 0) || 1;
  let offset = 0;
  const radius = 42;
  const c = 2 * Math.PI * radius;
  const arcs = items
    .map((item) => {
      const len = (item.count / total) * c;
      const stroke = STATUS_COLORS[item.label] || "#737373";
      const circle = `<circle cx="60" cy="60" r="${radius}" fill="none" stroke="${stroke}" stroke-width="14" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"></circle>`;
      offset += len;
      return circle;
    })
    .join("");
  const legend = items
    .map((item) => {
      const color = STATUS_COLORS[item.label] || "#737373";
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

export function dualColumns(series, limit = 6) {
  if (!series.length) {
    return `<p class="placeholder-note">Sem meses históricos para exibir.</p>`;
  }
  const historical = [...series].sort((a, b) => b.month.localeCompare(a.month));
  const visible = historical.slice(0, limit).reverse();
  const maxValue = Math.max(...visible.flatMap((i) => [i.scheduled || 0, i.completed || 0]), 0);
  const plotH = 180;
  const long = Number(limit) >= 12;
  return `<div class="acq-chart-scroll"><div class="acq-chart-grid dual-chart" data-cols="${visible.length}">${visible
    .map((i) => {
      const scheduledPx = maxValue > 0 && i.scheduled ? Math.max(Math.round((i.scheduled / maxValue) * plotH), 6) : 0;
      const completedPx = maxValue > 0 && i.completed ? Math.max(Math.round((i.completed / maxValue) * plotH), 6) : 0;
      return `<div class="acq-col dual-col" title="${escapeHtml(i.month)}: ${i.scheduled} agendadas · ${i.completed} realizadas">
        <div class="acq-col-value">${Number(i.scheduled || 0).toLocaleString("pt-BR")}</div>
        <div class="dual-bars">
          <div class="acq-col-bar dual-bar scheduled" style="height:${scheduledPx}px"></div>
          <div class="acq-col-bar dual-bar completed" style="height:${completedPx}px"></div>
        </div>
        <div class="acq-col-label">${escapeHtml(monthShortLabel(i.month, long))}</div>
      </div>`;
    })
    .join("")}</div></div>
    <p class="chart-legend-note"><span class="swatch scheduled"></span> Agendadas <span class="swatch completed"></span> Realizadas</p>`;
}
