/**
 * Componentes visuais para heatmaps/matrizes estatísticas (somente apresentação).
 * Dois layouts distintos: matriz simétrica (Spearman/coorte) e tabela ranking (eixos analíticos).
 */
import { escapeHtml } from "../general-charts.mjs";

const DEFAULT_CELL_SIZE = 70;
const DEFAULT_LABEL_WIDTH = 220;

const RANKING_METRIC_WIDTHS = {
  association: 110,
  stdDiff: 120,
  aucAdjusted: 100,
  coveragePercent: 110,
  percent: 80,
  n: 80,
  default: 100,
};

function normalizeLabel(item) {
  if (item == null) return { id: "", label: "" };
  if (typeof item === "string") return { id: item, label: item };
  return { id: item.id || item.label || "", label: item.label || item.id || "" };
}

function wrapHeaderLabel(label, maxLen = 16, maxLines = 2) {
  const text = String(label || "");
  if (text.length <= maxLen) return escapeHtml(text);
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLen && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines).map((l) => escapeHtml(l)).join("<br/>");
}

function rankingColumnWidth(col) {
  const id = col?.id || col?.metricId || "";
  if (col?.width) return col.width;
  return RANKING_METRIC_WIDTHS[id] || RANKING_METRIC_WIDTHS.default;
}

function buildStyleVars(vars) {
  return Object.entries(vars)
    .filter(([, value]) => value != null)
    .map(([key, value]) => `--matrix-${key}:${value}`)
    .join(";");
}

/**
 * Matriz simétrica (variável × variável, coorte, etc.) — células quadradas.
 */
export function renderStatisticalMatrix({
  columns = [],
  rows = [],
  cornerLabel = "",
  legendHtml = "",
  note = "",
  detailsHtml = "",
  compact = false,
  cellSize = DEFAULT_CELL_SIZE,
  labelWidth = DEFAULT_LABEL_WIDTH,
  rotateHeaders = false,
} = {}) {
  if (!rows.length) {
    return `<p class="placeholder-note">Não há variáveis suficientes para esta matriz neste recorte.</p>`;
  }

  const colCount = columns.length;
  const useRotation = rotateHeaders && colCount > 14;
  const size = Math.max(68, Math.min(76, cellSize));
  const label = Math.max(220, Math.min(280, labelWidth));
  const styleVars = buildStyleVars({
    "cell-size": `${size}px`,
    "row-label-width": `${label}px`,
  });

  const headCells = columns
    .map((col) => {
      const c = normalizeLabel(col);
      const title = col.title || c.label;
      const sub = col.sublabel ? `<span class="matrix-col-sub">${escapeHtml(col.sublabel)}</span>` : "";
      const cls = useRotation ? " matrix-col-head-rotated" : "";
      return `<th class="matrix-col-head${cls}" title="${escapeHtml(title)}">${wrapHeaderLabel(c.label, useRotation ? 18 : 14)}${sub}</th>`;
    })
    .join("");

  const bodyRows = rows
    .map((row) => {
      const r = normalizeLabel(row);
      const cells = (row.cells || [])
        .map((cell) => {
          const display = cell?.display ?? "—";
          const bg = cell?.bg || "#3a3a3a";
          const color = cell?.color || "#ccc";
          const tip = cell?.tooltip ? ` data-matrix-tip="${escapeHtml(cell.tooltip)}"` : "";
          const extra = cell?.className ? ` ${cell.className}` : "";
          return `<td class="matrix-cell num${extra}"${tip} style="background:${bg};color:${color}">${escapeHtml(String(display))}</td>`;
        })
        .join("");
      const trailing = row.trailing != null ? `<td class="num matrix-trailing">${escapeHtml(String(row.trailing))}</td>` : "";
      return `<tr><th class="matrix-row-label matrix-row-label-clamp" title="${escapeHtml(r.title || r.label)}">${escapeHtml(r.label)}</th>${cells}${trailing}</tr>`;
    })
    .join("");

  const compactClass = compact ? " matrix-compact" : "";
  const legend = legendHtml ? `<div class="matrix-legend">${legendHtml}</div>` : "";
  const noteHtml = note ? `<p class="note-muted matrix-note">${escapeHtml(note)}</p>` : "";
  const trailingHead = rows.some((r) => r.trailing != null) ? `<th class="num matrix-trailing">n</th>` : "";

  return `
    ${legend}
    ${noteHtml}
    <div class="matrix-panel" data-matrix-panel>
      <div class="matrix-panel-toolbar">
        <button type="button" class="btn btn-secondary btn-sm matrix-expand-btn" data-matrix-expand aria-label="Expandir matriz">Expandir matriz</button>
      </div>
      <div class="matrix-scroll matrix-scroll-symmetric${compactClass}" style="${styleVars}" data-matrix-root data-matrix-kind="symmetric">
        <table class="matrix-grid matrix-grid--symmetric gd-table" role="grid">
          <thead><tr><th class="matrix-row-label matrix-corner">${escapeHtml(cornerLabel)}</th>${headCells}${trailingHead}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>
    ${detailsHtml || ""}
    <div class="matrix-float-tip" id="matrixFloatTip" role="tooltip" hidden></div>`;
}

