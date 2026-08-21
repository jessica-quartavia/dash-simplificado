import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  defaultPlatformUsageFilters,
  filterPlatformUsageClients,
  summarizeFilteredPlatformUsage,
  LOGIN_FILTER_OPTIONS,
  LAST_ACCESS_FILTER_OPTIONS,
} from "../lib/analytics/platform-usage-filters.mjs";
import { escapeHtml, hBarsExpandable } from "./general-charts.mjs";
import { bindChartExpand } from "./components/chart-expand.js";
import { createFilterChangeHandler } from "../lib/analytics/filters/filter-state.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError, clearPageCache } from "./utils/page-load.js";
import { bindFilterBar, bindTableExport, renderFilterBar, renderTableToolbar } from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { exportFilteredTable } from "./utils/page-table-export.js";

const fmt = new Intl.NumberFormat("pt-BR");
const API = "/api/platform-usage";

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultPlatformUsageFilters(),
  sortKey: "userName",
  sortDir: "asc",
  page: 1,
  pageSize: 25,
  chartExpanded: { loginDist: false },
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let unbindChartExpand = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "puSearch", key: "search" },
  { kind: "select", id: "puLogin", key: "realizedLogin", label: "Realizou login", options: LOGIN_FILTER_OPTIONS },
  { kind: "select", id: "puLastAccess", key: "lastAccess", label: "Último acesso", options: LAST_ACCESS_FILTER_OPTIONS },
];

function $(id) {
  return document.getElementById(id);
}

function filtersFromForm() {
  return {
    search: $("puSearch")?.value || "",
    realizedLogin: $("puLogin")?.value || "all",
    lastAccess: $("puLastAccess")?.value || "all",
  };
}

function filteredRows() {
  const rows = filterPlatformUsageClients(state.payload?.clients || [], state.filters);
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
  return {
    rows,
    summary: summarizeFilteredPlatformUsage(rows, state.payload?.summary || {}),
  };
}

function kpiCard(label, value, note = "") {
  return `<article class="kpi-card kpi-card-highlight">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}

function pctLabel(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toLocaleString("pt-BR")}%`;
}

function kpiValue(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return fmt.format(Number(v));
}

function metricsSourceUnavailable() {
  return Boolean(
    state.payload?.metricsSourceUnavailable
    || (state.payload?.status !== "connected" && state.payload?.summary?.totalUsers == null),
  );
}

function pharusLoadErrorMessage(error) {
  const code = error?.code || "";
  const msg = String(error?.message || "");
  if (code === "config" || code === "pharus_config") {
    return "Fonte App Pharus indisponível para leitura.";
  }
  if (/pharus|metrics\.events|schema metrics/i.test(msg)) {
    return "Fonte App Pharus indisponível para leitura.";
  }
  return msg || "Não foi possível carregar os dados.";
}

function dateLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function loginDistribution(rows) {
  const yes = rows.filter((r) => r.realizedLogin).length;
  const no = rows.length - yes;
  const total = rows.length || 1;
  return [
    { label: "Sim", count: yes, percent: Math.round((yes / total) * 1000) / 10 },
    { label: "Não", count: no, percent: Math.round((no / total) * 1000) / 10 },
  ].filter((i) => i.count > 0);
}

