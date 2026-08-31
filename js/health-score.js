import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  buildHealthScoreAnalysis,
  DEFAULT_MECHANISM_SLIDER,
  HEALTH_SCORE_SLIDER_STEP,
  summarizeHealthScoreDistribution,
  weightSplitLabel,
  weightsFromMechanismSlider,
} from "../lib/analytics/health-score-metrics.mjs";
import {
  defaultHealthScoreFilters,
  filterHealthScoreBaseClients,
  filterHealthScoreClients,
  HEALTH_SCORE_CLASSIFICATION_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
} from "../lib/analytics/health-score-filters.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";
import { escapeHtml, hBars } from "./general-charts.mjs";
import { bindFilterBar, fillDynamicSelect, renderFilterBar } from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";

const fmt = new Intl.NumberFormat("pt-BR");
const pctFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const scoreFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultHealthScoreFilters(),
  mechanismSlider: DEFAULT_MECHANISM_SLIDER,
  showAllClients: false,
  fetchCount: 0,
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let unbindWeightControls = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "hsSearch", key: "search" },
  { kind: "select", id: "hsStatus", key: "status", label: "Status do cliente", options: STATUS_FILTER_OPTIONS },
  { kind: "select", id: "hsEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "hsProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
  {
    kind: "select",
    id: "hsClassification",
    key: "classification",
    label: "Classificação",
    options: HEALTH_SCORE_CLASSIFICATION_FILTER_OPTIONS,
  },
];

function $(id) {
  return document.getElementById(id);
}

function pctLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${pctFmt.format(Number(value))}%`;
}

function scoreLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return scoreFmt.format(Number(value));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("hsSearch")?.value || "",
    status: $("hsStatus")?.value || defaultHealthScoreFilters().status,
    engineer: $("hsEngineer")?.value || "all",
    program: normalizeProgramFilter($("hsProgram")?.value || "all"),
    classification: $("hsClassification")?.value || "all",
  };
}

function currentWeights() {
  return weightsFromMechanismSlider(state.mechanismSlider);
}

function currentView() {
  if (!state.payload?.clients) return null;
  const weights = currentWeights();
  const baseRows = filterHealthScoreBaseClients(state.payload.clients, state.filters);
  const analysis = buildHealthScoreAnalysis(baseRows, weights);
  const clients = filterHealthScoreClients(analysis.clients, state.filters);
  const summary = summarizeHealthScoreDistribution(clients);
  return { ...analysis, clients, summary, weights };
}

function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.highlight) classes.push("kpi-card-highlight");
  if (options.compact) classes.push("kpi-card-compact");
  const toneClass = options.tone ? ` hs-kpi--${options.tone}` : "";
  return `<article class="${classes.join(" ")}${toneClass}">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}

function classBadge(classification, label) {
  const cls =
    classification === "healthy"
      ? "hs-badge--healthy"
      : classification === "attention"
        ? "hs-badge--attention"
        : classification === "critical"
          ? "hs-badge--critical"
          : "hs-badge--nodata";
  return `<span class="hs-badge ${cls}">${escapeHtml(label || "—")}</span>`;
}

function renderWeightControls() {
  const weights = currentWeights();
  const meetingsPct = pctLabel(weights.meetings);
  const mechanismPct = pctLabel(weights.mechanism);
  const centerLabel = weightSplitLabel(weights);
  const trackStyle = `--hs-mechanism-pct:${weights.mechanismSlider * 100}%`;

  return `<section class="section-block hs-weights" id="hsWeights">
    <div class="hs-section-head">
      <h2>Peso das variáveis</h2>
      <span class="hs-tag">Experimental</span>
    </div>
    <p class="note-muted">Arraste a barra para definir qual variável deve influenciar mais o Health Score.</p>
    <div class="hs-weight-card">
      <div class="hs-weight-live">
        <div class="hs-weight-live__item">
          <span class="hs-weight-live__label">Engajamento (Reuniões)</span>
          <strong class="hs-weight-live__value" id="hsMeetingsPct">${meetingsPct}</strong>
        </div>
        <div class="hs-weight-live__item hs-weight-live__item--right">
          <span class="hs-weight-live__label">Mecanismos</span>
          <strong class="hs-weight-live__value" id="hsMechanismPct">${mechanismPct}</strong>
        </div>
      </div>
      <div class="hs-slider-labels">
        <span>Mais peso em Engajamento</span>
        <span>Mais peso em Mecanismos</span>
      </div>
      <div class="hs-slider-track" style="${trackStyle}">
        <input
          type="range"
          id="hsWeightSlider"
          class="hs-slider-input"
          min="0"
          max="1"
          step="${HEALTH_SCORE_SLIDER_STEP}"
          value="${weights.mechanismSlider}"
          aria-label="Peso de mecanismos no Health Score"
        />
      </div>
      <p class="hs-weight-center" id="hsWeightCenter">${escapeHtml(centerLabel)}</p>
    </div>
  </section>`;
}

