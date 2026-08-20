import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTER_OPTIONS,
  defaultGeneralFilters,
  filterGeneralAcquisitionRows,
  filterGeneralClients,
  sortGeneralClients,
  segmentLabelOf,
} from "../lib/analytics/general-filters.mjs";
import { resolvePeriod } from "../lib/analytics/filters/period.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import {
  bindFilterBar,
  bindTableExport,
  fillDynamicSelect,
  renderFilterBar,
  renderTableToolbar,
} from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { createPageRefresh } from "./components/page-refresh.js";
import { exportFilteredTable } from "./utils/page-table-export.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";
import {
  STAY_RANGES,
  summarizeGeneralRows,
  distributionsFromRows,
  buildAcquisitionMonthSeries,
  acquisitionSummaryFromSeries,
} from "../lib/analytics/general-metrics.mjs";
import { analyticalStatusDisplayLabel } from "../lib/analytics/analytical-cancellation.mjs";
import { acquisitionColumns, donut, escapeHtml, hBars } from "./general-charts.mjs";

const fmt = new Intl.NumberFormat("pt-BR");
const moneyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultGeneralFilters(),
  sortKey: "clientName",
  sortDir: "asc",
  page: 1,
  pageSize: 25,
  acqRange: 6,
  showAllEngineers: false,
  selectedId: null,
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "gSearch", key: "search" },
  { kind: "period", id: "gPeriod", fromId: "gFrom", toId: "gTo" },
  { kind: "select", id: "gStatusFilter", key: "status", label: "Status", options: STATUS_FILTER_OPTIONS },
  { kind: "select", id: "gSegment", key: "segment", label: "Segmento", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "gEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "gProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "gContractRange", key: "contract", label: "Contratação", options: [
    { value: "all", label: "Todas" },
    { value: "last3", label: "Últimos 3 meses" },
    { value: "last6", label: "Últimos 6 meses" },
    { value: "last12", label: "Últimos 12 meses" },
    { value: "older12", label: "Há mais de 12 meses" },
    { value: "missing", label: "Sem data" },
  ] },
  { kind: "select", id: "gCancelRange", key: "cancel", label: "Cancelamento", options: [
    { value: "all", label: "Todas" },
    { value: "last3", label: "Últimos 3 meses" },
    { value: "last6", label: "Últimos 6 meses" },
    { value: "last12", label: "Últimos 12 meses" },
    { value: "older12", label: "Há mais de 12 meses" },
    { value: "missing", label: "Sem data" },
    { value: "none", label: "Sem cancelamento" },
  ] },
  { kind: "select", id: "gStayRange", key: "stay", label: "Permanência", dynamic: true, allLabel: "Todas" },
];

function $(id) {
  return document.getElementById(id);
}

function money(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return moneyFmt.format(Number(value));
}

function dateBR(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function boolLabel(value) {
  if (value === true) return "Sim";
  if (value === false) return "Não";
  return "—";
}

function statusBadge(status) {
  const label = analyticalStatusDisplayLabel(status);
  let cls = "badge-muted";
  if (label === "Ativo") cls = "badge-active";
  else if (label === "Congelado") cls = "badge-frozen";
  else if (label.startsWith("Cancelado") || label.startsWith("Marcado")) cls = "badge-cancelled";
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("gSearch")?.value || "",
    period: $("gPeriod")?.value || "all",
    from: $("gFrom")?.value || "",
    to: $("gTo")?.value || "",
    status: $("gStatusFilter")?.value || DEFAULT_STATUS_FILTER,
    segment: $("gSegment")?.value || "all",
    engineer: $("gEngineer")?.value || "all",
    program: normalizeProgramFilter($("gProgram")?.value || "all"),
    contract: $("gContractRange")?.value || "all",
    cancel: $("gCancelRange")?.value || "all",
    stay: $("gStayRange")?.value || "all",
  };
}

function filteredRows() {
  const clients = state.payload?.clients || [];
  return sortGeneralClients(
    filterGeneralClients(clients, state.filters),
    state.sortKey,
    state.sortDir,
  );
}

/**
 * Aquisição: ignora o filtro de status (métrica histórica).
 * Demais recortes cadastrais continuam aplicados.
 */
function acquisitionRows() {
  return filterGeneralAcquisitionRows(state.payload?.clients || [], state.filters);
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
  fillDynamicSelect($("gSegment"), uniqueSorted(clients.map(segmentLabelOf)), "Todos", state.filters.segment);
  fillDynamicSelect($("gEngineer"), uniqueSorted(clients.map((c) => c.engineer)), "Todos", state.filters.engineer);
  fillDynamicSelect($("gStayRange"), STAY_RANGES, "Todas", state.filters.stay);
  fillDynamicSelect(
    $("gProgram"),
    programSelectOptions(clients),
    "Todos",
    normalizeProgramFilter(state.filters.program),
  );
}