/**
 * Tabela analítica ranking (Variável | Correlação | Diferença | AUC | …) — colunas proporcionais.
 */
export function renderRankingHeatmapTable({
  columns = [],
  rows = [],
  cornerLabel = "Variável",
  legendHtml = "",
  note = "",
  detailsHtml = "",
  labelWidth = 280,
  trailingLabel = "n",
} = {}) {
  if (!rows.length) {
    return `<p class="placeholder-note">Não há variáveis suficientes para esta matriz neste recorte.</p>`;
  }

  const label = Math.max(260, Math.min(320, labelWidth));
  const colWidths = columns.map((col) => rankingColumnWidth(col));
  const gridTemplate = `${label}px ${colWidths.map((w) => `${w}px`).join(" ")}${rows.some((r) => r.trailing != null) ? ` ${RANKING_METRIC_WIDTHS.n}px` : ""}`;
  const styleVars = buildStyleVars({
    "row-label-width": `${label}px`,
    "ranking-template": gridTemplate,
  });

  const headCells = columns
    .map((col, index) => {
      const c = normalizeLabel(col);
      const title = col.title || c.label;
      const sub = col.sublabel ? `<span class="matrix-col-sub">${escapeHtml(col.sublabel)}</span>` : "";
      return `<th class="matrix-rank-head" style="width:${colWidths[index]}px;min-width:${colWidths[index]}px" title="${escapeHtml(title)}">${wrapHeaderLabel(c.label, 14, 2)}${sub}</th>`;
    })
    .join("");

  const bodyRows = rows
    .map((row) => {
      const r = normalizeLabel(row);
      const cells = (row.cells || [])
        .map((cell, index) => {
          const display = cell?.display ?? "—";
          const bg = cell?.bg || "#3a3a3a";
          const color = cell?.color || "#ccc";
          const tip = cell?.tooltip ? ` data-matrix-tip="${escapeHtml(cell.tooltip)}"` : "";
          const extra = cell?.className ? ` ${cell.className}` : "";
          return `<td class="matrix-rank-cell num${extra}" style="width:${colWidths[index]}px;min-width:${colWidths[index]}px;background:${bg};color:${color}"${tip}>${escapeHtml(String(display))}</td>`;
        })
        .join("");
      const trailing = row.trailing != null ? `<td class="num matrix-rank-trailing">${escapeHtml(String(row.trailing))}</td>` : "";
      return `<tr class="matrix-rank-row"><th class="matrix-row-label matrix-row-label-clamp matrix-rank-label" title="${escapeHtml(r.title || r.label)}">${escapeHtml(r.label)}</th>${cells}${trailing}</tr>`;
    })
    .join("");

  const legend = legendHtml ? `<div class="matrix-legend">${legendHtml}</div>` : "";
  const noteHtml = note ? `<p class="note-muted matrix-note">${escapeHtml(note)}</p>` : "";
  const trailingHead = rows.some((r) => r.trailing != null)
    ? `<th class="num matrix-rank-trailing">${escapeHtml(trailingLabel)}</th>`
    : "";

  return `
    ${legend}
    ${noteHtml}
    <div class="matrix-panel" data-matrix-panel>
      <div class="matrix-panel-toolbar">
        <button type="button" class="btn btn-secondary btn-sm matrix-expand-btn" data-matrix-expand aria-label="Expandir matriz">Expandir matriz</button>
      </div>
      <div class="matrix-scroll matrix-scroll-ranking" style="${styleVars}" data-matrix-root data-matrix-kind="ranking">
        <table class="matrix-grid matrix-grid--ranking gd-table" role="grid">
          <thead><tr><th class="matrix-row-label matrix-corner matrix-rank-label">${escapeHtml(cornerLabel)}</th>${headCells}${trailingHead}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>
    ${detailsHtml || ""}
    <div class="matrix-float-tip" id="matrixFloatTip" role="tooltip" hidden></div>`;
}

