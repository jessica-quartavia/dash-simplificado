import { onPageChange, getCurrentPageId } from "./navigation.js";
import { analyticalStatusDisplayLabel } from "../lib/analytics/analytical-cancellation.mjs";
import {
  buildPreCancellationInsights,
  defaultTemporalIndicatorsFilters,
  sortTemporalActivityRecency,
  summarizeFilteredTemporal,
  needsTemporalClientRows,
  TEMPORAL_CANCEL_OPTIONS,
  temporalMonthSelectOptions,
} from "../lib/analytics/temporal-indicators-filters.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";
import { escapeHtml, hBars } from "./general-charts.mjs";
import {
  bindFilterBar,
  bindTableExport,
  fillDynamicSelect,
  renderFilterBar,
  renderTableToolbar,
} from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { exportFilename, exportToCsv, exportToExcel } from "./utils/table-export.js";

const fmt = new Intl.NumberFormat("pt-BR");

const METHODOLOGY_NOTE =
  "Âncora de churn: churn_efetivado_at > distrato_assinado_at > data_churn. Janelas pré-cancelamento: 30, 60, 90 e 180 dias (baseline 91–180 dias). Associações observadas são descritivas — não implicam causalidade.";

const RECENCY_EXPORT_COLUMNS = [
  { key: "name", header: "Cliente" },
  { key: "code", header: "Código" },
  { key: "engineer", header: "EP" },
  { key: "program", header: "Programa" },
  { key: "status", header: "Status" },
  { key: "source", header: "Origem técnica" },
  { key: "lastLoginAt", header: "Último login", type: "date" },
  { key: "lastMeetingAt", header: "Última reunião", type: "date" },
  { key: "lastImplementationAt", header: "Última implementação", type: "date" },
  { key: "lastFinancialUpdateAt", header: "Última atual. financeira", type: "date" },
  { key: "lastNpsAt", header: "Último NPS", type: "date" },
  { key: "daysSinceLastLogin", header: "Dias s/ login", type: "number" },
  { key: "daysSinceLastMeeting", header: "Dias s/ reunião", type: "number" },
  { key: "daysSinceLastImplementation", header: "Dias s/ implementação", type: "number" },
  { key: "daysSinceLastFinancialUpdate", header: "Dias s/ atual. financeira", type: "number" },
  { key: "daysSinceLastNps", header: "Dias s/ NPS", type: "number" },
];

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultTemporalIndicatorsFilters(),
  sortKey: "name",
  sortDir: "asc",
  page: 1,
  pageSize: 25,
  monthlyClients: null,
  monthlyClientsLoading: false,
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "tiSearch", key: "search" },
  { kind: "select", id: "tiProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "tiMonth", key: "month", label: "Mês", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "tiCancelWindow", key: "cancelWindow", label: "Cancelamento", options: TEMPORAL_CANCEL_OPTIONS },
];

function $(id) {
  return document.getElementById(id);
}

function filtersFromForm() {
  return {
    search: $("tiSearch")?.value || "",
    program: normalizeProgramFilter($("tiProgram")?.value || "all"),
    source: "all",
    month: $("tiMonth")?.value || "all",
    cancelWindow: $("tiCancelWindow")?.value || "all",
  };
}

function effectivePayload() {
  if (!state.payload) return null;
  if (state.monthlyClients?.length) {
    return { ...state.payload, clients: state.monthlyClients };
  }
  return state.payload;
}