function renderCharts(rows) {
  const dist = loginDistribution(rows);
  const chart = hBarsExpandable(dist, "puChartLogin", {
    limit: 8,
    expanded: state.chartExpanded.loginDist,
  });
  const host = $("puChartLogin");
  if (host) host.innerHTML = chart.html;
  const btnHost = $("puChartLoginToggle");
  if (btnHost) btnHost.innerHTML = chart.buttonHtml;
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  if (state.payload?.available === false || state.payload?.status === "unavailable") {
    content.innerHTML = `
      <section class="section-block">
        <h2>Uso da plataforma — App Pharus</h2>
        <p class="page-unavailable">${escapeHtml(state.payload?.message || "Fonte ainda não disponível para leitura.")}</p>
        ${(state.payload?.sources?.warnings || []).slice(0, 3).map((w) => `<p class="page-warning">${escapeHtml(w.message || w.label || "")}</p>`).join("")}
      </section>`;
    return;
  }
  const sourceUnavailable = metricsSourceUnavailable();
  const { rows, summary } = currentSummary();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const warnings = (state.payload?.sources?.warnings || []).slice(0, 3);

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    ${sourceUnavailable ? `<p class="page-source-unavailable" role="status">${escapeHtml(state.payload?.sources?.warnings?.[0]?.message || state.payload?.message || "Fonte de uso ainda indisponível.")}</p>` : ""}
    ${warnings.length && !sourceUnavailable ? `<div class="page-warnings">${warnings.map((w) => `<p class="page-warning">${escapeHtml(w.message || w.label || "")}</p>`).join("")}</div>` : ""}
    <section class="section-block">
      <h2>Uso da plataforma — App Pharus</h2>
      <p class="section-lead">Acesso, recência e frequência de login. Exclui contas @quartavia.com.br e demos.</p>
      <div class="kpi-row kpi-row-primary">
        ${kpiCard(state.payload?.summary?.usersLabel || "Usuários com registro de acesso", sourceUnavailable ? "—" : kpiValue(summary.totalUsers), sourceUnavailable ? "" : "População com login na view")}
        ${kpiCard("Com login", sourceUnavailable ? "—" : kpiValue(summary.usersWithLogin), sourceUnavailable ? "" : pctLabel(summary.loginCoverage))}
        ${kpiCard("Total de logins", sourceUnavailable ? "—" : kpiValue(summary.totalLogins))}
        ${kpiCard("Dias desde último acesso (mediana)", sourceUnavailable ? "—" : kpiValue(summary.typicalDaysSinceLastAccess))}
      </div>
    </section>
    <section class="section-block">
      <div class="chart-grid chart-grid--compact">
        <article class="chart-card chart-card--expandable">
          <div class="chart-card-head"><div><h3>Realizou login</h3></div><span id="puChartLoginToggle"></span></div>
          <div class="chart-card-body" id="puChartLogin"></div>
        </article>
        <article class="chart-card">
          <h3>Indicadores de viabilidade</h3>
          <ul class="indicator-list">${(state.payload?.indicators || []).slice(0, 6).map((i) => `<li><strong>${escapeHtml(i.indicator)}</strong> — ${escapeHtml(i.metric || "")}</li>`).join("")}</ul>
        </article>
      </div>
    </section>
    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Usuários</h2>
          ${renderTableToolbar({ countLabel: `${fmt.format(rows.length)} registros`, page: state.page, pages, pageSize: state.pageSize })}
        </div>
      </div>
      <div class="table-scroll">
        <table class="gd-table">
          <thead>
            <tr>
              <th data-sort="userName">Usuário</th>
              <th data-sort="email">E-mail</th>
              <th data-sort="realizedLogin">Login</th>
              <th data-sort="totalLogins" class="num">Logins</th>
              <th data-sort="loginsPerMonth" class="num">Logins/mês</th>
              <th data-sort="daysSinceLastAccess" class="num">Dias s/ acesso</th>
              <th data-sort="lastAccessAt">Último acesso</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((r) => `<tr>
              <td>${escapeHtml(r.userName)}</td>
              <td>${escapeHtml(r.email)}</td>
              <td>${r.realizedLogin ? "Sim" : "Não"}</td>
              <td class="num">${fmt.format(r.totalLogins || 0)}</td>
              <td class="num">${r.loginsPerMonth != null ? fmt.format(r.loginsPerMonth) : "—"}</td>
              <td class="num">${r.daysSinceLastAccess != null ? fmt.format(r.daysSinceLastAccess) : "—"}</td>
              <td>${dateLabel(r.lastAccessAt)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>`;

  renderCharts(rows);
  unbindChartExpand();
  unbindChartExpand = bindChartExpand(content, state.chartExpanded, () => renderSuccess());

  content.querySelectorAll(".gd-table th[data-sort]").forEach((th) => {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = "asc"; }
      renderSuccess();
    };
  });
  $("puPrev")?.addEventListener("click", () => { state.page -= 1; renderSuccess(); }, { once: true });
  $("puNext")?.addEventListener("click", () => { state.page += 1; renderSuccess(); }, { once: true });

  bindTableExport(content, (format) => {
    exportFilteredTable({ pageId: "platform_usage", rows, filters: state.filters, format });
  });
}

async function loadPayload(force = false) {
  state.loading = true;
  state.error = null;
  ensurePageRefresh().setLoading(true);
  if (force) clearPageCache("platform_usage");
  try {
    state.payload = await fetchPageJson(API, { force, pageId: "platform_usage" });
    ensurePageRefresh().markSuccess(state.payload?.generatedAt ? new Date(state.payload.generatedAt) : new Date());
  } catch (error) {
    const mapped = mapLoadError(error);
    if (mapped.stale) return mapped;
    state.errorCode = mapped.errorCode;
    state.error = pharusLoadErrorMessage(error);
    if (force && state.payload) {
      ensurePageRefresh().markError(state.error);
    } else {
      state.payload = null;
      ensurePageRefresh().render();
    }
    return mapped;
  } finally {
    state.loading = false;
    ensurePageRefresh().setEnabled(true);
  }
}

function ensurePageRefresh() {
  if (pageRefresh) return pageRefresh;
  pageRefresh = createPageRefresh({
    onRefresh: () => refresh(true),
  });
  return pageRefresh;
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "platform_usage",
    innerHtml: renderFilterBar({ fields: FILTER_FIELDS, filters: state.filters }),
    onBodyReady: (body) => {
      unbindFilters = bindFilterBar({
        host: body,
        fields: FILTER_FIELDS,
        filters: state.filters,
        onChange: onFilterChange,
        onClear: () => { state.filters = defaultPlatformUsageFilters(); state.page = 1; renderFilters(); renderSuccess(); },
      });
      return unbindFilters;
    },
  });
}

const onFilterChange = createFilterChangeHandler({
  readFilters: filtersFromForm,
  apply(next) {
    state.filters = next;
    state.page = 1;
    renderSuccess();
  },
});

function renderLoading() {
  const content = $("page-content");
  if (content) content.innerHTML = `<p class="placeholder-note">Carregando uso da plataforma…</p>`;
}

function renderErrorView() {
  const content = $("page-content");
  if (!content) return;
  content.innerHTML = `<div class="page-error"><p>${escapeHtml(state.error || "Erro ao carregar.")}</p><button type="button" class="btn btn-secondary" id="puRetry">Tentar novamente</button></div>`;
  $("puRetry")?.addEventListener("click", () => { void refresh(true); });
}

async function refresh(force = false) {
  renderLoading();
  ensurePageRefresh().render();
  const result = await loadPayload(force);
  if (result?.stale) return;
  if (state.error && !state.payload) { renderErrorView(); return; }
  renderFilters();
  renderSuccess();
}

export function bootPlatformUsage() {
  if (state.mounted) return;
  state.mounted = true;
  ensurePageRefresh().setEnabled(false);
  ensurePageRefresh().render();
  onPageChange(async (page) => {
    if (page.id !== "platform_usage") return;
    if (!state.payload && !state.loading) await refresh();
    else { renderFilters(); renderSuccess(); }
  });
  if (getCurrentPageId() === "platform_usage") void refresh();
  if (!eventsBound) eventsBound = true;
}