function renderExplanation() {
  return `<section class="section-block hs-how">
    <h2>Como o Health Score funciona?</h2>
    <p class="note-muted">O Health Score junta dois sinais da jornada do cliente: engajamento em reuniões e presença de mecanismos. Clientes com menos interação e sem mecanismo tendem a receber uma nota menor. Os pesos podem ser ajustados para testar qual sinal deve influenciar mais a nota.</p>
    <p class="note-muted hs-disclaimer">Este Health Score está sendo usado para testar regras e pesos. Ele não representa uma previsão definitiva de cancelamento.</p>
  </section>`;
}

function renderImpactBlock(view) {
  const weights = view.weights;
  const rows = view.summary.distribution
    .map(
      (item) =>
        `<div class="hs-impact-row"><span>${escapeHtml(item.label)}</span><strong>${fmt.format(item.count)} · ${pctLabel(item.percent)}</strong></div>`,
    )
    .join("");
  return `<section class="section-block hs-impact">
    <h2>Impacto dos pesos</h2>
    <div class="hs-impact-weights">
      <span>Engajamento (Reuniões) <strong>${pctLabel(weights.meetings)}</strong></span>
      <span>Mecanismos <strong>${pctLabel(weights.mechanism)}</strong></span>
    </div>
    <div class="hs-impact-rows">${rows}</div>
  </section>`;
}

function renderDistribution(title, rows) {
  return `<div class="chart-card hs-chart-card">
    <h3>${escapeHtml(title)}</h3>
    ${hBars(rows.filter((r) => r.count > 0), 8)}
  </div>`;
}

