import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  defaultSupportFilters,
  filterSupportTickets,
  summarizeFilteredSupport,
  IDENTIFIED_FILTER_OPTIONS,
} from "../lib/analytics/support-filters.mjs";
import { escapeHtml, hBarsExpandable, acquisitionColumns } from "./general-charts.mjs";
import { bindChartExpand } from "./components/chart-expand.js";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { resolvePeriod } from "../lib/analytics/filters/period.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";
import {
  bindFilterBar,
  bindTableExport,
  fillDynamicSelect,
  renderFilterBar,
  renderTableToolbar,
} from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { exportFilteredTable } from "./utils/page-table-export.js";

const fmt = new Intl.NumberFormat("pt-BR");
const API = "/api/support";

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultSupportFilters(),
  sortKey: "openedAt",
  sortDir: "desc",
  page: 1,
  pageSize: 25,
  chartExpanded: { byArea: false, byType: false, byRequester: false },
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let unbindChartExpand = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "spSearch", key: "search" },
  { kind: "period", id: "spPeriod", fromId: "spFrom", toId: "spTo" },
  { kind: "select", id: "spArea", key: "area", label: "Área", dynamic: true, allLabel: "Todas" },
  { kind: "select", id: "spType", key: "type", label: "Tipo", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "spPriority", key: "priority", label: "Prioridade", dynamic: true, allLabel: "Todas" },
  { kind: "select", id: "spStatus", key: "status", label: "Status", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "spRequester", key: "requester", label: "Solicitante", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "spIdentified", key: "identified", label: "Cliente identificado", options: IDENTIFIED_FILTER_OPTIONS },
];

function $(id) {
  return document.getElementById(id);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("spSearch")?.value || "",
    period: $("spPeriod")?.value || "all",
    from: $("spFrom")?.value || "",
    to: $("spTo")?.value || "",
    area: $("spArea")?.value || "all",
    type: $("spType")?.value || "all",
    priority: $("spPriority")?.value || "all",
    status: $("spStatus")?.value || "all",
    requester: $("spRequester")?.value || "all",
    identified: $("spIdentified")?.value || "all",
  };
}

function filteredRows() {
  const rows = filterSupportTickets(state.payload?.tickets || state.payload?.rows || [], state.filters);
  const key = state.sortKey;
  const dir = state.sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), "pt-BR", { numeric: true }) * dir;
  });
}

function currentSummary() {
  const rows = filteredRows();
  return { rows, summary: summarizeFilteredSupport(rows, state.payload?.summary || {}) };
}

function kpiCard(label, value, note = "") {
  return `<article class="kpi-card">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${escapeHtml(String(value))}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}

function pctLabel(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toLocaleString("pt-BR")}%`;
}

function dateLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function fillFilterOptions() {
  const tickets = state.payload?.tickets || [];
  fillDynamicSelect($("spArea"), uniqueSorted(tickets.map((t) => t.area)), "Todas", state.filters.area);
  fillDynamicSelect($("spType"), uniqueSorted(tickets.map((t) => t.type)), "Todos", state.filters.type);
  fillDynamicSelect($("spPriority"), uniqueSorted(tickets.map((t) => t.priority)), "Todas", state.filters.priority);
  fillDynamicSelect($("spStatus"), uniqueSorted(tickets.map((t) => t.status)), "Todos", state.filters.status);
  fillDynamicSelect($("spRequester"), uniqueSorted(tickets.map((t) => t.requester)), "Todos", state.filters.requester);
}

