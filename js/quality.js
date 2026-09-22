import { onPageChange, getCurrentPageId } from "./navigation.js";
import { getPageById } from "./pages.js";
import { resolveVisibleFilterFields } from "../lib/analytics/filters/page-contracts.mjs";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { buildQualityViabilitySections, renderViabilityMatrixHtml } from "../lib/analytics/quality-matrices.mjs";
import { escapeHtml } from "./general-charts.mjs";
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

const fmt = new Intl.NumberFormat("pt-BR");

export const QUALITY_SEVERITY_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "high", label: "Alto (≥ 85%)" },
  { value: "medium", label: "Médio (60%–84,9%)" },
  { value: "low", label: "Baixo (< 60%)" },
];

export function defaultQualityFilters() {
  return { search: "", domain: "all", severity: "all" };
}

const state = {
  mounted: false,
  payload: null,
  sources: {},
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultQualityFilters(),
  sortKey: "fillPercent",
  sortDir: "desc",
  page: 1,
  pageSize: 50,
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "qySearch", key: "search", placeholder: "Ex.: data_inicio_ciclo" },
  { kind: "select", id: "qyDomain", key: "domain", label: "Domínio", dynamic: true, allLabel: "Todos os domínios" },
  {
    kind: "select",
    id: "qySeverity",
    key: "severity",
    label: "Preenchimento",
    options: QUALITY_SEVERITY_OPTIONS,
  },
];

function $(id) {
  return document.getElementById(id);
}

function getFilled(row) {
  return (row.totalRows || 0) - (row.missingRows || 0);
}

function getPct(row) {
  return row.totalRows ? (getFilled(row) / row.totalRows) * 100 : 0;
}

function severityKey(percent) {
  if (percent >= 85) return "high";
  if (percent >= 60) return "medium";
  return "low";
}

const SEV_LABEL = { high: "Alto", medium: "Médio", low: "Baixo" };

function pctLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function qualityRows() {
  return state.payload?.data || [];
}

function filtersFromForm() {
  return {
    search: $("qySearch")?.value || "",
    domain: $("qyDomain")?.value || "all",
    severity: $("qySeverity")?.value || "all",
  };
}

