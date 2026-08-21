import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  SC_STATUS_FILTER_OPTIONS,
  buildStatisticalCrossesApiUrl,
  defaultStatisticalCrossesFilters,
  normalizeStatisticalCrossesFilters,
  scPassMin,
} from "../lib/analytics/statistical-crosses-filters.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";
import { escapeHtml } from "./general-charts.mjs";
import {
  bindFilterBar,
  fillDynamicSelect,
  renderFilterBar,
} from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import {
  bindMatrixTooltips,
  bindMatrixExpand,
  bindMatrixViewToggle,
  renderStatisticalMatrix,
  renderRankingHeatmapTable,
  renderProportionalHeatmapTable,
} from "./components/statistical-matrix.js";
import { renderSurvivalSection, bindSurvivalChart } from "./components/survival-chart.mjs";
import {
  renderActiveCancelledDiffChart,
  SC_DIFF_UNIT_OPTIONS,
} from "./components/statistical-diff-chart.mjs";
import { sortLabelsUnknownLast } from "../lib/analytics/filters/sort-categories.mjs";

const fmt = new Intl.NumberFormat("pt-BR");

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultStatisticalCrossesFilters(),
  showAllDiscoveries: false,
  survivalCompare: "overall",
  diffUnit: "time",
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "scSearch", key: "search", label: "Busca" },
  { kind: "select", id: "scEngineer", key: "engineer", label: "Engenheiro Patrimonial", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "scStatus", key: "status", label: "Status", options: SC_STATUS_FILTER_OPTIONS },
  { kind: "select", id: "scProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
  { kind: "period", id: "scPeriod", fromId: "scFrom", toId: "scTo", key: "period", label: "Período" },
  { kind: "number", id: "scMinCoverage", key: "minCoverage", label: "Cobertura mínima (%)", min: 0, max: 100, step: 1, default: 30, title: "Cobertura mínima para exibir variável" },
  { kind: "number", id: "scMinSample", key: "minSample", label: "Amostra mínima", min: 1, step: 1, default: 5, title: "Mínimo por grupo para mediana descritiva" },
];

function $(id) {
  return document.getElementById(id);
}

function uniqueSorted(values) {
  return sortLabelsUnknownLast(values.filter(Boolean));
}

function filtersFromForm() {
  return normalizeStatisticalCrossesFilters({
    search: $("scSearch")?.value || "",
    period: $("scPeriod")?.value || "all",
    from: $("scFrom")?.value || "",
    to: $("scTo")?.value || "",
    engineer: $("scEngineer")?.value || "all",
    status: $("scStatus")?.value || "active_cancelled",
    program: normalizeProgramFilter($("scProgram")?.value || "all"),
    minCoverage: $("scMinCoverage")?.value ?? 30,
    minSample: $("scMinSample")?.value ?? 5,
    cohortGranularity: $("scCohortGranularity")?.value || state.filters.cohortGranularity,
    cohortPeriod: $("scCohortPeriod")?.value || state.filters.cohortPeriod,
    cohortCellMode: $("scCohortCellMode")?.value || state.filters.cohortCellMode,
    cohortMinN: $("scCohortMinN")?.value ?? state.filters.cohortMinN,
  });
}

function currentThresholds() {
  const f = state.filters || defaultStatisticalCrossesFilters();
  return { minCoverage: f.minCoverage ?? 30, minSample: f.minSample ?? 5 };
}

function pctLabel(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;
}

