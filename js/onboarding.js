import { onPageChange, getCurrentPageId } from "./navigation.js";
import { analyticalStatusDisplayLabel } from "../lib/analytics/analytical-cancellation.mjs";
import {
  COMPLETION_FILTER_OPTIONS,
  DEFAULT_STATUS_FILTER,
  STATUS_FILTER_OPTIONS,
  defaultOnboardingFilters,
  filterOnboardingClients,
  sortOnboardingClients,
} from "../lib/analytics/onboarding-filters.mjs";
import {
  distributionsFromOnboardingRows,
  summarizeOnboardingRows,
} from "../lib/analytics/onboarding-metrics.mjs";
import { donut, escapeHtml, hBars } from "./general-charts.mjs";
import { resolvePeriod } from "../lib/analytics/filters/period.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
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
  filters: defaultOnboardingFilters(),
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
  { kind: "search", id: "obSearch", key: "search" },
  { kind: "period", id: "obPeriod", fromId: "obFrom", toId: "obTo" },
  { kind: "select", id: "obStatusFilter", key: "status", label: "Status", options: STATUS_FILTER_OPTIONS },
  { kind: "select", id: "obEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "obProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "obCompletion", key: "completion", label: "Conclusão", options: COMPLETION_FILTER_OPTIONS },
];

function $(id) {
  return document.getElementById(id);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("obSearch")?.value || "",
    period: $("obPeriod")?.value || "all",
    from: $("obFrom")?.value || "",
    to: $("obTo")?.value || "",
    status: $("obStatusFilter")?.value || DEFAULT_STATUS_FILTER,
    engineer: $("obEngineer")?.value || "all",
    program: normalizeProgramFilter($("obProgram")?.value || "all"),
    completion: $("obCompletion")?.value || "all",
  };
}

function filteredRows() {
  return sortOnboardingClients(
    filterOnboardingClients(state.payload?.clients || [], state.filters),
    state.sortKey,
    state.sortDir,
  );
}

function coverageLine(coverage, extra = "") {
  if (!coverage || !coverage.total) return extra;
  const sample = fmt.format(coverage.sample);
  const percent = Number(coverage.percent).toLocaleString("pt-BR");
  const base = `${sample} clientes com dados suficientes · ${percent}% da população`;
  return extra ? `${extra} · ${base}` : base;
}

function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.compact) classes.push("kpi-card-compact");
  if (options.highlight) classes.push("kpi-card-highlight");
  if (options.featured) classes.push("kpi-card-featured");
  const noteHtml = note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : "";
  const coverageHtml = options.coverage
    ? `<div class="kpi-coverage">${escapeHtml(options.coverage)}</div>`
    : "";
  return `<article class="${classes.join(" ")}">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${noteHtml}
    ${coverageHtml}
  </article>`;
}

function daysLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const rounded = Math.round(Number(value));
  return `${fmt.format(rounded)} d`;
}

function completionLabel(value) {
  if (value === true) return `<span class="badge badge-active">Concluiu</span>`;
  if (value === false) return `<span class="badge badge-cancelled">Não concluiu</span>`;
  return `<span class="badge badge-muted">Não avaliável</span>`;
}

