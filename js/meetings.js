import { authenticatedFetch } from "./auth.mjs";
import { onPageChange, getCurrentPageId } from "./navigation.js";
import { analyticalStatusDisplayLabel } from "../lib/analytics/analytical-cancellation.mjs";
import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTER_OPTIONS,
  applyMeetingFilters,
  defaultMeetingFilters,
  meetingTypeEventInPeriod,
  resolveMeetingPeriod,
} from "../lib/analytics/meeting-filters.mjs";
import { buildMeetingTypeDistributions } from "../lib/analytics/meeting-event-type.mjs";
import {
  FREQ_BANDS,
  distributionsFromMeetingRows,
  recencySecondaryNote,
  resolveMeetingsViewKind,
  summarizeMeetingRows,
} from "../lib/analytics/meeting-metrics.mjs";
import { donut, dualColumns, escapeHtml, hBars } from "./general-charts.mjs";
import { mergePeriodApply } from "../lib/analytics/filters/filter-state.mjs";
import { debounce } from "../lib/analytics/filters/search.mjs";
import { resolvePeriod } from "../lib/analytics/filters/period.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { bindTableExport, renderTableToolbar } from "./components/filters/filter-bar.js";
import { bindDateRangePicker, renderDateRangePicker } from "./components/filters/date-range-picker.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { exportFilteredTable } from "./utils/page-table-export.js";
import { fetchPageJson, mapLoadError } from "./utils/page-load.js";

const PERIOD_FIELD = { kind: "period", id: "mPeriod", fromId: "mFrom", toId: "mTo" };

const fmt = new Intl.NumberFormat("pt-BR");
const RESCHEDULE_NOTE =
  "Cobertura parcial: considera apenas remarcações registradas de forma estruturada e pode não representar o total real.";

const state = {
  mounted: false,
  payload: null,
  loading: false,
  error: null,
  errorCode: null,
  filters: defaultMeetingFilters(),
  sortKey: "totalMeetings",
  sortDir: "desc",
  page: 1,
  pageSize: 25,
  monthRange: 6,
  showAllEngineers: false,
  showAllTypes: false,
  typeMode: "family",
  selectedId: null,
  detailById: {},
};

let eventsBound = false;
let unbindPeriodPicker = () => {};
let unbindFilterEvents = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

function $(id) {
  return document.getElementById(id);
}

