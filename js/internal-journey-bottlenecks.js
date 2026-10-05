import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  defaultInternalJourneyBottlenecksFilters,
  internalJourneyBottlenecksFiltersToSearchParams,
  normalizeInternalJourneyBottlenecksFilters,
} from "../lib/analytics/internal-journey-bottlenecks-filters.mjs";
import {
  epWithoutMeetingAlert,
  formatEpWithoutMeetingCellTooltip,
  resolveEpWithoutMeetingFields,
} from "../lib/analytics/internal-journey-bottlenecks-ep-fields.mjs";
import {
  expectedAttentionClientsTotal,
  resolveAttentionClientsAll,
} from "../lib/analytics/internal-journey-bottlenecks-attention.mjs";
import { programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { STATUS_FILTER_OPTIONS } from "../lib/analytics/general-filters.mjs";
import { sortLabelsUnknownLast } from "../lib/analytics/filters/sort-categories.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError, clearPageCache } from "./utils/page-load.js";
import { escapeHtml } from "./general-charts.mjs";
import {
  bindFilterBar,
  renderFilterBar,
  bindTableExport,
  renderTableToolbar,
  fillDynamicSelect,
} from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { registerPageExportContext } from "./page-export-registry.js";
import { renderMetricTooltip, bindMetricTooltips, METRIC_TOOLTIPS } from "./components/metric-tooltip.js";
import { exportToCsv, exportToExcel, exportFilename } from "./utils/table-export.js";

const PAGE_ID = "internal_journey_bottlenecks";
const fmt = new Intl.NumberFormat("pt-BR");
const ATTENTION_EXPORT = "ijb-attention";
const EP_EXPORT = "ijb-ep";

const state = {
  mounted: false,
  payload: null,
  attentionClientsAll: [],
  loading: false,
  error: null,
  filters: defaultInternalJourneyBottlenecksFilters(),
  attentionPage: 1,
  attentionPageSize: 10,
  epFilter: "all",
};
let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "period", id: "ijbPeriod", key: "periodPreset", label: "Período" },
  { kind: "search", id: "ijbSearch", key: "search", label: "Busca" },
  { kind: "select", id: "ijbProgram", key: "program", label: "Programa", options: programSelectOptions(), allLabel: "Todos" },
  { kind: "select", id: "ijbEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "ijbSegment", key: "segment", label: "Segmento", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "ijbStatus", key: "status", label: "Status", options: STATUS_FILTER_OPTIONS },
  {
    kind: "select",
    id: "ijbOnboarding",
    key: "completedOnboarding",
    label: "Concluiu onboarding",
    options: [
      { value: "all", label: "Todos" },
      { value: "yes", label: "Sim" },
      { value: "no", label: "Não" },
      { value: "unknown", label: "Não avaliável" },
    ],
  },
  {
    kind: "select",
    id: "ijbFirstMeeting",
    key: "firstMeeting",
    label: "Primeira reunião",
    options: [
      { value: "all", label: "Todos" },
      { value: "yes", label: "Realizada" },
      { value: "no", label: "Não realizada" },
    ],
  },
];

function $(id) {
  return document.getElementById(id);
}

function pct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function formatDays(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
}

function paginateAttentionLocal(allRows, page, pageSize) {
  const total = allRows.length;
  const size = Math.min(100, Math.max(10, Number(pageSize) || 10));
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (p - 1) * size;
  return {
    rows: allRows.slice(start, start + size),
    page: p,
    pageSize: size,
    total,
    totalPages: pages,
  };
}

function sectionHead(title, subtitle, source = "BASE QV") {
  return `<div class="ijb-section-head">
    <h2>${escapeHtml(title)} ${sourceTag(source)}</h2>
    ${subtitle ? `<p class="ijb-section-sub">${escapeHtml(subtitle)}</p>` : ""}
  </div>`;
}

function kpi(label, value, note = "") {
  const labelHtml = String(label).includes("metric-tooltip") ? label : escapeHtml(label);
  return `<article class="kpi-card kpi-card-compact ijb-kpi"><div class="kpi-label">${labelHtml}</div><div class="kpi-value">${value}</div>${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}</article>`;
}

