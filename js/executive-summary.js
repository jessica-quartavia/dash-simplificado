import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  defaultExecutiveSummaryFilters,
  buildExecutiveSummaryApiUrl,
} from "../lib/analytics/executive-summary-filters.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";
import { escapeHtml } from "./general-charts.mjs";
import { renderExecutiveDashboard } from "./executive-summary-layout.mjs";

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultExecutiveSummaryFilters(),
};

let eventsBound = false;
let pageRefresh = null;

function $(id) {
  return document.getElementById(id);
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

  host.innerHTML = renderExecutiveDashboard(state.payload);
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
    void loadData();
  });
  if (getCurrentPageId() === "executive_summary") {
    if (!state.mounted) {
      state.mounted = true;
      bindEvents();
    }
    void loadData();
  }
}