function dateBR(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function pct(value) {
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

function firstBadge(value) {
  if (value === true) return `<span class="badge badge-active">Realizou</span>`;
  if (value === false) return `<span class="badge badge-cancelled">Não realizou</span>`;
  return `<span class="badge badge-muted">Não informado</span>`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function filtersFromForm() {
  return {
    search: $("mSearch")?.value || "",
    status: $("mStatusFilter")?.value || DEFAULT_STATUS_FILTER,
    engineer: $("mEngineer")?.value || "all",
    program: normalizeProgramFilter($("mProgram")?.value || "all"),
    period: $("mPeriod")?.value || "all",
    from: $("mFrom")?.value || "",
    to: $("mTo")?.value || "",
    attendance: $("mAttendance")?.value || "all",
    freq: $("mFreq")?.value || "all",
    first: $("mFirst")?.value || "all",
    absence: $("mAbsence")?.value || "all",
    reschedule: $("mReschedule")?.value || "all",
  };
}

function filteredRows() {
  return applyMeetingFilters(state.payload?.clients || [], state.filters, {
    sortKey: state.sortKey,
    sortDir: state.sortDir,
  });
}

function fillSelect(select, values, allLabel, current) {
  if (!select) return;
  const keep = current ?? select.value ?? "all";
  select.innerHTML =
    `<option value="all">${escapeHtml(allLabel)}</option>` +
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  select.value = [...select.options].some((o) => o.value === keep) ? keep : "all";
}

function populateFilterOptions() {
  const clients = state.payload?.clients || [];
  fillSelect($("mEngineer"), uniqueSorted(clients.map((c) => c.engineer)), "Todos", state.filters.engineer);
  fillSelect($("mProgram"), programSelectOptions(clients), "Todos", state.filters.program);
  fillSelect($("mFreq"), FREQ_BANDS, "Todas", state.filters.freq);
}

function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.featured) classes.push("kpi-card-featured");
  if (options.highlight) classes.push("kpi-card-highlight");
  if (options.compact) classes.push("kpi-card-compact");
  const methodology = options.methodology
    ? `<button type="button" class="kpi-methodology" title="${escapeHtml(options.methodology)}" aria-label="Metodologia: ${escapeHtml(label)}">?</button>`
    : "";
  return `<article class="${classes.join(" ")}">
    <div class="kpi-label">${escapeHtml(label)}${methodology}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-note">${escapeHtml(note || "")}</div>
  </article>`;
}

function renderDrawer(client, options = {}) {
  document.getElementById("mDrawer")?.remove();
  if (!client) {
    state.selectedId = null;
    return;
  }
  state.selectedId = client.clientId;
  const historyState = options.historyState || "success";
  let history = `<div class="timeline-item">Sem histórico de reuniões</div>`;
  if (historyState === "loading") {
    history = `<div class="timeline-item">Carregando histórico…</div>`;
  } else if (historyState === "error") {
    history = `<div class="timeline-item">${escapeHtml(options.historyError || "Não foi possível carregar o histórico.")}<div style="margin-top:8px"><button class="btn btn-secondary" type="button" data-drawer-retry>Tentar novamente</button></div></div>`;
  } else if ((client.meetings || []).length) {
    history = (client.meetings || [])
      .slice()
      .reverse()
      .map((m) => {
        const statusLabel =
          m.attendanceStatus === "compareceu"
            ? "Compareceu"
            : m.attendanceStatus === "nao_compareceu"
              ? "Não compareceu"
              : m.attendanceStatus === "cancelada"
                ? "Cancelada"
                : "Sem confirmação";
        const dateFlag =
          m.meetingDateStatus === "before_client_entry"
            ? " · Antes da entrada"
            : m.meetingDateStatus === "future"
              ? " · Futura"
              : "";
        return `<div class="timeline-item">
        <strong>${escapeHtml(m.title || "Reunião")}</strong>
        <div class="meta">${dateBR(m.startTime)} · ${escapeHtml(m.source || "")} · ${statusLabel}${m.rescheduled ? " · Remarcada" : ""}${dateFlag}</div>
      </div>`;
      })
      .join("");
  }

  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  backdrop.id = "mDrawer";
  backdrop.innerHTML = `<aside class="drawer" role="dialog" aria-labelledby="mDrawerTitle">
    <header>
      <p class="eyebrow">Cliente</p>
      <h2 id="mDrawerTitle">${escapeHtml(client.clientName)}</h2>
      <p class="text-muted">Código ${escapeHtml(client.clientCode || "Não informado")} · ID ${escapeHtml(client.clientId)}</p>
    </header>
    <dl>
      <div><dt>Status</dt><dd>${statusBadge(client.analyticalStatus)}</dd></div>
      <div><dt>EP</dt><dd>${escapeHtml(client.engineer || "—")}</dd></div>
      <div><dt>Total de reuniões</dt><dd>${fmt.format(client.totalMeetings || 0)}</dd></div>
      <div><dt>Média por mês</dt><dd>${client.meetingsPerMonth == null ? "—" : fmt.format(client.meetingsPerMonth)}</dd></div>
      <div><dt>Última reunião</dt><dd>${dateBR(client.lastMeetingDate)}</dd></div>
      <div><dt>Dias sem reunião</dt><dd>${client.daysSinceLastMeeting == null ? "—" : fmt.format(client.daysSinceLastMeeting)}</dd></div>
      <div><dt>Intervalo médio</dt><dd>${client.averageIntervalDays == null ? "—" : `${fmt.format(Math.round(client.averageIntervalDays))} d`}</dd></div>
      <div><dt>Faltas</dt><dd>${fmt.format(client.absences || 0)}</dd></div>
      <div><dt>Remarcações</dt><dd>${fmt.format(client.reschedules || 0)}</dd></div>
      <div><dt>Primeira reunião</dt><dd>${client.firstMeetingCompleted === true ? "Realizou" : client.firstMeetingCompleted === false ? "Não realizou" : "—"}</dd></div>
      <div><dt>Data da primeira</dt><dd>${dateBR(client.firstMeetingDate)}</dd></div>
      <div><dt>Dias até a primeira</dt><dd>${client.daysFromEntryToFirstMeeting == null ? "—" : fmt.format(client.daysFromEntryToFirstMeeting)}</dd></div>
    </dl>
    <h3>Histórico</h3>
    <div class="timeline">${history}</div>
    <button type="button" class="btn btn-secondary" data-drawer-close>Fechar</button>
  </aside>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (event) => {
    if (event.target.closest("[data-drawer-retry]")) {
      event.preventDefault();
      void openDrawer(client);
      return;
    }
    if (event.target === backdrop || event.target.closest("[data-drawer-close]")) renderDrawer(null);
  });
}

async function openDrawer(client) {
  if (!client?.clientId) return;
  const summary = { ...client };
  delete summary.meetings;
  const cached = state.detailById[client.clientId];
  if (cached) {
    renderDrawer({ ...summary, meetings: cached }, { historyState: "success" });
    return;
  }
  renderDrawer(summary, { historyState: "loading" });
  try {
    const response = await authenticatedFetch(`/api/meetings?client_id=${encodeURIComponent(client.clientId)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(payload.error || "Não foi possível carregar o histórico.");
      err.code = payload.code || String(response.status);
      throw err;
    }
    const meetings = payload.client?.meetings || [];
    state.detailById[client.clientId] = meetings;
    if (state.selectedId === client.clientId) {
      renderDrawer({ ...summary, meetings }, { historyState: "success" });
    }
  } catch (error) {
    if (state.selectedId !== client.clientId) return;
    renderDrawer(summary, {
      historyState: "error",
      historyError: error?.message || "Não foi possível carregar o histórico.",
    });
  }
}