function renderExpandableChart(containerId, toggleId, chartKey, items) {
  const chart = hBarsExpandable(items, chartKey, {
    limit: 8,
    expanded: state.chartExpanded[chartKey],
    compact: true,
  });
  const host = $(containerId);
  if (host) host.innerHTML = chart.html;
  const toggle = $(toggleId);
  if (toggle) toggle.innerHTML = chart.buttonHtml;
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  const { rows, summary } = currentSummary();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const ident = state.payload?.identification || {};
  const monthSeries = (state.payload?.monthlyEvolution || [])
    .filter((m) => m.grain === "month")
    .slice(-12)
    .map((m) => ({ month: m.label || m.month, acquiredClients: m.count }));

  content.innerHTML = `<div class="support-page">
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <section class="section-block">
      <h2>Acionamentos</h2>
      <p class="section-lead">Volume operacional, identificação de clientes e distribuição por área e tipo.</p>
      <div class="kpi-row kpi-row-primary">
        ${kpiCard("Total", fmt.format(summary.totalTickets))}
        ${kpiCard("Urgentes", fmt.format(summary.urgentTickets))}
        ${kpiCard("Com cliente", fmt.format(summary.ticketsWithClient), pctLabel(summary.identificationCoverage))}
        ${kpiCard("Top área", summary.topArea || "—", summary.topAreaCount ? `${fmt.format(summary.topAreaCount)} tickets` : "")}
        ${kpiCard("Top tipo", summary.topType || "—", summary.topTypeCount ? `${fmt.format(summary.topTypeCount)} tickets` : "")}
      </div>
    </section>
    <section class="section-block">
      <h2>Identificação</h2>
      <div class="kpi-row kpi-row-secondary">
        ${kpiCard("Clientes identificados", fmt.format(ident.identifiedClients ?? summary.identifiedClients))}
        ${kpiCard("Sem cliente", fmt.format(ident.ticketsWithoutClient ?? 0))}
        ${kpiCard("E-mail corporativo", fmt.format(ident.corporateEmailTickets ?? 0))}
        ${kpiCard("Aguardando reprocessamento", fmt.format(state.payload?.summary?.needsReprocessing ?? 0))}
      </div>
    </section>
    <section class="section-block">
      <h2>Distribuições</h2>
      <div class="chart-grid">
        <article class="chart-card chart-card--expandable">
          <div class="chart-card-head"><div><h3>Por área</h3><p class="chart-card-subtitle">Clientes distintos por ticket</p></div><span id="spAreaToggle"></span></div>
          <div class="chart-card-body" id="spChartArea"></div>
        </article>
        <article class="chart-card chart-card--expandable">
          <div class="chart-card-head"><div><h3>Por tipo</h3></div><span id="spTypeToggle"></span></div>
          <div class="chart-card-body" id="spChartType"></div>
        </article>
        <article class="chart-card chart-card--expandable">
          <div class="chart-card-head"><div><h3>Por solicitante</h3></div><span id="spRequesterToggle"></span></div>
          <div class="chart-card-body" id="spChartRequester"></div>
        </article>
      </div>
    </section>
    <section class="section-block">
      <h2>Evolução mensal</h2>
      <article class="chart-card">
        <div id="spChartMonths">${monthSeries.length ? acquisitionColumns(monthSeries, 12) : `<p class="placeholder-note">Sem série mensal.</p>`}</div>
      </article>
    </section>
    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Tickets</h2>
          ${renderTableToolbar({ countLabel: `${fmt.format(rows.length)} registros`, page: state.page, pages, pageSize: state.pageSize })}
        </div>
      </div>
      <div class="table-scroll">
        <table class="gd-table">
          <thead>
            <tr>
              <th data-sort="openedAt">Abertura</th>
              <th data-sort="area">Área</th>
              <th data-sort="type">Tipo</th>
              <th data-sort="priority">Prioridade</th>
              <th data-sort="status">Status</th>
              <th data-sort="requester">Solicitante</th>
              <th data-sort="primaryClientName">Cliente</th>
              <th>Título</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((t) => `<tr>
              <td>${dateLabel(t.openedAt)}</td>
              <td>${escapeHtml(t.area)}</td>
              <td>${escapeHtml(t.type)}</td>
              <td>${escapeHtml(t.priority)}</td>
              <td>${escapeHtml(t.status)}</td>
              <td>${escapeHtml(t.requester)}</td>
              <td>${escapeHtml(t.primaryClientName || t.clientLabel || (t.clientIdentified ? "Identificado" : "—"))}</td>
              <td>${escapeHtml(t.title)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>
  </div>`;

  renderExpandableChart("spChartArea", "spAreaToggle", "byArea", summary.byArea);
  renderExpandableChart("spChartType", "spTypeToggle", "byType", summary.byType);
  const requesterDist = (() => {
    const map = new Map();
    for (const t of rows) map.set(t.requester || "Não informado", (map.get(t.requester || "Não informado") || 0) + 1);
    return [...map.entries()].map(([label, count]) => ({
      label,
      count,
      percent: rows.length ? Math.round((count / rows.length) * 1000) / 10 : 0,
    })).sort((a, b) => b.count - a.count);
  })();
  renderExpandableChart("spChartRequester", "spRequesterToggle", "byRequester", requesterDist);

  unbindChartExpand();
  unbindChartExpand = bindChartExpand(content, state.chartExpanded, () => renderSuccess());

  content.querySelectorAll(".gd-table th[data-sort]").forEach((th) => {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = key === "openedAt" ? "desc" : "asc"; }
      renderSuccess();
    };
  });
  $("spPrev")?.addEventListener("click", () => { state.page -= 1; renderSuccess(); }, { once: true });
  $("spNext")?.addEventListener("click", () => { state.page += 1; renderSuccess(); }, { once: true });

  bindTableExport(content, (format) => {
    exportFilteredTable({ pageId: "support", rows, filters: state.filters, format });
  });
}

async function loadPayload(force = false) {
  state.loading = true;
  state.error = null;
  try {
    state.payload = await fetchPageJson(API, { force });
  } catch (error) {
    Object.assign(state, mapLoadError(error));
  } finally {
    state.loading = false;
  }
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const period = resolvePeriod(state.filters);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "support",
    innerHtml: renderFilterBar({
      fields: FILTER_FIELDS,
      filters: state.filters,
      periodInvalid: period.invalid,
    }),
    onBodyReady: (body) => {
      if (state.payload) fillFilterOptions();
      unbindFilters = bindFilterBar({
        host: body,
        fields: FILTER_FIELDS,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => { state.filters = defaultSupportFilters(); state.page = 1; renderFilters(); renderSuccess(); },
      });
      return unbindFilters;
    },
  });
}

const onFilterChange = createFilterChangeHandler({
  readFilters: filtersFromForm,
  apply(next) {
    state.filters = next;
    state.page = 1;
    renderSuccess();
  },
});

function renderLoading() {
  const content = $("page-content");
  if (content) content.innerHTML = `<p class="placeholder-note">Carregando acionamentos…</p>`;
}

function renderErrorView() {
  const content = $("page-content");
  if (!content) return;
  content.innerHTML = `<div class="page-error"><p>${escapeHtml(state.error || "Erro ao carregar.")}</p><button type="button" class="btn btn-secondary" id="spRetry">Tentar novamente</button></div>`;
  $("spRetry")?.addEventListener("click", () => { void refresh(true); });
}

async function refresh(force = false) {
  renderLoading();
  await loadPayload(force);
  if (state.error) { renderErrorView(); return; }
  renderFilters();
  renderSuccess();
  pageRefresh?.updateMeta(state.payload?.generatedAt);
}

export function bootSupport() {
  if (state.mounted) return;
  state.mounted = true;
  pageRefresh = createPageRefresh({ onRefresh: () => refresh(true) });
  onPageChange(async (page) => {
    if (page.id !== "support") return;
    if (!state.payload && !state.loading) await refresh();
    else { renderFilters(); renderSuccess(); }
  });
  if (getCurrentPageId() === "support") void refresh();
  if (!eventsBound) eventsBound = true;
}
