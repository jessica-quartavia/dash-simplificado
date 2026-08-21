import { onPageChange, getCurrentPageId } from "./navigation.js";
import { analyticalStatusDisplayLabel } from "../lib/analytics/analytical-cancellation.mjs";
import {
  COUNT_FILTER_OPTIONS,
  DEFAULT_STATUS_FILTER,
  MECH_STATUS_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  YES_NO_FILTER_OPTIONS,
  defaultMechanismFilters,
  filterMechanismClients,
  filterMechanismMonthSeries,
  filterPortfolio,
  portfolioSize,
} from "../lib/analytics/mechanism-filters.mjs";
import { summarizeEngineerBars, summarizeMechanismRows } from "../lib/analytics/mechanism-metrics.mjs";
import { donut, escapeHtml, hBars } from "./general-charts.mjs";
import { resolvePeriod } from "../lib/analytics/filters/period.mjs";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { parseMultiSelectValue } from "../lib/analytics/filters/multiselect.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";
import {
  bindFilterBar,
  bindTableExport,
  fillDynamicSelect,
  renderFilterBar,
  renderTableToolbar,
} from "./components/filters/filter-bar.js";
import { fillMultiSelectOptions } from "./components/filters/multi-select-filter.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { exportFilteredTable } from "./utils/page-table-export.js";

const fmt = new Intl.NumberFormat("pt-BR");

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultMechanismFilters(),
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
  { kind: "search", id: "mkSearch", key: "search" },
  { kind: "period", id: "mkPeriod", fromId: "mkFrom", toId: "mkTo" },
  { kind: "select", id: "mkStatus", key: "status", label: "Status", options: STATUS_FILTER_OPTIONS },
  { kind: "select", id: "mkEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "mkSegment", key: "segment", label: "Segmento", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "mkProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "mkMechStatus", key: "mechStatus", label: "Status do vínculo", options: MECH_STATUS_FILTER_OPTIONS },
  {
    kind: "multiselect",
    id: "mkMechanism",
    key: "mechanism",
    label: "Mecanismo",
    dynamic: true,
    allLabel: "Todos",
  },
  { kind: "select", id: "mkCategory", key: "category", label: "Categoria", dynamic: true, allLabel: "Todas" },
  { kind: "select", id: "mkCount", key: "countBand", label: "Quantidade", options: COUNT_FILTER_OPTIONS },
  { kind: "select", id: "mkHasImpl", key: "hasImpl", label: "Implementado", options: YES_NO_FILTER_OPTIONS },
];

function $(id) {
  return document.getElementById(id);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("mkSearch")?.value || "",
    period: $("mkPeriod")?.value || "all",
    from: $("mkFrom")?.value || "",
    to: $("mkTo")?.value || "",
    status: $("mkStatus")?.value || DEFAULT_STATUS_FILTER,
    engineer: $("mkEngineer")?.value || "all",
    segment: $("mkSegment")?.value || "all",
    program: normalizeProgramFilter($("mkProgram")?.value || "all"),
    mechStatus: $("mkMechStatus")?.value || "all",
    mechanism: parseMultiSelectValue($("mkMechanism")?.value || ""),
    category: $("mkCategory")?.value || "all",
    countBand: $("mkCount")?.value || "all",
    hasImpl: $("mkHasImpl")?.value || "all",
  };
}