function typesForChart(period) {
  const src = state.payload?.meetingTypes;
  const events = Array.isArray(src?.events) ? src.events : [];
  if (!src?.available) return { available: false, list: [], totalEvents: 0 };
  const mode = state.typeMode === "raw" ? "raw" : "family";
  const typeLimit = mode === "raw" ? 10 : 8;
  const mapEvent = (e) => ({
    title: e.rawEventType || e.title,
    rawEventType: e.rawEventType || e.title,
    startTime: e.startTime,
    canceled: e.canceled === true,
    attendanceStatus: e.canceled === true || e.attendanceStatus === "cancelada" ? "cancelada" : "desconhecido",
  });

  if (!period.active) {
    const preagg = mode === "raw" ? src.byRaw : src.byFamily;
    if (Array.isArray(preagg) && preagg.length) {
      const list = state.showAllTypes ? preagg : preagg.slice(0, typeLimit);
      const totalEvents = preagg.reduce((sum, row) => sum + (row.count || 0), 0);
      return { available: true, list, totalEvents };
    }
  }

  const scoped = period.active ? events.filter((e) => meetingTypeEventInPeriod(e, period)) : events;
  const dist = buildMeetingTypeDistributions(scoped.map(mapEvent));
  return {
    available: true,
    list: mode === "raw" ? dist.byRaw : dist.byFamily,
    totalEvents: scoped.length,
  };
}

