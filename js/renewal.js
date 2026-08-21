import { onPageChange, getCurrentPageId } from "./navigation.js";
import { analyticalStatusDisplayLabel } from "../lib/analytics/analytical-cancellation.mjs";
import {
  defaultRenewalFilters,
  filterRenewalClients,
  RENEWED_FILTER_OPTIONS,
  sortRenewalClients,
} from "../lib/analytics/renewal-filters.mjs";
import {
  distributionsFromRenewalRows,
  summarizeRenewalRows,
} from "../lib/analytics/renewal-metrics.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";
import { donut, escapeHtml, hBars } from "./general-charts.mjs";
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

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultRenewalFilters(),
  sortKey: "clientName",
  sortDir: "asc",
  page: 1,
  pageSize: 25,
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "rnSearch", key: "search" },
  { kind: "select", id: "rnEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "rnSegment", key: "segment", label: "Segmento", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "rnProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "rnRenewed", key: "renewed", label: "Renovou", options: RENEWED_FILTER_OPTIONS },
];

function $(id) {
  return document.getElementById(id);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("rnSearch")?.value || "",
    engineer: $("rnEngineer")?.value || "all",
    segment: $("rnSegment")?.value || "all",
    program: normalizeProgramFilter($("rnProgram")?.value || "all"),
    renewed: $("rnRenewed")?.value || "all",
  };
}

function filteredRows() {
  return sortRenewalClients(
    filterRenewalClients(state.payload?.clients || [], state.filters),
    state.sortKey,
    state.sortDir,
  );
}

function currentSummary() {
  const rows = filteredRows();
  const summary = summarizeRenewalRows(rows);
  const dist = distributionsFromRenewalRows(rows);
  return { rows, summary, dist };
}

function pctLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("pt-BR")}%`;
}

function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.compact) classes.push("kpi-card-compact");
  if (options.highlight) classes.push("kpi-card-highlight");
  if (options.featured) classes.push("kpi-card-featured");
  return `<article class="${classes.join(" ")}">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}

