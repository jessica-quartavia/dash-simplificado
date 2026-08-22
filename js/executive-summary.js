import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  defaultExecutiveSummaryFilters,
  buildExecutiveSummaryApiUrl,
} from "../lib/analytics/executive-summary-filters.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";
import { escapeHtml } from "./general-charts.mjs";
import { renderExecutiveDashboard } from "./executive-summary-layout.mjs";
import { bindChartExpand } from "./components/chart-expand.js";

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

function renderPage() {
  const host = $("page-content");
  if (!host) return;
  if (state.loading) {
    host.innerHTML = `<p class="placeholder-note">Consolidando indicadores…</p>`;
    pageRefresh?.setLoading(true);
    return;
  }
  if (state.error) {
    host.innerHTML = `<p class="page-error">${escapeHtml(state.error)}</p>`;
    pageRefresh?.markError(state.error);
    return;
  }
  if (!state.payload) {
    host.innerHTML = `<p class="placeholder-note">Carregando resumo executivo…</p>`;
    return;
  }

  host.innerHTML = renderExecutiveDashboard(state.payload, { chartExpanded: state.chartExpanded });
  unbindChartExpand();
  unbindChartExpand = bindChartExpand(host, state.chartExpanded, () => renderPage());
  pageRefresh?.markSuccess(state.payload.lastUpdatedAt || state.payload.generatedAt);
  pageRefresh?.setEnabled(true);
}

async function loadData({ force = false } = {}) {
  state.loading = true;
  state.error = null;
  pageRefresh?.setLoading(true);
  renderPage();
  try {
    const url = buildExecutiveSummaryApiUrl(state.filters, { force });
    const payload = await fetchPageJson(url, { force });
    state.payload = payload;
  } catch (error) {
    Object.assign(state, mapLoadError(error));
    pageRefresh?.markError(state.error);
  } finally {
    state.loading = false;
    renderPage();
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

export function bootExecutiveSummary() {
  onPageChange((page) => {
    if (page.id !== "executive_summary") return;
    if (!state.mounted) {
      state.mounted = true;
      bindEvents();
    }
    renderFilters();
    void loadData();
  });
  if (getCurrentPageId() === "executive_summary") {
    if (!state.mounted) {
      state.mounted = true;
      bindEvents();
    }
    renderFilters();
    void loadData();
  }
}