function renderSuccess() {
  const rows = filteredRows();
  const period = resolveMeetingPeriod(state.filters);
  const summary = summarizeMeetingRows(rows, {
    periodActive: period.active,
    periodDivisor: period.divisor,
  });
  const dist = distributionsFromMeetingRows(rows);
  const content = $("page-content");
  if (!content) return;

  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const scopeNote = period.active
    ? "Período selecionado · população filtrada"
    : "População filtrada";
  const totalMeetingsNote =
    "Base QV + reuniões manuais exclusivas. Reuniões anteriores à entrada e duplicadas são desconsideradas.";
  const totalMeetingsMethodology =
    "Total de reuniões registradas na BASE QV para os clientes do recorte. Reuniões manuais só são acrescentadas quando não possuem correspondência em client_meetings. Registros anteriores à entrada do cliente são excluídos.";
  const attendanceText = summary.attendanceInsufficientData || summary.attendanceRate == null
    ? "Dados insuficientes"
    : pct(summary.attendanceRate);
  const types = typesForChart(period);
  const typeLimit = state.typeMode === "raw" ? 10 : 8;
  const typeList = state.showAllTypes ? types.list : types.list.slice(0, typeLimit);

  content.innerHTML = `
    ${state.error ? `<p class="page-inline-error">${escapeHtml(state.error)}</p>` : ""}
    <section class="section-block">
      <h2>Visão do relacionamento</h2>
      <p>Indicadores da população filtrada. O padrão da página é clientes ativos.</p>
      <div class="kpi-row">
        ${kpiCard("Total de reuniões", fmt.format(summary.totalMeetings), totalMeetingsNote, {
          methodology: totalMeetingsMethodology,
        })}
        ${kpiCard("Clientes com reunião", fmt.format(summary.clientsWithMeeting), `${fmt.format(summary.filteredClients)} no recorte`, { featured: true })}
        ${kpiCard("Clientes sem nenhuma reunião", fmt.format(summary.clientsWithoutMeeting), "Clientes do recorte sem reunião válida")}
      </div>
      <div class="kpi-row kpi-row-secondary">
        ${kpiCard(
          "Dias desde a última reunião",
          summary.daysSinceLatestMeeting == null ? "—" : `${fmt.format(Math.round(summary.daysSinceLatestMeeting))} dias`,
          [
            recencySecondaryNote(summary.latestMeetingDate, summary.daysSinceLatestMeeting, dateBR),
            summary.typicalDaysSinceLastMeeting == null
              ? null
              : `Mediana ${fmt.format(Math.round(summary.typicalDaysSinceLastMeeting))} dias`,
            summary.averageDaysSinceLastMeeting == null
              ? null
              : `Média ${fmt.format(Math.round(summary.averageDaysSinceLastMeeting))} dias`,
          ]
            .filter(Boolean)
            .join(" · "),
          { featured: true },
        )}
        ${kpiCard("Intervalo médio entre reuniões", summary.averageIntervalDays == null ? "—" : `${fmt.format(Math.round(summary.averageIntervalDays))} d`, `Média entre reuniões com presença · mediana ${summary.typicalIntervalDays == null ? "—" : fmt.format(Math.round(summary.typicalIntervalDays))} d`)}
        ${kpiCard("Média de reuniões/mês", summary.averageMeetingsPerMonth == null ? "—" : fmt.format(summary.averageMeetingsPerMonth), period.active ? "Divisor do período" : "Histórico do recorte")}
      </div>
    </section>

    <section class="section-block">
      <h2>Comparecimento</h2>
      <p>No-show não inclui reunião cancelada nem reunião futura. Elegíveis = total − futuras − canceladas.</p>
      <div class="kpi-row">
        ${kpiCard("Taxa de comparecimento", attendanceText, summary.attendanceInsufficientData ? "Sem reuniões elegíveis no recorte" : `No-show ${pct(summary.noShowRate)} · elegíveis ${fmt.format(summary.eligibleMeetings)}`, { featured: true, highlight: true })}
        ${kpiCard("No-shows", fmt.format(summary.totalNoShows), `${fmt.format(summary.noShowsEligible)} no denominador elegível`, { featured: true })}
        ${kpiCard("Remarcações", fmt.format(summary.totalReschedules), RESCHEDULE_NOTE)}
      </div>
      <div class="chart-grid">
        <article class="chart-card"><h3>Status de presença</h3><p>Compareceu, no-show, cancelada ou sem confirmação</p><div id="mChartStatus"></div></article>
        <article class="chart-card"><h3>Frequência de no-show</h3><p>Clientes do recorte por quantidade de faltas</p><div id="mChartNoShowFreq"></div></article>
      </div>
    </section>

    <section class="section-block">
      <h2>Cobertura e cadência</h2>
      <p>Frequência, recência e intervalo usam a mesma população filtrada como denominador.</p>
      <div class="chart-grid">
        <article class="chart-card"><h3>Frequência</h3><p>Reuniões válidas por cliente</p><div id="mChartFreq"></div></article>
        <article class="chart-card"><h3>Dias desde a última reunião</h3><p>Dias desde a última reunião válida</p><div id="mChartDays"></div></article>
        <article class="chart-card"><h3>Intervalo médio entre reuniões</h3><p>Faixas do intervalo médio entre presenças confirmadas</p><div id="mChartInterval"></div></article>
        <article class="chart-card"><h3>Reuniões por Engenheiro Patrimonial</h3><p>Reuniões do recorte por EP</p><div id="mChartEngineers"></div><button class="btn btn-secondary btn-chart" type="button" id="mToggleEngineers">${state.showAllEngineers ? "Ver principais" : "Ver todos"}</button></article>
      </div>
    </section>

    <section class="section-block">
      <div class="acq-head">
        <div>
          <h2>Evolução</h2>
          <p>Reuniões agendadas e realizadas por mês, no recorte atual. Meses futuros não entram.</p>
        </div>
        <div class="seg" id="mMonthRangeSeg" role="group" aria-label="Período mensal">
          <button type="button" data-month-range="6">6 meses</button>
          <button type="button" data-month-range="12">12 meses</button>
        </div>
      </div>
      <p class="text-muted" id="mMonthCount"></p>
      <div class="chart-card"><div id="mChartMonths"></div></div>
    </section>

    <section class="section-block">
      <h2>Perfil</h2>
      <p>Tipos vêm exclusivamente do Calendly (Business Data) e respeitam apenas o filtro de período quando ativo.</p>
      <div class="chart-grid">
        <article class="chart-card">
          <div class="chart-title-row">
            <h3>Reuniões por tipo</h3>
            <span class="chart-source-note">Fonte: Calendly</span>
          </div>
          <p>${period.active ? "Período aplicado aos eventos Calendly" : "Todos os eventos Calendly, inclusive futuros e cancelados. Comercial excluído."}</p>
          <div class="seg" id="mTypeModeSeg" role="group" aria-label="Agrupamento por categoria">
            <button type="button" data-type-mode="family">Categoria</button>
            <button type="button" data-type-mode="raw">Nome original</button>
          </div>
          <div id="mChartTypes"></div>
          <button class="btn btn-secondary btn-chart" type="button" id="mToggleTypes" ${types.list.length <= typeLimit ? "hidden" : ""}>${state.showAllTypes ? "Ver menos" : "Ver todos"}</button>
        </article>
      </div>
    </section>

    <section class="table-panel">
      <div class="table-panel-head">
        <div>
          <h2>Detalhamento</h2>
          ${renderTableToolbar({
            countLabel: `${fmt.format(rows.length)} registros encontrados`,
            exportPrefix: "meetings",
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
              <th data-sort="totalMeetings">Reuniões</th>
              <th data-sort="meetingsPerMonth">Média/mês</th>
              <th data-sort="lastMeetingDate">Última</th>
              <th data-sort="daysSinceLastMeeting">Dias sem reunião</th>
              <th data-sort="averageIntervalDays">Intervalo</th>
              <th data-sort="absences">No-shows</th>
              <th data-sort="reschedules">Remarcações</th>
              <th data-sort="firstMeetingCompleted">Primeira</th>
            </tr>
          </thead>
          <tbody id="mRows"></tbody>
        </table>
      </div>
      <div class="pagination">
        <div>Página ${state.page} de ${pages}</div>
        <div>
          <button class="btn btn-secondary" type="button" id="mPrev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
          <button class="btn btn-secondary" type="button" id="mNext" ${state.page >= pages ? "disabled" : ""}>Próxima</button>
        </div>
      </div>
    </section>
  `;

  if ($("mChartStatus")) $("mChartStatus").innerHTML = donut(dist.attendanceStatus || []);
  if ($("mChartFreq")) $("mChartFreq").innerHTML = hBars(dist.meetingFrequency || []);
  if ($("mChartDays")) $("mChartDays").innerHTML = hBars(dist.daysSinceLastMeeting || []);
  if ($("mChartInterval")) $("mChartInterval").innerHTML = hBars(dist.intervalRanges || []);
  if ($("mChartEngineers")) $("mChartEngineers").innerHTML = hBars(dist.meetingsByEngineer || [], state.showAllEngineers ? null : 8);
  if ($("mChartNoShowFreq")) {
    $("mChartNoShowFreq").innerHTML = hBars(
      (dist.noShowFrequency || []).map((b) => ({
        label: b.label,
        count: b.clients,
        percent: b.percentage,
      })),
    );
  }
  const monthSeries = dist.meetingsByMonth || [];
  if ($("mChartMonths")) $("mChartMonths").innerHTML = dualColumns(monthSeries, state.monthRange);
  const shown = Math.min(monthSeries.length, state.monthRange);
  if ($("mMonthCount")) {
    $("mMonthCount").textContent = shown
      ? `Exibindo ${shown} ${shown === 1 ? "mês" : "meses"} mais recentes`
      : "Sem meses históricos";
  }
  document.querySelectorAll("#mMonthRangeSeg [data-month-range]").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.monthRange) === Number(state.monthRange));
  });
  document.querySelectorAll("#mTypeModeSeg [data-type-mode]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.typeMode === state.typeMode);
  });
  if ($("mChartTypes")) {
    $("mChartTypes").innerHTML = types.available
      ? hBars(typeList)
      : `<p class="placeholder-note">Tipos de reunião indisponíveis no Calendly.</p>`;
  }

  const tbody = $("mRows");
  if (!tbody) return;
  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="12">Nenhum cliente encontrado para os filtros selecionados.</td></tr>`;
  } else {
    tbody.innerHTML = pageRows
      .map(
        (c) => `<tr data-id="${escapeHtml(c.clientId)}">
        <td class="truncate" title="${escapeHtml(c.clientName)}">${escapeHtml(c.clientName)}</td>
        <td>${escapeHtml(c.clientCode || "Não informado")}</td>
        <td class="truncate" title="${escapeHtml(c.engineer)}">${escapeHtml(c.engineer)}</td>
        <td>${statusBadge(c.analyticalStatus)}</td>
        <td class="num">${fmt.format(c.totalMeetings || 0)}</td>
        <td class="num">${c.meetingsPerMonth == null ? "—" : fmt.format(c.meetingsPerMonth)}</td>
        <td>${dateBR(c.lastMeetingDate)}</td>
        <td class="num">${c.daysSinceLastMeeting == null ? "—" : fmt.format(c.daysSinceLastMeeting)}</td>
        <td class="num">${c.averageIntervalDays == null ? "—" : `${fmt.format(Math.round(c.averageIntervalDays))} d`}</td>
        <td class="num">${fmt.format(c.absences || 0)}</td>
        <td class="num">${fmt.format(c.reschedules || 0)}</td>
        <td>${firstBadge(c.firstMeetingCompleted)}</td>
      </tr>`,
      )
      .join("");
  }

  bindContentEvents(rows);
}

function bindContentEvents(rows) {
  $("mToggleEngineers")?.addEventListener("click", () => {
    state.showAllEngineers = !state.showAllEngineers;
    renderSuccess();
  });
  $("mToggleTypes")?.addEventListener("click", () => {
    state.showAllTypes = !state.showAllTypes;
    renderSuccess();
  });
  $("mPrev")?.addEventListener("click", () => {
    state.page -= 1;
    renderSuccess();
  });
  $("mNext")?.addEventListener("click", () => {
    state.page += 1;
    renderSuccess();
  });
  document.querySelectorAll("#mMonthRangeSeg [data-month-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.monthRange = Number(btn.dataset.monthRange) || 6;
      renderSuccess();
    });
  });
  document.querySelectorAll("#mTypeModeSeg [data-type-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.typeMode = btn.dataset.typeMode === "raw" ? "raw" : "family";
      state.showAllTypes = false;
      renderSuccess();
    });
  });
  document.querySelectorAll(".gd-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDir = "desc";
      }
      renderSuccess();
    });
  });
  $("mRows")?.addEventListener("click", (event) => {
    const tr = event.target.closest("tr[data-id]");
    if (!tr) return;
    const client = rows.find((c) => c.clientId === tr.dataset.id);
    if (client) void openDrawer(client);
  });
  bindTableExport($("page-content"), (format) => {
    exportFilteredTable({
      pageId: "meetings",
      rows,
      filters: state.filters,
      format,
      extraFilterLabels: {
        Presença: state.filters.attendance,
        Frequência: state.filters.freq,
        "Primeira reunião": state.filters.first,
        "No-show": state.filters.absence,
        Remarcação: state.filters.reschedule,
      },
    });
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  const statusOptions = STATUS_FILTER_OPTIONS.map(
    (o) => `<option value="${escapeHtml(o.value)}"${o.value === state.filters.status ? " selected" : ""}>${escapeHtml(o.label)}</option>`,
  ).join("");
  const period = resolvePeriod(state.filters);
  unbindPeriodPicker();
  unbindFilterMount();
  const innerHtml = `
    <div class="filter-bar">
      <label class="filter-search">Busca<input id="mSearch" type="search" placeholder="Nome, código ou ID" value="${escapeHtml(state.filters.search)}" /></label>
      <label>Status<select id="mStatusFilter">${statusOptions}</select></label>
      <label>EP<select id="mEngineer"><option value="all">Todos</option></select></label>
      <label>Programa<select id="mProgram"><option value="all">Todos</option></select></label>
      ${renderDateRangePicker({ field: PERIOD_FIELD, filters: state.filters, label: "Período" })}
      <label>Presença<select id="mAttendance">
        <option value="all">Todas</option>
        <option value="compareceu">Compareceu</option>
        <option value="nao_compareceu">No-show</option>
        <option value="cancelada">Cancelada</option>
        <option value="desconhecido">Sem confirmação</option>
      </select></label>
      <label>Frequência<select id="mFreq"><option value="all">Todas</option></select></label>
      <label>Primeira reunião<select id="mFirst">
        <option value="all">Todas</option>
        <option value="yes">Realizou</option>
        <option value="no">Não realizou</option>
      </select></label>
      <label>Falta / no-show<select id="mAbsence">
        <option value="all">Todos</option>
        <option value="yes">Com falta</option>
        <option value="no">Sem falta</option>
      </select></label>
      <label>Reagendamento<select id="mReschedule">
        <option value="all">Todos</option>
        <option value="yes">Com remarcação</option>
        <option value="no">Sem remarcação</option>
      </select></label>
      <div class="filter-actions">
        <button class="btn btn-secondary" type="button" id="mClear">Limpar</button>
      </div>
    </div>
    ${period.invalid ? `<p class="filter-error">Selecione um intervalo válido. Datas futuras não são permitidas.</p>` : ""}
    <p class="filter-semantics">Período usa a data da reunião (start_time). Reuniões por tipo (Calendly) respeitam só o período.</p>
  `;
  unbindFilterMount = mountPageFilters({
    host,
    pageId: "meetings",
    innerHtml,
    onBodyReady: (body) => {
      $("mAttendance").value = state.filters.attendance;
      $("mFirst").value = state.filters.first;
      $("mAbsence").value = state.filters.absence;
      $("mReschedule").value = state.filters.reschedule;
      if (state.payload) populateFilterOptions();
      $("mProgram") && ($("mProgram").value = state.filters.program);
      unbindPeriodPicker = bindDateRangePicker({
        host: body,
        field: PERIOD_FIELD,
        filters: state.filters,
        onApply: onFilterChange,
      });
      return unbindPeriodPicker;
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
      <button class="btn btn-secondary" type="button" id="mRetry">Tentar novamente</button>
    </div>
  </div>`;
  $("mRetry")?.addEventListener("click", () => {
    void loadMeetings({ force: true });
  });
}