function numLabel(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

function fmtAssoc(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(value).toFixed(3).replace(".", ",");
}

function dateBR(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.primary) classes.push("kpi-card-featured");
  return `<article class="${classes.join(" ")}">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}

function scStatusLabel(status, reason) {
  if (!status || status === "available") return "";
  const map = {
    small_sample: "Amostra pequena",
    low_coverage: "Baixa cobertura",
    constant: "Variável constante",
    insufficient_groups: "Grupos insuficientes",
    invalid: "Inválido",
    leakage: "Risco de leakage",
    error: "Erro de cálculo",
  };
  return map[status] || reason || status;
}

function corrColor(v) {
  if (v == null || !Number.isFinite(Number(v))) return { bg: "#3a3a3a", text: "#ccc" };
  const x = Math.max(-1, Math.min(1, Number(v)));
  const t = Math.abs(x);
  let r;
  let g;
  let b;
  if (x >= 0) {
    r = Math.round(55 + t * (220 - 55));
    g = Math.round(55 + t * (90 - 55));
    b = Math.round(55 + t * (40 - 55));
  } else {
    r = Math.round(55 + t * (40 - 55));
    g = Math.round(55 + t * (110 - 55));
    b = Math.round(55 + t * (220 - 55));
  }
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return { bg: `rgb(${r},${g},${b})`, text: lum > 140 ? "#111" : "#f5f5f5" };
}

function seqColor(t) {
  const x = Math.max(0, Math.min(1, Number(t) || 0));
  const r = Math.round(40 + (1 - x) * 160);
  const g = Math.round(60 + x * 100);
  const b = Math.round(90 + x * 130);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return { bg: `rgb(${r},${g},${b})`, text: lum > 140 ? "#111" : "#f5f5f5" };
}

function retentionColor(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return { bg: "#3a3a3a", text: "#ccc" };
  const t = Math.max(0, Math.min(1, Number(pct) / 100));
  const r = Math.round(210 - t * 150);
  const g = Math.round(70 + t * 130);
  const b = Math.round(50 + t * 120);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return { bg: `rgb(${r},${g},${b})`, text: lum > 140 ? "#111" : "#f5f5f5" };
}

function groupStdColor(std) {
  if (std == null || !Number.isFinite(Number(std))) return { bg: "#3a3a3a", text: "#ccc" };
  const v = Math.max(-1.2, Math.min(1.2, Number(std)));
  const t = (v + 1.2) / 2.4;
  const stops = [
    [29, 78, 216],
    [96, 165, 250],
    [107, 114, 128],
    [251, 146, 60],
    [239, 68, 68],
  ];
  const x = t * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[Math.min(i, stops.length - 1)];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
  return { bg: `rgb(${r},${g},${bl})`, text: lum > 140 ? "#111" : "#f5f5f5" };
}

function renderAxisHeatmapTable(matrix) {
  if (!matrix?.rows?.length) {
    return `<p class="placeholder-note">Não há variáveis suficientes para esta matriz neste recorte.</p>`;
  }
  const metrics = matrix.metrics || [];
  const legendSigned = metrics.some((m) => m.signed !== false && !m.sequential);
  const legendHtml = legendSigned
    ? `<span class="sc-heatmap-swatch" style="background:#dc5025"></span> Positiva <span class="sc-heatmap-swatch" style="background:#3b82f6"></span> Negativa <span class="note-muted">Escala −1 a +1</span>`
    : `<span class="sc-heatmap-swatch sc-heatmap-swatch-seq"></span> Fraco → forte`;
  const columns = metrics.map((m) => ({ id: m.id, label: m.label, title: m.label }));
  const rows = matrix.rows.map((row) => ({
    label: row.label || row.id,
    trailing: row.n ?? "—",
    cells: metrics.map((m) => {
      const raw = row[m.id];
      let colors;
      let txt;
      if (raw == null || !Number.isFinite(Number(raw))) {
        colors = { bg: "#3a3a3a", text: "#bbb" };
        txt = "—";
      } else if (m.sequential || !m.signed) {
        const max = m.scaleMax || 1;
        colors = seqColor(Number(raw) / max);
        txt = m.scaleMax === 100 ? `${Number(raw).toFixed(0)}%` : Number(raw).toFixed(2).replace(".", ",");
      } else {
        colors = corrColor(Number(raw));
        txt = Number(raw).toFixed(2).replace(".", ",");
      }
      const tip = `${row.label || row.id} · ${m.label}: ${txt}${row.n != null ? ` · n=${row.n}` : ""}${row.coveragePercent != null ? ` · cobertura=${Number(row.coveragePercent).toFixed(0)}%` : ""}`;
      return { display: txt, bg: colors.bg, color: colors.text, tooltip: tip };
    }),
  }));
  return renderRankingHeatmapTable({
    columns,
    rows,
    cornerLabel: "Variável",
    legendHtml,
    note: matrix.note || "",
    labelWidth: 250,
  });
}

function renderCorrelationMatrixTable(matrix) {
  if (!matrix?.variables?.length) {
    return `<p class="placeholder-note">Não há variáveis suficientes selecionadas para a matriz.</p>`;
  }
  const vars = matrix.variables;
  const byKey = new Map((matrix.cells || []).map((c) => [c.idA + "||" + c.idB, c]));
  const columns = vars.map((v) => ({ label: v.label || v.id, title: v.label || v.id }));
  const rows = vars.map((row) => ({
    label: row.label || row.id,
    cells: vars.map((col) => {
      const cell = byKey.get(row.id + "||" + col.id) || byKey.get(col.id + "||" + row.id);
      const v = cell?.value;
      const colors = corrColor(v);
      const txt = v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(2).replace(".", ",");
      const tip = cell
        ? `${cell.labelA} × ${cell.labelB}\nSpearman: ${txt}\nn=${cell.n ?? "—"}\n${cell.strength || "—"}`
        : "Sem dados";
      return { display: txt, bg: colors.bg, color: colors.text, tooltip: tip, className: v == null ? "matrix-empty" : "" };
    }),
  }));
  const pairs = [];
  const seen = new Set();
  for (const c of matrix.cells || []) {
    if (!c || c.idA === c.idB || c.value == null || !Number.isFinite(Number(c.value))) continue;
    const key = [c.idA, c.idB].sort().join("||");
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(c);
  }
  const detailRows = pairs
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 40)
    .map((c) => `<tr>
      <td>${escapeHtml(c.labelA)}</td>
      <td>${escapeHtml(c.labelB)}</td>
      <td class="num">${Number(c.value).toFixed(3).replace(".", ",")}</td>
      <td class="num">${c.n ?? "—"}</td>
      <td class="num">${c.coveragePercent != null ? pctLabel(c.coveragePercent) : "—"}</td>
      <td>${escapeHtml(c.strength || "—")}</td>
    </tr>`)
    .join("");
  const detailsHtml = `
    <details class="sc-data-details">
      <summary>Tabela detalhada de pares (${pairs.length})</summary>
      <div class="table-wrap"><table class="gd-table"><thead><tr><th>X</th><th>Y</th><th class="num">Spearman</th><th class="num">n</th><th class="num">Cobertura</th><th>Força</th></tr></thead><tbody>${detailRows || `<tr><td colspan="6">Sem pares calculáveis.</td></tr>`}</tbody></table></div>
    </details>`;
  return renderStatisticalMatrix({
    columns,
    rows,
    legendHtml: `<span class="sc-heatmap-swatch" style="background:#dc5025"></span> +1 <span class="sc-heatmap-swatch" style="background:#888"></span> 0 <span class="sc-heatmap-swatch" style="background:#3b82f6"></span> −1 · Método: Spearman`,
    detailsHtml,
    rotateHeaders: vars.length > 14,
    cellSize: vars.length > 12 ? 64 : 70,
    labelWidth: 220,
  });
}

function renderCohortHeatmap(cohort) {
  if (!cohort?.cohorts?.length || !cohort?.ages?.length) {
    return `<p class="placeholder-note">Coorte indisponível neste recorte.</p>`;
  }
  const minN = Number(state.filters.cohortMinN) || 5;
  const showCount = state.filters.cohortCellMode === "count";
  const cohorts = (cohort.cohorts || []).filter((c) => (c.nStart || 0) >= minN);
  const ages = cohort.ages || [];
  const cellMap = new Map((cohort.cells || []).map((c) => [c.cohortKey + "||" + c.age, c]));
  const columns = cohorts.map((c) => ({ label: c.label || c.key, title: c.label || c.key }));
  const rows = ages.map((age) => ({
    label: `M${age}`,
    cells: cohorts.map((c) => {
      const cell = cellMap.get(c.key + "||" + age);
      const observable = cell && cell.observable !== false && cell.retainedPct != null;
      if (!observable) return { display: "—", bg: "#3a3a3a", color: "#bbb", className: "matrix-empty" };
      const colors = retentionColor(cell.retainedPct);
      const txt = showCount ? String(cell.retainedN ?? "—") : `${Number(cell.retainedPct).toFixed(0)}%`;
      const tip = `${c.label || c.key} · M${age}: ${showCount ? `${cell.retainedN}/${c.nStart}` : txt} · retidos ${cell.retainedN ?? "—"}/${c.nStart ?? "—"}`;
      return { display: txt, bg: colors.bg, color: colors.text, tooltip: tip };
    }),
  }));
  const meta = cohort.metadata || {};
  const cohortCount = cohorts.length;
  const cellSize = cohortCount > 14 ? 52 : cohortCount > 10 ? 58 : 64;
  const note = `Coortes: ${cohorts.length} · elegíveis ${fmt.format(cohorts.reduce((a, c) => a + (c.nStart || 0), 0))} · excluídos por datas: ${fmt.format((meta.skippedCancelledNoDate || 0) + (meta.skippedDuplicate || 0) + (meta.skippedCancelBeforeHire || 0) + (meta.skippedNoHire || 0))} · mín. n≥5`;
  return renderStatisticalMatrix({
    columns,
    rows,
    cornerLabel: "Mês de vida",
    legendHtml: `<span class="note-muted">Verde = maior retenção · vermelho/laranja = menor retenção · células — = idade futura ou amostra insuficiente</span>`,
    note,
    cellSize,
    labelWidth: 200,
  });
}

function renderGroupMatrixTable(model) {
  if (!model?.variables?.length || !model?.groups?.length) {
    return `<p class="placeholder-note">Matriz comparativa indisponível.</p>`;
  }
  const byKey = new Map((model.cells || []).map((c) => [c.varId + "||" + c.groupId, c]));
  const columns = model.groups.map((g) => ({
    label: g.label,
    sublabel: `n=${g.n ?? "—"}`,
    title: g.label,
  }));
  const rows = model.variables.map((v) => ({
    label: v.label,
    cells: model.groups.map((g) => {
      const c = byKey.get(v.id + "||" + g.id);
      const std = c?.standardized;
      const colors = groupStdColor(std);
      const txt = c?.value == null ? "—" : String(c.value).replace(".", ",");
      const tip = `${g.label}: ${txt} · ref. ${c?.reference ?? "—"} · std ${std == null ? "—" : Number(std).toFixed(2)}`;
      return { display: txt, bg: colors.bg, color: colors.text, tooltip: tip, className: c?.value == null ? "matrix-empty" : "" };
    }),
  }));
  return renderProportionalHeatmapTable({
    columns,
    rows,
    cornerLabel: "Indicador",
    legendHtml: `<span class="note-muted">Azul = abaixo da referência geral · cinza = semelhante · laranja/vermelho = acima · n= por coluna no cabeçalho</span>`,
    note: model.note || "Valores padronizados em relação à referência geral da população filtrada.",
    cellMinWidth: Math.max(88, Math.min(120, 520 / Math.max(model.groups.length, 1))),
    labelWidth: 260,
  });
}

function assocBarItems(rows) {
  return (rows || [])
    .filter((a) => a.association != null || a.rho != null || a.absMeasure != null)
    .slice(0, 14)
    .map((a) => {
      const raw = a.association ?? a.rho ?? a.absMeasure ?? a.associationAbs ?? 0;
      const mag = Math.abs(Number(a.associationAbs ?? a.absMeasure ?? a.abs ?? raw ?? 0));
      const signed = Number.isFinite(Number(raw)) ? Number(raw) : mag;
      const cov = a.coveragePercent ?? a.coverage ?? (a.missingPercent != null ? 100 - a.missingPercent : null);
      return {
        label: a.label || a.id,
        width: Math.max(1, Math.round(mag * 1000)),
        signed,
        assocText: fmtAssoc(signed) || "—",
        covText: cov != null ? pctLabel(cov) : "—",
        nText: a.n ?? a.sample ?? ((a.nActive || 0) + (a.nCancelled || 0)),
      };
    });
}

function renderAssocBars(items) {
  if (!items.length) {
    return `<p class="placeholder-note">Nenhuma associação calculável neste recorte (verifique cobertura/amostra).</p>`;
  }
  const max = Math.max(...items.map((i) => i.width), 1);
  const legend = `<div class="sc-assoc-legend"><span><i style="background:#f47920"></i> Positiva</span><span><i style="background:#3b82f6"></i> Negativa</span></div>`;
  const rows = items.map((i) => {
    const cls = i.signed < 0 ? "is-neg" : i.signed === 0 ? "is-zero" : "";
    return `<div class="sc-association-row">
      <div class="sc-association-label">${escapeHtml(i.label)}</div>
      <div class="sc-association-track"><span class="${cls}" style="width:${(i.width / max) * 100}%"></span></div>
      <div class="sc-association-metrics"><strong>${escapeHtml(i.assocText)}</strong><span>${escapeHtml(i.covText)} · n=${escapeHtml(String(i.nText ?? "—"))}</span></div>
    </div>`;
  }).join("");
  return legend + rows;
}

function renderAucChart(rows) {
  const list = (rows || [])
    .filter((a) => Number.isFinite(Number(a.aucAdjusted ?? a.aucInverted ?? a.auc)))
    .sort((a, b) => Number(b.aucAdjusted ?? b.aucInverted ?? b.auc) - Number(a.aucAdjusted ?? a.aucInverted ?? a.auc))
    .slice(0, 12);
  if (!list.length) return `<p class="placeholder-note">Sem AUC calculável neste recorte.</p>`;
  const maxBar = 0.5;
  const bars = list.map((r) => {
    const auc = Number(r.aucAdjusted ?? r.aucInverted ?? r.auc);
    const width = Math.max(2, ((auc - 0.5) / maxBar) * 100);
    return `<div class="sc-auc-row">
      <span class="sc-auc-label">${escapeHtml((r.label || r.id || "").slice(0, 28))}</span>
      <span class="sc-auc-track"><span style="width:${width}%"></span></span>
      <span class="sc-auc-value">${numLabel(auc, 3)}</span>
    </div>`;
  }).join("");
  return `<p class="note-muted">Escala a partir de 0,50 (sem discriminação). Referências: 0,60 sinal fraco · 0,70 moderado.</p>${bars}`;
}

function renderDiscoveries(items) {
  const all = items || [];
  const rows = state.showAllDiscoveries ? all : all.slice(0, 6);
  if (!rows.length) {
    return `<p class="note-muted">Nenhuma descoberta publicada com os limiares atuais de cobertura/amostra.</p>`;
  }
  return rows.map((d) => {
    const tip = [d.technical, d.caveat, d.sample != null ? `Amostra: ${d.sample}` : "", d.coverage != null ? `Cobertura: ${d.coverage}%` : ""].filter(Boolean).join(" · ");
    return `<article class="sc-discovery-card" title="${escapeHtml(tip)}">
      <div class="sc-disc-cat">${escapeHtml(d.category || d.section || "Insight")}${d.lowConfidence ? " · cautela" : ""}</div>
      <strong>${escapeHtml(d.title || d.id || "Descoberta")}</strong>
      ${d.primaryValue ? `<div class="sc-disc-val">${escapeHtml(String(d.primaryValue))}</div>` : ""}
      <p>${escapeHtml(d.text || "")}</p>
    </article>`;
  }).join("");
}

function renderMethodologyAccordion(methodology) {
  const m = methodology || {};
  const bands = m.associationStrengthBands || {};
  return `<details class="sc-data-details sc-methodology">
    <summary>Metodologia e faixas de associação</summary>
    <div class="sc-methodology-body">
      <p class="note-muted">${escapeHtml(m.note || "Associações descrevem coocorrência no recorte analítico; não substituem desenho experimental.")}</p>
      <ul>
        ${m.churn ? `<li><strong>Cancelamento:</strong> ${escapeHtml(m.churn)}</li>` : ""}
        ${m.comparison ? `<li><strong>Comparação:</strong> ${escapeHtml(m.comparison)}</li>` : ""}
        ${m.associationNumeric ? `<li><strong>Numérica:</strong> ${escapeHtml(m.associationNumeric)}</li>` : ""}
        ${m.associationCategorical ? `<li><strong>Categórica:</strong> ${escapeHtml(m.associationCategorical)}</li>` : ""}
        ${m.auc ? `<li><strong>AUC:</strong> ${escapeHtml(m.auc)}</li>` : ""}
        ${m.survival ? `<li><strong>Sobrevivência:</strong> ${escapeHtml(m.survival)}</li>` : ""}
        ${m.cohortRetention ? `<li><strong>Cohort:</strong> ${escapeHtml(m.cohortRetention)}</li>` : ""}
        ${bands.r ? `<li><strong>|r| / Spearman:</strong> ${escapeHtml(bands.r)}</li>` : ""}
        ${bands.cramers_v ? `<li><strong>Cramér's V:</strong> ${escapeHtml(bands.cramers_v)}</li>` : ""}
      </ul>
    </div>
  </details>`;
}

function renderActiveVsCancelledTable(rows) {
  const { minCoverage, minSample } = currentThresholds();
  const diffs = (rows || []).filter((d) => d.type === "numeric" || d.type == null);
  const visible = diffs.filter((d) => scPassMin(d, minCoverage, minSample) || (d.medianActive != null && d.medianCancelled != null));
  if (!visible.length) {
    return `<tr><td colspan="11">Sem variáveis com amostra descritiva suficiente (mín. ${minSample}/grupo, cobertura ≥ ${minCoverage}%).</td></tr>`;
  }
  return visible.map((d) => {
    const medA = d.medianActive ?? d.medianNonCancelled ?? d.activeMedian ?? d.median0;
    const medC = d.medianCancelled ?? d.cancelledMedian ?? d.median1;
    const diff = d.diff ?? d.diffAbs ?? (medA != null && medC != null ? medC - medA : null);
    const pctD = d.diffPercent ?? d.differencePct;
    const assoc = d.association != null ? fmtAssoc(d.association) : scStatusLabel(d.status, d.reason) || "—";
    return `<tr>
      <td>${escapeHtml(d.label || d.id || "—")}</td>
      <td class="num">${numLabel(medA)}</td>
      <td class="num">${numLabel(medC)}</td>
      <td class="num">${numLabel(diff)}</td>
      <td class="num">${pctD == null ? "—" : `${numLabel(pctD)}%`}</td>
      <td>${escapeHtml(String(assoc))}</td>
      <td>${escapeHtml(d.strength || d.associationStrength || "—")}</td>
      <td class="num">${d.nActive ?? "—"}</td>
      <td class="num">${d.nCancelled ?? "—"}</td>
      <td class="num">${d.coveragePercent != null ? pctLabel(d.coveragePercent) : "—"}</td>
      <td class="sc-reading">${escapeHtml(scReadingSummary(d))}</td>
    </tr>`;
  }).join("");
}

function renderAucDetailTable(rows) {
  return (rows || []).map((a) => {
    const orig = a.aucOriginal ?? a.auc;
    const adj = a.aucAdjusted ?? a.aucInverted ?? (orig != null ? Math.max(orig, 1 - orig) : null);
    const status = scStatusLabel(a.status, a.reason) || (a.auc == null && adj == null ? "Indisponível" : "OK");
    return `<tr>
      <td>${escapeHtml(a.label || a.id || "—")}</td>
      <td class="num">${orig == null ? "—" : numLabel(orig, 3)}</td>
      <td class="num">${adj == null ? "—" : numLabel(adj, 3)}</td>
      <td>${escapeHtml(a.direction || a.aucDirection || "—")}</td>
      <td class="num">${a.n ?? a.sample ?? "—"}</td>
      <td class="num">${(a.coveragePercent ?? a.coverage) != null ? pctLabel(a.coveragePercent ?? a.coverage) : "—"}</td>
      <td>${escapeHtml(status)}</td>
      <td>${escapeHtml(a.warning || a.note || a.reason || "—")}</td>
    </tr>`;
  }).join("");
}

function renderRiskRulesTable(rules) {
  return (rules || []).map((rule) => {
    const obs = rule.observation || rule.caveat || "Combinação com cancelamento acima da média do recorte.";
    return `<tr>
      <td><strong>${escapeHtml(rule.label)}</strong></td>
      <td class="num">${fmt.format(rule.clients ?? 0)}</td>
      <td class="num">${fmt.format(rule.cancelled ?? 0)}</td>
      <td class="num">${numLabel(rule.ratePct)}%</td>
      <td class="num">${numLabel(rule.baselinePct)}%</td>
      <td class="num"><strong>${numLabel(rule.lift, 2)}x</strong></td>
      <td class="num">${rule.coveragePct != null ? pctLabel(rule.coveragePct, 0) : "—"}</td>
      <td class="sc-reading">${escapeHtml(obs)}</td>
    </tr>`;
  }).join("");
}

function renderPredictRankingTable(ranking) {
  return (ranking || []).map((r) => `<tr>
    <td class="num">${r.rank ?? "—"}</td>
    <td>${escapeHtml(r.label || r.id || "—")}</td>
    <td class="num">${r.importance != null ? numLabel(r.importance, 3) : "—"}</td>
    <td title="${r.direction === "positive" ? "aumento associado a maior risco" : r.direction === "negative" ? "aumento associado a menor risco" : ""}">${escapeHtml(r.direction || "—")}</td>
    <td class="num">${r.univariateAuc != null ? numLabel(r.univariateAuc, 3) : "—"}</td>
    <td class="num">${r.coveragePercent != null ? pctLabel(r.coveragePercent) : "—"}</td>
    <td>${escapeHtml(r.leakageRisk || "—")}</td>
    <td>${escapeHtml(r.observation || "—")}</td>
  </tr>`).join("");
}

function scReadingSummary(d) {
  const diff = d.diff ?? d.diffAbs;
  const pct = d.diffPercent ?? d.differencePct;
  if (diff == null && pct == null) return "Sem leitura automática";
  if (pct != null && Math.abs(Number(pct)) < 5) return "Medianas próximas entre grupos";
  if (diff != null && Number(diff) > 0) return "Cancelados acima dos ativos na mediana";
  if (diff != null && Number(diff) < 0) return "Ativos acima dos cancelados na mediana";
  return "Diferença observada entre grupos";
}

function renderDiscoveryRankingTable(rows) {
  return (rows || []).map((r) => `<tr>
    <td class="num">${r.rank ?? "—"}</td>
    <td>${escapeHtml(r.label || r.id || "—")}</td>
    <td class="num">${r.association != null ? fmtAssoc(r.association) : "—"}</td>
    <td class="num">${r.auc != null ? numLabel(r.auc, 3) : "—"}</td>
    <td class="num">${r.coveragePercent != null ? pctLabel(r.coveragePercent) : "—"}</td>
    <td>${escapeHtml(r.direction || "—")}</td>
    <td class="sc-reading">${escapeHtml(r.observation || "—")}</td>
  </tr>`).join("");
}

function renderDiscoveryRankingBars(rows) {
  const list = (rows || []).slice(0, 12);
  if (!list.length) return `<p class="placeholder-note">Ranking indisponível neste recorte.</p>`;
  const max = Math.max(...list.map((r) => Math.abs(Number(r.association || 0))), 0.01);
  return list.map((r) => {
    const v = Number(r.association || 0);
    const width = Math.max(2, (Math.abs(v) / max) * 100);
    const cls = v < 0 ? "is-neg" : "";
    return `<div class="sc-association-row">
      <div class="sc-association-label">${escapeHtml(r.label || r.id)}</div>
      <div class="sc-association-track"><span class="${cls}" style="width:${width}%"></span></div>
      <div class="sc-association-metrics"><strong>${fmtAssoc(v) || "—"}</strong><span>AUC ${r.auc != null ? numLabel(r.auc, 3) : "—"}</span></div>
    </div>`;
  }).join("");
}

function healthStrengthLabel(candidate) {
  const auc = candidate?.univariateAuc;
  const assoc = Math.abs(candidate?.associationChurn || 0);
  if ((auc != null && auc >= 0.7) || assoc >= 0.5) return "Alta";
  if ((auc != null && auc >= 0.55) || assoc >= 0.3) return "Moderada";
  return "Fraca";
}

function healthDirectionLabel(candidate, predictiveById) {
  const pred = predictiveById?.get(candidate?.id);
  if (pred?.direction === "positive") return "↑ maior = maior risco";
  if (pred?.direction === "negative") return "↓ aumento = menor risco";
  const assoc = candidate?.associationChurn;
  if (assoc == null) return "—";
  if (assoc > 0) return "↑ maior = maior risco";
  if (assoc < 0) return "proteção";
  return "—";
}

function renderHealthScoreCandidatesBlock(candidates, predictiveRanking = []) {
  const list = (candidates || []).slice(0, 6);
  const predictiveById = new Map((predictiveRanking || []).map((r) => [r.id, r]));
  const rows = list.length
    ? list.map((c) => `<tr>
        <td>${escapeHtml(c.label || c.id || "—")}</td>
        <td>${escapeHtml(healthStrengthLabel(c))}</td>
        <td>${escapeHtml(healthDirectionLabel(c, predictiveById))}</td>
        <td class="num">${c.coveragePercent != null ? pctLabel(c.coveragePercent) : "—"}</td>
        <td class="sc-reading">${escapeHtml(c.justification || "Evidência no ranking preditivo e associações do recorte.")}</td>
      </tr>`).join("")
    : `<tr><td colspan="5">Sem candidatos elegíveis com cobertura/estabilidade suficientes neste recorte.</td></tr>`;

  return `<section class="section-block sc-health-block" id="scSecHealthCandidates">
    <h2>Variáveis mais relevantes para Health Score</h2>
    <p class="note-muted">Seleção analítica a partir dos resultados estatísticos atuais — sem pesos nem score final.</p>
    <div class="table-wrap sc-health-table-wrap">
      <table class="gd-table sc-health-table">
        <thead><tr><th>Variável</th><th>Força</th><th>Direção</th><th class="num">Cobertura</th><th>Por que considerar</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="note-muted sc-health-disclaimer">Seleção exploratória para composição futura do Health Score. Associação estatística não implica causalidade.</p>
  </section>`;
}

function renderSignalsLiftChart(signalStats) {
  const stats = (signalStats || []).slice(0, 8);
  if (!stats.length) return `<p class="placeholder-note">Nenhum sinal detectado em clientes ativos neste recorte.</p>`;
  const maxLift = Math.max(...stats.map((s) => Number(s.lift) || 1), 1.01);
  return stats.map((s) => {
    const lift = Number(s.lift) || 1;
    const width = Math.max(8, ((lift - 1) / (maxLift - 1 || 1)) * 100);
    return `<div class="sc-association-row">
      <div class="sc-association-label">${escapeHtml(s.label || s.id || "—")}</div>
      <div class="sc-association-track"><span class="is-warn" style="width:${width}%"></span></div>
      <div class="sc-association-metrics"><strong>lift ${s.lift != null ? numLabel(s.lift, 2) : "—"}</strong><span>${s.activeClientsWithSignal ?? "—"} ativos · taxa ${s.observedRatePct != null ? pctLabel(s.observedRatePct) : "—"}</span></div>
    </div>`;
  }).join("");
}

function renderSignalsClientsTable(clients) {
  const rows = clients || [];
  if (!rows.length) return `<p class="note-muted">Nenhum cliente ativo com os sinais configurados.</p>`;
  return `<div class="table-wrap"><table class="gd-table"><thead><tr>
    <th>Cliente</th><th>EP</th><th>Segmento</th><th>Programa</th><th>Sinais</th><th class="num">Qtd</th><th>Intensidade</th><th>NPS</th><th class="num">Dias s/ reunião</th>
  </tr></thead><tbody>${rows.slice(0, 40).map((r) => `<tr>
    <td>${escapeHtml(r.clientName || "—")}</td>
    <td>${escapeHtml(r.engineer || "—")}</td>
    <td>${escapeHtml(r.segment || "—")}</td>
    <td>${escapeHtml(r.program || "—")}</td>
    <td>${escapeHtml((r.signals || []).join("; "))}</td>
    <td class="num">${r.signalCount ?? "—"}</td>
    <td>${escapeHtml(r.intensity || "—")}</td>
    <td>${escapeHtml(r.npsClass || "—")}${r.npsScore != null ? ` (${r.npsScore})` : ""}</td>
    <td class="num">${r.daysSinceLastMeeting ?? "—"}</td>
  </tr>`).join("")}</tbody></table></div>`;
}

function renderDiffUnitSelect(selected = "time") {
  const opts = SC_DIFF_UNIT_OPTIONS.map((o) =>
    `<option value="${escapeHtml(o.value)}"${selected === o.value ? " selected" : ""}>${escapeHtml(o.label)}</option>`,
  ).join("");
  return `<label class="sc-inline-filter">Unidade do gráfico
    <select id="scDiffUnit">${opts}</select>
  </label>`;
}

function renderRenewedVsNotTable(rows) {
  const { minCoverage, minSample } = currentThresholds();
  const visible = (rows || []).filter((d) => scPassMin(d, minCoverage, minSample) || d.medianRenewed != null);
  if (!visible.length) return `<tr><td colspan="8">Sem comparação renovados vs não renovados neste recorte.</td></tr>`;
  return visible.map((d) => `<tr>
    <td>${escapeHtml(d.label || d.id || "—")}</td>
    <td class="num">${numLabel(d.medianRenewed ?? d.median0)}</td>
    <td class="num">${numLabel(d.medianNotRenewed ?? d.median1)}</td>
    <td class="num">${numLabel(d.diff)}</td>
    <td class="num">${d.diffPercent == null ? "—" : `${numLabel(d.diffPercent)}%`}</td>
    <td class="num">${d.nRenewed ?? d.n0 ?? "—"}</td>
    <td class="num">${d.nNotRenewed ?? d.n1 ?? "—"}</td>
    <td class="num">${d.coveragePercent != null ? pctLabel(d.coveragePercent) : "—"}</td>
  </tr>`).join("");
}

function renderNpsGroupsTable(groups) {
  return (groups || []).map((g) => `<tr>
    <td>${escapeHtml(g.label || g.class || "—")}</td>
    <td class="num">${g.n ?? "—"}</td>
    <td class="num">${g.cancelled ?? "—"}</td>
    <td class="num">${g.cancelledPct != null ? pctLabel(g.cancelledPct) : "—"}</td>
    <td class="num">${g.renewed ?? "—"}</td>
    <td class="num">${g.renewedPct != null ? pctLabel(g.renewedPct) : "—"}</td>
    <td class="num">${g.meanStayDays != null ? numLabel(g.meanStayDays, 0) : "—"}</td>
  </tr>`).join("");
}

function renderNpsGroupsChart(groups) {
  if (!groups?.length) return `<p class="placeholder-note">Sem grupos NPS neste recorte.</p>`;
  const max = Math.max(...groups.map((g) => Number(g.cancelledPct || 0)), 1);
  return groups.map((g) => {
    const v = Number(g.cancelledPct || 0);
    const width = Math.max(2, (v / max) * 100);
    return `<div class="sc-association-row">
      <div class="sc-association-label">${escapeHtml(g.label)}</div>
      <div class="sc-association-track"><span style="width:${width}%"></span></div>
      <div class="sc-association-metrics"><strong>${pctLabel(v)}</strong><span>n=${g.n ?? "—"} · cancelados ${g.cancelled ?? "—"}</span></div>
    </div>`;
  }).join("");
}

function renderTenureBucketsTable(buckets) {
  return (buckets || []).map((b) => `<tr>
    <td>${escapeHtml(b.label || b.bucket || "—")}</td>
    <td class="num">${b.n ?? b.count ?? "—"}</td>
    <td class="num">${b.cancelled ?? "—"}</td>
    <td class="num">${b.cancelledPct != null ? pctLabel(b.cancelledPct) : "—"}</td>
    <td class="num">${b.active ?? "—"}</td>
  </tr>`).join("");
}

function renderPredictBars(ranking) {
  const list = (ranking || []).slice(0, 15);
  if (!list.length) return `<p class="placeholder-note">Ranking indisponível.</p>`;
  const max = Math.max(...list.map((r) => Number(r.importance || 0)), 0.01);
  return list.map((r) => {
    const v = Number(r.importance || 0);
    const width = Math.max(2, (v / max) * 100);
    return `<div class="sc-auc-row">
      <span class="sc-auc-label">${escapeHtml((r.label || r.id || "").slice(0, 32))}</span>
      <span class="sc-auc-track"><span style="width:${width}%"></span></span>
      <span class="sc-auc-value">${numLabel(v, 3)}</span>
    </div>`;
  }).join("");
}

function renderActiveSignalsTable(signals) {
  const rows = signals?.signalStats || signals?.signals || signals?.rows || [];
  if (!Array.isArray(rows) || !rows.length) {
    return `<tr><td colspan="7">Nenhum sinal detectado em clientes ativos neste recorte.</td></tr>`;
  }
  return rows.map((s) => `<tr>
    <td>${escapeHtml(s.label || s.rule || s.id || "—")}</td>
    <td class="num">${s.activeClientsWithSignal ?? s.activeCount ?? "—"}</td>
    <td class="num">${s.observedRatePct != null ? pctLabel(s.observedRatePct) : "—"}</td>
    <td class="num">${s.baselinePct != null ? pctLabel(s.baselinePct) : "—"}</td>
    <td class="num">${s.lift != null ? `${numLabel(s.lift, 2)}x` : "—"}</td>
    <td class="num">${s.association != null ? fmtAssoc(s.association) : "—"}</td>
    <td class="sc-reading">${escapeHtml(s.caveat || s.note || s.interpretation || "Sinal exploratório em clientes ativos.")}</td>
  </tr>`).join("");
}

function renderTopClientsTable(bucket) {
  const list = bucket?.rows || (Array.isArray(bucket) ? bucket : []);
  if (!list.length) return `<tr><td colspan="10">Nenhum cliente elegível neste recorte.</td></tr>`;
  return list.map((c, i) => `<tr>
    <td class="num">${c.rank ?? i + 1}</td>
    <td>${escapeHtml(c.clientName || c.name || "—")}</td>
    <td>${escapeHtml(c.clientCode || c.code || "—")}</td>
    <td>${escapeHtml(c.engineer || "—")}</td>
    <td class="num">${c.exploratoryScore != null ? numLabel(c.exploratoryScore, 1) : numLabel(c.performanceScore ?? c.score, 1)}</td>
    <td class="num">${c.npsScore ?? "—"}</td>
    <td>${escapeHtml(c.npsClass || "—")}</td>
    <td class="num">${c.currentCycle ?? "—"}</td>
    <td class="num">${c.meetingCount ?? "—"}</td>
    <td class="num">${c.implementedMechanismCount ?? c.mechanismCount ?? "—"}</td>
  </tr>`).join("");
}

function renderNpsComparativeMatrix(model) {
  if (!model?.variables?.length || !model?.groups?.length) {
    return `<p class="placeholder-note">Matriz comparativa NPS indisponível neste recorte.</p>`;
  }
  const byKey = new Map((model.cells || []).map((c) => [c.varId + "||" + c.groupId, c]));
  const columns = model.groups.map((g) => ({ label: g.label, title: g.label }));
  const rows = model.variables.map((v) => ({
    label: v.label,
    cells: model.groups.map((g) => {
      const c = byKey.get(v.id + "||" + g.id);
      const val = c?.value ?? c?.median;
      const colors = corrColor(val);
      const txt = val == null ? "—" : Number(val).toFixed(2).replace(".", ",");
      return { display: txt, bg: colors.bg, color: colors.text, tooltip: `${g.label}: ${txt}` };
    }),
  }));
  return renderProportionalHeatmapTable({
    columns,
    rows,
    cornerLabel: "Variável",
    legendHtml: `<span class="note-muted">Comparação de medianas por classe NPS · escala relativa</span>`,
    labelWidth: 260,
  });
}

function renderCohortControls() {
  const f = state.filters;
  return `<div class="sc-cohort-controls filters-inline">
    <label>Período coorte
      <select id="scCohortPeriod">
        <option value="since_2025_01"${f.cohortPeriod === "since_2025_01" ? " selected" : ""}>Desde jan/2025</option>
        <option value="since_2026_01"${f.cohortPeriod === "since_2026_01" ? " selected" : ""}>Desde jan/2026</option>
      </select>
    </label>
    <label>Granularidade
      <select id="scCohortGranularity">
        <option value="month"${f.cohortGranularity === "month" ? " selected" : ""}>Mês</option>
        <option value="quarter"${f.cohortGranularity === "quarter" ? " selected" : ""}>Trimestre</option>
      </select>
    </label>
    <label>Texto da célula
      <select id="scCohortCellMode">
        <option value="percent"${f.cohortCellMode !== "count" ? " selected" : ""}>Percentual</option>
        <option value="count"${f.cohortCellMode === "count" ? " selected" : ""}>Quantidade</option>
      </select>
    </label>
    <label>Tamanho mín. coorte
      <input type="number" id="scCohortMinN" min="1" step="1" value="${f.cohortMinN ?? 5}" />
    </label>
  </div>`;
}

function renderCohortTable(cohort) {
  if (!cohort?.cohorts?.length) return `<tr><td colspan="2">Sem coortes.</td></tr>`;
  const minN = Number(state.filters.cohortMinN) || 5;
  const showCount = state.filters.cohortCellMode === "count";
  const cohorts = (cohort.cohorts || []).filter((c) => (c.nStart || 0) >= minN);
  const ages = cohort.ages || [];
  const cellMap = new Map((cohort.cells || []).map((c) => [c.cohortKey + "||" + c.age, c]));
  const head = cohorts.map((c) => `<th class="num">${escapeHtml(c.label || c.key)}</th>`).join("");
  const body = ages.map((age) => {
    const cells = cohorts.map((c) => {
      const cell = cellMap.get(c.key + "||" + age);
      if (!cell || cell.observable === false) return `<td class="num">—</td>`;
      const val = showCount ? (cell.retainedN ?? "—") : (cell.retainedPct != null ? `${Number(cell.retainedPct).toFixed(0)}%` : "—");
      return `<td class="num">${val}</td>`;
    }).join("");
    return `<tr><th>M${age}</th>${cells}</tr>`;
  }).join("");
  return `<div class="table-wrap sc-cohort-table-wrap"><table class="gd-table"><thead><tr><th>Mês de vida</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderSurvivalSummary(survival) {
  const surv = survival?.overall || {};
  const curve = surv.curve || [];
  if (!curve.length) {
    return `<p class="placeholder-note">Curva indisponível (sem eventos/censuras elegíveis).</p>`;
  }
  const marks = [0, 90, 180, 365, 730];
  const atRiskRow = marks.map((d) => {
    let last = curve[0];
    for (const pt of curve) {
      if (Number(pt.time) > d) break;
      last = pt;
    }
    return `<td class="num">${last?.atRisk ?? "—"}</td>`;
  }).join("");
  const sampleRows = curve
    .filter((_, i) => i % Math.max(1, Math.floor(curve.length / 12)) === 0 || i === curve.length - 1)
    .map((pt) => `<tr>
      <td>${pt.time}</td>
      <td class="num">${pt.survival != null ? pctLabel(pt.survival * 100, 1) : "—"}</td>
      <td class="num">${pt.atRisk ?? "—"}</td>
      <td class="num">${pt.events ?? "—"}</td>
      <td class="num">${pt.censored ?? "—"}</td>
    </tr>`)
    .join("");
  const lr = survival?.logRank;
  return `
    <p class="note-muted">n início=${surv.nStart ?? "—"} · eventos=${surv.events ?? "—"} · censurados=${surv.censored ?? "—"} · mediana=${escapeHtml(String(surv.medianSurvival ?? "não atingida"))} · cancelados sem data excluídos da curva.</p>
    <details class="sc-data-details">
      <summary>Tabela em risco por marco temporal</summary>
      <div class="table-wrap sc-at-risk"><table class="gd-table"><thead><tr><th>Tempo (dias)</th>${marks.map((d) => `<th class="num">${d}</th>`).join("")}</tr></thead><tbody><tr><th>Em risco</th>${atRiskRow}</tr></tbody></table></div>
    </details>
    <details class="sc-data-details">
      <summary>Pontos da curva Kaplan-Meier</summary>
      <div class="table-wrap"><table class="gd-table"><thead><tr><th>Tempo (dias)</th><th class="num">Prob. permanência</th><th class="num">Em risco</th><th class="num">Eventos</th><th class="num">Censurados</th></tr></thead><tbody>${sampleRows}</tbody></table></div>
    </details>
    ${lr ? `<p class="note-muted">Log-rank (${escapeHtml(lr.groupA || "")} vs ${escapeHtml(lr.groupB || "")}): χ²=${lr.chi2 ?? "—"} · p=${lr.pValue ?? "—"} · ${escapeHtml(lr.note || "Comparação exploratória.")}</p>` : ""}`;
}

function populateFilterOptions() {
  const opts = state.payload?.filterOptions || {};
  fillDynamicSelect($("scEngineer"), opts.engineers || uniqueSorted((state.payload?.clients || []).map((c) => c.engineer)), "Todos", state.filters.engineer);
  fillDynamicSelect($("scProgram"), programSelectOptions(state.payload?.clients || []), "Todos", state.filters.program);
}

function bindContentEvents() {
  $("scDiscoveriesToggle")?.addEventListener("click", () => {
    state.showAllDiscoveries = !state.showAllDiscoveries;
    const host = $("scDiscoveriesHost");
    if (host && state.payload) {
      const discoveries = state.payload.discoveries?.length ? state.payload.discoveries : state.payload.simpleInsights || [];
      host.innerHTML = renderDiscoveries(discoveries);
      const btn = $("scDiscoveriesToggle");
      if (btn) btn.textContent = state.showAllDiscoveries ? "Ver menos" : "Ver todas as descobertas";
    }
  });
  $("scDiffUnit")?.addEventListener("change", (e) => {
    state.diffUnit = e.target.value;
    const host = $("scDiffChartHost");
    if (host && state.payload) {
      host.innerHTML = renderActiveCancelledDiffChart(
        state.payload.activeVsCancelled || state.payload.groupDifferences || [],
        state.diffUnit,
        { summary: state.payload.summary, population: state.payload.population },
      );
    }
  });
  const cohortReload = () => {
    state.filters = filtersFromForm();
    void loadStatisticalCrosses({ force: true });
  };
  $("scCohortPeriod")?.addEventListener("change", cohortReload);
  $("scCohortGranularity")?.addEventListener("change", cohortReload);
  $("scCohortCellMode")?.addEventListener("change", () => {
    state.filters = filtersFromForm();
    renderStateView();
  });
  $("scCohortMinN")?.addEventListener("change", () => {
    state.filters = filtersFromForm();
    renderStateView();
  });
}

function renderSuccess() {
  const content = $("page-content");
  if (!content || !state.payload) return;

  const p = state.payload;
  const { minCoverage, minSample } = currentThresholds();
  const s = p.summary || {};
  const pop = p.population || p.metadata?.population || {};
  const axes = p.axisMatrices || {};
  const rankings = p.discoveryRankings || {};
  const discoveries = (p.discoveries?.length ? p.discoveries : p.simpleInsights || []).filter((d) =>
    scPassMin({ coverage: d.coverage, sample: d.sample, n: d.sample }, minCoverage, minSample) || d.title,
  );
  const churn = p.churnAssociations || {};
  const numeric = (churn.numeric || p.numericAssociations || []).filter(
    (a) => scPassMin(a, minCoverage, minSample) || a.association != null,
  );
  const categorical = (churn.categorical || p.categoricalAssociations || []).filter(
    (a) => scPassMin(a, minCoverage, minSample) || a.association != null,
  );
  const auc = (p.univariatePredictivePower || p.predictivePower || []).filter((a) =>
    scPassMin(a, minCoverage, minSample) || a.auc != null,
  );
  const renewalAssoc = p.renewalAssociations || {};
  const renewalNum = (renewalAssoc.numeric || []).filter((a) => scPassMin(a, minCoverage, minSample) || a.association != null);
  const renewalCat = (renewalAssoc.categorical || []).filter((a) => scPassMin(a, minCoverage, minSample) || a.association != null);
  const pred = p.predictiveModel || p.exploratory?.predictive || {};
  const groupMatrix = p.groupComparative || p.exploratory?.groupComparative;
  const riskRules = p.riskRules || [];
  const excluded = p.excludedVariables || [];
  const warnings = p.qualityWarnings || [];
  const topClients = p.topClients || {};
  const exclPop = (pop.frozen || 0) + (pop.unknown || 0) + (pop.excluded || 0);
  const audit = p.renewalParityAudit;
  const auditNote = audit?.excludedCount
    ? ` Card renovados: ${fmt.format(s.renewedClients ?? 0)} (paridade Renovações). ${fmt.format(audit.excludedCount)} renovado(s) fora do recorte ativo/cancelados.`
    : "";
  const diffRows = p.activeVsCancelled || p.groupDifferences || [];
  const healthCandidates = p.healthScoreCandidates || p.exploratory?.healthScoreCandidates || [];
  const activeSignals = p.activeRiskSignals || {};

  content.innerHTML = `<div class="statistical-page">${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}

    ${renderHealthScoreCandidatesBlock(healthCandidates, pred?.ranking)}

    <section class="section-block" id="scSecResumo">
      <h2>1. Resumo da base analítica</h2>
      <p>Uma linha por cliente · regras oficiais de cancelamento, ciclo e NPS.</p>
      <div class="kpi-row kpi-row-compact">
        ${kpiCard("Clientes analisados", fmt.format(s.analyzedClients ?? pop.total ?? 0), "População consolidada", { primary: true })}
        ${kpiCard("Clientes ativos", fmt.format(s.activeClients ?? pop.active ?? 0))}
        ${kpiCard("Cancelamentos efetivados", fmt.format(s.confirmedCancellations ?? pop.cancelled ?? 0), `Com data: ${fmt.format(s.cancelledWithDate ?? pop.cancelledWithDate ?? 0)} · sem data: ${fmt.format(s.cancelledWithoutDate ?? pop.cancelledWithoutDate ?? 0)}`, { primary: true })}
        ${kpiCard("Clientes renovados", fmt.format(s.renewedClients ?? 0), `Ciclo 1: ${fmt.format(s.cycle1Clients ?? 0)}`)}
        ${kpiCard("Respostas NPS válidas", fmt.format(s.validNpsResponses ?? s.npsResponses ?? 0), `Índice preditivo: ${s.npsIndex ?? s.nps ?? "—"}`)}
        ${kpiCard("Variáveis avaliadas", fmt.format(s.evaluatedVariables ?? 0))}
        ${kpiCard("Cobertura média", s.averageCoverage == null ? "—" : pctLabel(s.averageCoverage))}
        ${kpiCard("Período observado", `${(s.observationPeriod?.from || s.cutoffDate) ? dateBR(s.observationPeriod?.from) : "—"} → ${dateBR(s.observationPeriod?.to || s.cutoffDate || p.metadata?.cutoffDate)}`)}
      </div>
      <p class="note-muted" id="scPopNote">Comparação Ativos vs cancelados: ${fmt.format(pop.activeUsedInComparison ?? pop.active ?? 0)} ativos × ${fmt.format(pop.cancelledUsedInComparison ?? pop.cancelled ?? 0)} cancelados efetivados. Congelados/outros fora da comparação de churn: ${fmt.format(exclPop)}.${auditNote}</p>
    </section>

    <section class="section-block" id="scSecDiscoveries">
      <div class="table-panel-head">
        <div>
          <h2>2. Principais descobertas</h2>
          <p class="note-muted">Textos determinísticos (sem IA generativa). Só entram achados com cobertura/amostra suficientes.</p>
        </div>
        <button class="btn btn-secondary" type="button" id="scDiscoveriesToggle">${state.showAllDiscoveries ? "Ver menos" : "Ver todas as descobertas"}</button>
      </div>
      <div id="scDiscoveriesHost" class="sc-discoveries">${renderDiscoveries(discoveries)}</div>
    </section>

    <section class="section-block sc-axis-block" id="scSecCancel">
      <h2>3. Cancelamento — correlações e associações</h2>
      <p class="note-muted">Mostra quais variáveis possuem maior relação observada com cancelamento. Valores maiores representam associações mais fortes, não causalidade.</p>
      <article class="sc-matrix-card sc-matrix-card--wide"><h3 class="sc-matrix-title">Matriz de associação com cancelamento</h3>${renderAxisHeatmapTable(axes.cancellation)}</article>

      <h3 class="sc-subtitle">Diferença entre ativos e cancelados</h3>
      <p class="note-muted sc-howto">Compare as barras verdes e vermelhas. Quando a barra vermelha é maior, o valor típico entre cancelados foi maior neste recorte.</p>
      ${renderDiffUnitSelect(state.diffUnit)}
      <div id="scDiffChartHost" class="sc-diff-host">${renderActiveCancelledDiffChart(diffRows, state.diffUnit, { summary: s, population: pop })}</div>
      <details class="sc-data-details"><summary>Ver dados de cancelamento (diferenças)</summary>
        <div class="table-wrap">
          <table class="gd-table sc-diff-table">
            <thead><tr>
              <th>Indicador</th><th class="num">Mediana ativos</th><th class="num">Mediana cancelados</th><th class="num">Diferença</th><th class="num">Dif. %</th><th>Associação</th><th>Força</th><th class="num">n ativos</th><th class="num">n cancel.</th><th class="num">Cobertura</th><th>Leitura</th>
            </tr></thead>
            <tbody>${renderActiveVsCancelledTable(diffRows)}</tbody>
          </table>
        </div>
      </details>

      <h3 class="sc-subtitle">Poder preditivo individual (AUC)</h3>
      <article class="chart-card">${renderAucChart(auc)}</article>
      <details class="sc-data-details"><summary>Ver metodologia (AUC)</summary>
        <p class="note-muted">Método: separação individual (AUC). Valores acima de 0,80 merecem revisão de leakage (informação só disponível após o cancelamento).</p>
      </details>

      <div class="chart-grid">
        <article class="chart-card"><h3>Associações numéricas com cancelamentos</h3>${renderAssocBars(assocBarItems(numeric))}</article>
        <article class="chart-card"><h3>Associações categóricas com cancelamentos</h3>${renderAssocBars(assocBarItems(categorical))}</article>
      </div>
      <details class="sc-data-details"><summary>Ver dados de AUC</summary>
        <div class="table-wrap"><table class="gd-table"><thead><tr>
          <th>Variável</th><th class="num">AUC orig.</th><th class="num">AUC adj.</th><th>Direção</th><th class="num">n</th><th class="num">Cobertura</th><th>Status</th><th>Observação</th>
        </tr></thead><tbody>${renderAucDetailTable(auc) || `<tr><td colspan="8">Sem linhas.</td></tr>`}</tbody></table></div>
      </details>

      <article class="chart-card"><h3>Ranking de associações com cancelamento</h3>${renderDiscoveryRankingBars(rankings.cancellation)}</article>
      <details class="sc-data-details"><summary>Ver ranking completo — cancelamento</summary>
        <div class="table-wrap"><table class="gd-table"><thead><tr>
          <th class="num">#</th><th>Variável</th><th class="num">Associação</th><th class="num">AUC</th><th class="num">Cobertura</th><th>Direção</th><th>Observação</th>
        </tr></thead><tbody>${renderDiscoveryRankingTable(rankings.cancellation) || `<tr><td colspan="7">Sem ranking.</td></tr>`}</tbody></table></div>
      </details>
    </section>

    <section class="section-block sc-axis-block" id="scSecNps">
      <h2>4. NPS — matriz de correlação</h2>
      <article class="sc-matrix-card sc-matrix-card--wide">${renderAxisHeatmapTable(axes.nps)}</article>
      <article class="chart-card"><h3>Promotores, Neutros e Detratores</h3>${renderNpsGroupsChart(p.npsGroups)}</article>
      <details class="sc-data-details"><summary>Tabela por classe NPS</summary>
        <div class="table-wrap"><table class="gd-table"><thead><tr>
          <th>Classe</th><th class="num">n</th><th class="num">Cancelados</th><th class="num">% cancel.</th><th class="num">Renovados</th><th class="num">% renov.</th><th class="num">Permanência média</th>
        </tr></thead><tbody>${renderNpsGroupsTable(p.npsGroups) || `<tr><td colspan="7">Sem dados NPS.</td></tr>`}</tbody></table></div>
      </details>
      <article class="chart-card"><h3>Ranking NPS</h3>${renderDiscoveryRankingBars(rankings.nps)}</article>
    </section>

    <section class="section-block sc-axis-block" id="scSecRenewal">
      <h2>5. Renovação — matriz de associação</h2>
      <article class="sc-matrix-card sc-matrix-card--wide">${renderAxisHeatmapTable(axes.renewal)}</article>
      <div class="chart-grid">
        <article class="chart-card"><h3>Associações numéricas com renovações</h3>${renderAssocBars(assocBarItems(renewalNum))}</article>
        <article class="chart-card"><h3>Associações categóricas com renovações</h3>${renderAssocBars(assocBarItems(renewalCat))}</article>
      </div>
      <details class="sc-data-details"><summary>Renovados vs não renovados</summary>
        <div class="table-wrap"><table class="gd-table"><thead><tr>
          <th>Indicador</th><th class="num">Med. renovados</th><th class="num">Med. não renov.</th><th class="num">Diferença</th><th class="num">Dif. %</th><th class="num">n renov.</th><th class="num">n não renov.</th><th class="num">Cobertura</th>
        </tr></thead><tbody>${renderRenewedVsNotTable(p.renewedVsNotRenewed)}</tbody></table></div>
      </details>
      <article class="chart-card"><h3>Ranking de renovação</h3>${renderDiscoveryRankingBars(rankings.renewal)}</article>
    </section>

    <section class="section-block sc-axis-block" id="scSecTenure">
      <h2>6. Permanência — matriz de correlação</h2>
      <article class="sc-matrix-card sc-matrix-card--wide">${renderAxisHeatmapTable(axes.tenure)}</article>
      <details class="sc-data-details"><summary>Metodologia de permanência</summary>
        <p class="note-muted">Permanência analítica usa ajuste +365 para ciclo ≥ 2 nas comparações descritivas. Curva de sobrevivência e coorte usam permanência cronológica real.</p>
      </details>
      <article class="chart-card"><h3>Correlações com permanência (Spearman)</h3>${renderAssocBars(assocBarItems(p.tenureCorrelations))}</article>
      <div class="table-panel"><h3>Clientes por faixa de permanência</h3>
        <div class="table-wrap"><table class="gd-table"><thead><tr>
          <th>Faixa</th><th class="num">Clientes</th><th class="num">Cancelados</th><th class="num">% cancel.</th><th class="num">Ativos</th>
        </tr></thead><tbody>${renderTenureBucketsTable(p.tenureBuckets) || `<tr><td colspan="5">Sem faixas.</td></tr>`}</tbody></table></div>
      </div>
    </section>

    <section class="section-block sc-matrix-section" id="scSecGroups">
      <h2>7. Matriz comparativa dos grupos</h2>
      <p class="note-muted">Valores padronizados em relação à referência geral · azul abaixo · laranja/vermelho acima.</p>
      <article class="sc-matrix-card sc-matrix-card--wide">${renderGroupMatrixTable(groupMatrix)}</article>
    </section>

    <section class="section-block" id="scSecPredict">
      <h2>8. Ranking preditivo de cancelamento</h2>
      ${pred?.note || pred?.status === "insufficient_sample" ? `<p class="note-muted">${escapeHtml(pred.note || "Amostra insuficiente.")}</p>` : `<p class="note-muted" id="scPredictMeta">Importância relativa no modelo exploratório multivariável — não prova causalidade.</p>`}
      <article class="chart-card">${renderPredictBars(pred?.ranking)}</article>
      <details class="sc-data-details"><summary>Top 20 — ranking multivariável</summary>
        <div class="table-wrap"><table class="gd-table sc-predict-table"><thead><tr>
          <th class="num">#</th><th>Variável</th><th class="num">Importância</th><th>Direção</th><th class="num">AUC univ.</th><th class="num">Cobertura</th><th>Leakage</th><th class="sc-col-obs">Observação</th>
        </tr></thead><tbody>${renderPredictRankingTable(pred?.ranking || []) || `<tr><td colspan="8">Ranking indisponível neste recorte.</td></tr>`}</tbody></table></div>
      </details>
    </section>

    <section class="section-block" id="scSecRules">
      <h2>9. Combinações de fatores</h2>
      <p class="note-muted">Grupos com taxa de cancelamento acima da média e lift &gt; 1 (mín. 30 clientes).</p>
      <div class="table-wrap"><table class="gd-table"><thead><tr>
        <th>Combinação</th><th class="num">Clientes</th><th class="num">Cancelados</th><th class="num">Taxa</th><th class="num">Baseline</th><th class="num">Lift</th><th class="num">Cobertura</th><th>Observação</th>
      </tr></thead><tbody>${renderRiskRulesTable(riskRules) || `<tr><td colspan="8">Nenhuma combinação elegível neste recorte.</td></tr>`}</tbody></table></div>
    </section>

    <section class="section-block" id="scSecSurvival">
      <h2>10. Curva de sobrevivência</h2>
      ${renderSurvivalSection(p.survival, { compare: state.survivalCompare })}
    </section>

    <section class="section-block sc-matrix-section" id="scSecCohort">
      <h2>11. Análise de cohort</h2>
      <p class="note-muted">Linhas = meses de vida desde a contratação · colunas = mês/trimestre de entrada · retenção = sem cancelamento até a idade.</p>
      ${renderCohortControls()}
      <article class="sc-matrix-card sc-matrix-card--wide">${renderCohortHeatmap(p.cohort)}</article>
      <details class="sc-data-details"><summary>Tabela de retenção por coorte</summary>${renderCohortTable(p.cohort)}</details>
      ${p.challengeCohort?.note ? `<p class="note-muted" id="scCohortNote">${escapeHtml(p.challengeCohort.note)}</p>` : ""}
    </section>

    <section class="section-block sc-matrix-section" id="scSecGeneralMatrix">
      <h2>12. Matriz geral de relações entre variáveis</h2>
      <article class="sc-matrix-card sc-matrix-card--wide">${renderCorrelationMatrixTable(p.correlationMatrix)}</article>
    </section>

    <section class="section-block" id="scSecSignals">
      <h2>Clientes ativos com sinais detectados</h2>
      <p class="note-muted">${escapeHtml(activeSignals.note || "Clientes ainda ativos com padrões associados ao cancelamento. Não é previsão certa de churn.")}</p>
      <p class="note-muted" id="scSignalsSummary">Ativos com sinais: ${activeSignals.summary?.activeWithSignals ?? 0} · EPs afetados: ${activeSignals.summary?.engineersAffected ?? 0} · baseline cancelamento: ${activeSignals.baselinePct ?? "—"}%.</p>
      <article class="chart-card"><div id="scSignalsChart">${renderSignalsLiftChart(activeSignals.signalStats)}</div></article>
      <div class="table-wrap"><table class="gd-table"><thead><tr>
        <th>Sinal</th><th class="num">Ativos c/ sinal</th><th class="num">Taxa obs.</th><th class="num">Baseline</th><th class="num">Lift</th><th class="num">Associação</th><th>Observação</th>
      </tr></thead><tbody>${renderActiveSignalsTable(activeSignals)}</tbody></table></div>
      <details class="sc-data-details"><summary>Ver clientes com sinais</summary><div id="scSignalsTable">${renderSignalsClientsTable(activeSignals.clients)}</div></details>
    </section>

    <section class="section-block" id="scSecTop">
      <h2>Top clientes — Pharus e Davos</h2>
      <p class="note-muted">${escapeHtml(topClients.methodology?.note || "Ranking pelo índice exploratório de alta performance (transparente). Não é Health Score oficial.")}</p>
      <h3 class="sc-subtitle">Top clientes — Pharus</h3>
      <details class="sc-data-details"><summary>Ver tabela Pharus</summary>
        <div class="table-wrap"><table class="gd-table"><thead><tr>
          <th class="num">#</th><th>Cliente</th><th>Código</th><th>EP</th><th class="num">Score</th><th class="num">NPS</th><th>Classe</th><th class="num">Ciclo</th><th class="num">Reuniões</th><th class="num">Mecanismos</th>
        </tr></thead><tbody>${renderTopClientsTable(topClients.pharus)}</tbody></table></div>
      </details>
      <h3 class="sc-subtitle">Top clientes — Davos</h3>
      <details class="sc-data-details"><summary>Ver tabela Davos</summary>
        <div class="table-wrap"><table class="gd-table"><thead><tr>
          <th class="num">#</th><th>Cliente</th><th>Código</th><th>EP</th><th class="num">Score</th><th class="num">NPS</th><th>Classe</th><th class="num">Ciclo</th><th class="num">Reuniões</th><th class="num">Mecanismos</th>
        </tr></thead><tbody>${renderTopClientsTable(topClients.davos)}</tbody></table></div>
      </details>
    </section>

    <section class="section-block sc-matrix-section" id="scSecNpsMatrix">
      <h2>Matriz comparativa NPS (variáveis amplas)</h2>
      <article class="sc-matrix-card sc-matrix-card--wide">${renderNpsComparativeMatrix(p.npsComparative)}</article>
    </section>

    <section class="section-block" id="scSecExcluded">
      <h2>13. Variáveis excluídas</h2>
      <div class="table-wrap"><table class="gd-table"><thead><tr><th>Variável</th><th>Motivo</th><th>Detalhe</th></tr></thead><tbody>
        ${excluded.length ? excluded.map((e) => `<tr><td>${escapeHtml(e.label || e.id || "—")}</td><td>${escapeHtml(e.status || e.reasonCode || "excluída")}</td><td>${escapeHtml(e.reason || e.note || "—")}</td></tr>`).join("") : `<tr><td colspan="3">Nenhuma variável excluída além das regras metodológicas padrão.</td></tr>`}
      </tbody></table></div>
    </section>

    <section class="section-block" id="scSecQuality">
      <h2>14. Qualidade, cobertura e limitações</h2>
      ${warnings.length ? `<ul class="sc-quality-list">${warnings.map((w) => `<li>${escapeHtml(w.message || w.text || String(w))}</li>`).join("")}</ul>` : `<p class="note-muted">Sem alertas adicionais de qualidade neste recorte.</p>`}
      <p class="note-muted">Fontes read-only (BASE QV / App Pharus). Cancelamento confirmado via helper analítico oficial. Congelados e arquivados respeitam contexto de cada análise.</p>
    </section>

    ${renderMethodologyAccordion(p.methodology)}
  </div>`;

  bindContentEvents();
  bindMatrixTooltips(content);
  bindMatrixExpand(content);
  bindMatrixViewToggle(content);
  bindSurvivalPanel(content);
}

function bindSurvivalPanel(root) {
  bindSurvivalChart(root, (compare) => {
    state.survivalCompare = compare;
    const section = root.querySelector?.("#scSecSurvival") || root.closest?.("#scSecSurvival");
    if (!section || !state.payload) return;
    section.innerHTML = `<h2>Curva de sobrevivência</h2>${renderSurvivalSection(state.payload.survival, { compare })}`;
    bindSurvivalPanel(section);
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "statistical_crosses",
    innerHtml: renderFilterBar({
      fields: FILTER_FIELDS,
      filters: state.filters,
    }),
    onBodyReady: (body) => {
      if (state.payload) populateFilterOptions();
      unbindFilters = bindFilterBar({
        host: body,
        fields: FILTER_FIELDS,
        filters: state.filters,
        onChange: () => {
          state.filters = filtersFromForm();
          void loadStatisticalCrosses({ force: true });
        },
        onClear: () => {
          state.filters = defaultStatisticalCrossesFilters();
          void loadStatisticalCrosses({ force: true });
        },
      });
      return unbindFilters;
    },
  });
}

function renderErrorView(title, message) {
  const content = $("page-content");
  if (!content) return;
  content.innerHTML = `
    <div class="gd-status" role="alert">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
      <button class="btn btn-secondary" type="button" id="scRetry">Tentar novamente</button>
    </div>`;
  $("scRetry")?.addEventListener("click", () => void loadStatisticalCrosses({ force: true }));
}

function renderStateView() {
  const content = $("page-content");
  if (!content) return;
  if (state.errorCode === "AUTH_REQUIRED" || state.errorCode === "unauthenticated") {
    renderErrorView("Sessão necessária", "Entre novamente com sua conta corporativa.");
    return;
  }
  if (state.error && !state.payload) {
    renderErrorView("Não foi possível carregar os dados.", state.error);
    return;
  }
  if (state.loading && !state.payload) {
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando análises estatísticas</strong><span>Consultando cruzamentos…</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Análises Estatísticas] render", error);
    renderErrorView("Não foi possível montar a página.", error instanceof Error ? error.message : "Falha ao renderizar.");
  }
}

