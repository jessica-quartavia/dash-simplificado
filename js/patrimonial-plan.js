import { authenticatedFetch } from "./auth.mjs";
import { onPageChange, getCurrentPageId } from "./navigation.js";
import { escapeHtml } from "./general-charts.mjs";
import { resolvePeriod } from "../lib/analytics/filters/period.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
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

const FILTER_FIELDS = [
  { kind: "search", id: "ppSearch", key: "search" },
  { kind: "period", id: "ppPeriod", fromId: "ppFrom", toId: "ppTo" },
  { kind: "select", id: "ppEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
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
      <p>Tempo médio entre a contratação e a última reunião Central de Inteligência, só com intervalos válidos.</p>
      <article class="kpi-card kpi-card-highlight kpi-card-hero">
        <div class="kpi-label">Tempo médio até aprovação</div>
        <div class="kpi-value">${daysLabel(approval.value)}</div>
        <div class="kpi-note">${escapeHtml(scope.populationLabel || "Carteira completa")} · cálculo por média · recorte filtrado</div>
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

function setActions(enabled) {
  const host = $("page-actions");
  if (!host) return;
  host.innerHTML = `<button class="btn btn-secondary" type="button" id="ppRefresh" ${enabled ? "" : "disabled"}>Atualizar</button>`;
  $("ppRefresh")?.addEventListener("click", () => {
    void loadPatrimonialPlan({ force: true });
  });
}

async function loadPatrimonialPlan({ force = false } = {}) {
  if (state.loading) {
    renderFilters();
    renderStateView();
    return;
  }
  if (state.payload && !force) {
    renderFilters();
    renderStateView();
    return;
  }
  state.loading = true;
  state.error = null;
  state.errorCode = null;
  if (force) state.payload = null;
  renderFilters();
  renderStateView();
  const startedAt = Date.now();
  try {
    console.info("[Plano] GET /api/patrimonial-plan");
    const response = await authenticatedFetch("/api/patrimonial-plan");
    const payload = await response.json().catch(() => ({}));
    console.info("[Plano] resposta", response.status, `${Date.now() - startedAt}ms`);
    if (!response.ok) {
      const err = new Error(payload.error || "Não foi possível carregar os dados.");
      err.code = payload.code || String(response.status);
      throw err;
    }
    state.payload = payload;
    state.filters = { ...defaultPlanFilters(), ...state.filters };
  } catch (error) {
    console.error("[Plano] falha", error?.code || error?.message || error);
    state.errorCode = error?.code || "error";
    state.error =
      error?.code === "AUTH_REQUIRED"
        ? "Sessão expirada."
        : error?.message || "Não foi possível carregar os dados.";
    state.payload = null;
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