function renderStateView() {
  const content = $("page-content");
  if (!content) return;
  const kind = resolveMeetingsViewKind(state);
  if (kind === "unauthorized") {
    if (state.errorCode === "AUTH_FORBIDDEN" || state.errorCode === "invalid_domain") {
      renderErrorView("Acesso não autorizado", "O portal é restrito a contas @quartavia.com.br.");
      return;
    }
    renderErrorView("Sessão necessária", "Entre novamente com sua conta corporativa.");
    return;
  }
  if (kind === "error") {
    renderErrorView("Não foi possível carregar as reuniões.", state.error);
    return;
  }
  if (kind === "loading") {
    content.innerHTML = `<div class="gd-status" role="status"><strong>Carregando reuniões</strong><span>Consultando a BASE QV e o Calendly…</span></div>`;
    return;
  }
  if (kind === "empty") {
    content.innerHTML = `<div class="gd-status"><strong>Sem reuniões</strong><span>A consulta não retornou clientes para esta base.</span></div>`;
    return;
  }
  try {
    renderSuccess();
  } catch (error) {
    console.error("[Reuniões] render", error);
    renderErrorView(
      "Não foi possível carregar as reuniões.",
      error instanceof Error ? error.message : "Falha ao montar a página.",
    );
  }
}

function onFilterChange(periodApply) {
  state.filters = mergePeriodApply(filtersFromForm(), periodApply);
  state.page = 1;
  renderSuccess();
}

