import { onPageChange, getCurrentPageId } from "./navigation.js";
import { analyticalStatusDisplayLabel } from "../lib/analytics/analytical-cancellation.mjs";
import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTER_OPTIONS,
  FINANCIAL_TRAIT_OPTIONS,
  defaultFinancialUpdatesFilters,
  filterFinancialUpdateClients,
  sortFinancialUpdateClients,
} from "../lib/analytics/financial-updates-filters.mjs";
import {
  distributionsFromFinancialRows,
  summarizeFinancialUpdateRows,
  financialUpdatesLeader,
  formatFinancialLeaderNote,
} from "../lib/analytics/financial-updates-metrics.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { resolvePeriod } from "../lib/analytics/filters/period.mjs";
import { parseMultiSelectValue } from "../lib/analytics/filters/multiselect.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";
import { donut, escapeHtml, hBars, financialUpdateColumns } from "./general-charts.mjs";
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
  filters: defaultFinancialUpdatesFilters(),
  sortKey: "clientName",
  sortDir: "asc",
  page: 1,
  pageSize: 25,
  monthRange: 6,
  showAllEngineers: false,
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "fuSearch", key: "search" },
  { kind: "period", id: "fuPeriod", fromId: "fuFrom", toId: "fuTo" },
  { kind: "select", id: "fuStatus", key: "status", label: "Status", options: STATUS_FILTER_OPTIONS },
  { kind: "select", id: "fuEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "fuSegment", key: "segment", label: "Segmento", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "fuProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
  {
    kind: "multiselect",
    id: "fuTraits",
    key: "financialTraits",
    label: "Dados financeiros",
    options: FINANCIAL_TRAIT_OPTIONS,
    allLabel: "Todos",
  },
];

function $(id) {
  return document.getElementById(id);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("fuSearch")?.value || "",
    period: $("fuPeriod")?.value || "all",
    from: $("fuFrom")?.value || "",
    to: $("fuTo")?.value || "",
    status: $("fuStatus")?.value || DEFAULT_STATUS_FILTER,
    engineer: $("fuEngineer")?.value || "all",
    segment: $("fuSegment")?.value || "all",
    program: normalizeProgramFilter($("fuProgram")?.value || "all"),
    financialTraits: parseMultiSelectValue($("fuTraits")?.value || ""),
  };
}

function filteredRows() {
  return sortFinancialUpdateClients(
    filterFinancialUpdateClients(state.payload?.clients || [], state.filters),
    state.sortKey,
    state.sortDir,
  );
}

function currentSummary() {
  const rows = filteredRows();
  const summary = summarizeFinancialUpdateRows(rows, state.payload?.summary || {});
  const dist = distributionsFromFinancialRows(rows, {
    monthRange: state.monthRange,
    filters: state.filters,
  });
  return { rows, summary, dist };
}

function pctLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("pt-BR")}%`;
}

function daysLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${fmt.format(Math.round(Number(value)))} d`;
}

function coverageLine(coverage, extra = "") {
  if (!coverage || !coverage.total) return extra;
  const base = `${fmt.format(coverage.sample)} clientes · ${Number(coverage.percent).toLocaleString("pt-BR")}% da carteira filtrada`;
  return extra ? `${extra} · ${base}` : base;
}