function coverageText(filled, total) {
  const denom = Number(total) || 0;
  if (denom <= 0) return "";
  const pct = Math.round((Number(filled) / denom) * 1000) / 10;
  return `Cobertura: ${pct.toLocaleString("pt-BR")}% da carteira filtrada`;
}

function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.highlight) classes.push("kpi-card-highlight");
  if (options.compact) classes.push("kpi-card-compact");
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

function renderAcquisition(rows) {
  const series = buildAcquisitionMonthSeries(rows, state.acqRange);
  const summary = acquisitionSummaryFromSeries(series);
  const host = $("gAcqChart");
  const sum = $("gAcqSummary");
  const subtitle = $("gAcqSubtitle");
  if (subtitle) {
    subtitle.textContent =
      "Clientes adquiridos por mês, independentemente do status atual. O recorte de ativos da página não se aplica a este gráfico.";
  }
  if (sum) {
    const change = summary.latestMonthChangePercent;
    const changeText =
      change == null ? "—" : `${change > 0 ? "+" : ""}${change.toLocaleString("pt-BR")}%`;
    sum.innerHTML = `
      <div class="acq-summary-item"><div class="k">Mês mais recente</div><div class="v">${fmt.format(summary.latestMonthAcquisitions)}</div></div>
      <div class="acq-summary-item"><div class="k">Média mensal</div><div class="v">${summary.averageMonthlyAcquisitions == null ? "—" : fmt.format(summary.averageMonthlyAcquisitions)}</div></div>
      <div class="acq-summary-item"><div class="k">Mediana mensal</div><div class="v">${summary.medianMonthlyAcquisitions == null ? "—" : fmt.format(summary.medianMonthlyAcquisitions)}</div></div>
      <div class="acq-summary-item"><div class="k">Variação</div><div class="v">${escapeHtml(changeText)}</div></div>`;
  }
  if (host) host.innerHTML = acquisitionColumns(series, state.acqRange);
  document.querySelectorAll("#gAcqRangeSeg [data-acq-range]").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.acqRange) === Number(state.acqRange));
  });
}

