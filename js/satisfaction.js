import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  defaultSatisfactionFilters,
  filterSatisfactionClients,
  sortSatisfactionClients,
  buildScopedSatisfactionView,
  satisfactionQuarterOptions,
  NPS_CLASSIFICATION_FILTER_OPTIONS,
  HAS_CSAT_FILTER_OPTIONS,
  LAST_NPS_BAND_OPTIONS,
} from "../lib/analytics/satisfaction-filters.mjs";
import {
  distributionsFromSatisfactionRows,
  summarizeSatisfactionRows,
} from "../lib/analytics/satisfaction-metrics.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { donut, escapeHtml, vBars } from "./general-charts.mjs";
import {
  bindFilterBar,
  bindTableExport,
  fillDynamicSelectFilter,
  renderFilterBar,
  renderTableToolbar,
} from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { createPageRefresh } from "./components/page-refresh.js";
import { exportFilteredTable } from "./utils/page-table-export.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";

const fmt = new Intl.NumberFormat("pt-BR");

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultSatisfactionFilters(),
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
  { kind: "search", id: "sfSearch", key: "search" },
  {
    kind: "selectfilter",
    id: "sfQuarter",
    key: "quarter",
    label: "Trimestre",
    options: [{ value: "latest", label: "Mais recente" }],
  },
  {
    kind: "selectfilter",
    id: "sfNpsClass",
    key: "npsClassification",
    label: "Classificação NPS",
    options: NPS_CLASSIFICATION_FILTER_OPTIONS,
  },
  {
    kind: "selectfilter",
    id: "sfHasCsat",
    key: "hasCsat",
    label: "Possui CSAT",
    options: HAS_CSAT_FILTER_OPTIONS,
  },
  {
    kind: "selectfilter",
    id: "sfLastNps",
    key: "lastNpsBand",
    label: "Último NPS",
    options: LAST_NPS_BAND_OPTIONS,
  },
  { kind: "selectfilter", id: "sfEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "selectfilter", id: "sfProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
];

function $(id) {
  return document.getElementById(id);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("sfSearch")?.value || "",
    quarter: $("sfQuarter")?.value || "latest",
    npsClassification: $("sfNpsClass")?.value || "all",
    hasCsat: $("sfHasCsat")?.value || "all",
    lastNpsBand: $("sfLastNps")?.value || "all",
    engineer: $("sfEngineer")?.value || "all",
    program: normalizeProgramFilter($("sfProgram")?.value || "all"),
  };
}

function filteredRows() {
  return sortSatisfactionClients(
    filterSatisfactionClients(state.payload?.clients || [], state.filters),
    state.sortKey,
    state.sortDir,
  );
}

function currentSummary() {
  const scoped = buildScopedSatisfactionView(state.payload, state.filters);
  const rows = sortSatisfactionClients(
    filterSatisfactionClients(scoped.clients, state.filters),
    state.sortKey,
    state.sortDir,
  );
  const population = state.payload?.population?.totalClients ?? scopeInputsTotal(state.payload);
  const summary = summarizeSatisfactionRows(rows, population);
  const dist = distributionsFromSatisfactionRows(rows, state.payload?.distributions || {});
  return { rows, summary, dist, selectedQuarter: scoped.selectedQuarter };
}

function scopeInputsTotal(payload) {
  return payload?.scopeInputs?.totalClients ?? payload?.population?.totalClients ?? (payload?.clients || []).length;
}

function pctLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("pt-BR")}%`;
}

function npsClass(score) {
  if (score == null) return "Sem nota";
  if (score >= 9) return "Promotor";
  if (score >= 7) return "Neutro";
  return "Detrator";
}

function dateBR(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.compact) classes.push("kpi-card-compact");
  const coverageHtml = options.coverage
    ? `<div class="kpi-coverage">${escapeHtml(options.coverage)}</div>`
    : "";
  const sublegendHtml = options.sublegend || "";
  return `<article class="${classes.join(" ")}">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
    ${sublegendHtml}
    ${coverageHtml}
  </article>`;
}

function formatNpsSublegend(summary) {
  const pharus = summary?.npsPharus?.nps;
  const davos = summary?.npsDavos?.nps;
  const pharusLabel = pharus == null ? "—" : fmt.format(pharus);
  const davosLabel = davos == null ? "—" : fmt.format(davos);
  return `<div class="kpi-sublegend">Pharus ${pharusLabel} · Davos ${davosLabel}</div>`;
}

function populateFilterOptions(host = document) {
  const clients = state.payload?.clients || [];
  const quarterOptions = satisfactionQuarterOptions(state.payload);
  fillDynamicSelectFilter(host, { id: "sfQuarter", allLabel: "Mais recente" }, quarterOptions, "Mais recente", state.filters.quarter);
  fillDynamicSelectFilter(host, { id: "sfEngineer", allLabel: "Todos" }, uniqueSorted(clients.map((c) => c.engineer)), "Todos", state.filters.engineer);
  fillDynamicSelectFilter(host, { id: "sfProgram", allLabel: "Todos" }, programSelectOptions(clients), "Todos", state.filters.program);
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  const { rows, summary, dist } = currentSummary();
  const globalSummary = state.payload?.summary || {};
  const npsSublegend = formatNpsSublegend(globalSummary);
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const npsRule = state.payload?.methodology?.npsRule || "Última resposta NPS válida por cliente.";

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <p class="text-muted">${escapeHtml(npsRule)}</p>

    <section class="section-block">
      <h2>Indicadores</h2>
      <p>NPS calculado como % promotores menos % detratores. CSAT considera nota 5 como satisfeito.</p>
      <div class="kpi-row kpi-row-compact">
        ${kpiCard("NPS", summary.nps == null ? "—" : fmt.format(summary.nps), "Promotores% − detratores%", {
          sublegend: npsSublegend,
          coverage: `Cobertura NPS: ${pctLabel(summary.npsCoveragePercent)} da carteira`,
        })}
        ${kpiCard("Data do NPS", dateBR(summary.latestNpsAt), "Última resposta registrada")}
        ${kpiCard("Respostas de NPS", fmt.format(summary.npsResponses), `${fmt.format(summary.npsDistinctClients)} clientes distintos`)}
        ${kpiCard("Último NPS", summary.latestNps == null ? "—" : fmt.format(summary.latestNps), npsClass(summary.latestNps))}
        ${kpiCard("CSAT médio", summary.csatAverage == null ? "—" : fmt.format(summary.csatAverage), `${fmt.format(summary.csatResponses)} respostas CSAT`)}
        ${kpiCard("CSAT satisfeitos", pctLabel(summary.csatSatisfiedPercent), "Nota 5 na escala 1–5")}
        ${kpiCard("Clientes com feedback", fmt.format(summary.clientsWithFeedback), "NPS ou CSAT vinculado", { coverage: `Cobertura: ${pctLabel(summary.feedbackCoveragePercent)} da carteira` })}
      </div>
    </section>

    <section class="section-block">
      <h2>Distribuições</h2>
      <div class="chart-grid">
        <article class="chart-card"><h3>Classificação NPS</h3><div id="sfChartNps"></div></article>
        <article class="chart-card"><h3>CSAT</h3><div id="sfChartCsat"></div></article>
      </div>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Clientes</h2>
          ${renderTableToolbar({ countLabel: `${fmt.format(rows.length)} registros encontrados`, exportPrefix: "satisfaction" })}
        </div>
      </div>
      <div class="table-wrap">
        <table class="gd-table">
          <thead>
            <tr>
              <th data-sort="clientName">Cliente</th>
              <th data-sort="clientCode">Código</th>
              <th data-sort="engineer">EP</th>
              <th data-sort="latestNps">Último NPS</th>
              <th data-sort="latestNpsAt">Data NPS</th>
              <th data-sort="npsResponses">Respostas NPS</th>
              <th data-sort="averageCsat">CSAT médio</th>
              <th data-sort="csatResponses">Respostas CSAT</th>
            </tr>
          </thead>
          <tbody id="sfRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="sfPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="sfNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  if ($("sfChartNps")) $("sfChartNps").innerHTML = vBars(dist.npsClassification.filter((i) => i.count > 0));
  if ($("sfChartCsat")) $("sfChartCsat").innerHTML = donut(dist.csatSatisfaction.filter((i) => i.count > 0));

  const tbody = $("sfRows");
  if (tbody) {
    tbody.innerHTML = pageRows.length
      ? pageRows
          .map(
            (c) => `<tr>
          <td class="truncate" title="${escapeHtml(c.clientName)}">${escapeHtml(c.clientName)}</td>
          <td>${escapeHtml(c.clientCode || "Não informado")}</td>
          <td class="truncate">${escapeHtml(c.engineer)}</td>
          <td class="num">${c.latestNps == null ? "—" : fmt.format(c.latestNps)}</td>
          <td>${dateBR(c.latestNpsAt)}</td>
          <td class="num">${fmt.format(c.npsResponses || 0)}</td>
          <td class="num">${c.averageCsat == null ? "—" : fmt.format(c.averageCsat)}</td>
          <td class="num">${fmt.format(c.csatResponses || 0)}</td>
        </tr>`,
          )
          .join("")
      : `<tr><td colspan="8">Nenhum cliente encontrado para os filtros selecionados.</td></tr>`;
  }

  $("sfPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("sfNext")?.addEventListener("click", () => {
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
    exportFilteredTable({ pageId: "satisfaction", rows, filters: state.filters, format });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveVisibleFilterFields("satisfaction", FILTER_FIELDS);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "satisfaction",
    innerHtml: renderFilterBar({ fields, filters: state.filters }),
    onBodyReady: (body) => {
      if (state.payload) populateFilterOptions(body);
      $("sfQuarter") && ($("sfQuarter").value = state.filters.quarter || "latest");
      $("sfNpsClass") && ($("sfNpsClass").value = state.filters.npsClassification || "all");
      $("sfHasCsat") && ($("sfHasCsat").value = state.filters.hasCsat || "all");
      $("sfLastNps") && ($("sfLastNps").value = state.filters.lastNpsBand || "all");
      $("sfEngineer") && ($("sfEngineer").value = state.filters.engineer);
      $("sfProgram") && ($("sfProgram").value = state.filters.program);
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultSatisfactionFilters();
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
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="sfRetry">Tentar novamente</button></div>
  </div>`;
  $("sfRetry")?.addEventListener("click", () => {
    void loadSatisfaction({ force: true });
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
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando satisfação</strong><span>Consultando a BASE QV…</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Satisfação] render", error);
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
    buttonId: "sfRefresh",
    onRefresh: () => loadSatisfaction({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadSatisfaction({ force = false } = {}) {
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
    state.payload = await fetchPageJson("/api/satisfaction", { force });
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

function unmountSatisfaction() {
  state.mounted = false;
}

function mountSatisfaction() {
  state.mounted = true;
  setActions(false);
  void loadSatisfaction();
}

export function bootSatisfaction() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "satisfaction") mountSatisfaction();
    else if (state.mounted) unmountSatisfaction();
  });
  if (getCurrentPageId() === "satisfaction") mountSatisfaction();
}
