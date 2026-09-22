import { onPageChange, getCurrentPageId } from "./navigation.js";
import { escapeHtml } from "./general-charts.mjs";
import { resolvePeriod } from "../lib/analytics/filters/period.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import {
  defaultPlanFilters,
  filterPlanClients,
  summarizeFilteredPlanClients,
} from "../lib/analytics/patrimonial-plan-filters.mjs";
import {
  bindFilterBar,
  bindTableExport,
  fillDynamicSelect,
  renderFilterBar,
  renderTableToolbar,
} from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { exportFilteredTable } from "./utils/page-table-export.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";

const fmt = new Intl.NumberFormat("pt-BR");

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultPlanFilters(),
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
  { kind: "search", id: "ppSearch", key: "search" },
  { kind: "period", id: "ppPeriod", fromId: "ppFrom", toId: "ppTo" },
  { kind: "select", id: "ppEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "ppProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
];

function $(id) {
  return document.getElementById(id);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("ppSearch")?.value || "",
    period: $("ppPeriod")?.value || "all",
    from: $("ppFrom")?.value || "",
    to: $("ppTo")?.value || "",
    engineer: $("ppEngineer")?.value || "all",
    program: normalizeProgramFilter($("ppProgram")?.value || "all"),
  };
}

function filteredRows() {
  const rows = filterPlanClients(state.payload?.clients || [], state.filters);
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

function daysLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${fmt.format(Math.round(Number(value)))} d`;
}

function dateBR(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function coverageLine(approval) {
  if (!approval?.totalPopulation) return "";
  const sample = fmt.format(approval.eligibleClients || 0);
  const percent = Number(approval.coveragePercent || 0).toLocaleString("pt-BR");
  return `${sample} clientes com dados suficientes · ${percent}% do recorte`;
}

function populateFilterOptions() {
  const clients = state.payload?.clients || [];
  fillDynamicSelect($("ppEngineer"), uniqueSorted(clients.map((c) => c.engineer)), "Todos", state.filters.engineer);
  fillDynamicSelect($("ppProgram"), programSelectOptions(clients), "Todos", state.filters.program);
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  const rows = filteredRows();
  const approval = summarizeFilteredPlanClients(rows);
  const scope = state.payload?.scope || {};
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <section class="section-block">
      <h2>Tempo até aprovação</h2>
      <p>Proxy V1: contratação → última reunião Central de Inteligência (intervalos negativos e futuros excluídos).</p>
      <article class="kpi-card kpi-card-highlight kpi-card-hero">
        <div class="kpi-label">Tempo médio até aprovação</div>
        <div class="kpi-value">${daysLabel(approval.value)}</div>
        <div class="kpi-note">${escapeHtml(scope.populationLabel || "Carteira completa")} · cálculo por mediana (V1 UI) · recorte filtrado</div>
        <div class="kpi-coverage">${escapeHtml(coverageLine(approval))}</div>
      </article>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Clientes</h2>
          ${renderTableToolbar({
            countLabel: `${fmt.format(rows.length)} registros encontrados`,
            exportPrefix: "plano-patrimonial",
          })}
        </div>
      </div>
      <div class="table-wrap">
        <table class="gd-table">
          <thead>
            <tr>
              <th data-sort="clientName">Cliente</th>
              <th data-sort="clientCode">Código</th>
              <th data-sort="engineer">EP</th>
              <th data-sort="contractDate">Contratação</th>
              <th data-sort="approvedAt">Reunião Central</th>
              <th data-sort="daysToApproval">Dias até aprovação</th>
            </tr>
          </thead>
          <tbody id="ppRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="ppPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="ppNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  const tbody = $("ppRows");
  if (tbody) {
    tbody.innerHTML = pageRows.length
      ? pageRows
        .map(
          (c) => `<tr>
          <td class="truncate" title="${escapeHtml(c.clientName)}">${escapeHtml(c.clientName)}</td>
          <td>${escapeHtml(c.clientCode || "Não informado")}</td>
          <td class="truncate">${escapeHtml(c.engineer)}</td>
          <td>${dateBR(c.contractDate)}</td>
          <td>${dateBR(c.approvedAt)}</td>
          <td class="num">${c.daysToApproval == null ? "—" : `${fmt.format(c.daysToApproval)} d`}</td>
        </tr>`,
        )
        .join("")
      : `<tr><td colspan="6">Nenhum cliente encontrado para os filtros selecionados.</td></tr>`;
  }

  $("ppPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("ppNext")?.addEventListener("click", () => {
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
    exportFilteredTable({
      pageId: "patrimonial_plan",
      rows,
      filters: state.filters,
      format,
    });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveVisibleFilterFields("patrimonial_plan", FILTER_FIELDS);
  const period = resolvePeriod(state.filters);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "patrimonial_plan",
    innerHtml: renderFilterBar({
      fields,
      filters: state.filters,
      periodInvalid: period.invalid,
    }),
    onBodyReady: (body) => {
      if (state.payload) populateFilterOptions();
      $("ppEngineer") && ($("ppEngineer").value = state.filters.engineer);
      $("ppProgram") && ($("ppProgram").value = state.filters.program);
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultPlanFilters();
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
    <div style="margin-top:12px">
      <button class="btn btn-secondary" type="button" id="ppRetry">Tentar novamente</button>
    </div>
  </div>`;
  $("ppRetry")?.addEventListener("click", () => {
    void loadPatrimonialPlan({ force: true });
  });
}

function renderStateView() {
  const content = $("page-content");
  if (!content) return;

  if (state.errorCode === "AUTH_REQUIRED" || state.errorCode === "unauthenticated") {
    renderErrorView("Sessão necessária", "Entre novamente com sua conta corporativa.");
    return;
  }
  if (state.errorCode === "AUTH_FORBIDDEN" || state.errorCode === "invalid_domain") {
    renderErrorView("Acesso não autorizado", "O portal é restrito a contas @quartavia.com.br.");
    return;
  }
  if (state.error && !state.payload) {
    renderErrorView("Não foi possível carregar os dados.", state.error);
    return;
  }
  if (state.loading && !state.payload) {
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando plano patrimonial</strong><span>Consultando a base…</span></div>`;
    return;
  }
  if (state.payload && !(state.payload.clients || []).length) {
    content.innerHTML = `<div class="gd-status"><strong>Sem clientes</strong><span>A consulta não retornou registros para esta base.</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Plano] render", error);
    state.loading = false;
    renderErrorView(
      "Não foi possível carregar os dados.",
      error instanceof Error ? error.message : "Falha ao montar a página.",
    );
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
    pageId: "patrimonial_plan",
    buttonId: "ppRefresh",
    csvButtonId: "ppCsv",
    getExportContext: () => ({ payload: state.payload, filters: state.filters, loading: state.loading }),
    onRefresh: () => loadPatrimonialPlan({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadPatrimonialPlan({ force = false } = {}) {
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
    state.payload = await fetchPageJson("/api/patrimonial-plan", { force });
    state.filters = { ...defaultPlanFilters(), ...state.filters };
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

function unmountPatrimonialPlan() {
  state.mounted = false;
  unbindFilters();
}

function mountPatrimonialPlan() {
  state.mounted = true;
  setActions(false);
  void loadPatrimonialPlan();
}

export function bootPatrimonialPlan() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "patrimonial_plan") mountPatrimonialPlan();
    else if (state.mounted) unmountPatrimonialPlan();
  });
  if (getCurrentPageId() === "patrimonial_plan") mountPatrimonialPlan();
}