function statusBadge(status) {
  const label = analyticalStatusDisplayLabel(status);
  let cls = "badge-muted";
  if (label === "Ativo") cls = "badge-active";
  else if (label === "Congelado") cls = "badge-frozen";
  else if (label.startsWith("Cancelado") || label.startsWith("Marcado")) cls = "badge-cancelled";
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function boolLabel(value) {
  if (value === true) return "Sim";
  if (value === false) return "Não";
  return "—";
}

function dateBR(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function populateFilterOptions() {
  const clients = state.payload?.clients || [];
  fillDynamicSelect($("rnEngineer"), uniqueSorted(clients.map((c) => c.engineer)), "Todos", state.filters.engineer);
  fillDynamicSelect($("rnSegment"), uniqueSorted(clients.map((c) => c.segment)), "Todos", state.filters.segment);
  fillDynamicSelect($("rnProgram"), programSelectOptions(clients), "Todos", state.filters.program);
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  const { rows, summary, dist } = currentSummary();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const methodology =
    state.payload?.methodology?.renewalInference
    || "Renovação inferida pelo ciclo atual do cliente (clients.ciclo > 1). Não há evento formal de renovação nesta base.";

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <p class="text-muted">${escapeHtml(methodology)}</p>

    <section class="section-block">
      <h2>Indicadores</h2>
      <p>Elegíveis com ciclo válido no recorte filtrado. Renovação = ciclo atual maior que 1.</p>
      <div class="kpi-row kpi-row-three">
        ${kpiCard("Clientes que renovaram", fmt.format(summary.renewedClients), pctLabel(summary.renewedClientsPercent) + " dos elegíveis", { featured: true, highlight: true })}
        ${kpiCard("Total de renovações", fmt.format(summary.totalRenewals), "Soma de max(ciclo − 1, 0)")}
        ${kpiCard("Maior ciclo atual", summary.maxCurrentCycle == null ? "—" : fmt.format(summary.maxCurrentCycle), `${fmt.format(summary.eligibleClients)} elegíveis`)}
      </div>
    </section>

    <section class="section-block">
      <h2>Distribuições</h2>
      <div class="chart-grid">
        <article class="chart-card"><h3>Renovação inferida</h3><div id="rnChartRenewed"></div></article>
        <article class="chart-card"><h3>Contagem de renovações</h3><div id="rnChartCount"></div></article>
        <article class="chart-card"><h3>Renovados por EP</h3><div id="rnChartEngineer"></div></article>
      </div>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Clientes</h2>
          ${renderTableToolbar({ countLabel: `${fmt.format(rows.length)} registros encontrados`, exportPrefix: "renewal" })}
        </div>
      </div>
      <div class="table-wrap">
        <table class="gd-table">
          <thead>
            <tr>
              <th data-sort="clientName">Cliente</th>
              <th data-sort="clientCode">Código</th>
              <th data-sort="engineer">EP</th>
              <th data-sort="segment">Segmento</th>
              <th data-sort="analyticalStatus">Status</th>
              <th data-sort="renewed">Renovou</th>
              <th data-sort="currentCycle">Ciclo atual</th>
              <th data-sort="renewalCount">Renovações</th>
              <th data-sort="contractDate">Contratação</th>
              <th data-sort="cycleEndDate">Fim do ciclo</th>
            </tr>
          </thead>
          <tbody id="rnRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="rnPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="rnNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  $("rnChartRenewed") && ($("rnChartRenewed").innerHTML = donut(dist.renewedYesNo.filter((i) => i.count > 0)));
  $("rnChartCount") && ($("rnChartCount").innerHTML = hBars(dist.renewalCountBands.filter((i) => i.count > 0)));
  $("rnChartEngineer") && ($("rnChartEngineer").innerHTML = hBars(dist.renewedByEngineer.filter((i) => i.count > 0), 12));

  const tbody = $("rnRows");
  if (tbody) {
    tbody.innerHTML = pageRows.length
      ? pageRows
          .map(
            (c) => `<tr>
          <td class="truncate" title="${escapeHtml(c.clientName)}">${escapeHtml(c.clientName)}</td>
          <td>${escapeHtml(c.clientCode || "Não informado")}</td>
          <td class="truncate">${escapeHtml(c.engineer)}</td>
          <td>${escapeHtml(c.segment || "—")}</td>
          <td>${statusBadge(c.analyticalStatus)}</td>
          <td>${boolLabel(c.cycleValid ? c.renewed : null)}</td>
          <td class="num">${c.currentCycle == null ? "—" : fmt.format(c.currentCycle)}</td>
          <td class="num">${c.renewalCount == null ? "—" : fmt.format(c.renewalCount)}</td>
          <td>${dateBR(c.contractDate)}</td>
          <td>${dateBR(c.cycleEndDate)}</td>
        </tr>`,
          )
          .join("")
      : `<tr><td colspan="10">Nenhum cliente encontrado para os filtros selecionados.</td></tr>`;
  }

  $("rnPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("rnNext")?.addEventListener("click", () => {
    state.page += 1;
    renderSuccess();
  });
  document.querySelectorAll(".gd-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDir = "asc";
      }
      renderSuccess();
    });
  });

  bindTableExport(content, (format) => {
    exportFilteredTable({ pageId: "renewal", rows, filters: state.filters, format });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveVisibleFilterFields("renewal", FILTER_FIELDS);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "renewal",
    innerHtml: renderFilterBar({ fields, filters: state.filters }),
    onBodyReady: (body) => {
      if (state.payload) populateFilterOptions();
      $("rnEngineer") && ($("rnEngineer").value = state.filters.engineer);
      $("rnSegment") && ($("rnSegment").value = state.filters.segment);
      $("rnProgram") && ($("rnProgram").value = state.filters.program);
      $("rnRenewed") && ($("rnRenewed").value = state.filters.renewed);
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultRenewalFilters();
          state.page = 1;
          renderFilters();
          renderSuccess();
        },
      });
      return unbindFilters;
    },
  });
}

function renderErrorView(title, message) {
  const content = $("page-content");
  if (!content) return;
  content.innerHTML = `<div class="gd-status">
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(message)}</span>
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="rnRetry">Tentar novamente</button></div>
  </div>`;
  $("rnRetry")?.addEventListener("click", () => {
    void loadRenewal({ force: true });
  });
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
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando renovação</strong><span>Consultando a BASE QV…</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Renovação] render", error);
    renderErrorView("Não foi possível carregar os dados.", error instanceof Error ? error.message : "Falha ao montar a página.");
  }
}

const onFilterChange = createFilterChangeHandler({
  state,
  filtersFromForm,
  renderFilters,
  renderSuccess,
});

function ensurePageRefresh() {
  if (pageRefresh) return pageRefresh;
  pageRefresh = createPageRefresh({
    buttonId: "rnRefresh",
    onRefresh: () => loadRenewal({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadRenewal({ force = false } = {}) {
  if (state.loading && !force) {
    renderFilters();
    renderStateView();
    setActions(true);
    return;
  }
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
    state.payload = await fetchPageJson("/api/renewal", { force });
    ensurePageRefresh().markSuccess();
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

function unmountRenewal() {
  state.mounted = false;
}

function mountRenewal() {
  state.mounted = true;
  setActions(false);
  void loadRenewal();
}

export function bootRenewal() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "renewal") mountRenewal();
    else if (state.mounted) unmountRenewal();
  });
  if (getCurrentPageId() === "renewal") mountRenewal();
}