function statusBadge(status) {
  const label = analyticalStatusDisplayLabel(status);
  let cls = "badge-muted";
  if (label === "Ativo") cls = "badge-active";
  else if (label === "Congelado") cls = "badge-frozen";
  else if (label.startsWith("Cancelado") || label.startsWith("Marcado")) cls = "badge-cancelled";
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function fillSelect(select, values, allLabel) {
  if (!select) return;
  const current = select.value || "all";
  select.innerHTML =
    `<option value="all">${escapeHtml(allLabel)}</option>` +
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  select.value = [...select.options].some((o) => o.value === current) ? current : "all";
}

function populateFilterOptions() {
  const clients = state.payload?.clients || [];
  fillDynamicSelect($("obEngineer"), uniqueSorted(clients.map((c) => c.engineer)), "Todos", state.filters.engineer);
  fillDynamicSelect($("obProgram"), programSelectOptions(clients), "Todos", state.filters.program);
}

function renderSuccess() {
  const rows = filteredRows();
  const summary = summarizeOnboardingRows(rows);
  const dist = distributionsFromOnboardingRows(rows);
  const content = $("page-content");
  if (!content) return;

  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const comparableNote = coverageLine(
    summary.comparableCoverage,
    "Mediana entre clientes com os três marcos comparáveis",
  );
  const mechanismNote = coverageLine(
    summary.firstImplementationCoverage,
    "Leitura com cautela — amostra pequena; preenchimento retroativo pode distorcer",
  );

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <section class="section-block">
      <h2>Situação do onboarding</h2>
      <p>Quem já concluiu a jornada inicial no recorte filtrado. O padrão da página é clientes ativos.</p>
      <div class="kpi-row kpi-row-primary kpi-row-three">
        ${kpiCard("Concluíram onboarding", fmt.format(summary.completedOnboarding), "Estágio fora dos abertos, primeira reunião ou dado financeiro", { highlight: true, featured: true })}
        ${kpiCard("Não concluíram", fmt.format(summary.openOnboarding), "Ainda em estágio aberto, sem reunião nem financeiro")}
        ${kpiCard("Percentual de conclusão", `${Number(summary.completedPercent).toLocaleString("pt-BR")}%`, coverageLine(summary.completionCoverage, "Sobre a população avaliável"))}
      </div>
      <article class="chart-card chart-card-featured">
        <h3>Concluiu onboarding</h3>
        <p>Sim ou não entre clientes avaliáveis. ${escapeHtml(coverageLine(summary.completionCoverage))}</p>
        <div id="obChartCompletion"></div>
      </article>
    </section>

    <section class="section-block">
      <h2>Tempo de onboarding</h2>
      <p>Distribuição do tempo total até o primeiro marco (reunião ou dado financeiro), na coorte comparável.</p>
      <article class="chart-card chart-card-featured">
        <h3>Tempo total de onboarding</h3>
        <p>${escapeHtml(coverageLine(summary.comparableCoverage))}</p>
        <div id="obChartTotal"></div>
      </article>
    </section>

    <section class="section-block">
      <h2>Indicadores complementares</h2>
      <p>Medianas de apoio. Não representam a carteira inteira quando a cobertura é baixa.</p>
      <div class="kpi-row kpi-row-compact">
        ${kpiCard("Mediana onboarding total", daysLabel(summary.medianTotalOnboardingDays), comparableNote, { compact: true })}
        ${kpiCard("Mediana até 1ª reunião", daysLabel(summary.medianFirstMeetingDays), comparableNote, { compact: true })}
        ${kpiCard("Mediana até entrega do plano", daysLabel(summary.medianPlanDeliveryDays), comparableNote, { compact: true })}
        ${kpiCard("Mediana até 1º mecanismo", daysLabel(summary.medianFirstImplementationDays), mechanismNote, { compact: true })}
      </div>
    </section>

    <section class="section-block">
      <h2>Tempos por etapa</h2>
      <p>Mesma coorte comparável do tempo total de onboarding.</p>
      <div class="chart-grid">
        <article class="chart-card chart-card-quiet">
          <h3>Dias até a primeira reunião</h3>
          <p>${escapeHtml(coverageLine(summary.comparableCoverage))}</p>
          <div id="obChartFirstMeeting"></div>
        </article>
        <article class="chart-card chart-card-quiet">
          <h3>Dias até entrega do plano patrimonial</h3>
          <p>${escapeHtml(coverageLine(summary.comparableCoverage))}</p>
          <div id="obChartPlan"></div>
        </article>
      </div>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Clientes</h2>
          ${renderTableToolbar({
            countLabel: `${fmt.format(rows.length)} registros encontrados`,
            exportPrefix: "journey",
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
              <th data-sort="analyticalStatus">Status</th>
              <th data-sort="completedOnboarding">Conclusão</th>
              <th data-sort="totalOnboardingDays">Onboarding</th>
              <th data-sort="daysToFirstMeeting">1ª reunião</th>
              <th data-sort="daysToPlanDelivery">Plano</th>
            </tr>
          </thead>
          <tbody id="obRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="obPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="obNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  if ($("obChartCompletion")) $("obChartCompletion").innerHTML = donut(dist.completion);
  if ($("obChartTotal")) $("obChartTotal").innerHTML = hBars(dist.totalOnboarding.filter((i) => i.count > 0));
  if ($("obChartFirstMeeting")) $("obChartFirstMeeting").innerHTML = hBars(dist.firstMeeting.filter((i) => i.count > 0));
  if ($("obChartPlan")) $("obChartPlan").innerHTML = hBars(dist.planDelivery.filter((i) => i.count > 0));

  const tbody = $("obRows");
  if (!tbody) return;
  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="8">Nenhum cliente encontrado para os filtros selecionados.</td></tr>`;
  } else {
    tbody.innerHTML = pageRows
      .map(
        (c) => `<tr>
        <td class="truncate" title="${escapeHtml(c.clientName)}">${escapeHtml(c.clientName)}</td>
        <td>${escapeHtml(c.clientCode || "Não informado")}</td>
        <td class="truncate" title="${escapeHtml(c.engineer)}">${escapeHtml(c.engineer)}</td>
        <td>${statusBadge(c.analyticalStatus)}</td>
        <td>${completionLabel(c.completedOnboarding)}</td>
        <td class="num">${c.totalOnboardingDays == null ? "—" : `${fmt.format(c.totalOnboardingDays)} d`}</td>
        <td class="num">${c.daysToFirstMeeting == null ? "—" : `${fmt.format(c.daysToFirstMeeting)} d`}</td>
        <td class="num">${c.daysToPlanDelivery == null ? "—" : `${fmt.format(c.daysToPlanDelivery)} d`}</td>
      </tr>`,
      )
      .join("");
  }

  $("obPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("obNext")?.addEventListener("click", () => {
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
      pageId: "journey",
      rows,
      filters: state.filters,
      format,
      extraFilterLabels: {
        Conclusão: state.filters.completion,
      },
    });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveVisibleFilterFields("journey", FILTER_FIELDS);
  const period = resolvePeriod(state.filters);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "journey",
    innerHtml: renderFilterBar({
      fields,
      filters: state.filters,
      periodInvalid: period.invalid,
    }),
    onBodyReady: (body) => {
      if (state.payload) populateFilterOptions();
      $("obEngineer") && ($("obEngineer").value = state.filters.engineer);
      $("obProgram") && ($("obProgram").value = state.filters.program);
      $("obCompletion") && ($("obCompletion").value = state.filters.completion);
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultOnboardingFilters();
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
      <button class="btn btn-secondary" type="button" id="obRetry">Tentar novamente</button>
    </div>
  </div>`;
  $("obRetry")?.addEventListener("click", () => {
    void loadOnboarding({ force: true });
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
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando jornada</strong><span>Consultando a BASE QV…</span></div>`;
    return;
  }
  if (state.payload && !(state.payload.clients || []).length) {
    content.innerHTML = `<div class="gd-status"><strong>Sem clientes</strong><span>A consulta não retornou registros para esta base.</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Jornada] render", error);
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
    buttonId: "obRefresh",
    onRefresh: () => loadOnboarding({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadOnboarding({ force = false } = {}) {
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
    state.payload = await fetchPageJson("/api/onboarding", { force });
    state.filters = {
      ...defaultOnboardingFilters(),
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

function unmountOnboarding() {
  state.mounted = false;
}

function mountOnboarding() {
  state.mounted = true;
  setActions(false);
  void loadOnboarding();
}

export function bootOnboarding() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "journey") mountOnboarding();
    else if (state.mounted) unmountOnboarding();
  });
  if (getCurrentPageId() === "journey") mountOnboarding();
}