function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.compact) classes.push("kpi-card-compact");
  if (options.highlight) classes.push("kpi-card-highlight");
  if (options.featured) classes.push("kpi-card-featured");
  const coverageHtml = options.coverage
    ? `<div class="kpi-coverage">${escapeHtml(options.coverage)}</div>`
    : "";
  return `<article class="${classes.join(" ")}">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
    ${coverageHtml}
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
  fillDynamicSelect($("fuEngineer"), uniqueSorted(clients.map((c) => c.engineer)), "Todos", state.filters.engineer);
  fillDynamicSelect($("fuSegment"), uniqueSorted(clients.map((c) => c.segment)), "Todos", state.filters.segment);
  fillDynamicSelect($("fuProgram"), programSelectOptions(clients), "Todos", state.filters.program);
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  const { rows, summary, dist } = currentSummary();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const note = state.payload?.summary?.note || "Atualização = updated_at > created_at.";
  const engItems = (dist.updatesByEngineer || []).slice(0, state.showAllEngineers ? undefined : 8);
  const leader = financialUpdatesLeader(rows);
  const leaderNote = formatFinancialLeaderNote(leader);

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <p class="text-muted">${escapeHtml(note)}</p>

    <section class="section-block">
      <h2>Cobertura financeira</h2>
      <p>Quem possui registro em client_financial_data no recorte filtrado. O padrão da página é clientes ativos.</p>
      <div class="kpi-row kpi-row-primary kpi-row-three">
        ${kpiCard("Clientes com dados financeiros", fmt.format(summary.clientsWithFinancialData), pctLabel(summary.financialDataCoveragePercent) + " da carteira", { featured: true, highlight: true })}
        ${kpiCard("Registro alterado após criação", fmt.format(summary.clientsWithPostCreationUpdate), "Regra: updated_at > created_at", { compact: true })}
        ${kpiCard("Atualizados nos últimos 30 dias", fmt.format(summary.updatedLast30Days), pctLabel(summary.updatedLast30DaysPercentOfFinancial) + " com dados financeiros", { compact: true })}
      </div>
    </section>

    <section class="section-block">
      <h2>Atualização / recência</h2>
      <p>Mediana de dias desde a última atualização válida entre clientes com dados financeiros.</p>
      <div class="kpi-row kpi-row-primary kpi-row-three">
        ${kpiCard("Recência da atualização", daysLabel(summary.medianDaysSinceUpdate), summary.averageDaysSinceUpdate != null ? `Mediana · média ${daysLabel(summary.averageDaysSinceUpdate)}` : "Mediana sobre clientes com atualização válida", { featured: true, highlight: true })}
        ${kpiCard("Dados desatualizados (> 90 dias)", fmt.format(summary.outdatedOver90Days), pctLabel(summary.outdatedOver90DaysPercent) + " com dados financeiros", { featured: true, highlight: true })}
      </div>
      <article class="chart-card chart-card-featured">
        <h3>Recência dos dados financeiros</h3>
        <p>Faixas desde a última atualização conhecida (updated_at > created_at).</p>
        <div id="fuChartRecency"></div>
      </article>
    </section>

    <section class="section-block">
      <h2>Engrenagens</h2>
      <p>Tempo entre o primeiro registro financeiro e a reunião de Ativação das Engrenagens.</p>
      <div class="kpi-row">
        ${kpiCard("Tempo até ativação das engrenagens", daysLabel(summary.medianDaysFinancialToActivation), coverageLine(summary.financialToActivationCoverage, `${fmt.format(summary.financialToActivationSample)} clientes com sequência válida`))}
      </div>
    </section>

    <section class="section-block">
      <h2>Evolução</h2>
      <article class="chart-card chart-card-featured">
        <div class="table-panel-head">
          <div><h3>Atualizações financeiras por mês</h3><p>Clientes distintos com updated_at > created_at no mês.</p></div>
          <div class="seg" id="fuMonthRangeSeg" role="group" aria-label="Período do gráfico mensal">
            <button type="button" data-fu-month-range="6" class="${state.monthRange === 6 ? "active" : ""}">6 meses</button>
            <button type="button" data-fu-month-range="12" class="${state.monthRange === 12 ? "active" : ""}">12 meses</button>
            <button type="button" data-fu-month-range="24" class="${state.monthRange === 24 ? "active" : ""}">24 meses</button>
          </div>
        </div>
        <div id="fuChartMonths"></div>
      </article>
    </section>

    <section class="section-block">
      <h2>Qualidade / cobertura</h2>
      <article class="chart-card">
        <h3>Cobertura dos campos financeiros</h3>
        <p>Preenchimento sobre a carteira filtrada.</p>
        <div id="fuChartCoverage"></div>
      </article>
    </section>

    <section class="section-block">
      <h2>EP</h2>
      <article class="chart-card">
        <h3>Atualização por Engenheiro Patrimonial</h3>
        <p>Clientes com atualização nos últimos 30 dias, por EP.</p>
        <div id="fuChartEngineers"></div>
        ${leaderNote ? `<p class="chart-note">${escapeHtml(leaderNote)}</p>` : ""}
        <button class="btn btn-secondary" type="button" id="fuToggleEngineers">${state.showAllEngineers ? "Ver principais" : "Ver todos"}</button>
      </article>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Clientes</h2>
          ${renderTableToolbar({ countLabel: `${fmt.format(rows.length)} registros encontrados`, exportPrefix: "financial" })}
        </div>
      </div>
      <div class="table-wrap">
        <table class="gd-table">
          <thead>
            <tr>
              <th data-sort="clientName">Cliente</th>
              <th data-sort="clientCode">Código</th>
              <th data-sort="engineer">EP</th>
              <th data-sort="analyticalStatus">Status</th>
              <th data-sort="hasFinancialData">Possui dados</th>
              <th data-sort="financialUpdateDate">Última atualização</th>
              <th data-sort="daysSinceFinancialUpdate">Dias</th>
              <th data-sort="updatedLast30Days">30d</th>
              <th data-sort="filledFinancialFields">Cobertura</th>
            </tr>
          </thead>
          <tbody id="fuRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="fuPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="fuNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  if ($("fuChartRecency")) $("fuChartRecency").innerHTML = hBars(dist.updateRecency);
  if ($("fuChartMonths")) {
    $("fuChartMonths").innerHTML = financialUpdateColumns(dist.updatesByMonth, state.monthRange);
  }
  if ($("fuChartCoverage")) $("fuChartCoverage").innerHTML = hBars(dist.fieldCoverage.filter((i) => i.count > 0));
  if ($("fuChartEngineers")) {
    $("fuChartEngineers").innerHTML = hBars(
      engItems.map((i) => ({ ...i, label: `${i.label} · ${i.recentUpdatePercent ?? i.percent}%` })),
    );
  }

  const tbody = $("fuRows");
  if (tbody) {
    tbody.innerHTML = pageRows.length
      ? pageRows
          .map(
            (c) => `<tr>
          <td class="truncate" title="${escapeHtml(c.clientName)}">${escapeHtml(c.clientName)}</td>
          <td>${escapeHtml(c.clientCode || "Não informado")}</td>
          <td class="truncate">${escapeHtml(c.engineer)}</td>
          <td>${statusBadge(c.analyticalStatus)}</td>
          <td>${boolLabel(c.hasFinancialData)}</td>
          <td>${dateBR(c.financialUpdateDate)}</td>
          <td class="num">${c.daysSinceFinancialUpdate == null ? "—" : fmt.format(c.daysSinceFinancialUpdate)}</td>
          <td>${boolLabel(c.updatedLast30Days)}</td>
          <td class="num">${c.hasFinancialData ? `${c.filledFinancialFields}/${c.totalFinancialFields}` : "—"}</td>
        </tr>`,
          )
          .join("")
      : `<tr><td colspan="9">Nenhum cliente encontrado para os filtros selecionados.</td></tr>`;
  }

  $("fuPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("fuNext")?.addEventListener("click", () => {
    state.page += 1;
    renderSuccess();
  });
  $("fuToggleEngineers")?.addEventListener("click", () => {
    state.showAllEngineers = !state.showAllEngineers;
    renderSuccess();
  });
  document.querySelectorAll("#fuMonthRangeSeg [data-fu-month-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.monthRange = Number(btn.dataset.fuMonthRange) || 12;
      renderSuccess();
    });
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
    exportFilteredTable({ pageId: "financial_updates", rows, filters: state.filters, format });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveVisibleFilterFields("financial_updates", FILTER_FIELDS);
  const period = resolvePeriod(state.filters);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "financial_updates",
    innerHtml: renderFilterBar({
      fields,
      filters: state.filters,
      periodInvalid: period.invalid,
      note: "Multiselect financeiro: OR entre opções; AND com demais filtros.",
    }),
    onBodyReady: (body) => {
      if (state.payload) populateFilterOptions();
      $("fuEngineer") && ($("fuEngineer").value = state.filters.engineer);
      $("fuSegment") && ($("fuSegment").value = state.filters.segment);
      $("fuProgram") && ($("fuProgram").value = state.filters.program);
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultFinancialUpdatesFilters();
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
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="fuRetry">Tentar novamente</button></div>
  </div>`;
  $("fuRetry")?.addEventListener("click", () => {
    void loadFinancialUpdates({ force: true });
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
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando atualização financeira</strong><span>Consultando a BASE QV…</span></div>`;
    return;
  }
  if (state.payload && !(state.payload.clients || []).length) {
    content.innerHTML = `<div class="gd-status"><strong>Sem clientes</strong><span>A consulta não retornou registros para esta base.</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Financeiro] render", error);
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
    pageId: "financial_updates",
    buttonId: "fuRefresh",
    csvButtonId: "fuCsv",
    getExportContext: () => ({ payload: state.payload, filters: state.filters, loading: state.loading }),
    onRefresh: () => loadFinancialUpdates({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadFinancialUpdates({ force = false } = {}) {
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
    state.payload = await fetchPageJson("/api/financial-updates", { force });
    state.filters = {
      ...defaultFinancialUpdatesFilters(),
      ...state.filters,
      status: state.filters.status || DEFAULT_STATUS_FILTER,
    };
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

function unmountFinancialUpdates() {
  state.mounted = false;
}

function mountFinancialUpdates() {
  state.mounted = true;
  setActions(false);
  void loadFinancialUpdates();
}

export function bootFinancialUpdates() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "financial_updates") mountFinancialUpdates();
    else if (state.mounted) unmountFinancialUpdates();
  });
  if (getCurrentPageId() === "financial_updates") mountFinancialUpdates();
}