function renderDrawer(client) {
  const existing = document.getElementById("gDrawer");
  existing?.remove();
  if (!client) {
    state.selectedId = null;
    return;
  }
  state.selectedId = client.clientId;
  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  backdrop.id = "gDrawer";
  backdrop.innerHTML = `<aside class="drawer" role="dialog" aria-labelledby="gDrawerTitle">
    <header>
      <p class="eyebrow">Cliente</p>
      <h2 id="gDrawerTitle">${escapeHtml(client.clientName)}</h2>
      <p class="text-muted">Código ${escapeHtml(client.clientCode || "Não informado")} · ID ${escapeHtml(client.clientId)}</p>
    </header>
    <dl>
      <div><dt>Contratação</dt><dd>${dateBR(client.contractDate)}</dd></div>
      <div><dt>Cancelamento</dt><dd>${dateBR(client.cancellationDate)}</dd></div>
      <div><dt>Permanência</dt><dd>${client.stayDays == null ? "Não calculável" : `${fmt.format(client.stayDays)} d (${escapeHtml(client.stayRange || "")})`}</dd></div>
      <div><dt>Status analítico</dt><dd>${statusBadge(client.analyticalStatus)}</dd></div>
      <div><dt>Segmento</dt><dd>${escapeHtml(segmentLabelOf(client))}</dd></div>
      <div><dt>EP</dt><dd>${escapeHtml(client.engineer || "—")}</dd></div>
      <div><dt>Programa</dt><dd>${escapeHtml(client.program || "—")}</dd></div>
      <div><dt>Ciclo</dt><dd>${client.currentCycle == null ? "—" : fmt.format(client.currentCycle)}</dd></div>
      <div><dt>Renda</dt><dd>${money(client.monthlyIncome)}</dd></div>
      <div><dt>Aporte</dt><dd>${money(client.lastContribution)}</dd></div>
      <div><dt>Liquidez</dt><dd>${money(client.liquidityReserve)}</dd></div>
      <div><dt>Imóveis quitados</dt><dd>${money(client.paidPropertiesValue)}</dd></div>
      <div><dt>Imóvel</dt><dd>${boolLabel(client.hasProperty)}</dd></div>
      <div><dt>Carro</dt><dd>${boolLabel(client.hasCar)}</dd></div>
      <div><dt>Consórcio</dt><dd>${boolLabel(client.hasConsortium)}</dd></div>
    </dl>
    <button type="button" class="btn btn-secondary" data-drawer-close>Fechar</button>
  </aside>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-drawer-close]")) renderDrawer(null);
  });
}

function renderSuccess() {
  const rows = filteredRows();
  const summary = summarizeGeneralRows(rows);
  const dist = distributionsFromRows(rows);
  const content = $("page-content");
  if (!content) return;

  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  const total = summary.totalClients;
  const stayCoverage = coverageText(summary.stayCalculatedClients, total);
  const diagnosticCoverage = coverageText(summary.clientsWithFinancialProfile, total);
  const incomeCoverage = coverageText(summary.monthlyIncomeFilledCount, total);
  const liquidityCoverage = coverageText(summary.liquidityReserveFilledCount, total);
  const contributionCoverage = coverageText(summary.lastContributionFilledCount, total);
  const segmentCoverage = coverageText(summary.segmentation?.classifiableClients, total);
  const engineerFilled = rows.filter(
    (row) => row.engineer && row.engineer !== "Não informado",
  ).length;
  const engineerCoverage = coverageText(engineerFilled, total);
  const statusIsActiveDefault = state.filters.status === DEFAULT_STATUS_FILTER;
  const statusChartNote = statusIsActiveDefault
    ? "No recorte padrão (Ativos), este gráfico concentra praticamente uma categoria. Use o filtro Status para ver a composição completa."
    : "Composição do recorte atual pelo status analítico.";

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <section class="section-block">
      <h2>Visão da carteira</h2>
      <p>Leitura principal da população filtrada. O padrão da página é clientes ativos.</p>
      <div class="kpi-row kpi-row-primary">
        ${kpiCard("Clientes ativos", fmt.format(summary.activeClients), "Status analítico: Ativo", { highlight: true, featured: true })}
        ${kpiCard("Total de clientes", fmt.format(summary.totalClients), "População filtrada", { featured: true })}
        ${kpiCard(
          "Permanência mediana",
          summary.typicalStayDays == null ? "—" : `${fmt.format(Math.round(summary.typicalStayDays))} d`,
          "",
          { coverage: stayCoverage, featured: true },
        )}
        ${kpiCard(
          "Clientes com diagnóstico financeiro",
          fmt.format(summary.clientsWithFinancialProfile),
          "",
          { coverage: diagnosticCoverage, featured: true },
        )}
      </div>
    </section>

    <section class="section-block">
      <h2>Situação da carteira</h2>
      <p>Estados fora da leitura principal de ativos.</p>
      <div class="kpi-row kpi-row-compact">
        ${kpiCard("Clientes congelados", fmt.format(summary.frozenClients), "Fora da carteira ativa, sem churn efetivado", { compact: true })}
        ${kpiCard("Cancelados confirmados", fmt.format(summary.cancelledClients), "Churn efetivado ou distrato assinado", { compact: true })}
        ${kpiCard("Cancelados sem data confirmada", fmt.format(summary.cancelledWithoutConfirmedDate), "Marcados sem data efetiva", { compact: true })}
        ${kpiCard("Clientes não ativos", fmt.format(summary.nonActiveClients), "Congelados + marcados sem confirmação", { compact: true })}
      </div>
      <article class="chart-card chart-card-quiet">
        <h3>Clientes por status</h3>
        <p>${escapeHtml(statusChartNote)}</p>
        <div id="chartStatus"></div>
      </article>
    </section>

    <section class="section-block">
      <h2>Perfil financeiro</h2>
      <p>Mediana da população filtrada.</p>
      <div class="kpi-row kpi-row-three">
        ${kpiCard("Renda mensal mediana", money(summary.typicalMonthlyIncome), "", { coverage: incomeCoverage })}
        ${kpiCard("Reserva de liquidez mediana", money(summary.typicalLiquidityReserve), "", { coverage: liquidityCoverage })}
        ${kpiCard("Último aporte mediano", money(summary.typicalLastContribution), "", { coverage: contributionCoverage })}
      </div>
      <div class="chart-grid chart-grid-three">
        <article class="chart-card">
          <h3>Distribuição da renda mensal</h3>
          <p>Faixas da última renda registrada.</p>
          <div id="chartIncome"></div>
        </article>
        <article class="chart-card">
          <h3>Distribuição da reserva de liquidez</h3>
          <p>Faixas da reserva informada.</p>
          <div id="chartLiquidity"></div>
        </article>
        <article class="chart-card">
          <h3>Perfil Financeiro</h3>
          <p>Imóvel, carro, consórcio ou reserva informada.</p>
          <div id="chartFinancialProfile"></div>
        </article>
      </div>
    </section>

    <section class="section-block">
      <h2>Perfil da carteira</h2>
      <p>Segmentação financeira e responsáveis da população filtrada.</p>
      <div class="chart-grid">
        <article class="chart-card">
          <h3>Clientes por segmento</h3>
          <p>Capacidade financeira. Sem dados suficientes quando faltar evidência.</p>
          ${segmentCoverage ? `<p class="chart-coverage">${escapeHtml(segmentCoverage)}</p>` : ""}
          <div id="chartSegment"></div>
        </article>
        <article class="chart-card">
          <h3>Engenheiro Patrimonial</h3>
          <p>Principais responsáveis.</p>
          ${engineerCoverage ? `<p class="chart-coverage">${escapeHtml(engineerCoverage)}</p>` : ""}
          <div id="chartEngineers"></div>
          <button class="btn btn-secondary btn-chart" type="button" id="toggleEngineers">${state.showAllEngineers ? "Ver principais" : "Ver todos"}</button>
        </article>
      </div>
    </section>

    <section class="section-block">
      <h2>Evolução</h2>
      <p>Aquisição histórica e distribuição do tempo de permanência.</p>
      <div class="acq-head">
        <div>
          <h3 class="section-chart-title">Evolução mensal da aquisição de clientes</h3>
          <p id="gAcqSubtitle"></p>
        </div>
        <div class="seg" id="gAcqRangeSeg" role="group" aria-label="Período da aquisição">
          <button type="button" data-acq-range="6">6 meses</button>
          <button type="button" data-acq-range="12">12 meses</button>
          <button type="button" data-acq-range="24">24 meses</button>
        </div>
      </div>
      <div id="gAcqSummary" class="acq-summary"></div>
      <div class="chart-card"><div id="gAcqChart"></div></div>
      <article class="chart-card chart-card-follow">
        <h3>Tempo de permanência</h3>
        <p>Contratação até hoje (ativos/congelados) ou até o cancelamento analítico.</p>
        <div id="chartStay"></div>
      </article>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Clientes</h2>
          ${renderTableToolbar({
            countLabel: `${fmt.format(rows.length)} registros encontrados`,
            exportPrefix: "general",
          })}
        </div>
      </div>
      <div class="table-wrap">
        <table class="gd-table">
          <thead>
            <tr>
              <th data-sort="clientName">Cliente</th>
              <th data-sort="clientCode">Código</th>
              <th data-sort="clientId">ID</th>
              <th data-sort="contractDate">Contratação</th>
              <th data-sort="cancellationDate">Cancelamento</th>
              <th data-sort="stayDays">Permanência</th>
              <th data-sort="analyticalStatus">Status</th>
              <th data-sort="segmentLabel">Segmento</th>
              <th data-sort="engineer">EP</th>
              <th data-sort="monthlyIncome">Renda</th>
              <th data-sort="lastContribution">Aporte</th>
              <th data-sort="liquidityReserve">Liquidez</th>
              <th data-sort="hasProperty">Imóvel</th>
              <th data-sort="hasCar">Carro</th>
              <th data-sort="hasConsortium">Consórcio</th>
            </tr>
          </thead>
          <tbody id="gRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="gPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="gNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  if ($("chartStatus")) $("chartStatus").innerHTML = donut(dist.status);
  if ($("chartSegment")) $("chartSegment").innerHTML = hBars(dist.segments.filter((i) => i.count > 0));
  if ($("chartStay")) $("chartStay").innerHTML = hBars(dist.stayRanges.filter((i) => i.count > 0));
  if ($("chartEngineers")) $("chartEngineers").innerHTML = hBars(dist.engineers, state.showAllEngineers ? null : 8);
  if ($("chartFinancialProfile")) $("chartFinancialProfile").innerHTML = hBars(dist.financialProfile);
  if ($("chartIncome")) $("chartIncome").innerHTML = hBars(dist.monthlyIncome.filter((i) => i.count > 0));
  if ($("chartLiquidity")) $("chartLiquidity").innerHTML = hBars(dist.liquidityReserve.filter((i) => i.count > 0));
  renderAcquisition(acquisitionRows());

  const tbody = $("gRows");
  if (!tbody) return;
  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="15">Nenhum cliente encontrado para os filtros selecionados.</td></tr>`;
  } else {
    tbody.innerHTML = pageRows
      .map(
        (c) => `<tr data-id="${escapeHtml(c.clientId)}">
        <td class="truncate" title="${escapeHtml(c.clientName)}">${escapeHtml(c.clientName)}</td>
        <td>${escapeHtml(c.clientCode || "Não informado")}</td>
        <td class="truncate" title="${escapeHtml(c.clientId)}">${escapeHtml(c.clientId)}</td>
        <td>${dateBR(c.contractDate)}</td>
        <td>${dateBR(c.cancellationDate)}</td>
        <td class="num">${c.stayDays == null ? "—" : `${fmt.format(c.stayDays)} d`}</td>
        <td>${statusBadge(c.analyticalStatus)}</td>
        <td>${escapeHtml(segmentLabelOf(c))}</td>
        <td class="truncate" title="${escapeHtml(c.engineer)}">${escapeHtml(c.engineer)}</td>
        <td class="num">${money(c.monthlyIncome)}</td>
        <td class="num">${money(c.lastContribution)}</td>
        <td class="num">${money(c.liquidityReserve)}</td>
        <td>${boolLabel(c.hasProperty)}</td>
        <td>${boolLabel(c.hasCar)}</td>
        <td>${boolLabel(c.hasConsortium)}</td>
      </tr>`,
      )
      .join("");
  }

  bindContentEvents(rows);
}

