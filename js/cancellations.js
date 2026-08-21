import { onPageChange, getCurrentPageId } from "./navigation.js";
import { analyticalStatusDisplayLabel } from "../lib/analytics/analytical-cancellation.mjs";
import {
  STATUS_FILTER_OPTIONS,
  CANCELLATION_STAGE_FILTER_OPTIONS,
  NO_RESPONSIBLE_LABEL,
  defaultCancellationFilters,
  filterCancellationClients,
  sortCancellationClients,
  collectCancellationReasonCategories,
  collectCancellationResponsibles,
} from "../lib/analytics/cancellations-filters.mjs";
import {
  branchFunnelCounts,
  distributionsFromCancellationRows,
  summarizeCancellationRows,
} from "../lib/analytics/cancellations-metrics.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { resolvePeriod } from "../lib/analytics/filters/period.mjs";
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
  filters: defaultCancellationFilters(),
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
  { kind: "search", id: "cxSearch", key: "search" },
  { kind: "period", id: "cxPeriod", fromId: "cxFrom", toId: "cxTo" },
  { kind: "select", id: "cxStatus", key: "status", label: "Status", options: STATUS_FILTER_OPTIONS },
  {
    kind: "select",
    id: "cxStage",
    key: "cancellationStage",
    label: "Etapa de cancelamento",
    options: CANCELLATION_STAGE_FILTER_OPTIONS,
  },
  {
    kind: "select",
    id: "cxReasonCategory",
    key: "reasonCategory",
    label: "Categoria motivo",
    dynamic: true,
    allLabel: "Todos",
  },
  {
    kind: "select",
    id: "cxResponsible",
    key: "responsible",
    label: "Responsável",
    dynamic: true,
    allLabel: "Todos",
  },
  { kind: "select", id: "cxEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "cxSegment", key: "segment", label: "Segmento", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "cxProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
];

function $(id) {
  return document.getElementById(id);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("cxSearch")?.value || "",
    period: $("cxPeriod")?.value || "all",
    from: $("cxFrom")?.value || "",
    to: $("cxTo")?.value || "",
    status: $("cxStatus")?.value || "all",
    cancellationStage: $("cxStage")?.value || "all",
    reasonCategory: $("cxReasonCategory")?.value || "all",
    responsible: $("cxResponsible")?.value || "all",
    engineer: $("cxEngineer")?.value || "all",
    segment: $("cxSegment")?.value || "all",
    program: normalizeProgramFilter($("cxProgram")?.value || "all"),
  };
}

function filteredRows() {
  return sortCancellationClients(
    filterCancellationClients(state.payload?.clients || [], state.filters),
    state.sortKey,
    state.sortDir,
  );
}

function metricOptions() {
  const clients = state.payload?.clients || [];
  return {
    filters: state.filters,
    allRows: filterCancellationClients(clients, {
      ...state.filters,
      period: "all",
      from: "",
      to: "",
    }),
  };
}

function currentSummary() {
  const rows = filteredRows();
  const options = metricOptions();
  const summary = summarizeCancellationRows(rows, state.payload?.summary || {}, options);
  const dist = distributionsFromCancellationRows(rows, state.payload?.distributions || {}, state.payload?.summary || {}, options);
  const funnel = branchFunnelCounts(rows, options);
  return { rows, summary, dist, funnel };
}

function pctLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("pt-BR")}%`;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
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

function monthShortLabel(ym, long) {
  const [y, m] = String(ym).split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const idx = Number(m) - 1;
  if (!y || idx < 0 || idx > 11) return ym;
  return long ? `${names[idx]}/${String(y).slice(2)}` : names[idx];
}

function intentionEffectiveColumns(series, limit = 12) {
  if (!series.length) return `<p class="placeholder-note">Sem meses históricos para exibir.</p>`;
  const visible = series.slice(-limit);
  const maxValue = Math.max(...visible.flatMap((i) => [i.intentions || 0, i.effective || 0]), 0);
  const plotH = 180;
  const long = Number(limit) >= 12;
  return `<div class="acq-chart-scroll"><div class="acq-chart-grid dual-chart" data-cols="${visible.length}">${visible
    .map((i) => {
      const intentionsPx = maxValue > 0 && i.intentions ? Math.max(Math.round((i.intentions / maxValue) * plotH), 6) : 0;
      const effectivePx = maxValue > 0 && i.effective ? Math.max(Math.round((i.effective / maxValue) * plotH), 6) : 0;
      return `<div class="acq-col dual-col" title="${escapeHtml(i.month)}: ${i.intentions} intenções · ${i.effective} efetivados">
        <div class="acq-col-value">${Number(i.intentions || 0).toLocaleString("pt-BR")}</div>
        <div class="dual-bars">
          <div class="acq-col-bar dual-bar scheduled" style="height:${intentionsPx}px"></div>
          <div class="acq-col-bar dual-bar completed" style="height:${effectivePx}px"></div>
        </div>
        <div class="acq-col-label">${escapeHtml(monthShortLabel(i.month, long))}</div>
      </div>`;
    })
    .join("")}</div></div>
    <p class="chart-legend-note"><span class="swatch scheduled"></span> Intenções/pedidos <span class="swatch completed"></span> Efetivados</p>`;
}

function semesterBars(series) {
  const total = series.reduce((sum, item) => sum + (item.total || 0), 0);
  return series.map((item) => ({
    label: item.semester,
    count: item.total || 0,
    percent: pct(item.total || 0, total),
  }));
}

function populateFilterOptions() {
  const clients = state.payload?.clients || [];
  fillDynamicSelect(
    $("cxReasonCategory"),
    collectCancellationReasonCategories(clients),
    "Todos",
    state.filters.reasonCategory,
  );
  fillDynamicSelect(
    $("cxResponsible"),
    collectCancellationResponsibles(clients),
    "Todos",
    state.filters.responsible,
  );
  fillDynamicSelect($("cxEngineer"), uniqueSorted(clients.map((c) => c.engineer)), "Todos", state.filters.engineer);
  fillDynamicSelect($("cxSegment"), uniqueSorted(clients.map((c) => c.segment)), "Todos", state.filters.segment);
  fillDynamicSelect($("cxProgram"), programSelectOptions(clients), "Todos", state.filters.program);
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  const { rows, summary, dist, funnel } = currentSummary();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const funnelItems = [
    { label: "Intenções/pedidos", count: funnel.intentions, percent: pct(funnel.intentions, funnel.total) },
    { label: "Em processo", count: funnel.inProcess, percent: pct(funnel.inProcess, funnel.total) },
    { label: "Efetivados", count: funnel.effective, percent: pct(funnel.effective, funnel.total) },
  ];
  const topReason = summary.topReasonCategory?.label || summary.topReasonCategory || null;
  const secondReason = summary.secondReasonCategory?.label || summary.secondReasonCategory || null;
  const reasonNote = topReason
    ? `Principal categoria: ${topReason}${secondReason ? ` · 2ª: ${secondReason}` : ""}`
    : "Motivos categorizados no backend a partir do campo motivo.";

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}

    <section class="section-block">
      <h2>A · Visão geral</h2>
      <p>Clientes com intenção, pedido ou cancelamento efetivado no recorte filtrado.</p>
      <div class="kpi-row kpi-row-primary">
        ${kpiCard("Cancelamentos efetivados", fmt.format(summary.effectiveCancellations), summary.effectiveWithoutConfirmedDate ? `${fmt.format(summary.effectiveWithoutConfirmedDate)} sem data confirmada` : "Churn/distrato confirmado", { featured: true, highlight: true })}
        ${kpiCard("Em processo", fmt.format(summary.clientsInCancellationProcess), "Intenção ou pedido sem efetivação")}
        ${kpiCard("Casos críticos", fmt.format(summary.criticalCount), "Flag operacional no processo")}
        ${kpiCard("Sem responsável", fmt.format(summary.withoutResponsibleCount), "Tratativa sem EP definido")}
      </div>
      <div class="kpi-row kpi-row-secondary">
        ${kpiCard("Intenções/pedidos registrados", fmt.format(summary.intentionsOrOrdersRegistered), "Inclui intenções e pedidos distintos")}
        ${kpiCard("Registros arquivados", fmt.format(summary.archivedRecords), "Total na base (não depende do filtro)")}
        ${kpiCard("Não renovações", fmt.format(summary.nonRenewals), `${fmt.format(summary.comparableCycleCount)} comparáveis`)}
        ${kpiCard("Antes do fim do ciclo", fmt.format(summary.beforeCycleEnd), "Cancelamento antecipado")}
      </div>
    </section>

    <section class="section-block">
      <h2>B · Operação</h2>
      <div class="chart-grid">
        <article class="chart-card"><h3>Status do processo</h3><div id="cxChartProcess"></div></article>
        <article class="chart-card"><h3>Funil do recorte</h3><div id="cxChartFunnel"></div></article>
      </div>
    </section>

    <section class="section-block">
      <h2>C · Motivos</h2>
      <p>${escapeHtml(reasonNote)}</p>
      <div class="chart-grid">
        <article class="chart-card"><h3>Categoria (efetivados)</h3><div id="cxChartReason"></div></article>
        <article class="chart-card"><h3>Motivos por semestre</h3><div id="cxChartSemester"></div></article>
      </div>
    </section>

    <section class="section-block">
      <h2>D · Ciclo</h2>
      <div class="chart-grid">
        <article class="chart-card"><h3>Etapa exclusiva</h3><div id="cxChartStage"></div></article>
        <article class="chart-card"><h3>Estágio do cliente</h3><div id="cxChartClientStage"></div></article>
      </div>
    </section>

    <section class="section-block">
      <h2>E · Evolução</h2>
      <p>Séries independentes por data de intenção e de efetivação; não representa conversão do mesmo cliente.</p>
      <article class="chart-card"><h3>Intenções vs efetivados por mês</h3><div id="cxChartMonth"></div></article>
    </section>

    <section class="section-block">
      <h2>F · Concentração</h2>
      <div class="chart-grid">
        <article class="chart-card"><h3>Efetivados por EP</h3><div id="cxChartEngineer"></div></article>
        <article class="chart-card"><h3>Efetivados por segmento</h3><div id="cxChartSegment"></div></article>
      </div>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Clientes</h2>
          ${renderTableToolbar({ countLabel: `${fmt.format(rows.length)} registros encontrados`, exportPrefix: "cancellations" })}
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
              <th data-sort="exclusiveStage">Etapa</th>
              <th data-sort="processStatusName">Processo</th>
              <th data-sort="cancellationDate">Cancelamento</th>
              <th data-sort="reasonCategory">Categoria</th>
            </tr>
          </thead>
          <tbody id="cxRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="cxPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="cxNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  $("cxChartProcess") && ($("cxChartProcess").innerHTML = hBars(dist.byProcessStatus.filter((i) => i.count > 0)));
  $("cxChartFunnel") && ($("cxChartFunnel").innerHTML = hBars(funnelItems.filter((i) => i.count > 0)));
  $("cxChartReason") && ($("cxChartReason").innerHTML = hBars(dist.byCategory.filter((i) => i.count > 0), 10));
  $("cxChartSemester") && ($("cxChartSemester").innerHTML = hBars(semesterBars(dist.byReasonSemester || []).filter((i) => i.count > 0)));
  $("cxChartStage") && ($("cxChartStage").innerHTML = donut(dist.byExclusiveStage.filter((i) => i.count > 0)));
  $("cxChartClientStage") && ($("cxChartClientStage").innerHTML = hBars(dist.byEstagioCliente.filter((i) => i.count > 0)));
  $("cxChartMonth") && ($("cxChartMonth").innerHTML = intentionEffectiveColumns(dist.byMonthIntentionVsEffective || []));
  $("cxChartEngineer") && ($("cxChartEngineer").innerHTML = hBars(dist.byEngineer.filter((i) => i.count > 0), 12));
  $("cxChartSegment") && ($("cxChartSegment").innerHTML = hBars(dist.bySegment.filter((i) => i.count > 0)));

  const tbody = $("cxRows");
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
          <td>${escapeHtml(c.exclusiveStage || "—")}</td>
          <td>${escapeHtml(c.processStatusName || "—")}</td>
          <td>${dateBR(c.cancellationDate)}</td>
          <td>${escapeHtml(c.reasonCategory || c.category || "—")}</td>
        </tr>`,
          )
          .join("")
      : `<tr><td colspan="9">Nenhum cliente encontrado para os filtros selecionados.</td></tr>`;
  }

  $("cxPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("cxNext")?.addEventListener("click", () => {
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
    exportFilteredTable({ pageId: "cancellations", rows, filters: state.filters, format });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveVisibleFilterFields("cancellations", FILTER_FIELDS);
  const period = resolvePeriod(state.filters);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "cancellations",
    innerHtml: renderFilterBar({
      fields,
      filters: state.filters,
      periodInvalid: period.invalid,
    }),
    onBodyReady: (body) => {
      if (state.payload) populateFilterOptions();
      $("cxStatus") && ($("cxStatus").value = state.filters.status);
      $("cxStage") && ($("cxStage").value = state.filters.cancellationStage || "all");
      $("cxReasonCategory") && ($("cxReasonCategory").value = state.filters.reasonCategory || "all");
      $("cxResponsible") && ($("cxResponsible").value = state.filters.responsible || "all");
      $("cxEngineer") && ($("cxEngineer").value = state.filters.engineer);
      $("cxSegment") && ($("cxSegment").value = state.filters.segment);
      $("cxProgram") && ($("cxProgram").value = state.filters.program);
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultCancellationFilters();
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
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="cxRetry">Tentar novamente</button></div>
  </div>`;
  $("cxRetry")?.addEventListener("click", () => {
    void loadCancellations({ force: true });
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
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando cancelamentos</strong><span>Consultando a BASE QV…</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Cancelamentos] render", error);
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
    buttonId: "cxRefresh",
    onRefresh: () => loadCancellations({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadCancellations({ force = false } = {}) {
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
    state.payload = await fetchPageJson("/api/cancellations", { force });
    ensurePageRefresh().markSuccess();
  } catch (error) {
    const mapped = mapLoadError(error);
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

function unmountCancellations() {
  state.mounted = false;
}

function mountCancellations() {
  state.mounted = true;
  setActions(false);
  void loadCancellations();
}

export function bootCancellations() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "cancellations") mountCancellations();
    else if (state.mounted) unmountCancellations();
  });
  if (getCurrentPageId() === "cancellations") mountCancellations();
}