function bindFilterEvents() {
  unbindFilterEvents();
  const cleanups = [];
  ["mSearch", "mStatusFilter", "mEngineer", "mProgram", "mAttendance", "mFreq", "mFirst", "mAbsence", "mReschedule"]
    .forEach((id) => {
      const el = $(id);
      if (!el) return;
      const eventName = id === "mSearch" ? "input" : "change";
      const handler = id === "mSearch" ? debounce(onFilterChange, 300) : onFilterChange;
      el.addEventListener(eventName, handler);
      cleanups.push(() => {
        if (id === "mSearch") handler.cancel?.();
        el.removeEventListener(eventName, handler);
      });
    });
  const onClear = () => {
    state.filters = defaultMeetingFilters();
    state.page = 1;
    renderFilters();
    bindFilterEvents();
    renderSuccess();
  };
  $("mClear")?.addEventListener("click", onClear);
  cleanups.push(() => $("mClear")?.removeEventListener("click", onClear));
  unbindFilterEvents = () => cleanups.forEach((fn) => fn());
}

function ensurePageRefresh() {
  if (pageRefresh) return pageRefresh;
  pageRefresh = createPageRefresh({
    pageId: "meetings",
    buttonId: "mRefresh",
    csvButtonId: "mCsv",
    getExportContext: () => ({ payload: state.payload, filters: state.filters, loading: state.loading }),
    onRefresh: () => loadMeetings({ force: true }),
  });
  return pageRefresh;
}

function setActions(enabled) {
  ensurePageRefresh().setEnabled(enabled);
  ensurePageRefresh().render();
}

async function loadMeetings({ force = false } = {}) {
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
  if (force) {
    state.payload = null;
    state.detailById = {};
  }
  ensurePageRefresh().setLoading(true);
  renderFilters();
  bindFilterEvents();
  renderStateView();
  try {
    state.payload = await fetchPageJson("/api/meetings", { force });
    state.filters = {
      ...defaultMeetingFilters(),
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
      bindFilterEvents();
      renderStateView();
    }
  }
}

function unmountMeetings() {
  renderDrawer(null);
  state.mounted = false;
}

function mountMeetings() {
  state.mounted = true;
  setActions(false);
  void loadMeetings();
}

export function bootMeetings() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "meetings") mountMeetings();
    else if (state.mounted) unmountMeetings();
  });
  if (getCurrentPageId() === "meetings") mountMeetings();
}