function bindContentEvents(rows) {
  const content = $("page-content");
  $("toggleEngineers")?.addEventListener("click", () => {
    state.showAllEngineers = !state.showAllEngineers;
    renderSuccess();
  });
  $("gPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("gNext")?.addEventListener("click", () => {
    state.page += 1;
    renderSuccess();
  });
  document.querySelectorAll("#gAcqRangeSeg [data-acq-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.acqRange = Number(btn.dataset.acqRange) || 6;
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
  $("gRows")?.addEventListener("click", (event) => {
    const tr = event.target.closest("tr[data-id]");
    if (!tr) return;
    const client = rows.find((c) => c.clientId === tr.dataset.id);
    if (client) renderDrawer(client);
  });
  bindTableExport(content, (format) => {
    exportFilteredTable({
      pageId: "general",
      rows,
      filters: state.filters,
      format,
      extraFilterLabels: {
        Programa: state.filters.program,
        Contratação: state.filters.contract,
        Cancelamento: state.filters.cancel,
        Permanência: state.filters.stay,
      },
    });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveVisibleFilterFields("general", FILTER_FIELDS);
  const period = resolvePeriod(state.filters);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "general",
    innerHtml: renderFilterBar({
      fields,
      filters: state.filters,
      periodInvalid: period.invalid,
    }),
    onBodyReady: (body) => {
      if (state.payload) populateFilterOptions();
      $("gContractRange") && ($("gContractRange").value = state.filters.contract);
      $("gCancelRange") && ($("gCancelRange").value = state.filters.cancel);
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultGeneralFilters();
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
      <button class="btn btn-secondary" type="button" id="gRetry">Tentar novamente</button>
    </div>
  </div>`;
  $("gRetry")?.addEventListener("click", () => {
    void loadGeneral({ force: true });
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
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando dados gerais</strong><span>Consultando a BASE QV…</span></div>`;
    return;
  }
  if (state.payload && !(state.payload.clients || []).length) {
    content.innerHTML = `<div class="gd-status"><strong>Sem clientes</strong><span>A consulta não retornou registros para esta base.</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Dados Gerais] render", error);
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

function bindFilterEvents() {
  /* eventos da barra são ligados em renderFilters */
}

function ensurePageRefresh() {
  if (pageRefresh) return pageRefresh;
  pageRefresh = createPageRefresh({
    buttonId: "gRefresh",
    onRefresh: () => loadGeneral({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadGeneral({ force = false } = {}) {
  if (state.loading && !force) {
    renderFilters();
    bindFilterEvents();
    renderStateView();
    setActions(true);
    return;
  }
  if (state.payload && !force) {
    renderFilters();
    bindFilterEvents();
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
  bindFilterEvents();
  renderStateView();
  try {
    state.payload = await fetchPageJson("/api/general-data", { force });
    state.filters = { ...defaultGeneralFilters(), ...state.filters, status: state.filters.status || DEFAULT_STATUS_FILTER };
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
      bindFilterEvents();
      renderStateView();
    }
  }
}

function unmountGeneral() {
  renderDrawer(null);
  state.mounted = false;
}

function mountGeneral() {
  state.mounted = true;
  setActions(false);
  void loadGeneral();
}

export function bootGeneralData() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "general") mountGeneral();
    else if (state.mounted) unmountGeneral();
  });
  if (getCurrentPageId() === "general") mountGeneral();
}