function renderClientsTable(clients) {
  const limit = state.showAllClients ? clients.length : 12;
  const rows = clients.slice(0, limit);
  const body = rows.length
    ? rows
        .map(
          (row) => `<tr>
      <td>${escapeHtml(row.clientName || "—")}</td>
      <td>${escapeHtml(row.engineer || "—")}</td>
      <td>${escapeHtml(row.program || "—")}</td>
      <td class="num">${scoreLabel(row.meetingScore)}</td>
      <td>${escapeHtml(row.hasMechanismLabel || "—")}</td>
      <td class="num">${scoreLabel(row.healthScore)}</td>
      <td>${classBadge(row.classification, row.classificationLabel)}</td>
    </tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="placeholder-note">Nenhum cliente no recorte.</td></tr>`;
  const toggle =
    clients.length > 12
      ? `<button type="button" class="btn btn-secondary btn-sm" id="hsToggleClients">${state.showAllClients ? "Ver menos" : "Ver todos"}</button>`
      : "";
  return `<section class="section-block" id="hsClients">
    <div class="hs-section-head"><h2>Clientes</h2>${toggle}</div>
    <div class="table-wrap"><table class="gd-table">
      <thead><tr>
        <th>Cliente</th><th>EP</th><th>Programa</th><th class="num">Score reuniões</th><th>Possui mecanismo</th><th class="num">Health Score</th><th>Classificação</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

function renderResults() {
  const view = currentView();
  if (!view) return "";
  const summary = view.summary;
  const distRows = view.summary.distribution.filter((d) => d.count > 0);
  const healthy = view.summary.distribution.find((d) => d.key === "healthy");
  const attention = view.summary.distribution.find((d) => d.key === "attention");
  const critical = view.summary.distribution.find((d) => d.key === "critical");

  return `<div id="hsResults">
    <section class="section-block" id="hsSummary">
      <h2>Resumo</h2>
      <div class="kpi-row kpi-row-primary">
        ${kpiCard("Clientes filtrados", fmt.format(summary.filteredClients), "Recorte atual")}
        ${kpiCard("Score médio", scoreLabel(summary.averageScore), "Média dos clientes pontuáveis", { highlight: true })}
        ${kpiCard("Sem dados", fmt.format(summary.noDataClients), summary.noData.percent ? `${pctLabel(summary.noData.percent)} do recorte` : "Fora da amostra")}
        ${kpiCard("Saudáveis", fmt.format(healthy?.count || 0), pctLabel(healthy?.percent), { tone: "healthy" })}
        ${kpiCard("Atenção", fmt.format(attention?.count || 0), pctLabel(attention?.percent), { tone: "attention" })}
        ${kpiCard("Críticos", fmt.format(critical?.count || 0), pctLabel(critical?.percent), { tone: "critical" })}
      </div>
    </section>
    <section class="section-block hs-charts">
      <h2>Distribuição do Health Score</h2>
      <div class="chart-grid hs-chart-grid">
        ${renderDistribution("Classificação", distRows)}
        ${renderDistribution("Reuniões", view.meetingDistribution)}
        ${renderDistribution("Possui mecanismo", view.mechanismDistribution)}
      </div>
    </section>
    ${renderImpactBlock(view)}
    ${renderClientsTable(view.clients)}
  </div>`;
}

function renderResultsArea() {
  if (state.loading) {
    return `<div id="hsResults" class="hs-results hs-results--loading"><p class="placeholder-note">Carregando dados do Health Score…</p></div>`;
  }
  if (state.error) {
    return `<div id="hsResults" class="hs-results hs-results--error">
      <p class="page-error">Não foi possível carregar os dados do Health Score.</p>
      <button type="button" class="btn btn-secondary" id="hsRetry">Tentar novamente</button>
    </div>`;
  }
  if (!state.payload) {
    return `<div id="hsResults" class="hs-results hs-results--loading"><p class="placeholder-note">Carregando dados do Health Score…</p></div>`;
  }
  return renderResults();
}

function renderPageShell() {
  const host = $("page-content");
  if (!host) return;

  host.innerHTML = `
    <div class="hs-page">
      <div class="sc-methodology-banner hs-banner">
        <span class="hs-tag">Experimental</span>
        <p class="sc-methodology-note">Health Score determinístico com engajamento em reuniões e mecanismos (Análises Estatísticas). Faixas e pesos em teste.</p>
      </div>
      ${renderExplanation()}
      ${renderWeightControls()}
      ${renderResultsArea()}
    </div>`;

  bindWeightControls();
  $("hsRetry")?.addEventListener("click", () => void loadData({ force: true }));
  $("hsToggleClients")?.addEventListener("click", () => {
    state.showAllClients = !state.showAllClients;
    renderPageShell();
  });

  if (state.payload && !state.error && !state.loading) {
    pageRefresh?.markSuccess(state.payload.generatedAt);
    pageRefresh?.setEnabled(true);
  } else if (state.error) {
    pageRefresh?.markError(state.error);
  }
}

function bindWeightControls() {
  unbindWeightControls();
  const slider = $("hsWeightSlider");
  const onInput = () => {
    state.mechanismSlider = Number(slider.value);
    renderPageShell();
  };
  slider?.addEventListener("input", onInput);
  unbindWeightControls = () => slider?.removeEventListener("input", onInput);
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilterMount();
  const visibleFields = resolveVisibleFilterFields("health_score", FILTER_FIELDS);
  const options = state.payload?.filterOptions || {};
  const engineers = uniqueSorted(options.engineers || (state.payload?.clients || []).map((c) => c.engineer));
  const programs = programSelectOptions(options.programs);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "health_score",
    innerHtml: renderFilterBar(visibleFields),
    onBodyReady: (body) => {
      fillDynamicSelect(body.querySelector("#hsEngineer"), engineers, state.filters.engineer);
      fillDynamicSelect(body.querySelector("#hsProgram"), programs, state.filters.program, { allLabel: "Todos" });
      $("hsSearch") && ($("hsSearch").value = state.filters.search);
      $("hsStatus") && ($("hsStatus").value = state.filters.status);
      $("hsClassification") && ($("hsClassification").value = state.filters.classification);
      unbindFilters();
      unbindFilters = bindFilterBar({
        root: body,
        fields: visibleFields,
        onChange: createFilterChangeHandler(() => {
          state.filters = filtersFromForm();
          state.showAllClients = false;
          renderPageShell();
        }),
      });
    },
  });
}

async function loadData({ force = false } = {}) {
  state.loading = true;
  state.error = null;
  renderPageShell();
  pageRefresh?.setLoading(true);
  try {
    const url = force ? "/api/health-score?force=1" : "/api/health-score";
    state.fetchCount += 1;
    const payload = await fetchPageJson(url, { force, pageId: "health_score" });
    state.payload = payload;
  } catch (error) {
    Object.assign(state, mapLoadError(error));
  } finally {
    state.loading = false;
    renderFilters();
    renderPageShell();
    pageRefresh?.setLoading(false);
  }
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;
  pageRefresh = createPageRefresh({
    buttonId: "hsRefresh",
    onRefresh: () => loadData({ force: true }),
  });
  pageRefresh.render();
  pageRefresh.setEnabled(false);
}

function mountHealthScore() {
  if (!state.mounted) {
    state.mounted = true;
    bindEvents();
  }
  renderFilters();
  renderPageShell();
  if (!state.payload && !state.loading) void loadData();
}

function unmountHealthScore() {
  state.mounted = false;
  unbindFilters();
  unbindFilterMount();
  unbindWeightControls();
}

export function bootHealthScore() {
  onPageChange((page) => {
    if (page.id === "health_score") mountHealthScore();
    else if (state.mounted) unmountHealthScore();
  });
  if (getCurrentPageId() === "health_score") mountHealthScore();
}

export function __healthScoreTestState() {
  return state;
}
