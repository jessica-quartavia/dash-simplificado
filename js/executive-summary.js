import { onPageChange } from "./navigation.js";
import {
  defaultExecutiveSummaryFilters,
  buildExecutiveSummaryApiUrl,
} from "../lib/analytics/executive-summary-filters.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { applyLoadError, fetchPageJson } from "./utils/page-load.js";
import { escapeHtml } from "./general-charts.mjs";
import { renderExecutiveDashboard } from "./executive-summary-layout.mjs";
import { bindChartExpand } from "./components/chart-expand.js";

const isDevLog =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.search.includes("bootdebug=1"));

function execLog(step, extra) {
  if (!isDevLog) return;
  if (extra !== undefined) console.info(`[Executive] ${step}`, extra);
  else console.info(`[Executive] ${step}`);
}

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultExecutiveSummaryFilters(),
  chartExpanded: {},
};

let eventsBound = false;
let pageRefresh = null;
let unbindChartExpand = () => {};
let unbindFilterMount = () => {};
let loadToken = 0;

function $(id) {
  return document.getElementById(id);
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilterMount();
  const options = programSelectOptions();
  const optionHtml = [`<option value="all">Todos</option>`]
    .concat(options.map((program) => `<option value="${escapeHtml(program)}">${escapeHtml(program)}</option>`))
    .join("");
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "executive_summary",
    innerHtml: `
      <div class="filter-bar filter-bar--compact executive-filter-bar">
        <label class="filter-field" for="exProgram">
          <span class="filter-field__label">Programa</span>
          <select id="exProgram" class="filter-field__control">${optionHtml}</select>
        </label>
      </div>`,
    onBodyReady: (body) => {
      const select = body.querySelector("#exProgram");
      if (select) select.value = state.filters.program || "all";
      const onProgramChange = () => {
        state.filters.program = normalizeProgramFilter(select?.value || "all");
        void loadData();
      };
      select?.addEventListener("change", onProgramChange);
      return () => select?.removeEventListener("change", onProgramChange);
    },
  });
}

function renderErrorView(message) {
  const host = $("page-content");
  if (!host) return;
  host.innerHTML = `<div class="gd-status">
    <strong>Não foi possível carregar o Resumo Executivo.</strong>
    <span>${escapeHtml(message || "Tente novamente.")}</span>
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="exRetry">Tentar novamente</button></div>
  </div>`;
  $("exRetry")?.addEventListener("click", () => {
    void loadData({ force: true });
  });
}

function renderPage() {
  const host = $("page-content");
  if (!host) return;
  if (state.loading && !state.payload) {
    host.innerHTML = `<p class="placeholder-note" role="status">Consolidando indicadores…</p>`;
    pageRefresh?.setLoading(true);
    return;
  }
  if (state.error && !state.payload) {
    renderErrorView(state.error);
    pageRefresh?.markError(state.error);
    return;
  }
  if (!state.payload) {
    host.innerHTML = `<p class="placeholder-note" role="status">Consolidando indicadores…</p>`;
    return;
  }

  try {
    execLog("render");
    host.innerHTML = renderExecutiveDashboard(state.payload, { chartExpanded: state.chartExpanded });
    unbindChartExpand();
    unbindChartExpand = bindChartExpand(host, state.chartExpanded, () => renderPage());
    pageRefresh?.markSuccess(state.payload.lastUpdatedAt || state.payload.generatedAt);
    pageRefresh?.setEnabled(true);
  } catch (error) {
    console.error("[Executive] render", error);
    execLog("error", error instanceof Error ? error.message : error);
    state.error = error instanceof Error ? error.message : "Falha ao montar o Resumo Executivo.";
    renderErrorView(state.error);
    pageRefresh?.markError(state.error);
  }
}

async function loadData({ force = false } = {}) {
  const token = ++loadToken;
  execLog("start", { force, program: state.filters.program || "all" });
  state.loading = true;
  state.error = null;
  state.errorCode = null;
  if (force) state.payload = null;
  pageRefresh?.setLoading(true);
  renderPage();
  try {
    const url = buildExecutiveSummaryApiUrl(state.filters, { force });
    const payload = await fetchPageJson(url, { force, pageId: "executive_summary" });
    if (token !== loadToken) {
      execLog("stale superseded");
      return;
    }
    state.payload = payload;
    execLog("build payload", { domains: Object.keys(payload?.sourcesLoaded || {}).length });
  } catch (error) {
    execLog("error", error instanceof Error ? error.message : error);
    if (token !== loadToken) return;
    if (applyLoadError(state, error, { force, pageRefresh })) {
      execLog("stale navigation — ignorando resposta");
      return;
    }
  } finally {
    if (token === loadToken) {
      state.loading = false;
      pageRefresh?.setEnabled(true);
      try {
        renderPage();
      } catch (renderError) {
        console.error("[Executive] render pós-load", renderError);
        state.error = renderError instanceof Error ? renderError.message : "Falha ao montar o Resumo Executivo.";
        renderErrorView(state.error);
      }
    }
  }
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;
  pageRefresh = createPageRefresh({
    buttonId: "exRefresh",
    onRefresh: () => loadData({ force: true }),
  });
  pageRefresh.render();
  pageRefresh.setEnabled(false);
}

function mountExecutive() {
  if (!state.mounted) {
    state.mounted = true;
    bindEvents();
  }
  renderFilters();
  void loadData();
}

export function bootExecutiveSummary() {
  onPageChange((page) => {
    if (page.id === "executive_summary") mountExecutive();
    else state.mounted = false;
  });
}
