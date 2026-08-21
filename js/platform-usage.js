import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  defaultPlatformUsageFilters,
  filterPlatformUsageClients,
  filtersMatchDefault,
  LOGIN_FILTER_OPTIONS,
  LAST_ACCESS_FILTER_OPTIONS,
} from "../lib/analytics/platform-usage-filters.mjs";
import { escapeHtml, hBarsExpandable, donut } from "./general-charts.mjs";
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
  chartExpanded: { loginDist: false, lastAccess: false, monthly: false },
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

function isConnected() {
  return state.payload?.status === "connected" && state.payload?.metricsSourceUnavailable !== true;
}

function primarySummary() {
  return state.payload?.summary || {};
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

function daysLabel(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${fmt.format(Math.round(Number(v)))} dias`;
}

function pharusLoadErrorMessage(error) {
  const code = error?.code || "";
  const msg = String(error?.message || "");
  if (code === "config" || code === "pharus_config") {
    return "Configure PHARUS_SUPABASE_URL e PHARUS_SUPABASE_ANON_KEY.";
  }
  return msg || "Não foi possível carregar os dados.";
}

function dateLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function accessRangeLabel(days) {
  if (days == null) return "Sem acesso";
  if (days <= 7) return "0-7 dias";
  if (days <= 30) return "8-30 dias";
  if (days <= 90) return "31-90 dias";
  return "Mais de 90 dias";
}

function monthlyLoginRangeLabel(value) {
  if (value == null || value <= 0) return "Sem login";
  if (value < 1) return "Até 1/mês";
  if (value < 4) return "1-3/mês";
  if (value < 8) return "4-7/mês";
  return "8+/mês";
}

function loginDistribution(rows) {
  const yes = rows.filter((r) => r.realizedLogin).length;
  const no = rows.length - yes;
  const total = rows.length || 1;
  return [
    { label: "Sim", count: yes, percent: Math.round((yes / total) * 1000) / 10 },
    { label: "Não", count: no, percent: Math.round((no / total) * 1000) / 10 },
  ];
}

function lastAccessDistribution(rows) {
  const total = rows.length || 1;
  return ["0-7 dias", "8-30 dias", "31-90 dias", "Mais de 90 dias", "Sem acesso"].map((label) => {
    const count = rows.filter((row) => accessRangeLabel(row.daysSinceLastAccess) === label).length;
    return { label, count, percent: Math.round((count / total) * 1000) / 10 };
  }).filter((item) => item.count > 0);
}

function monthlyLoginDistribution(rows) {
  const total = rows.length || 1;
  return ["Sem login", "Até 1/mês", "1-3/mês", "4-7/mês", "8+/mês"].map((label) => {
    const count = rows.filter((row) => monthlyLoginRangeLabel(row.loginsPerMonth) === label).length;
    return { label, count, percent: Math.round((count / total) * 1000) / 10 };
  }).filter((item) => item.count > 0);
}

function sourceDistribution(rows) {
  const total = rows.length || 1;
  const counts = new Map();
  for (const row of rows) {
    const label = row.source || "App Pharus";
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({
    label,
    count,
    percent: Math.round((count / total) * 1000) / 10,
  }));
}

function coverageNote(summary) {
  const users = summary.totalUsers;
  const events = summary.eventsLoaded;
  const eligible = summary.appPharusLoginEvents ?? summary.eventReconciliation?.eligibleEvents;
  if (users == null) return "";
  const parts = [`${fmt.format(users)} usuários com registro de acesso`];
  if (Number.isFinite(eligible) && Number.isFinite(events) && eligible !== events) {
    parts.push(`${fmt.format(eligible)} de ${fmt.format(events)} eventos elegíveis`);
  } else if (Number.isFinite(events)) {
    parts.push(`${fmt.format(events)} eventos carregados`);
  }
  const sample = summary.daysSinceLastAccessSample;
  if (Number.isFinite(sample)) parts.push(`amostra mediana: ${fmt.format(sample)} usuários`);
  return parts.join(" · ");
}

function reconciliationNote(summary) {
  const rec = summary.eventReconciliation;
  if (!rec || rec.excludedTotal <= 0) return "";
  const bits = [];
  if (rec.excludedCorporateEmail) bits.push(`${fmt.format(rec.excludedCorporateEmail)} corporativos`);
  if (rec.excludedDemoEmail) bits.push(`${fmt.format(rec.excludedDemoEmail)} demo`);
  if (rec.excludedMissingUserId) bits.push(`${fmt.format(rec.excludedMissingUserId)} sem user_id`);
  if (rec.excludedInvalidTimestamp) bits.push(`${fmt.format(rec.excludedInvalidTimestamp)} timestamp inválido`);
  if (rec.excludedFutureTimestamp) bits.push(`${fmt.format(rec.excludedFutureTimestamp)} timestamp futuro`);
  if (rec.excludedInvalidEventName) bits.push(`${fmt.format(rec.excludedInvalidEventName)} event_name fora da lista`);
  if (!bits.length) return "";
  return `${fmt.format(rec.excludedTotal)} eventos excluídos na agregação (${bits.join(", ")}).`;
}

function renderCharts(rows) {
  const loginHost = $("puChartLogin");
  if (loginHost) loginHost.innerHTML = donut(loginDistribution(rows));

  const lastChart = hBarsExpandable(lastAccessDistribution(rows), "puChartLast", {
    limit: 8,
    expanded: state.chartExpanded.lastAccess,
  });
  const lastHost = $("puChartLast");
  if (lastHost) lastHost.innerHTML = lastChart.html;
  const lastToggle = $("puChartLastToggle");
  if (lastToggle) lastToggle.innerHTML = lastChart.buttonHtml;

  const monthlyChart = hBarsExpandable(monthlyLoginDistribution(rows), "puChartMonthly", {
    limit: 8,
    expanded: state.chartExpanded.monthly,
  });
  const monthlyHost = $("puChartMonthly");
  if (monthlyHost) monthlyHost.innerHTML = monthlyChart.html;
  const monthlyToggle = $("puChartMonthlyToggle");
  if (monthlyToggle) monthlyToggle.innerHTML = monthlyChart.buttonHtml;

  const sourceHost = $("puChartSources");
  if (sourceHost) sourceHost.innerHTML = hBarsExpandable(sourceDistribution(rows), "puChartSources", { limit: 8, expanded: true }).html;
}

function renderSuccess() {
  const content = $("page-content");
  if (!content) return;
  if (state.payload?.available === false || state.payload?.status === "unavailable") {
    content.innerHTML = `
      <section class="section-block">
        <h2>Uso da plataforma — App Pharus</h2>
        <p class="page-unavailable">${escapeHtml(state.payload?.message || "Fonte ainda não disponível para leitura.")}</p>
      </section>`;
    return;
  }

  const connected = isConnected();
  const summary = primarySummary();
  const rows = filteredRows();
  const filtersActive = !filtersMatchDefault(state.filters);
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const timing = state.payload?.sources?.timing || {};
  const reconNote = reconciliationNote(summary);

  content.innerHTML = `
    ${state.error && !connected ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <section class="section-block">
      <h2>Uso da plataforma — App Pharus</h2>
      <p class="section-lead">Acesso, recência e frequência de login. Fonte: analytics.platform_login_events.</p>
      ${connected ? `<p class="section-meta">${escapeHtml(coverageNote(summary))}</p>` : ""}
      ${connected && reconNote ? `<p class="section-meta section-meta--muted">${escapeHtml(reconNote)}</p>` : ""}
      ${filtersActive ? `<p class="section-meta section-meta--muted">Tabela e gráficos refletem os filtros ativos (${fmt.format(rows.length)} de ${fmt.format(state.payload?.clients?.length || 0)} usuários).</p>` : ""}
      <div class="kpi-row kpi-row-primary">
        ${kpiCard(summary.usersLabel || "Usuários App Pharus", connected ? kpiValue(summary.totalUsers) : "—", connected ? coverageNote(summary) : "")}
        ${kpiCard("Realizaram login", connected ? kpiValue(summary.usersWithLogin) : "—", connected ? `${pctLabel(summary.loginCoverage)} da base App Pharus` : "")}
        ${kpiCard("Número total de logins", connected ? kpiValue(summary.totalLogins) : "—", connected && summary.appPharusLoginEvents != null ? `${fmt.format(summary.appPharusLoginEvents)} eventos elegíveis` : "")}
        ${kpiCard("Média de logins por mês", connected ? kpiValue(summary.averageLoginsPerMonth) : "—", connected ? "Por usuário desde o primeiro acesso" : "")}
        ${kpiCard("Dias desde o último acesso", connected ? daysLabel(summary.typicalDaysSinceLastAccess) : "—", connected && summary.daysSinceLastAccessSample != null ? `Mediana · amostra ${fmt.format(summary.daysSinceLastAccessSample)} usuários` : "")}
        ${kpiCard("Tempo médio entre acessos", connected ? daysLabel(summary.averageDaysBetweenAccesses) : "—", connected ? "Mediana · dias distintos com login" : "")}
        ${kpiCard("Tempo médio de sessão", "Sem Dados", connected ? "Sem base confiável na view atual" : "")}
      </div>
      ${connected && timing.fetchMs != null ? `<p class="section-meta section-meta--muted">Carregamento: ${fmt.format(timing.restRequests || 0)} requests · ${fmt.format(Math.round(timing.fetchMs))} ms</p>` : ""}
    </section>
    <section class="section-block">
      <h3 class="section-subtitle">Distribuições de acesso</h3>
      <div class="chart-grid chart-grid--compact">
        <article class="chart-card">
          <div class="chart-card-head"><div><h3>Realizou login</h3><p>Usuários com histórico de acesso</p></div></div>
          <div class="chart-card-body" id="puChartLogin"></div>
        </article>
        <article class="chart-card chart-card--expandable">
          <div class="chart-card-head"><div><h3>Dias desde o último acesso</h3><p>Faixas de recência</p></div><span id="puChartLastToggle"></span></div>
          <div class="chart-card-body" id="puChartLast"></div>
        </article>
        <article class="chart-card chart-card--expandable">
          <div class="chart-card-head"><div><h3>Logins por mês</h3><p>Distribuição média por usuário</p></div><span id="puChartMonthlyToggle"></span></div>
          <div class="chart-card-body" id="puChartMonthly"></div>
        </article>
        <article class="chart-card">
          <div class="chart-card-head"><div><h3>Fonte dos dados</h3><p>Disponibilidade por banco</p></div></div>
          <div class="chart-card-body" id="puChartSources"></div>
        </article>
      </div>
    </section>
    <section class="section-block">
      <div class="chart-grid chart-grid--compact">
        <article class="chart-card">
          <h3>Indicadores de viabilidade</h3>
          <ul class="indicator-list">${(state.payload?.indicators || []).slice(0, 8).map((i) => `<li><strong>${escapeHtml(i.indicator)}</strong> — ${escapeHtml(i.metric || "")}</li>`).join("")}</ul>
        </article>
      </div>
    </section>
    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Detalhamento por usuário</h2>
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
              <th data-sort="averageDaysBetweenAccesses" class="num">Tempo entre acessos</th>
              <th data-sort="weeklyAccessFrequency" class="num">Freq. semanal</th>
              <th data-sort="monthlyAccessFrequency" class="num">Freq. mensal</th>
              <th data-sort="lastAccessAt">Último acesso</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows.length ? pageRows.map((r) => `<tr>
              <td>${escapeHtml(r.userName)}</td>
              <td>${escapeHtml(r.email)}</td>
              <td>${r.realizedLogin ? "Sim" : "Não"}</td>
              <td class="num">${fmt.format(r.totalLogins || 0)}</td>
              <td class="num">${r.loginsPerMonth != null ? fmt.format(r.loginsPerMonth) : "—"}</td>
              <td class="num">${r.daysSinceLastAccess != null ? fmt.format(r.daysSinceLastAccess) : "—"}</td>
              <td class="num">${r.averageDaysBetweenAccesses != null ? fmt.format(Math.round(r.averageDaysBetweenAccesses)) : "—"}</td>
              <td class="num">${r.weeklyAccessFrequency != null ? fmt.format(r.weeklyAccessFrequency) : "—"}</td>
              <td class="num">${r.monthlyAccessFrequency != null ? fmt.format(r.monthlyAccessFrequency) : "—"}</td>
              <td>${dateLabel(r.lastAccessAt)}</td>
            </tr>`).join("") : `<tr><td colspan="10" class="table-empty">Nenhum usuário encontrado para os filtros selecionados.</td></tr>`}
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
    if (isConnected()) {
      ensurePageRefresh().markSuccess(state.payload?.generatedAt ? new Date(state.payload.generatedAt) : new Date());
    } else {
      ensurePageRefresh().render();
    }
  } catch (error) {
    const mapped = mapLoadError(error);
    if (mapped.stale) return mapped;
    state.errorCode = mapped.errorCode;
    state.error = pharusLoadErrorMessage(error);
    if (force && state.payload && isConnected()) {
      ensurePageRefresh().markSuccess(state.payload?.generatedAt ? new Date(state.payload.generatedAt) : new Date());
    } else if (force && state.payload) {
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