function pickFiniteNumber(...candidates) {
  for (const value of candidates) {
    if (value != null && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function meetingsRecencyBand(meetings, threshold) {
  const m = meetings || {};
  const rec = m.recency || {};
  const count = pickFiniteNumber(
    rec[`count${threshold}Plus`],
    rec[`count${threshold}`],
    m[`count${threshold}PlusWithoutMeeting`],
  );
  const pctVal = pickFiniteNumber(rec[`pct${threshold}Plus`], m[`pct${threshold}PlusWithoutMeeting`]);
  return { count, pct: pctVal };
}

function firstMeetingBucket(fm, key) {
  const f = fm || {};
  return {
    count: pickFiniteNumber(f[`count${key}`]),
    pct: pickFiniteNumber(f[`pct${key}`]),
  };
}

const RECENCY_WITHOUT_MEETING_TOOLTIPS = {
  30: "Percentual da base do recorte que está há mais de 30 dias sem reunião.",
  60: "Percentual da base do recorte que está há mais de 60 dias sem reunião.",
  90: "Percentual da base do recorte que está há mais de 90 dias sem reunião.",
};

const FIRST_MEETING_TOOLTIPS = {
  Within7:
    "Percentual dos clientes com tempo até primeira reunião observável cuja primeira reunião ocorreu em até 7 dias.",
  Within14: "Percentual dos clientes observáveis cuja primeira reunião ocorreu em até 14 dias.",
  Within30: "Percentual dos clientes observáveis cuja primeira reunião ocorreu em até 30 dias.",
  Over30: "Percentual dos clientes observáveis cuja primeira reunião ocorreu após 30 dias.",
};

function kpiCountPct(label, count, pctVal, tooltipLabel = "", pctSuffix = "da base") {
  const labelHtml = tooltipLabel ? renderMetricTooltip(label, tooltipLabel) : escapeHtml(label);
  const countNum = pickFiniteNumber(count);
  const countDisplay = countNum != null ? fmt.format(countNum) : "—";
  return `<article class="kpi-card kpi-card-compact ijb-kpi ijb-kpi-duo">
    <div class="kpi-label">${labelHtml}</div>
    <div class="ijb-kpi-duo-values">
      <span class="ijb-kpi-count">${countDisplay}</span>
      <span class="ijb-kpi-pct">${pct(pctVal)} ${escapeHtml(pctSuffix)}</span>
    </div>
  </article>`;
}

/** Percentual como valor principal (sem count); sufixo curto abaixo. */
function kpiPctPrimary(label, pctVal, tooltipLabel = "", suffix = "da base") {
  const labelHtml = tooltipLabel ? renderMetricTooltip(label, tooltipLabel) : escapeHtml(label);
  return `<article class="kpi-card kpi-card-compact ijb-kpi ijb-kpi-duo ijb-kpi-pct-primary">
    <div class="kpi-label">${labelHtml}</div>
    <div class="ijb-kpi-duo-values">
      <span class="ijb-kpi-count">${pct(pctVal)}</span>
      <span class="ijb-kpi-pct">${escapeHtml(suffix)}</span>
    </div>
  </article>`;
}

function sourceTag(src = "BASE QV") {
  return `<span class="ijb-source-tag">${escapeHtml(src)}</span>`;
}

function ijbTableToolbar(countLabel, exportPrefix) {
  return renderTableToolbar({ countLabel, exportPrefix });
}

function bindIjbTableExport(root, exportPrefix, getExportData) {
  bindTableExport(root, (format) => {
    const { columns, rows } = getExportData();
    if (!rows?.length) return;
    const ext = format === "xlsx" ? "xlsx" : "csv";
    const filename = exportFilename(`gargalos_jornada_${exportPrefix}`, ext);
    if (format === "xlsx") exportToExcel({ rows, columns, filename });
    else exportToCsv({ rows, columns, filename });
  });
}

function onboardingLabel(completed) {
  if (completed === true) return "Concluído";
  if (completed === false) return "Incompleto";
  return "—";
}

function epOptionsFromPayload(p) {
  const eps = (p?.epTable || []).map((r) => r.ep).filter(Boolean);
  return sortLabelsUnknownLast(eps);
}

function renderHero() {
  return `<header class="ijb-hero">
    <p class="eyebrow">Análises internas</p>
    <h1>Gargalos da Jornada</h1>
    <p class="ijb-lead">Em quais pontos da jornada os clientes estão travando e quais sinais merecem atenção para melhorar onboarding e experiência inicial?</p>
  </header>`;
}

function renderSummary(p) {
  const s = p.summary || {};
  return `<section class="ijb-section">
    ${sectionHead("Resumo dos principais gargalos", "Visão rápida da população filtrada e dos sinais mais críticos.")}
    <div class="kpi-row ijb-kpi-row">
      ${kpi("Clientes no recorte", fmt.format(s.activeClients ?? 0))}
      ${kpiCountPct("Concluíram onboarding", s.completedOnboarding, s.completedOnboardingPct)}
      ${kpiCountPct("Não concluíram onboarding", s.openOnboarding, s.openOnboardingPct)}
      ${kpi(renderMetricTooltip("Tempo típico de onboarding", "Mediana de dias até conclusão (coorte comparável)."), s.medianOnboardingDays != null ? `${s.medianOnboardingDays} d` : "—")}
      ${kpi(renderMetricTooltip("Tempo até 1ª reunião", "Tempo entre entrada na carteira e primeira reunião válida."), s.medianFirstMeetingDays != null ? `${s.medianFirstMeetingDays} d` : "—")}
      ${kpiCountPct("Sem nenhuma reunião", s.withoutAnyMeeting, s.withoutAnyMeetingPct, "Clientes sem nenhuma reunião válida registrada.")}
      ${kpi(renderMetricTooltip("Recência", "Dias desde a última reunião registrada."), s.medianDaysSinceLastMeeting != null ? `${s.medianDaysSinceLastMeeting} d` : "—")}
      ${kpiCountPct("Jornada parada", s.stalledJourney, s.stalledJourneyPct, "Normal / Atenção / Crítico conforme regras documentadas.")}
    </div>
  </section>`;
}

function renderInsights(p) {
  const items = (p.insights || []).slice(0, 6);
  if (!items.length) return "";
  return `<section class="ijb-section ijb-insights">
    ${sectionHead("Principais sinais de atenção", "Padrões observados no recorte — associação, não causalidade.")}
    <ul class="ijb-insight-list">${items.map((i) => `<li>${escapeHtml(i.text)}</li>`).join("")}</ul>
  </section>`;
}

function renderFunnel(p) {
  const steps = p.funnel?.steps || [];
  const mb = p.mainBottleneck;
  return `<section class="ijb-section">
    ${sectionHead("Funil do onboarding", "Onde os clientes avançam ou param entre marcos da jornada inicial.")}
    <div class="ijb-funnel">${steps
      .map(
        (s) => `<div class="ijb-funnel-step">
        <div class="ijb-funnel-label">${escapeHtml(s.label)}</div>
        <div class="ijb-funnel-metrics">
          <strong>${fmt.format(s.count)}</strong>
          <span>${pct(s.pctOfTotal)} do total</span>
          ${s.dropOff ? `<span class="ijb-drop">−${fmt.format(s.dropOff)} (${pct(s.dropOffPct)})</span>` : ""}
        </div>
      </div>`,
      )
      .join("")}</div>
    ${
      mb
        ? `<article class="ijb-callout"><h3>Maior gargalo atual</h3>
      <p><strong>${escapeHtml(mb.label)}</strong> — de ${fmt.format(mb.fromCount)} para ${fmt.format(mb.toCount)} clientes (perda ${pct(mb.dropOffPct)}).</p></article>`
        : ""
    }
  </section>`;
}

function renderVelocity(p) {
  const steps = p.velocity?.steps || [];
  return `<section class="ijb-section">
    ${sectionHead("Velocidade da jornada", "Quanto tempo leva, em mediana, para passar de um marco ao outro.")}
    <div class="hbar-list">${steps
      .map((s) => {
        const max = Math.max(...steps.map((x) => x.medianDays || 0), 1);
        const w = s.medianDays != null ? (s.medianDays / max) * 100 : 0;
        const tip = `Mediana: ${s.medianDays ?? "—"} d · p25 ${s.p25Days ?? "—"} · p75 ${s.p75Days ?? "—"} · N=${s.n}`;
        return `<div class="hbar" title="${escapeHtml(tip)}"><div class="hbar-label">${escapeHtml(s.label)}</div><div class="hbar-track"><span style="width:${w}%"></span></div><div class="hbar-val">${s.medianDays ?? "—"} d</div></div>`;
      })
      .join("")}</div>
  </section>`;
}

function renderMeetingsCadence(p) {
  const m = p.meetings;
  if (!m) return "";
  const fm = m.firstMeeting || {};
  const b30 = meetingsRecencyBand(m, 30);
  const b60 = meetingsRecencyBand(m, 60);
  const b90 = meetingsRecencyBand(m, 90);
  const fm7 = firstMeetingBucket(fm, "Within7");
  const fm14 = firstMeetingBucket(fm, "Within14");
  const fm30 = firstMeetingBucket(fm, "Within30");
  const fmOver30 = firstMeetingBucket(fm, "Over30");
  return `<section class="ijb-section">
    ${sectionHead("Reuniões e cadência", "Cadência de encontros e tempo até o primeiro contato — indicadores BASE QV.")}
    <div class="kpi-row ijb-kpi-row">
      ${kpiCountPct("Com reunião", m.withMeeting, m.withMeetingPct)}
      ${kpiCountPct("Sem reunião", m.withoutMeeting, m.withoutMeetingPct)}
      ${kpi(renderMetricTooltip("Mediana até 1ª reunião", METRIC_TOOLTIPS?.firstMeeting || "Tempo entre entrada e primeira reunião válida."), m.medianDaysToFirst != null ? `${m.medianDaysToFirst} d` : "—")}
      ${kpi("Mediana desde última", m.medianDaysSinceLast != null ? `${m.medianDaysSinceLast} d` : "—")}
      ${kpi("Intervalo médio entre reuniões", m.meanIntervalDays != null ? `${m.meanIntervalDays} d` : "—")}
      ${kpi("Reuniões por cliente (mediana)", m.medianMeetingsPerClient ?? "—")}
      ${kpiPctPrimary("30+ dias sem reunião", b30.pct, RECENCY_WITHOUT_MEETING_TOOLTIPS[30], "da base")}
      ${kpiPctPrimary("60+ dias sem reunião", b60.pct, RECENCY_WITHOUT_MEETING_TOOLTIPS[60], "da base")}
      ${kpiPctPrimary("90+ dias sem reunião", b90.pct, RECENCY_WITHOUT_MEETING_TOOLTIPS[90], "da base")}
    </div>
    <h3 class="ijb-subheading">Tempo até a primeira reunião</h3>
    <div class="kpi-row ijb-kpi-row ijb-kpi-row-first-meeting">
      ${kpi("Mediana", m.medianDaysToFirst != null ? formatDays(m.medianDaysToFirst) : "—")}
      ${kpiPctPrimary("Até 7 dias", fm7.pct, FIRST_MEETING_TOOLTIPS.Within7, "dos clientes observáveis")}
      ${kpiPctPrimary("Até 14 dias", fm14.pct, FIRST_MEETING_TOOLTIPS.Within14, "dos clientes observáveis")}
      ${kpiPctPrimary("Até 30 dias", fm30.pct, FIRST_MEETING_TOOLTIPS.Within30, "dos clientes observáveis")}
      ${kpiPctPrimary("Acima de 30 dias", fmOver30.pct, FIRST_MEETING_TOOLTIPS.Over30, "dos clientes observáveis")}
    </div>
  </section>`;
}

function renderRecencyChart(p) {
  const chart = p.recencyChart || [];
  const max = Math.max(1, ...chart.map((c) => c.count));
  return `<section class="ijb-section">
    ${sectionHead(
      "Há quanto tempo os clientes não fazem reunião?",
      "Distribuição dos clientes conforme o tempo desde a última reunião registrada. Ajuda a identificar quem pode estar sem acompanhamento.",
    )}
    <div class="ijb-bar-chart">${chart
      .map((c) => {
        const h = Math.max(4, Math.round((c.count / max) * 120));
        const tip = `${c.bucket}: ${fmt.format(c.count)} clientes (${pct(c.sharePct)} da base)`;
        return `<div class="ijb-bar-col" title="${escapeHtml(tip)}">
        <span class="ijb-bar-val">${fmt.format(c.count)}</span>
        <div class="ijb-bar-fill" style="height:${h}px"></div>
        <span class="ijb-bar-lbl">${escapeHtml(c.bucket)}</span>
      </div>`;
      })
      .join("")}</div>
  </section>`;
}

function renderRankings(p) {
  const items = p.rankings || [];
  if (!items.length) return "";
  return `<section class="ijb-section">
    ${sectionHead("Principais gargalos observados", "Ordenado por volume de clientes afetados no recorte atual.")}
    <ol class="ijb-ranking-list">${items
      .map(
        (r, i) => `<li><strong>${i + 1}. ${escapeHtml(r.label)}</strong> — ${fmt.format(r.clients)} clientes (${pct(r.sharePct)})</li>`,
      )
      .join("")}</ol>
  </section>`;
}

function renderMeetingTypes(p) {
  const items = p.meetingsByType?.items || p.meetingsByType || [];
  if (!Array.isArray(items) || !items.length) return "";
  const max = Math.max(...items.map((i) => i.count || i.value || 0), 1);
  return `<section class="ijb-section">
    ${sectionHead("Reuniões por tipo", "Composição dos tipos agendados — somente esta visão usa Calendly.", "Calendly")}
    <p class="note-muted">${escapeHtml(p.meetingsByTypeMeta?.note || "Fonte: Calendly.")}</p>
    <div class="hbar-list">${items
      .slice(0, 12)
      .map((i) => {
        const count = i.count ?? i.value ?? 0;
        const w = (count / max) * 100;
        return `<div class="hbar"><div class="hbar-label">${escapeHtml(i.label || i.type || "—")}</div><div class="hbar-track"><span style="width:${w}%"></span></div><div class="hbar-val">${fmt.format(count)}</div></div>`;
      })
      .join("")}</div>
  </section>`;
}

function renderEpDetail(r) {
  const wm = resolveEpWithoutMeetingFields(r);
  const wmTip = formatEpWithoutMeetingCellTooltip(r, (n) => fmt.format(n), (v) => pct(v));
  return `<div class="ijb-ep-detail">
    <h3 class="ijb-ep-detail-title">${escapeHtml(r.ep)}</h3>
    ${r.smallSample ? '<p class="ijb-badge-warn inline">Amostra pequena — interpretar com cautela.</p>' : ""}
    <div class="kpi-row ijb-kpi-row">
      ${kpi("Clientes", fmt.format(r.clients))}
      ${kpi("% onboarding concluído", pct(r.onboardingCompletedPct))}
      ${kpi("Tempo típico onboarding", formatDays(r.medianOnboardingDays))}
      ${kpi("Tempo típico até 1ª reunião", formatDays(r.medianFirstMeetingDays))}
      ${kpiCountPct("% sem reunião", wm.count, wm.pct, wmTip)}
      ${kpi("30+ d sem reunião", pct(r.days30WithoutMeetingPct))}
      ${kpi("60+ d sem reunião", pct(r.days60WithoutMeetingPct))}
      ${kpi("90+ d sem reunião", pct(r.days90WithoutMeetingPct))}
      ${kpi("Reuniões / cliente (mediana)", r.medianMeetingsPerClient ?? "—")}
      ${kpi("Com mecanismo", pct(r.withMechanismPct))}
    </div>
  </div>`;
}

function epCellFirstMeeting(r) {
  const v = r.medianFirstMeetingDays;
  const alert = !r.smallSample && v != null && v > 30;
  const tip = alert
    ? "Ponto de atenção: tempo típico acima de 30 dias."
    : r.smallSample
      ? "Mediana de dias até a 1ª reunião. Interprete com cautela: poucos clientes neste EP."
      : "Mediana de dias entre a entrada do cliente e a primeira reunião válida.";
  const cls = alert ? "ijb-cell-alert" : "";
  return `<td class="num ${cls}" title="${escapeHtml(tip)}">${formatDays(v)}</td>`;
}

function epCellWithoutMeeting(r) {
  const { pct: pctVal } = resolveEpWithoutMeetingFields(r);
  const alert = epWithoutMeetingAlert(r, pctVal);
  const tip = formatEpWithoutMeetingCellTooltip(r, (n) => fmt.format(n), (v) => pct(v));
  const cls = alert ? "ijb-cell-alert" : "";
  const display = pctVal != null ? pct(pctVal) : "—";
  return `<td class="num ${cls}" title="${escapeHtml(tip)}">${display}</td>`;
}

function renderEpTableBody(p) {
  const allRows = p.epTable || [];
  const selected = state.epFilter;
  if (selected !== "all") {
    const one = allRows.find((r) => r.ep === selected);
    return one ? renderEpDetail(one) : `<p class="note-muted">EP não encontrado no recorte.</p>`;
  }
  return `<div class="table-wrap ijb-table-wrap">
    <table class="gd-table ijb-table" id="${EP_EXPORT}">
      <thead><tr>
        <th class="col-text">EP</th>
        <th class="num col-narrow">Clientes</th>
        <th class="num col-narrow" title="Percentual dos clientes desse EP que concluíram o onboarding.">Onboarding concluído</th>
        <th class="num col-narrow" title="Mediana de dias para os clientes desse EP concluírem o onboarding. Metade conclui antes desse valor e metade depois.">Tempo típico de onboarding</th>
        <th class="num col-narrow" title="Mediana de dias entre a entrada do cliente e a primeira reunião válida.">Tempo típico até 1ª reunião</th>
        <th class="num col-narrow" title="Percentual dos clientes deste EP que não possuem nenhuma reunião válida registrada.">% sem reunião</th>
        <th class="num col-narrow" title="Percentual dos clientes deste EP há 60+ dias sem reunião recente (regra de recência; distinto de nunca ter tido reunião).">60+ dias sem reunião</th>
        <th class="col-sample">Amostra</th>
      </tr></thead>
      <tbody>${allRows
        .map(
          (r) => `<tr>
        <td class="col-text">${escapeHtml(r.ep)}</td>
        <td class="num">${fmt.format(r.clients)}</td>
        <td class="num">${pct(r.onboardingCompletedPct)}</td>
        <td class="num">${formatDays(r.medianOnboardingDays)}</td>
        ${epCellFirstMeeting(r)}
        ${epCellWithoutMeeting(r)}
        <td class="num" title="Percentual dos clientes deste EP há 60+ dias sem reunião recente (regra de recência; distinto de nunca ter tido reunião).">${pct(r.days60WithoutMeetingPct)}</td>
        <td class="col-sample">${r.smallSample ? '<span class="ijb-badge-warn" title="Interprete com cautela: poucos clientes neste EP.">Amostra pequena</span>' : "OK"}</td>
      </tr>`,
        )
        .join("")}</tbody>
    </table>
  </div>`;
}

function renderEpSection(p) {
  const eps = epOptionsFromPayload(p);
  const opts = [`<option value="all"${state.epFilter === "all" ? " selected" : ""}>Todos os EPs</option>`]
    .concat(
      eps.map((ep) => `<option value="${escapeHtml(ep)}"${state.epFilter === ep ? " selected" : ""}>${escapeHtml(ep)}</option>`),
    )
    .join("");
  const countLabel =
    state.epFilter === "all"
      ? `${fmt.format((p.epTable || []).length)} EP(s) no recorte`
      : `Detalhe: ${state.epFilter}`;
  return `<section class="ijb-section ijb-section-full" id="ijb-ep-section">
    ${sectionHead("Gargalos por EP", "Compare EPs ou aprofunde um responsável específico no recorte filtrado.")}
    <label class="ijb-ep-filter">EP <select id="ijbEpFilter">${opts}</select></label>
    ${ijbTableToolbar(countLabel, EP_EXPORT)}
    <div data-ijb-ep-content>${renderEpTableBody(p)}</div>
  </section>`;
}

function renderAttentionTableBody(block) {
  const rows = block.rows || [];
  return `<div class="table-wrap ijb-table-wrap">
      <table class="gd-table ijb-table" id="${ATTENTION_EXPORT}">
        <thead><tr>
          <th class="col-text-wide">Cliente</th>
          <th class="col-text">EP</th>
          <th class="col-text">Programa</th>
          <th class="num col-narrow">Dias carteira</th>
          <th class="col-text-narrow">Onboarding</th>
          <th class="num col-narrow">1ª reunião (d)</th>
          <th class="num col-narrow">Desde última</th>
          <th class="num col-narrow">Reuniões</th>
          <th class="col-motivos">Motivos</th>
        </tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
        <td class="col-text-wide">${escapeHtml(r.clientName)}</td>
        <td class="col-text">${escapeHtml(r.engineer)}</td>
        <td class="col-text">${escapeHtml(r.program)}</td>
        <td class="num">${r.tenureDays ?? "—"}</td>
        <td class="col-text-narrow">${escapeHtml(onboardingLabel(r.completedOnboarding))}</td>
        <td class="num">${r.daysToFirstMeeting ?? "—"}</td>
        <td class="num">${r.daysSinceLastMeeting ?? "—"}</td>
        <td class="num">${r.totalMeetings ?? 0}</td>
        <td class="col-motivos ijb-chips">${(r.attentionReasons || []).map((x) => `<span class="ijb-chip">${escapeHtml(x)}</span>`).join("")}</td>
      </tr>`,
          )
          .join("")}</tbody>
      </table>
    </div>`;
}

function renderAttentionPager(block) {
  return `<div class="ijb-pager">
      <button type="button" class="btn btn-secondary btn-sm" data-ijb-page="prev" ${block.page <= 1 ? "disabled" : ""}>Anterior</button>
      <span>Página ${block.page}/${block.totalPages}</span>
      <label class="ijb-page-size">Por página
        <select id="ijbPageSize" data-ijb-page-size>
          ${[10, 25, 50, 100].map((n) => `<option value="${n}"${block.pageSize === n ? " selected" : ""}>${n}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="btn btn-secondary btn-sm" data-ijb-page="next" ${block.page >= block.totalPages ? "disabled" : ""}>Próxima</button>
    </div>`;
}

function renderAttentionTable(p) {
  const block = paginateAttentionLocal(state.attentionClientsAll, state.attentionPage, state.attentionPageSize);
  return `<section class="ijb-section" id="ijb-attention-section">
    ${sectionHead("Clientes em atenção", "Lista operacional para priorizar follow-up — motivos em chips.")}
    ${ijbTableToolbar(`${fmt.format(block.total ?? 0)} clientes em atenção`, ATTENTION_EXPORT)}
    <div data-ijb-attention-content>${renderAttentionTableBody(block)}</div>
    <div data-ijb-attention-pager>${renderAttentionPager(block)}</div>
  </section>`;
}

function patchAttentionSection() {
  const scrollY = window.scrollY;
  const section = document.getElementById("ijb-attention-section");
  if (!section) return;
  const block = paginateAttentionLocal(state.attentionClientsAll, state.attentionPage, state.attentionPageSize);
  const content = section.querySelector("[data-ijb-attention-content]");
  const pager = section.querySelector("[data-ijb-attention-pager]");
  if (content) content.innerHTML = renderAttentionTableBody(block);
  if (pager) pager.innerHTML = renderAttentionPager(block);
  const countEl = section.querySelector(".table-count");
  if (countEl) countEl.textContent = `${fmt.format(block.total ?? 0)} clientes em atenção`;
  bindAttentionPager(section);
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

function bindAttentionPager(root) {
  root.querySelectorAll("[data-ijb-page]").forEach((btn) => {
    if (btn.dataset.ijbPagerBound) return;
    btn.dataset.ijbPagerBound = "1";
    btn.addEventListener("click", () => {
      const block = paginateAttentionLocal(state.attentionClientsAll, state.attentionPage, state.attentionPageSize);
      if (btn.dataset.ijbPage === "prev" && block.page > 1) state.attentionPage = block.page - 1;
      if (btn.dataset.ijbPage === "next" && block.page < block.totalPages) state.attentionPage = block.page + 1;
      patchAttentionSection();
    });
  });
  const sizeEl = root.querySelector("#ijbPageSize");
  if (sizeEl && !sizeEl.dataset.ijbPagerBound) {
    sizeEl.dataset.ijbPagerBound = "1";
    sizeEl.addEventListener("change", (e) => {
      state.attentionPageSize = Number(e.target.value) || 10;
      state.attentionPage = 1;
      patchAttentionSection();
    });
  }
}

function renderAnalysisInsights(p) {
  const items = p.insights || [];
  if (!items.length) return "";
  return `<section class="ijb-section ijb-insights">
    ${sectionHead("Insights da análise", "Síntese automática com N e comparações quando há suporte nos dados.")}
    <ul class="ijb-insight-list">${items
      .map((i) => `<li>${escapeHtml(i.text)}${i.n != null ? ` <span class="ijb-insight-meta">(N=${fmt.format(i.n)})</span>` : ""}</li>`)
      .join("")}</ul>
  </section>`;
}

function renderRecommendations(p) {
  const recs = p.recommendations || [];
  if (!recs.length) return "";
  return `<section class="ijb-section">
    ${sectionHead("Onde atuar primeiro", "Sugestões derivadas dos dados — para teste operacional, não promessa de resultado.")}
    <ul class="ijb-rec-list">${recs.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
  </section>`;
}

function renderPageHtml(p) {
  return `<div class="ijb-page">
    ${renderHero()}
    ${renderSummary(p)}
    ${renderInsights(p)}
    ${renderFunnel(p)}
    ${renderVelocity(p)}
    ${renderMeetingsCadence(p)}
    ${renderRecencyChart(p)}
    ${renderRankings(p)}
    ${renderMeetingTypes(p)}
    ${renderEpSection(p)}
    ${renderAttentionTable(p)}
    ${renderAnalysisInsights(p)}
    ${renderRecommendations(p)}
  </div>`;
}

function bindEpSectionEvents(host) {
  const sel = host.querySelector("#ijbEpFilter");
  if (!sel || sel.dataset.ijbBound) return;
  sel.dataset.ijbBound = "1";
  sel.addEventListener("change", () => {
    const scrollY = window.scrollY;
    state.epFilter = sel.value || "all";
    const section = document.getElementById("ijb-ep-section");
    const slot = section?.querySelector("[data-ijb-ep-content]");
    if (slot && state.payload) {
      slot.innerHTML = renderEpTableBody(state.payload);
      const countEl = section.querySelector(".table-count");
      if (countEl) {
        countEl.textContent =
          state.epFilter === "all"
            ? `${fmt.format((state.payload.epTable || []).length)} EP(s) no recorte`
            : `Detalhe: ${state.epFilter}`;
      }
    }
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  });
}

function bindIjbUi(root) {
  bindEpSectionEvents(root);
  bindAttentionPager(root.querySelector("#ijb-attention-section") || root);
  const attentionColumns = [
    { key: "clientName", header: "Cliente" },
    { key: "engineer", header: "EP" },
    { key: "program", header: "Programa" },
    { key: "tenureDays", header: "Dias carteira", type: "number" },
    { key: "completedOnboarding", header: "Onboarding", format: (v) => onboardingLabel(v) },
    { key: "daysToFirstMeeting", header: "1ª reunião (d)", type: "number" },
    { key: "daysSinceLastMeeting", header: "Desde última", type: "number" },
    { key: "totalMeetings", header: "Reuniões", type: "number" },
    { key: "attentionReasons", header: "Motivos", format: (v) => (Array.isArray(v) ? v.join("; ") : v) },
  ];
  bindIjbTableExport(root, ATTENTION_EXPORT, () => ({
    columns: attentionColumns,
    rows: state.attentionClientsAll || [],
  }));
  bindIjbTableExport(root.querySelector("#ijb-ep-section") || root, EP_EXPORT, () => ({
    columns: [
      { key: "ep", header: "EP" },
      { key: "clients", header: "Clientes", type: "number" },
      { key: "onboardingCompletedPct", header: "% onboarding" },
      { key: "medianOnboardingDays", header: "Med. onboarding", type: "number" },
      { key: "medianFirstMeetingDays", header: "Med. 1ª reunião", type: "number" },
      { key: "withoutMeetingPct", header: "% sem reunião" },
      { key: "days60WithoutMeetingPct", header: "% 60+ d sem reunião" },
    ],
    rows:
      state.epFilter === "all"
        ? state.payload?.epTable || []
        : (state.payload?.epTable || []).filter((r) => r.ep === state.epFilter),
  }));
}

function renderSuccess() {
  const root = $("page-content");
  if (!root || !state.payload) return;
  root.innerHTML = renderPageHtml(state.payload);
  bindMetricTooltips(root);
  bindIjbUi(root);
}

function hydrateAttentionClientsAll(payload) {
  return resolveAttentionClientsAll(payload);
}

async function loadPayload({ force = false } = {}) {
  state.loading = true;
  state.error = null;
  const params = internalJourneyBottlenecksFiltersToSearchParams(state.filters);
  try {
    const res = await fetchPageJson(`/api/internal-journey-bottlenecks?${params}`, { pageId: PAGE_ID, force });
    state.payload = res?.payload ?? res;
    state.attentionClientsAll = hydrateAttentionClientsAll(state.payload);
    const expectedTotal = expectedAttentionClientsTotal(state.payload);
    if (!force && expectedTotal > 0 && state.attentionClientsAll.length === 0) {
      state.loading = false;
      return loadPayload({ force: true });
    }
    state.attentionPage = 1;
    state.loading = false;
    populateFilterOptions($("page-filters")?.querySelector("[data-filter-body]"));
    renderSuccess();
    registerPageExportContext(PAGE_ID, () => ({ payload: state.payload, filters: state.filters, loading: state.loading }));
  } catch (err) {
    state.loading = false;
    state.error = mapLoadError(err);
    $("page-content").innerHTML = `<p class="placeholder-note">${escapeHtml(state.error)}</p>`;
  }
}

function filtersFromForm(body) {
  const root = body || document;
  return normalizeInternalJourneyBottlenecksFilters({
    ...state.filters,
    search: root.querySelector("#ijbSearch")?.value || "",
    program: root.querySelector("#ijbProgram")?.value || "all",
    engineer: root.querySelector("#ijbEngineer")?.value || "all",
    segment: root.querySelector("#ijbSegment")?.value || "all",
    status: root.querySelector("#ijbStatus")?.value || state.filters.status,
    completedOnboarding: root.querySelector("#ijbOnboarding")?.value || "all",
    firstMeeting: root.querySelector("#ijbFirstMeeting")?.value || "all",
  });
}

function populateFilterOptions(body) {
  const opts = state.payload?.filterOptions || {};
  fillDynamicSelect(body?.querySelector("#ijbEngineer") || $("ijbEngineer"), opts.engineers || [], "Todos", state.filters.engineer);
  fillDynamicSelect(body?.querySelector("#ijbSegment") || $("ijbSegment"), opts.segments || [], "Todos", state.filters.segment);
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  unbindFilters();
  unbindFilterMount();
  unbindFilterMount = mountPageFilters({
    host,
    pageId: PAGE_ID,
    innerHtml: renderFilterBar({ fields: FILTER_FIELDS, filters: state.filters }),
    onBodyReady: (body) => {
      populateFilterOptions(body);
      const set = (id, key) => {
        const el = body.querySelector(`#${id}`);
        if (el && state.filters[key] != null) el.value = state.filters[key];
      };
      set("ijbProgram", "program");
      set("ijbStatus", "status");
      set("ijbOnboarding", "completedOnboarding");
      set("ijbFirstMeeting", "firstMeeting");
      unbindFilters = bindFilterBar({
        host: body,
        fields: FILTER_FIELDS,
        filters: state.filters,
        onChange: () => {
          state.filters = filtersFromForm(body);
          state.attentionPage = 1;
          loadPayload();
        },
        onClear: () => {
          state.filters = defaultInternalJourneyBottlenecksFilters();
          state.attentionPage = 1;
          loadPayload();
        },
      });
      return unbindFilters;
    },
  });
}

export function bootInternalJourneyBottlenecks() {
  if (!eventsBound) {
    eventsBound = true;
    onPageChange((page) => {
      if (page.id !== PAGE_ID) return;
      state.mounted = true;
      renderFilters();
      if (!state.payload && !state.loading) loadPayload();
    });
    pageRefresh = createPageRefresh(() => {
      clearPageCache(PAGE_ID);
      loadPayload();
    });
  }
  if (getCurrentPageId() === PAGE_ID) {
    state.mounted = true;
    renderFilters();
    if (!state.payload && !state.loading) loadPayload();
  }
}
