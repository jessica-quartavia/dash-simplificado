import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  defaultEpPerformanceFilters,
  filterEpEngineers,
  sortEpEngineers,
  summarizeFilteredEpEngineers,
} from "../lib/analytics/ep-performance-filters.mjs";
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
import { fillMultiSelectOptions, readMultiSelectFieldValue } from "./components/filters/multi-select-filter.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { exportFilteredTable } from "./utils/page-table-export.js";

const fmt = new Intl.NumberFormat("pt-BR");
const STACK_COLORS = {
  active: "#0a0a0a",
  frozen: "#d18426",
  cancelled: "#737373",
};

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultEpPerformanceFilters(),
  sortKey: "totalClients",
  sortDir: "desc",
  page: 1,
  pageSize: 25,
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "epSearch", key: "search" },
  {
    kind: "multiselect",
    id: "epEngineer",
    key: "engineer",
    label: "Engenheiro",
    dynamic: true,
    allLabel: "Todos",
  },
  { kind: "select", id: "epSegment", key: "segment", label: "Segmento", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "epProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
];

function $(id) {
  return document.getElementById(id);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("epSearch")?.value || "",
    engineer: readMultiSelectFieldValue({ id: "epEngineer", key: "engineer" }),
    segment: $("epSegment")?.value || "all",
    program: normalizeProgramFilter($("epProgram")?.value || "all"),
  };
}

function filteredEngineers() {
  return sortEpEngineers(
    filterEpEngineers(state.payload?.engineers || [], state.filters),
    state.sortKey,
    state.sortDir,
  );
}

function currentView() {
  const engineers = filteredEngineers();
  const summary = summarizeFilteredEpEngineers(engineers);
  return { engineers, summary };
}

function pctLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("pt-BR")}%`;
}

function pct(n, d) {
  if (d == null || d <= 0 || n == null) return null;
  return Math.round((n / d) * 1000) / 10;
}

function shareLabel(numerator, denominator, percent) {
  const num = numerator == null ? "—" : fmt.format(numerator);
  const den = denominator == null ? "—" : fmt.format(denominator);
  const pct = pctLabel(percent);
  return `${num}/${den} · ${pct}`;
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

function npsCell(row) {
  if (row.nps == null && row.npsMeanScore == null) {
    return `<span class="text-muted">—</span><div class="kpi-note">Sem respostas NPS</div>`;
  }
  const index = row.nps == null ? "—" : fmt.format(row.nps);
  const mean = row.npsMeanScore == null ? "—" : fmt.format(row.npsMeanScore);
  const coverage = shareLabel(row.npsRespondentClients ?? row.npsResponses, row.totalClients, row.npsCoverage);
  const sample = row.npsSampleSizeLabel ? ` · ${row.npsSampleSizeLabel}` : "";
  return `<div>NPS ${escapeHtml(String(index))}</div>
    <div class="kpi-note">Média ${escapeHtml(String(mean))} · ${escapeHtml(coverage)}${escapeHtml(sample)}</div>`;
}

function portfolioStackedBars(engineers, limit = 12) {
  const list = (limit ? engineers.slice(0, limit) : engineers).filter((e) => (e.totalClients || 0) > 0);
  if (!list.length) return `<p class="placeholder-note">Sem dados</p>`;
  const max = Math.max(...list.map((e) => e.totalClients || 0), 1);
  return list
    .map((e) => {
      const total = e.totalClients || 0;
      const active = e.activeClients || 0;
      const frozen = e.frozenClients || 0;
      const cancelled = e.confirmedCancelledClients || e.cancelledClients || 0;
      const width = (total / max) * 100;
      const segments = [
        { count: active, color: STACK_COLORS.active, label: "Ativo" },
        { count: frozen, color: STACK_COLORS.frozen, label: "Congelado" },
        { count: cancelled, color: STACK_COLORS.cancelled, label: "Cancelado" },
      ].filter((s) => s.count > 0);
      const track = segments.length
        ? `<div class="hbar-track" style="display:flex">${segments
            .map(
              (s) =>
                `<span style="width:${(s.count / total) * width}%;background:${s.color}" title="${escapeHtml(s.label)}: ${fmt.format(s.count)}"></span>`,
            )
            .join("")}</div>`
        : `<div class="hbar-track"><span style="width:${width}%"></span></div>`;
      const metric = `${fmt.format(total)} clientes · ${escapeHtml(e.sampleSizeLabel || "")}`;
      return `<div class="hbar" title="${escapeHtml(e.engineer)}: ${escapeHtml(metric)}">
        <div class="hbar-label" title="${escapeHtml(e.engineer)}">${escapeHtml(e.engineer)}</div>
        ${track}
        <div class="hbar-val">${escapeHtml(metric)}</div>
      </div>`;
    })
    .join("");
}

function cancelledShareBars(engineers, limit = 12) {
  return hBars(
    engineers
      .filter((e) => e.cancelledShareOfPortfolio != null)
      .slice(0, limit)
      .map((e) => ({
        label: `${e.engineer} (n=${fmt.format(e.totalClients)}, ${e.sampleSizeLabel || "—"})`,
        count: e.confirmedCancelledClients || e.cancelledClients || 0,
        percent: e.cancelledShareOfPortfolio,
      })),
    limit,
  );
}

function meetingCoverageBars(engineers, limit = 12) {
  return hBars(
    engineers
      .filter((e) => e.meetingCoverage != null)
      .slice(0, limit)
      .map((e) => ({
        label: `${e.engineer} (n=${fmt.format(e.totalClients)})`,
        count: e.clientsWithMeeting || 0,
        percent: e.meetingCoverage,
      })),
    limit,
  );
}

function portfolioLegend() {
  return `<div class="legend" style="margin-bottom:12px">
    <div><i style="background:${STACK_COLORS.active}"></i>Ativo</div>
    <div><i style="background:${STACK_COLORS.frozen}"></i>Congelado</div>
    <div><i style="background:${STACK_COLORS.cancelled}"></i>Cancelado</div>
  </div>`;
}

function populateFilterOptions() {
  const engineers = state.payload?.engineers || [];
  const segments = uniqueSorted(
    engineers.flatMap((e) => (e.clients || []).map((c) => c.segment)),
  );
  const engineerField = FILTER_FIELDS.find((f) => f.key === "engineer");
  fillMultiSelectOptions(
    $("page-filters"),
    engineerField,
    uniqueSorted(engineers.map((e) => e.engineer)).map((name) => ({ value: name, label: name })),
    state.filters.engineer,
  );
  fillDynamicSelect($("epSegment"), segments, "Todos", state.filters.segment);
  fillDynamicSelect($("epProgram"), programSelectOptions(engineers.flatMap((e) => e.clients || [])), "Todos", state.filters.program);
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  const { engineers, summary } = currentView();
  const pages = Math.max(1, Math.ceil(engineers.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = engineers.slice(start, start + state.pageSize);

  const attributionNote =
    state.payload?.attributionNote
    || "Os indicadores utilizam o EP atualmente vinculado ao cliente. Não é ranking de desempenho.";

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <p class="text-muted">${escapeHtml(attributionNote)}</p>

    <section class="section-block">
      <h2>Indicadores</h2>
      <p>Carteira atribuída ao EP atual no recorte filtrado. Percentuais mostram numerador/denominador quando aplicável.</p>
      <div class="kpi-row kpi-row-compact">
        ${kpiCard("EPs com carteira", fmt.format(summary.advisorsWithPortfolio), "Com cliente atribuído")}
        ${kpiCard("Clientes", fmt.format(summary.totalClients), "Total no recorte")}
        ${kpiCard("Ativos", fmt.format(summary.activeClients), shareLabel(summary.activeClients, summary.totalClients, summary.totalClients ? pct(summary.activeClients, summary.totalClients) : null))}
        ${kpiCard("Cobertura de reuniões", pctLabel(summary.meetingCoverage), shareLabel(summary.clientsWithMeeting, summary.totalClients, summary.meetingCoverage))}
        ${kpiCard("Cancelados na carteira", pctLabel(summary.cancelledShareOfPortfolio), shareLabel(summary.confirmedCancelledClients, summary.totalClients, summary.cancelledShareOfPortfolio))}
        ${kpiCard("Renovados na carteira", pctLabel(summary.renewedPortfolioPercentage), shareLabel(summary.renewedClients, summary.totalClients, summary.renewedPortfolioPercentage))}
      </div>
    </section>

    <section class="section-block">
      <h2>Distribuições por EP</h2>
      <p>Carteira por status (empilhado), participação cancelada e cobertura de reuniões — sempre com n explícito.</p>
      <div class="chart-grid">
        <article class="chart-card">
          <h3>Carteira por EP</h3>
          ${portfolioLegend()}
          <div id="epChartPortfolio"></div>
        </article>
        <article class="chart-card">
          <h3>Cancelados na carteira</h3>
          <div id="epChartCancelled"></div>
        </article>
        <article class="chart-card">
          <h3>Cobertura de reuniões</h3>
          <div id="epChartMeetings"></div>
        </article>
      </div>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Engenheiros patrimoniais</h2>
          ${renderTableToolbar({ countLabel: `${fmt.format(engineers.length)} EP(s) no recorte`, exportPrefix: "ep-performance" })}
        </div>
      </div>
      <div class="table-wrap">
        <table class="gd-table">
          <thead>
            <tr>
              <th data-sort="engineer">EP</th>
              <th data-sort="totalClients">Clientes</th>
              <th data-sort="activeClients">Ativos</th>
              <th data-sort="cancelledShareOfPortfolio">Cancelados</th>
              <th data-sort="meetingCoverage">Cobertura reuniões</th>
              <th data-sort="totalMeetings">Reuniões</th>
              <th data-sort="averageMeetingsPerClient">Média reuniões/cliente</th>
              <th data-sort="nps">NPS</th>
              <th data-sort="clientsWithImplementedMechanisms">Com mecanismos</th>
              <th data-sort="renewedClients">Renovados</th>
              <th data-sort="sampleSizeLabel">Amostra</th>
            </tr>
          </thead>
          <tbody id="epRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="epPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="epNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  $("epChartPortfolio") && ($("epChartPortfolio").innerHTML = portfolioStackedBars(engineers, 12));
  $("epChartCancelled") && ($("epChartCancelled").innerHTML = cancelledShareBars(engineers, 12));
  $("epChartMeetings") && ($("epChartMeetings").innerHTML = meetingCoverageBars(engineers, 12));

  const tbody = $("epRows");
  if (tbody) {
    tbody.innerHTML = pageRows.length
      ? pageRows
          .map(
            (e) => `<tr>
          <td class="truncate" title="${escapeHtml(e.engineer)}">${escapeHtml(e.engineer)}</td>
          <td class="num">${fmt.format(e.totalClients)}</td>
          <td class="num">${fmt.format(e.activeClients)}</td>
          <td class="num" title="${escapeHtml(shareLabel(e.confirmedCancelledClients || e.cancelledClients, e.totalClients, e.cancelledShareOfPortfolio))}">${pctLabel(e.cancelledShareOfPortfolio)}</td>
          <td class="num" title="${escapeHtml(shareLabel(e.clientsWithMeeting, e.totalClients, e.meetingCoverage))}">${pctLabel(e.meetingCoverage)}</td>
          <td class="num">${fmt.format(e.totalMeetings || 0)}</td>
          <td class="num">${e.averageMeetingsPerClient == null ? "—" : fmt.format(e.averageMeetingsPerClient)}</td>
          <td class="num">${npsCell(e)}</td>
          <td class="num" title="${escapeHtml(`${fmt.format(e.clientsWithImplementedMechanisms || 0)}/${fmt.format(e.totalClients)}`)}">${fmt.format(e.clientsWithImplementedMechanisms || 0)}</td>
          <td class="num" title="${escapeHtml(shareLabel(e.renewedClients, e.totalClients, e.renewedPortfolioPercentage))}">${fmt.format(e.renewedClients || 0)}</td>
          <td>${escapeHtml(e.sampleSizeLabel || "—")} <span class="text-muted">(n=${fmt.format(e.totalClients)})</span></td>
        </tr>`,
          )
          .join("")
      : `<tr><td colspan="11">Nenhum EP encontrado para os filtros selecionados.</td></tr>`;
  }

  $("epPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("epNext")?.addEventListener("click", () => {
    state.page += 1;
    renderSuccess();
  });
  document.querySelectorAll(".gd-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDir = key === "engineer" ? "asc" : "desc";
      }
      renderSuccess();
    });
  });

  bindTableExport(content, (format) => {
    exportFilteredTable({ pageId: "ep_performance", rows: engineers, filters: state.filters, format });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveVisibleFilterFields("ep_performance", FILTER_FIELDS);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "ep_performance",
    innerHtml: renderFilterBar({ fields, filters: state.filters }),
    onBodyReady: (body) => {
      if (state.payload) populateFilterOptions();
      $("epSegment") && ($("epSegment").value = state.filters.segment);
      $("epProgram") && ($("epProgram").value = state.filters.program);
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultEpPerformanceFilters();
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
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="epRetry">Tentar novamente</button></div>
  </div>`;
  $("epRetry")?.addEventListener("click", () => {
    void loadEpPerformance({ force: true });
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
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando performance do EP</strong><span>Consultando a BASE QV…</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[EP Performance] render", error);
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
    buttonId: "epRefresh",
    onRefresh: () => loadEpPerformance({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadEpPerformance({ force = false } = {}) {
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
    state.payload = await fetchPageJson("/api/ep-performance", { force });
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

function unmountEpPerformance() {
  state.mounted = false;
}

function mountEpPerformance() {
  state.mounted = true;
  setActions(false);
  void loadEpPerformance();
}

export function bootEpPerformance() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "ep_performance") mountEpPerformance();
    else if (state.mounted) unmountEpPerformance();
  });
  if (getCurrentPageId() === "ep_performance") mountEpPerformance();
}