function filteredRows() {
  const rows = filterMechanismClients(state.payload?.clients || [], state.filters);
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

function currentSummary() {
  const rows = filteredRows();
  const portfolio = filterPortfolio(state.payload?.portfolio || [], state.filters);
  const summary = summarizeMechanismRows(rows, {
    catalog: state.payload?.catalog || [],
    portfolioCount: portfolioSize(portfolio),
    consolidationQuality: state.payload?.metadata?.consolidationQuality || null,
  });
  summary.months = filterMechanismMonthSeries(state.payload?.clients || [], state.filters);
  summary.byEngineer = summarizeEngineerBars(rows, portfolio);
  return { rows, summary };
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
  const titleAttr = options.title ? ` title="${escapeHtml(options.title)}"` : "";
  return `<article class="${classes.join(" ")}"${titleAttr}>
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}

function pctLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("pt-BR")}%`;
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

function populateFilterOptions(host) {
  const clients = state.payload?.clients || [];
  const catalog = state.payload?.catalog || [];
  fillSelect($("mkEngineer"), uniqueSorted(clients.map((c) => c.engineer)), "Todos");
  fillSelect($("mkSegment"), uniqueSorted(clients.map((c) => c.segment)), "Todos");
  fillDynamicSelect($("mkProgram"), programSelectOptions(clients), "Todos", state.filters.program);
  fillSelect($("mkCategory"), uniqueSorted(clients.flatMap((c) => (c.mechanisms || []).map((m) => m.dimension))), "Todas");
  const mechanismField = FILTER_FIELDS.find((field) => field.key === "mechanism");
  const mechanismOptions = catalog
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((m) => ({ value: m.id, label: m.name }));
  fillMultiSelectOptions(host, mechanismField, mechanismOptions, state.filters.mechanism);
}

function mechanismSourceLegend(quality, metadata = {}) {
  const clients = quality?.clients || {};
  const baseQv = clients.qvClientsWithMechanisms ?? clients.baseQv ?? 0;
  const matched = clients.matchedInBoth ?? clients.presentInBothSources ?? 0;
  const pharusUnavailable = metadata?.pharus?.status === "unavailable"
    || metadata?.pharusConsulted === false
    || metadata?.status === "partial";
  if (pharusUnavailable) {
    return {
      line: `BASE QV ${fmt.format(baseQv)} · Parcial — App Pharus indisponível`,
      tooltip:
        "Clientes presentes nas duas fontes são contados uma única vez quando App Pharus responde. Matches ambíguos não entram no consolidado.",
    };
  }
  const appPharus = clients.pharusUsersWithMechanisms ?? 0;
  return {
    line: `BASE QV ${fmt.format(baseQv)} · App Pharus ${fmt.format(appPharus)} · correspondência ${fmt.format(matched)}`,
    tooltip:
      "Clientes presentes nas duas fontes são contados uma única vez. Clientes Pharus sem correspondência segura permanecem no consolidado; matches ambíguos não são fundidos.",
  };
}

function clientsWithMechanismsLabel(summary, quality) {
  const mode = summary?.consolidationMode || quality?.clients?.consolidationMode;
  if (mode === "partial") return "Clientes únicos com mecanismos (parcial)";
  if (mode === "full") return "Clientes únicos com mecanismos";
  return "Clientes com mecanismos";
}

function consolidatedTooltip(metadata) {
  const sources = metadata?.sources || ["BASE QV"];
  const temporal = metadata?.consolidationQuality?.temporalScope?.note || "";
  return `Visão consolidada ${sources.join(" + ")}. ${temporal}`.trim();
}

function renderQualityAccordion(quality) {
  if (!quality) return "";
  const clients = quality.clients || {};
  const links = quality.links || {};
  const types = quality.mechanisms || {};
  const crosswalk = quality.mechanismCrosswalk || {};
  const confirmed = (crosswalk.confirmed || [])
    .slice(0, 8)
    .map((row) => `<li>${escapeHtml(row.baseQv)} → ${escapeHtml(row.appPharus)} · ${escapeHtml(row.canonicalName || row.decision)}</li>`)
    .join("");
  const probable = (crosswalk.probable || [])
    .slice(0, 6)
    .map((row) => `<li>${escapeHtml(row.baseQv)} ↔ ${escapeHtml(row.appPharus)} · revisar</li>`)
    .join("");

  return `
    <details class="mech-quality-panel">
      <summary>Qualidade da consolidação das fontes</summary>
      <div class="mech-quality-panel__body">
        <div class="mech-quality-grid">
          <article><span>matchedInBoth</span><strong>${fmt.format(clients.matchedInBoth ?? clients.presentInBothSources ?? 0)}</strong></article>
          <article><span>baseQvOnly</span><strong>${fmt.format(clients.baseQvOnly ?? clients.qvOnly ?? 0)}</strong></article>
          <article><span>unmatchedAppPharus</span><strong>${fmt.format(clients.unmatchedAppPharus ?? clients.pharusOnly ?? 0)}</strong></article>
          <article><span>ambiguous (fora)</span><strong>${fmt.format(clients.ambiguous ?? clients.ambiguousMatches ?? 0)}</strong></article>
          <article><span>consolidatedUniquePeople</span><strong>${fmt.format(clients.consolidatedUniquePeople ?? clients.consolidated ?? 0)}</strong></article>
          <article><span>modo</span><strong>${escapeHtml(clients.consolidationMode || "—")}</strong></article>
          <article><span>rawSum (risco dup.)</span><strong>${fmt.format(clients.rawSum ?? 0)}</strong></article>
          <article><span>Overlap vínculos</span><strong>${fmt.format(links.overlapRemoved || 0)}</strong></article>
        </div>
        ${confirmed ? `<h4>Mecanismos equivalentes confirmados</h4><ul class="mech-quality-list">${confirmed}</ul>` : ""}
        ${probable ? `<h4>Mecanismos possivelmente equivalentes</h4><ul class="mech-quality-list">${probable}</ul>` : ""}
        <p class="mech-quality-note">Catálogo consolidado: ${fmt.format(types.consolidatedCatalog || 0)} tipos (${fmt.format(types.baseQvCatalog || 0)} BASE QV + ${fmt.format(types.pharusCatalog || 0)} App Pharus).</p>
      </div>
    </details>`;
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  const { rows, summary } = currentSummary();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const retro = state.payload?.metadata?.retroactiveNote || "";
  const meta = state.payload?.metadata || {};
  const quality = meta.consolidationQuality;
  const percentScope = quality?.implementationPercentScope?.primaryLabel || "";
  const temporalNote = quality?.temporalScope?.note || "";
  const sourceTip = consolidatedTooltip(meta);
  const sourceLegend = mechanismSourceLegend(quality, meta);

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <section class="section-block">
      <h2>Implementação de Mecanismos</h2>
      <p>Visão consolidada — BASE QV + App Pharus. Vínculos deduplicados por cliente e mecanismo canônico.</p>
      <div class="kpi-row kpi-row-primary">
        ${kpiCard(clientsWithMechanismsLabel(summary, quality), fmt.format(summary.clientsWithMechanisms), `${sourceLegend.line}${coverageLine(summary.coverage) ? ` · ${coverageLine(summary.coverage)}` : ""}`, { highlight: true, featured: true, title: `${sourceTip}\n${sourceLegend.tooltip}` })}
        ${kpiCard("Clientes com mecanismo implementado", fmt.format(summary.clientsWithImplementedMechanism), `${pctLabel(summary.implementationPercent)} do recorte`, { highlight: true, title: sourceTip })}
        ${kpiCard("Mecanismos implementados", fmt.format(summary.implementedMechanisms), "Vínculos distintos (cliente + mecanismo)", { title: sourceTip })}
        ${kpiCard("Em andamento", fmt.format(summary.inProgressMechanisms), "Somente status consolidável", { title: sourceTip })}
        ${kpiCard("Implementações recentes", fmt.format(summary.recentClients), temporalNote || "Últimos 30 dias (BASE QV — implemented_at)", { title: sourceTip })}
      </div>
    </section>

    <section class="section-block">
      <h2>Catálogo consolidado</h2>
      <div class="kpi-row">
        ${kpiCard("Tipos de mecanismos", fmt.format(summary.catalogSize), `${fmt.format(summary.typesUsed)} tipos utilizados`, { title: "Catálogo consolidado entre BASE QV e App Pharus." })}
        ${kpiCard("Tipos sem utilização", fmt.format(summary.typesUnused), `${fmt.format(summary.typesUnused)} de ${fmt.format(summary.catalogSize)} tipos`, { compact: true })}
        ${kpiCard("Mecanismo mais utilizado", escapeHtml(summary.topMechanismName), `${fmt.format(summary.topMechanismClients)} clientes distintos`, { compact: true, title: sourceTip })}
        ${kpiCard("Percentual implementado", pctLabel(summary.implementationPercent), `${fmt.format(summary.clientsWithImplementedMechanism)} de ${fmt.format(summary.clientsWithMechanisms)} clientes · ${percentScope}`, { compact: true, title: sourceTip })}
      </div>
    </section>

    ${renderQualityAccordion(quality)}

    <section class="section-block">
      <h2>Perfil dos mecanismos</h2>
      <div class="chart-grid">
        <article class="chart-card"><h3>Status dos vínculos</h3><div id="mkChartStatus"></div></article>
        <article class="chart-card"><h3>Quantidade de mecanismos por cliente</h3><p>${escapeHtml(coverageLine(summary.coverage))}</p><div id="mkChartCount"></div></article>
        <article class="chart-card"><h3>Cobertura do catálogo</h3><div id="mkChartCatalog"></div></article>
        <article class="chart-card"><h3>Utilização por tipo de mecanismo</h3><div id="mkChartTypes"></div></article>
      </div>
    </section>

    <section class="section-block">
      <h2>Evolução</h2>
      <article class="chart-card">
        <h3>Implementações por mês</h3>
        <p>${escapeHtml(temporalNote || retro)}</p>
        <div id="mkChartMonths"></div>
      </article>
    </section>

    <section class="section-block">
      <h2>Recortes</h2>
      <div class="chart-grid">
        <article class="chart-card"><h3>Implementados por segmento</h3><div id="mkChartSegment"></div></article>
        <article class="chart-card"><h3>Clientes com mecanismo implementado por EP</h3><p>${escapeHtml(retro)}</p><div id="mkChartEp"></div></article>
      </div>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Clientes</h2>
          ${renderTableToolbar({
            countLabel: `${fmt.format(rows.length)} registros encontrados`,
            exportPrefix: "mechanisms",
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
              <th data-sort="available">Vínculos</th>
              <th data-sort="implemented">Implementados</th>
              <th data-sort="implementationPercent">%</th>
            </tr>
          </thead>
          <tbody id="mkRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="mkPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="mkNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  if ($("mkChartStatus")) $("mkChartStatus").innerHTML = donut(summary.statusDist.filter((i) => i.count > 0));
  if ($("mkChartCount")) $("mkChartCount").innerHTML = hBars(summary.countDist.filter((i) => i.count > 0));
  if ($("mkChartCatalog")) $("mkChartCatalog").innerHTML = donut(summary.catalogDist);
  if ($("mkChartTypes")) $("mkChartTypes").innerHTML = hBars(summary.typeUsage);
  if ($("mkChartMonths")) $("mkChartMonths").innerHTML = hBars(summary.months);
  if ($("mkChartSegment")) $("mkChartSegment").innerHTML = hBars(summary.bySegment);
  if ($("mkChartEp")) $("mkChartEp").innerHTML = hBars(summary.byEngineer.map((i) => ({ ...i, label: `${i.label} · ${i.percent}%` })));

  const tbody = $("mkRows");
  if (tbody) {
    tbody.innerHTML = pageRows.length
      ? pageRows
        .map(
          (c) => `<tr>
          <td class="truncate" title="${escapeHtml(c.clientName)}">${escapeHtml(c.clientName)}</td>
          <td>${escapeHtml(c.clientCode || "Não informado")}</td>
          <td class="truncate">${escapeHtml(c.engineer)}</td>
          <td>${statusBadge(c.analyticalStatus)}</td>
          <td class="num">${fmt.format(c.available)}</td>
          <td class="num">${fmt.format(c.implemented)}</td>
          <td class="num">${pctLabel(c.implementationPercent)}</td>
        </tr>`,
        )
        .join("")
      : `<tr><td colspan="7">Nenhum cliente encontrado para os filtros selecionados.</td></tr>`;
  }

  $("mkPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("mkNext")?.addEventListener("click", () => {
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
      pageId: "mechanisms",
      rows,
      filters: state.filters,
      format,
      extraFilterLabels: {
        "Status do vínculo": state.filters.mechStatus,
        Mecanismo: state.filters.mechanism,
        Categoria: state.filters.category,
        Quantidade: state.filters.countBand,
        Implementado: state.filters.hasImpl,
      },
    });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveVisibleFilterFields("mechanisms", FILTER_FIELDS);
  const period = resolvePeriod(state.filters);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "mechanisms",
    innerHtml: renderFilterBar({
      fields,
      filters: state.filters,
      periodInvalid: period.invalid,
      note: "Mecanismo multiselect: OR entre opções; AND com demais filtros.",
    }),
    onBodyReady: (body) => {
      if (state.payload) populateFilterOptions(body);
      $("mkEngineer") && ($("mkEngineer").value = state.filters.engineer);
      $("mkSegment") && ($("mkSegment").value = state.filters.segment);
      $("mkProgram") && ($("mkProgram").value = state.filters.program);
      $("mkCategory") && ($("mkCategory").value = state.filters.category);
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultMechanismFilters();
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
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="mkRetry">Tentar novamente</button></div>
  </div>`;
  $("mkRetry")?.addEventListener("click", () => {
    void loadMechanisms({ force: true });
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
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando mecanismos</strong><span>Consolidando BASE QV e App Pharus…</span></div>`;
    return;
  }
  if (state.payload && !portfolioSize(state.payload.portfolio || [])) {
    content.innerHTML = `<div class="gd-status"><strong>Sem clientes</strong><span>A consulta não retornou registros para esta base.</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Mecanismos] render", error);
    state.loading = false;
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
    buttonId: "mkRefresh",
    onRefresh: () => loadMechanisms({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadMechanisms({ force = false } = {}) {
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
  ensurePageRefresh().setLoading(true);
  renderFilters();
  renderStateView();
  try {
    state.payload = await fetchPageJson("/api/mechanisms", { force });
    state.filters = { ...defaultMechanismFilters(), ...state.filters, status: state.filters.status || DEFAULT_STATUS_FILTER };
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

function unmountMechanisms() {
  state.mounted = false;
}

function mountMechanisms() {
  state.mounted = true;
  setActions(false);
  void loadMechanisms();
}

export function bootMechanisms() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "mechanisms") mountMechanisms();
    else if (state.mounted) unmountMechanisms();
  });
  if (getCurrentPageId() === "mechanisms") mountMechanisms();
}