function filteredQualityRows() {
  const q = (state.filters.search || "").trim().toLowerCase();
  const rows = qualityRows()
    .filter((row) => {
      if (state.filters.domain !== "all" && row.domain !== state.filters.domain) return false;
      const sev = severityKey(getPct(row));
      if (state.filters.severity !== "all" && sev !== state.filters.severity) return false;
      if (q && !`${row.table} ${row.column}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .map((row) => ({
      ...row,
      filled: getFilled(row),
      fillPercent: getPct(row),
      tableLabel: `${row.schema || "public"}.${row.table}`,
    }));

  const dir = state.sortDir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const key = state.sortKey;
    const av = a[key];
    const bv = b[key];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR") * dir;
  });
  return rows;
}

function populateDomainOptions() {
  const domains = [...new Set(qualityRows().map((row) => row.domain).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  fillDynamicSelect($("qyDomain"), domains, "Todos os domínios", state.filters.domain);
}

function kpiCard(label, value, note) {
  return `<article class="kpi-card">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}

function renderFieldCard(row) {
  const percent = row.fillPercent;
  const sev = severityKey(percent);
  const filled = row.filled;
  const schemaName = row.schema || "public";
  const consistency = (row.consistencyNotes || [])
    .map((note) => `<div class="field-consistency">${escapeHtml(note)}</div>`)
    .join("");
  const usedLabel =
    Array.isArray(row.usedIn) && row.usedIn.length
      ? row.usedIn.length === 1
        ? row.usedIn[0]
        : `${row.usedIn.slice(0, -1).join(", ")} e ${row.usedIn[row.usedIn.length - 1]}`
      : "";
  const usedIn = usedLabel ? `<div class="field-used"><b>Usado em:</b> ${escapeHtml(usedLabel)}</div>` : "";

  return `<article class="field-card">
    <div class="card-top">
      <div>
        <div class="field">${escapeHtml(row.column)}</div>
        <div class="table-name">${escapeHtml(schemaName)}.${escapeHtml(row.table)}</div>
        ${row.description ? `<div class="field-desc">${escapeHtml(row.description)}</div>` : ""}
        ${usedIn}
        ${consistency}
      </div>
      <span class="badge ${sev}">${SEV_LABEL[sev]}</span>
    </div>
    <div class="missing">
      <div><span>Preenchidos</span><br><strong>${fmt.format(filled)}</strong></div>
      <div class="percent"><b>${pctLabel(percent)}</b><span>de ${fmt.format(row.totalRows)} linhas</span></div>
    </div>
    <div class="track" title="${pctLabel(percent)} preenchido"><div style="width:${Math.min(percent, 100)}%"></div></div>
    <div class="card-footer"><span>${escapeHtml(row.domain)}</span><span>${fmt.format(row.totalRows)} linhas</span></div>
  </article>`;
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;

  const rows = filteredQualityRows();
  const totals = rows.reduce(
    (acc, row) => {
      acc.rows += row.totalRows || 0;
      acc.filled += row.filled || 0;
      return acc;
    },
    { rows: 0, filled: 0 },
  );
  const completion = totals.rows ? (totals.filled / totals.rows) * 100 : 0;
  const tableCount = new Set(rows.map((row) => row.table)).size;
  const sections = buildQualityViabilitySections(state.sources);
  const pageNote =
    getPageById("quality")?.description ||
    "Esta página é utilizada pelo time de Inteligência para analisar cobertura, disponibilidade e confiabilidade dos dados utilizados no portal.";

  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  const warnings = state.payload?.warnings || [];
  const warningHtml =
    warnings.length && state.payload
      ? `<div class="portal-alert portal-alert--warning" role="status"><div class="portal-alert__content"><h3>Alertas de qualidade</h3><p>${fmt.format(warnings.length)} aviso(s) na consulta. A página continua utilizável.</p></div></div>`
      : "";

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    ${warningHtml}
    <p class="text-muted quality-intel-note">${escapeHtml(pageNote)}</p>

    <section class="section-block">
      <h2>Resumo</h2>
      <div class="kpi-row kpi-row-compact">
        ${kpiCard("Linhas analisadas*", fmt.format(totals.rows), "Soma das linhas por coluna filtrada")}
        ${kpiCard("Colunas auditadas", fmt.format(rows.length), `Em ${fmt.format(tableCount)} tabelas`)}
        ${kpiCard("Valores preenchidos", fmt.format(totals.filled), "Células com informação registrada")}
        ${kpiCard("Completude geral*", pctLabel(completion), "Sobre todas as células auditadas")}
      </div>
    </section>

    <section class="section-block">
      <h2>Matrizes de viabilidade</h2>
      <p>Leitura técnica dos indicadores construídos nas abas ativas do dashboard.</p>
      <div class="chart-grid viability-stack">
        ${sections
          .map(
            (section) => `<article class="chart-card">
          <h3>${escapeHtml(section.title)}</h3>
          <p>${escapeHtml(section.subtitle)}</p>
          <div class="indicator-matrix">${renderViabilityMatrixHtml(section.rows)}</div>
        </article>`,
          )
          .join("")}
      </div>
    </section>

    <section class="section-block">
      <div class="table-panel-head">
        <div>
          <h2>Preenchimento por coluna</h2>
          <p>Cada cartão compara valores vazios ou nulos com o total de registros da tabela.</p>
        </div>
        <span class="counter">${fmt.format(rows.length)} de ${fmt.format(qualityRows().length)} colunas</span>
      </div>
      <div class="quality-cards" id="qyCards">${rows.length ? rows.map(renderFieldCard).join("") : ""}</div>
      ${rows.length ? "" : `<p class="text-muted">Nenhuma coluna encontrada para os filtros selecionados.</p>`}
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Detalhamento técnico</h2>
          <p>Base para validação da consulta e acompanhamento da completude.</p>
          ${renderTableToolbar({ countLabel: `${fmt.format(rows.length)} colunas`, exportPrefix: "quality" })}
        </div>
      </div>
      <div class="table-wrap">
        <table class="gd-table">
          <thead>
            <tr>
              <th data-sort="domain">Domínio</th>
              <th data-sort="tableLabel">Tabela</th>
              <th data-sort="column">Coluna</th>
              <th data-sort="totalRows" class="num">Linhas</th>
              <th data-sort="filled" class="num">Preenchidos</th>
              <th data-sort="fillPercent" class="num">Percentual preenchido</th>
            </tr>
          </thead>
          <tbody id="qyRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="qyPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="qyNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  const tbody = $("qyRows");
  if (tbody) {
    tbody.innerHTML = pageRows.length
      ? pageRows
          .map(
            (row) => `<tr>
          <td>${escapeHtml(row.domain)}</td>
          <td><code>${escapeHtml(row.tableLabel)}</code></td>
          <td title="${escapeHtml(row.description || "")}"><code>${escapeHtml(row.column)}</code></td>
          <td class="num">${fmt.format(row.totalRows)}</td>
          <td class="num">${fmt.format(row.filled)}</td>
          <td class="num">${pctLabel(row.fillPercent)}</td>
        </tr>`,
          )
          .join("")
      : `<tr><td colspan="6">Nenhuma coluna encontrada para os filtros selecionados.</td></tr>`;
  }

  $("qyPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("qyNext")?.addEventListener("click", () => {
    state.page += 1;
    renderSuccess();
  });

  document.querySelectorAll(".gd-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDir = key === "domain" || key === "column" || key === "tableLabel" ? "asc" : "desc";
      }
      renderSuccess();
    });
  });

  bindTableExport(content, (format) => {
    exportFilteredTable({
      pageId: "quality",
      rows: rows.map((row) => ({
        domain: row.domain,
        tableLabel: row.tableLabel,
        column: row.column,
        totalRows: row.totalRows,
        filled: row.filled,
        fillPercent: row.fillPercent,
      })),
      filters: state.filters,
      format,
      extraFilterLabels: {
        Domínio: state.filters.domain,
        Preenchimento: QUALITY_SEVERITY_OPTIONS.find((o) => o.value === state.filters.severity)?.label || "Todos",
      },
    });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  const fields = resolveVisibleFilterFields("quality", FILTER_FIELDS);
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "quality",
    innerHtml: renderFilterBar({ fields, filters: state.filters }),
    onBodyReady: (body) => {
      if (state.payload) populateDomainOptions();
      $("qySeverity") && ($("qySeverity").value = state.filters.severity || "all");
      $("qyDomain") && ($("qyDomain").value = state.filters.domain || "all");
      unbindFilters = bindFilterBar({
        host: body,
        fields,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => {
          state.filters = defaultQualityFilters();
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
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="qyRetry">Tentar novamente</button></div>
  </div>`;
  $("qyRetry")?.addEventListener("click", () => {
    void loadQuality({ force: true });
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
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando qualidade</strong><span>Consultando a BASE QV…</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Qualidade] render", error);
    renderErrorView("Não foi possível carregar os dados.", error instanceof Error ? error.message : "Falha ao montar a página.");
  }
}

const onFilterChange = createFilterChangeHandler({
  state,
  filtersFromForm,
  renderFilters,
  renderSuccess,
});

async function fetchSourceQuiet(url, { force = false } = {}) {
  try {
    return await fetchPageJson(url, { force });
  } catch {
    return {};
  }
}

async function loadMatrixSources({ force = false } = {}) {
  const [
    general,
    onboarding,
    plan,
    meetings,
    mechanisms,
    financial,
    satisfaction,
    temporal,
    renewal,
    ep,
  ] = await Promise.all([
    fetchSourceQuiet("/api/general-data", { force }),
    fetchSourceQuiet("/api/onboarding", { force }),
    fetchSourceQuiet("/api/patrimonial-plan", { force }),
    fetchSourceQuiet("/api/meetings", { force }),
    fetchSourceQuiet("/api/mechanisms", { force }),
    fetchSourceQuiet("/api/financial-updates", { force }),
    fetchSourceQuiet("/api/satisfaction", { force }),
    fetchSourceQuiet("/api/temporal-indicators", { force }),
    fetchSourceQuiet("/api/renewal", { force }),
    fetchSourceQuiet("/api/ep-performance", { force }),
  ]);

  state.sources = {
    general,
    onboarding,
    plan,
    meetings,
    mechanisms,
    financial,
    satisfaction,
    temporal,
    renewal,
    ep,
    support: {},
    pharus: {},
  };
}

function ensurePageRefresh() {
  if (pageRefresh) return pageRefresh;
  pageRefresh = createPageRefresh({
    pageId: "quality",
    buttonId: "qyRefresh",
    csvButtonId: "qyCsv",
    getExportContext: () => ({ payload: state.payload, filters: state.filters, loading: state.loading }),
    onRefresh: () => loadQuality({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadQuality({ force = false } = {}) {
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
    state.sources = {};
  }
  ensurePageRefresh().setLoading(true);
  renderFilters();
  renderStateView();

  try {
    const [payload] = await Promise.all([
      fetchPageJson("/api/quality", { force }),
      loadMatrixSources({ force }),
    ]);
    state.payload = payload;
    ensurePageRefresh().markSuccess(payload.generatedAt ? new Date(payload.generatedAt) : new Date());
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
    await loadMatrixSources({ force }).catch(() => {});
  } finally {
    state.loading = false;
    setActions(true);
    if (state.mounted) {
      renderFilters();
      renderStateView();
    }
  }
}

function unmountQuality() {
  state.mounted = false;
}

function mountQuality() {
  state.mounted = true;
  setActions(false);
  void loadQuality();
}

export function bootQuality() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "quality") mountQuality();
    else if (state.mounted) unmountQuality();
  });
  if (getCurrentPageId() === "quality") mountQuality();
}