function currentView() {
  const filtered = summarizeFilteredTemporal(effectivePayload() || {}, state.filters);
  const recencyRows = sortTemporalActivityRecency(filtered.recency, state.sortKey, state.sortDir);
  const insights = buildPreCancellationInsights(filtered.preCancellation);
  const preSignalBars = (filtered.preCancellation?.signals || [])
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
    .map((item) => ({ label: item.label, count: item.count, percent: item.percent }));
  const activeSignalBars = (filtered.activeRisk?.signals || [])
    .filter((item) => item.count > 0)
    .map((item) => ({ label: item.label, count: item.count, percent: item.percent }));
  const signalIntensityBars = (filtered.activeRisk?.signalCountDistribution || [])
    .filter((item) => item.count > 0);
  return {
    summary: filtered.summary,
    preCancellation: filtered.preCancellation,
    activeRisk: filtered.activeRisk,
    recencyRows,
    insights,
    preSignalBars,
    activeSignalBars,
    signalIntensityBars,
  };
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

function dateBR(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function daysLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return fmt.format(value);
}

function populateFilterOptions() {
  fillDynamicSelect($("tiProgram"), programSelectOptions(state.payload?.activityRecency || []), "Todos", state.filters.program);
  const monthOpts = temporalMonthSelectOptions(state.payload || {}, state.filters.month);
  fillDynamicSelect(
    $("tiMonth"),
    monthOpts.map((o) => ({ value: o.value, label: o.label })),
    "Todos",
    state.filters.month,
  );
  if ($("tiCancelWindow")) $("tiCancelWindow").value = state.filters.cancelWindow || "all";
}

function resolveFilterFields() {
  const resolved = resolveVisibleFilterFields("temporal_indicators", FILTER_FIELDS);
  return resolved.length ? resolved : FILTER_FIELDS;
}

function exportRecencyTable(rows, format) {
  const filters = [
    { label: "Programa", value: state.filters.program === "all" ? "Todos" : state.filters.program },
    { label: "Mês", value: state.filters.month === "all" ? "Todos" : state.filters.month },
    {
      label: "Cancelamento",
      value: TEMPORAL_CANCEL_OPTIONS.find((o) => o.value === state.filters.cancelWindow)?.label || "Todos",
    },
    { label: "Busca", value: String(state.filters.search || "").trim() || "—" },
  ];
  const filename = exportFilename("indicadores-temporais", format === "xlsx" ? "xlsx" : "csv");
  if (format === "xlsx") {
    return exportToExcel({ rows, columns: RECENCY_EXPORT_COLUMNS, filename, filters });
  }
  return exportToCsv({ rows, columns: RECENCY_EXPORT_COLUMNS, filename, filters });
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  const { summary, preCancellation, activeRisk, recencyRows, insights, preSignalBars, activeSignalBars, signalIntensityBars } = currentView();
  const pages = Math.max(1, Math.ceil(recencyRows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = recencyRows.slice(start, start + state.pageSize);

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <p class="text-muted">${escapeHtml(METHODOLOGY_NOTE)}</p>

    <section class="section-block">
      <h2>Indicadores</h2>
      <p>Atividade agregada de clientes/usuários no recorte filtrado (últimos ${state.payload?.months?.length || 12} meses).</p>
      <div class="kpi-row kpi-row-compact">
        ${kpiCard("Clientes/usuários", fmt.format(summary.totalSubjects), "Clientes e usuários Pharus vinculados")}
        ${kpiCard("Logins", fmt.format(summary.totalLogins), "App Pharus metrics.events")}
        ${kpiCard("Reuniões", fmt.format(summary.totalMeetings), "client_meetings + manual_meetings")}
        ${kpiCard("Atualizações financeiras", fmt.format(summary.totalFinancialUpdates), "client_financial_data")}
        ${kpiCard("Respostas NPS", fmt.format(summary.totalNpsResponses), "nps_responses vinculados")}
      </div>
    </section>

    <section class="section-block">
      <h2>Principais sinais observados</h2>
      <p>Padrões associados a cancelados analisados (${fmt.format(preCancellation.analyzedCancelledClients || 0)} casos). Linguagem descritiva — não implica causalidade.</p>
      <ul class="insight-list">
        ${
          insights.length
            ? insights.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
            : `<li class="placeholder-note">Sem insights determinísticos para o recorte atual.</li>`
        }
      </ul>
    </section>

    <section class="section-block">
      <h2>Sinais antes do cancelamento</h2>
      <p>${fmt.format(preCancellation.clientsWithSignals || 0)} de ${fmt.format(preCancellation.analyzedCancelledClients || 0)} cancelados (${pctLabel(preCancellation.clientsWithSignalsPercent)}) com ao menos um sinal.</p>
      <div class="chart-grid chart-grid-single">
        <article class="chart-card"><h3>Ranking de sinais pré-cancelamento</h3><div id="tiChartPreCancel"></div></article>
      </div>
    </section>

    <section class="section-block">
      <h2>Risco em clientes ativos</h2>
      <p>${fmt.format(activeRisk.clientsWithSignals || 0)} de ${fmt.format(activeRisk.analyzedActiveClients || 0)} ativos (${pctLabel(activeRisk.clientsWithSignalsPercent)}) com sinais recentes para monitoramento.</p>
      <div class="chart-grid">
        <article class="chart-card"><h3>Sinais em carteira ativa</h3><div id="tiChartActiveRisk"></div></article>
        <article class="chart-card"><h3>Clientes por quantidade de sinais</h3><p>Cada cliente ativo é contado uma única vez em sua faixa</p><div id="tiChartActiveRiskIntensity"></div></article>
      </div>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Recência de atividade</h2>
          ${renderTableToolbar({ countLabel: `${fmt.format(recencyRows.length)} registros encontrados`, exportPrefix: "temporal-indicators" })}
        </div>
      </div>
      <div class="table-wrap">
        <table class="gd-table">
          <thead>
            <tr>
              <th data-sort="name">Cliente</th>
              <th data-sort="code">Código</th>
              <th data-sort="engineer">EP</th>
              <th data-sort="program">Programa</th>
              <th data-sort="status">Status</th>
              <th data-sort="daysSinceLastLogin">Dias s/ login</th>
              <th data-sort="daysSinceLastMeeting">Dias s/ reunião</th>
              <th data-sort="daysSinceLastFinancialUpdate">Dias s/ atual. fin.</th>
              <th data-sort="daysSinceLastNps">Dias s/ NPS</th>
              <th data-sort="lastLoginAt">Último login</th>
            </tr>
          </thead>
          <tbody id="tiRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="tiPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="tiNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  $("tiChartPreCancel") && ($("tiChartPreCancel").innerHTML = hBars(preSignalBars));
  $("tiChartActiveRisk") && ($("tiChartActiveRisk").innerHTML = hBars(activeSignalBars));
  $("tiChartActiveRiskIntensity") && ($("tiChartActiveRiskIntensity").innerHTML = signalIntensityBars.length
    ? hBars(signalIntensityBars)
    : `<p class="placeholder-note">Sem clientes ativos com sinais.</p>`);

  const tbody = $("tiRows");
  if (tbody) {
    tbody.innerHTML = pageRows.length
      ? pageRows
          .map(
            (row) => `<tr>
          <td class="truncate" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.code || "Não informado")}</td>
          <td class="truncate">${escapeHtml(row.engineer || "—")}</td>
          <td>${escapeHtml(row.program || "—")}</td>
          <td>${statusBadge(row.status)}</td>
          <td class="num">${daysLabel(row.daysSinceLastLogin)}</td>
          <td class="num">${daysLabel(row.daysSinceLastMeeting)}</td>
          <td class="num">${daysLabel(row.daysSinceLastFinancialUpdate)}</td>
          <td class="num">${daysLabel(row.daysSinceLastNps)}</td>
          <td>${dateBR(row.lastLoginAt)}</td>
        </tr>`,
          )
          .join("")
      : `<tr><td colspan="10">Nenhum registro encontrado para os filtros selecionados.</td></tr>`;
  }

  $("tiPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("tiNext")?.addEventListener("click", () => {
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
    exportRecencyTable(recencyRows, format);
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveFilterFields();
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "temporal_indicators",
    innerHtml: renderFilterBar({ fields, filters: state.filters }),
    onBodyReady: (body) => {
      populateFilterOptions();
      $("tiProgram") && ($("tiProgram").value = state.filters.program);
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultTemporalIndicatorsFilters();
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
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="tiRetry">Tentar novamente</button></div>
  </div>`;
  $("tiRetry")?.addEventListener("click", () => {
    void loadTemporalIndicators({ force: true });
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
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando indicadores temporais</strong><span>Consultando BASE QV e App Pharus…</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Indicadores Temporais] render", error);
    renderErrorView("Não foi possível carregar os dados.", error instanceof Error ? error.message : "Falha ao montar a página.");
  }
}

async function ensureTemporalClientRows() {
  if (!needsTemporalClientRows(state.filters)) return;
  if (state.monthlyClients?.length || state.monthlyClientsLoading) return;
  state.monthlyClientsLoading = true;
  try {
    const detail = await fetchPageJson("/api/temporal-indicators/details");
    state.monthlyClients = detail.clients || [];
  } catch (error) {
    console.warn("[Temporal] lazy clients failed", error);
  } finally {
    state.monthlyClientsLoading = false;
  }
}

const onFilterChange = createFilterChangeHandler({
  state,
  filtersFromForm,
  renderFilters,
  renderSuccess: () => {
    void ensureTemporalClientRows().then(() => renderSuccess());
  },
});

function ensurePageRefresh() {
  if (pageRefresh) return pageRefresh;
  pageRefresh = createPageRefresh({
    buttonId: "tiRefresh",
    onRefresh: () => loadTemporalIndicators({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadTemporalIndicators({ force = false } = {}) {
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
  if (force) {
    state.payload = null;
    state.monthlyClients = null;
  }
  ensurePageRefresh().setLoading(true);
  renderFilters();
  renderStateView();
  try {
    state.payload = await fetchPageJson("/api/temporal-indicators", { force });
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

function unmountTemporalIndicators() {
  state.mounted = false;
}

function mountTemporalIndicators() {
  state.mounted = true;
  setActions(false);
  void loadTemporalIndicators();
}

export function bootTemporalIndicators() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "temporal_indicators") mountTemporalIndicators();
    else if (state.mounted) unmountTemporalIndicators();
  });
  if (getCurrentPageId() === "temporal_indicators") mountTemporalIndicators();
}