function ensurePageRefresh() {
  if (pageRefresh) return pageRefresh;
  pageRefresh = createPageRefresh({
    buttonId: "scRefresh",
    onRefresh: () => loadStatisticalCrosses({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadStatisticalCrosses({ force = false } = {}) {
  if (state.loading && !force) {
    renderFilters();
    renderStateView();
    setActions(true);
    return;
  }
  state.filters = filtersFromForm();
  if (state.payload && !force) {
    renderFilters();
    renderStateView();
    setActions(true);
    return;
  }
  state.loading = true;
  state.error = null;
  state.errorCode = null;
  if (force) state.payload = null;
  ensurePageRefresh().setLoading(true);
  renderFilters();
  renderStateView();
  try {
    const url = buildStatisticalCrossesApiUrl(state.filters);
    state.payload = await fetchPageJson(url, { force });
    state.filters = normalizeStatisticalCrossesFilters(state.filters);
    ensurePageRefresh().markSuccess(state.payload?.generatedAt ? new Date(state.payload.generatedAt) : new Date());
  } catch (error) {
    const mapped = mapLoadError(error);
    if (mapped.stale) return;
    state.errorCode = mapped.errorCode;
    state.error = mapped.error;
    if (force && state.payload) {
      ensurePageRefresh().markError(state.error);
    } else {
      state.payload = null;
      ensurePageRefresh().render();
    }
  } finally {
    state.loading = false;
    setActions(true);
    if (state.mounted) {
      renderFilters();
      renderStateView();
    }
  }
}

function unmountStatisticalCrosses() {
  state.mounted = false;
  unbindFilters();
  unbindFilterMount();
}

function mountStatisticalCrosses() {
  state.mounted = true;
  state.showAllDiscoveries = false;
  setActions(false);
  void loadStatisticalCrosses({ force: true });
}

export function bootStatisticalCrosses() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "statistical_crosses") mountStatisticalCrosses();
    else if (state.mounted) unmountStatisticalCrosses();
  });
  if (getCurrentPageId() === "statistical_crosses") mountStatisticalCrosses();
}