/**
 * Heatmap com colunas dinâmicas proporcionais (ex.: matriz comparativa por grupo).
 */
export function renderProportionalHeatmapTable({
  columns = [],
  rows = [],
  cornerLabel = "",
  legendHtml = "",
  note = "",
  cellMinWidth = 92,
  labelWidth = 220,
} = {}) {
  if (!rows.length) {
    return `<p class="placeholder-note">Não há variáveis suficientes para esta matriz neste recorte.</p>`;
  }

  const label = Math.max(190, Math.min(240, labelWidth));
  const colWidth = Math.max(80, cellMinWidth);
  const rankingColumns = columns.map((col) => ({
    ...col,
    id: col.id || col.label,
    width: col.width || colWidth,
  }));

  return renderRankingHeatmapTable({
    columns: rankingColumns,
    rows,
    cornerLabel,
    legendHtml,
    note,
    labelWidth: label,
  });
}

/** Extrai valores renderizados para testes de fidelidade numérica. */
export function extractMatrixRenderedValues(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  return [...doc.querySelectorAll(".matrix-cell, .matrix-rank-cell")].map((el) => el.textContent.trim());
}

export function bindMatrixTooltips(root = document) {
  const host = root.querySelector?.("[data-matrix-root]")?.closest?.(".chart-card, .section-block, #page-content") || root;
  let tip = host.querySelector("#matrixFloatTip");
  if (!tip && host !== root) tip = document.getElementById("matrixFloatTip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "matrixFloatTip";
    tip.className = "matrix-float-tip";
    tip.hidden = true;
    tip.setAttribute("role", "tooltip");
    (host.body ? document.body : host).appendChild(tip);
  }

  const scrolls = host.querySelectorAll ? host.querySelectorAll(".matrix-scroll[data-matrix-root]") : [];
  for (const scroll of scrolls) {
    scroll.addEventListener("mouseover", (event) => {
      const cell = event.target.closest(".matrix-cell[data-matrix-tip], .matrix-rank-cell[data-matrix-tip]");
      if (!cell || !scroll.contains(cell)) return;
      tip.textContent = cell.getAttribute("data-matrix-tip") || "";
      tip.hidden = false;
      const rect = cell.getBoundingClientRect();
      tip.style.left = `${rect.left + rect.width / 2}px`;
      tip.style.top = `${rect.top - 8}px`;
    });
    scroll.addEventListener("mouseout", (event) => {
      if (event.relatedTarget?.closest?.(".matrix-cell[data-matrix-tip], .matrix-rank-cell[data-matrix-tip]")) return;
      tip.hidden = true;
    });
  }
}

export function bindMatrixExpand(root = document) {
  const host = root.querySelector?.("#page-content") || root;
  if (!host?.querySelectorAll) return;

  host.querySelectorAll("[data-matrix-expand]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const panel = btn.closest("[data-matrix-panel]");
      const scroll = panel?.querySelector("[data-matrix-root]");
      if (!scroll) return;
      const overlay = document.createElement("div");
      overlay.className = "matrix-expand-overlay";
      overlay.innerHTML = `
        <div class="matrix-expand-shell" role="dialog" aria-modal="true">
          <header class="matrix-expand-head">
            <strong>Matriz ampliada</strong>
            <button type="button" class="btn btn-secondary btn-sm" data-matrix-expand-close>Fechar</button>
          </header>
          <div class="matrix-expand-body"></div>
        </div>`;
      const body = overlay.querySelector(".matrix-expand-body");
      body.appendChild(scroll.cloneNode(true));
      document.body.appendChild(overlay);
      bindMatrixTooltips(overlay);
      const close = () => overlay.remove();
      overlay.querySelector("[data-matrix-expand-close]")?.addEventListener("click", close);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close();
      });
    });
  });
}
