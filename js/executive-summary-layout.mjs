/**
 * Renderização visual do Resumo Executivo — somente markup/CSS classes.
 */
import { escapeHtml, hBars, rankedBars, acquisitionColumns, mechanismDistributionBars, intentionEffectiveColumns } from "./general-charts.mjs";

const fmt = new Intl.NumberFormat("pt-BR");
const pctFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const moneyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

function pct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${pctFmt.format(Number(value))}%`;
}

function num(value, suffix = "") {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${fmt.format(Number(value))}${suffix}`;
}

function money(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return moneyFmt.format(Number(value));
}

function metric(block, id) {
  return block?.metrics?.[id] ?? {};
}

function coverageNote(metric) {
  const c = metric.coverage;
  if (!c) return "";
  if (c.percent != null) return `Cobertura ${pct(c.percent)}`;
  if (c.denominator != null && c.numerator != null) return `${num(c.numerator)}/${num(c.denominator)}`;
  if (c.denominator != null) return `Base ${num(c.denominator)}`;
  return "";
}

function execSection(title, bodyHtml, status = "ok") {
  if (status === "error") {
    return `
      <section class="executive-section executive-section--error">
        <h2 class="executive-section__title">${escapeHtml(title)}</h2>
        <p class="placeholder-note">Erro ao carregar este bloco.</p>
      </section>`;
  }
  const statusClass =
    status === "partial" ? " executive-section--partial" : status === "ok" ? "" : " executive-section--empty";
  return `
    <section class="executive-section${statusClass}">
      <h2 class="executive-section__title">${escapeHtml(title)}</h2>
      <div class="executive-section__body">
        ${bodyHtml || `<p class="placeholder-note">${status === "partial" ? "Dados parciais neste recorte." : "Sem dados."}</p>`}
      </div>
    </section>`;
}

function execKpi({ label, value, note, accent = false, hero = false, mini = false }) {
  const classes = ["executive-kpi"];
  if (accent) classes.push("executive-kpi--accent");
  if (hero) classes.push("executive-kpi--hero");
  if (mini) classes.push("executive-mini-kpi");
  return `
    <article class="${classes.join(" ")}">
      <span class="executive-kpi__label">${escapeHtml(label)}</span>
      <strong class="executive-kpi__value">${value}</strong>
      ${note ? `<span class="executive-kpi__meta">${escapeHtml(note)}</span>` : ""}
    </article>`;
}

function execChart(title, bodyHtml, extraClass = "") {
  return `
    <article class="executive-chart-card ${extraClass}">
      ${title ? `<h3 class="executive-chart-card__title">${escapeHtml(title)}</h3>` : ""}
      <div class="executive-chart-card__body">${bodyHtml}</div>
    </article>`;
}

function renderSplitBar(promoters, detractors, neutrals) {
  const p = Number(promoters?.percent) || 0;
  const d = Number(detractors?.percent) || 0;
  const n = Number(neutrals?.percent) || Math.max(0, 100 - p - d);
  return `
    <div class="executive-split-bar">
      <div class="executive-split-bar__track" role="img" aria-label="Promotores ${pct(p)}, Neutros ${pct(n)}, Detratores ${pct(d)}">
        <span class="executive-split-bar__seg executive-split-bar__seg--promoters" style="width:${p}%"></span>
        <span class="executive-split-bar__seg executive-split-bar__seg--neutrals" style="width:${n}%"></span>
        <span class="executive-split-bar__seg executive-split-bar__seg--detractors" style="width:${d}%"></span>
      </div>
      <ul class="executive-split-bar__legend">
        <li><span class="executive-split-bar__dot executive-split-bar__dot--promoters"></span>Promotores ${pct(p)}</li>
        <li><span class="executive-split-bar__dot executive-split-bar__dot--neutrals"></span>Neutros ${pct(n)}</li>
        <li><span class="executive-split-bar__dot executive-split-bar__dot--detractors"></span>Detratores ${pct(d)}</li>
      </ul>
    </div>`;
}

function renderEpCard({ title, engineer, percent, detail }) {
  return `
    <article class="executive-kpi executive-kpi--hero">
      <span class="executive-kpi__label">${escapeHtml(title)}</span>
      <strong class="executive-kpi__name">${engineer ? escapeHtml(engineer) : "—"}</strong>
      <strong class="executive-kpi__value">${percent != null ? pct(percent) : "—"}</strong>
      ${detail ? `<span class="executive-kpi__meta">${escapeHtml(detail)}</span>` : ""}
    </article>`;
}

function renderBase(block) {
  if (!block) return execSection("Base de clientes", "", "error");
  const active = metric(block, "active_clients");
  const frozen = metric(block, "frozen_clients");
  const stay = metric(block, "median_stay_days");
  const segments = metric(block, "active_segment_distribution");
  const income = metric(block, "median_monthly_income");
  const contribution = metric(block, "median_last_contribution");
  const reserve = metric(block, "median_liquidity_reserve");
  const acquisition = metric(block, "acquisition_last_3_months");
  const acqSeries = Array.isArray(acquisition.value) ? acquisition.value : [];
  const segmentItems = (segments.value || []).map((item) => ({
    label: item.label,
    count: item.count,
    percent: item.percent ?? 0,
  }));

  return execSection(
    "Base de clientes",
    `
    <div class="executive-grid executive-grid--headline">
      ${execKpi({
        label: "Clientes ativos",
        value: num(active.value),
        note: "Carteira analítica atual",
        accent: true,
      })}
      ${execKpi({
        label: "Clientes congelados",
        value: num(frozen.value),
        note: "Sobre a carteira total",
      })}
      ${execKpi({
        label: "Permanência mediana",
        value: stay.value == null ? "—" : `${num(stay.value)} dias`,
        note: coverageNote(stay),
      })}
    </div>
    <div class="executive-grid executive-grid--base-secondary">
      ${execChart("Base ativa por segmento", hBars(segmentItems, { wideLabels: true }), "executive-chart-card--wide")}
      <div class="executive-grid executive-grid--mini-kpis">
        ${execKpi({ label: "Renda mediana", value: money(income.value), note: coverageNote(income), mini: true })}
        ${execKpi({ label: "Aporte mediano", value: money(contribution.value), note: coverageNote(contribution), mini: true })}
        ${execKpi({ label: "Reserva mediana", value: money(reserve.value), note: coverageNote(reserve), mini: true })}
      </div>
    </div>
    ${execChart("Aquisição — últimos 3 meses", acquisitionColumns(acqSeries, 3), "executive-chart-card--compact")}`,
    block.status,
  );
}

function renderOnboarding(block) {
  if (!block) return execSection("Onboarding e ativação", "", "error");
  const completion = metric(block, "onboarding_completion_rate");
  const firstMeeting = metric(block, "median_first_meeting_days");
  return execSection(
    "Onboarding e ativação",
    `
    <div class="executive-grid executive-grid--2">
      ${execKpi({
        label: "Onboarding concluído",
        value: pct(completion.value),
        note: completion.denominator
          ? `${num(completion.numerator)}/${num(completion.denominator)} · ${coverageNote(completion)}`
          : coverageNote(completion),
        accent: true,
      })}
      ${execKpi({
        label: "Tempo até 1ª reunião",
        value: firstMeeting.value == null ? "—" : `${num(firstMeeting.value)} dias`,
        note: coverageNote(firstMeeting),
      })}
    </div>`,
    block.status,
  );
}

function renderEngagement(block) {
  if (!block) return execSection("Engajamento", "", "error");
  const withoutMeeting = metric(block, "clients_without_meeting");
  const interval = metric(block, "average_interval_between_meetings");
  const firstMeeting = metric(block, "days_to_first_meeting");
  const activation = metric(block, "days_financial_to_activation");
  const ci = metric(block, "days_to_central_intelligence");
  const noDiagnosis = metric(block, "clients_without_financial_diagnosis");
  const intervalLabel =
    interval.calculation === "mean" ? "Intervalo médio entre reuniões" : "Intervalo entre reuniões";

  const items = [
    { label: "Clientes sem reunião", value: num(withoutMeeting.value), note: coverageNote(withoutMeeting) },
    {
      label: intervalLabel,
      value: interval.value == null ? "—" : `${num(interval.value)} dias`,
      note: interval.median != null ? `Mediana ${num(interval.median)} dias` : coverageNote(interval),
    },
    {
      label: "Dias até 1ª reunião",
      value: firstMeeting.value == null ? "—" : `${num(firstMeeting.value)} dias`,
      note: coverageNote(firstMeeting),
    },
    {
      label: "Tempo até ativação das engrenagens",
      value: activation.value == null ? "—" : `${num(activation.value)} dias`,
      note: coverageNote(activation),
    },
    {
      label: "Dias até Central de Inteligência",
      value: ci.value == null ? "—" : `${num(ci.value)} dias`,
      note: coverageNote(ci),
    },
    {
      label: "Sem diagnóstico financeiro",
      value: num(noDiagnosis.value),
      note: noDiagnosis.rule || coverageNote(noDiagnosis),
    },
  ];

  return execSection(
    "Engajamento",
    `<div class="executive-grid executive-grid--6">${items.map((item) => execKpi({ ...item, mini: true })).join("")}</div>`,
    block.status,
  );
}

function renderValue(block, chartExpanded = {}) {
  if (!block) return execSection("Entrega de valor", "", "error");
  const clients = metric(block, "clients_with_implemented_mechanisms");
  const rate = metric(block, "clients_implementation_rate");
  const distribution = metric(block, "mechanism_type_distribution");
  const distItems = (distribution.value?.full || distribution.value?.top || distribution.value || []).map((item) => ({
    label: item.label,
    count: item.count ?? item.clients ?? 0,
    percent: item.percent ?? 0,
  }));
  const distExpanded = chartExpanded.mechanismDistribution === true;

  return execSection(
    "Entrega de valor",
    `
    <div class="executive-grid executive-grid--value">
      <div class="executive-stack">
        ${execKpi({
          label: "Clientes com mecanismos implantados",
          value: num(clients.value),
          note:
            rate.numerator != null && rate.denominator != null
              ? `${num(rate.numerator)}/${num(rate.denominator)} clientes vinculados`
              : coverageNote(clients),
          accent: true,
        })}
        ${execKpi({
          label: "% com mecanismo implantado",
          value: pct(rate.value),
          note: rate.numerator != null ? `${num(rate.numerator)}/${num(rate.denominator)} clientes` : rate.note || "",
        })}
      </div>
      ${execChart(
        "Distribuição dos mecanismos",
        mechanismDistributionBars(distItems, { limit: 8, expanded: distExpanded, chartId: "mechanismDistribution" }),
        "executive-chart-card--distribution",
      )}
    </div>`,
    block.status,
  );
}

function renderIntentionDestination(block) {
  if (!block) return "";
  const destination = metric(block, "intention_destination_branches");
  const data = destination.value;
  if (!data) return execSection("Destino das intenções e pedidos", "", block.status === "error" ? "error" : "partial");

  const branches = (data.branches || [])
    .map(
      (branch) => `
      <article class="executive-branch-card">
        <span class="executive-branch-card__label">${escapeHtml(branch.label)}</span>
        <strong class="executive-branch-card__value">${num(branch.count)}</strong>
        <span class="executive-branch-card__meta">${pct(branch.percent)} · ${escapeHtml(branch.subtitle)}</span>
      </article>`,
    )
    .join("");

  return execSection(
    "Destino das intenções e pedidos",
    `
    <div class="executive-intention-flow">
      <article class="executive-intention-root">
        <span class="executive-kpi__label">Intenção/Pedido</span>
        <strong class="executive-kpi__value">${num(data.total)}</strong>
        <span class="executive-kpi__meta">Soma das quatro ramificações</span>
      </article>
      <div class="executive-intention-flow__arrow" aria-hidden="true">→</div>
      <div class="executive-grid executive-grid--branches">${branches}</div>
    </div>`,
    block.status,
  );
}

function renderHealth(block) {
  if (!block) return execSection("Saúde do cliente", "", "error");
  const nps = metric(block, "nps");
  const shares = metric(block, "promoters_detractors_share");
  const csat = metric(block, "csat_average");
  const monthly = metric(block, "cancellation_intention_vs_effective");
  const reasons = metric(block, "top_cancellation_reasons");
  const renewals = metric(block, "total_renewals");
  const eligible = metric(block, "renewal_eligible_clients");
  const perActive = metric(block, "renewals_per_active_client");

  const promoters = shares.value?.promoters;
  const detractors = shares.value?.detractors;
  const neutrals = shares.value?.neutrals;
  const monthlyRows = Array.isArray(monthly.value) ? monthly.value.slice(-6) : [];
  const reasonItems = (reasons.value || []).map((item) => ({
    label: item.label,
    count: item.count,
    percent: item.percent ?? 0,
  }));

  return execSection(
    "Saúde do cliente",
    `
    <div class="executive-grid executive-grid--health-top">
      ${execKpi({
        label: "NPS",
        value: nps.value == null ? "—" : num(nps.value),
        note: coverageNote(nps),
        accent: true,
      })}
      ${execChart("Promotores × detratores", renderSplitBar(promoters, detractors, neutrals), "executive-chart-card--split")}
      ${execKpi({
        label: "CSAT",
        value: csat.value == null ? "—" : `${num(csat.value)}/5`,
        note: csat.coverage?.responses ? `${num(csat.coverage.responses)} respostas` : coverageNote(csat),
      })}
    </div>
    ${execChart(
      "Cancelamentos × intenções (mensal)",
      intentionEffectiveColumns(monthlyRows, 12),
      "executive-chart-card--wide executive-chart-card--monthly",
    )}
    <div class="executive-grid executive-grid--health-bottom">
      ${execChart(
        "Principais motivos de cancelamento",
        rankedBars(reasonItems, { limit: 3, note: reasons.note || "Principais motivos categorizados." }),
        "executive-chart-card--reasons",
      )}
      <div class="executive-grid executive-grid--mini-kpis executive-grid--renewal">
        ${execKpi({ label: "Quantidade de renovações", value: num(renewals.value), note: coverageNote(renewals), mini: true })}
        ${execKpi({
          label: "Clientes aptos para renovação",
          value: eligible.status === "pending_rule" ? "Regra pendente" : num(eligible.value),
          note: eligible.pending?.message ? "Pendente de validação" : "Clientes com ciclo válido",
          mini: true,
        })}
        ${execKpi({
          label: "Renovações por cliente ativo",
          value: perActive.value == null ? "—" : num(perActive.value),
          note: perActive.numerator != null ? `${num(perActive.numerator)}/${num(perActive.denominator)}` : perActive.rule || "",
          mini: true,
        })}
      </div>
    </div>`,
    block.status,
  );
}

function renderEp(block) {
  if (!block) return execSection("EP", "", "error");
  const renewed = metric(block, "top_ep_renewed_share");
  const implemented = metric(block, "top_ep_implementation_share");
  const renewedValue = renewed.value;
  const implementedValue = implemented.value;

  return execSection(
    "EP",
    `
    <div class="executive-grid executive-grid--2">
      ${renderEpCard({
        title: "Maior % da base renovada",
        engineer: renewedValue?.engineer,
        percent: renewedValue?.percent,
        detail: renewedValue
          ? `${num(renewedValue.renewed)}/${num(renewedValue.base)} renovados${renewedValue.tied?.length ? ` · Empate: ${renewedValue.tied.join(", ")}` : ""}`
          : "",
      })}
      ${renderEpCard({
        title: "Maior % implantada",
        engineer: implementedValue?.engineer,
        percent: implementedValue?.percent,
        detail: implementedValue
          ? `${num(implementedValue.implementedClients)}/${num(implementedValue.base)} clientes${implementedValue.tied?.length ? ` · Empate: ${implementedValue.tied.join(", ")}` : ""}`
          : "",
      })}
    </div>`,
    block.status,
  );
}

function renderTemporal(block) {
  if (!block) return execSection("Indicadores temporais", "", "error");
  const signals = metric(block, "temporal_top_signals");
  const distribution = metric(block, "temporal_signal_distribution");
  const signalItems = (signals.value || []).slice(0, 5);
  const signalHtml = signalItems.length
    ? `<ol class="executive-signal-ranked">${signalItems
        .map(
          (item, index) => `
        <li class="executive-signal-ranked__item">
          <span class="executive-signal-ranked__rank">${index + 1}</span>
          <div class="executive-signal-ranked__body">
            <strong class="executive-signal-ranked__title">${escapeHtml(item.label)}</strong>
            ${item.description ? `<span class="executive-signal-ranked__desc">${escapeHtml(item.description)}</span>` : ""}
          </div>
          <div class="executive-signal-ranked__metrics">
            <strong>${pct(item.percent)}</strong>
            <span>${num(item.count)} clientes</span>
          </div>
        </li>`,
        )
        .join("")}</ol>`
    : `<p class="placeholder-note">Sem sinais no recorte.</p>`;
  const distItems = (distribution.value || []).map((item) => ({
    label: item.label,
    count: item.count,
    percent: item.percent,
  }));

  return execSection(
    "Indicadores temporais",
    `
    <p class="executive-note">Sinais determinísticos pré-cancelamento. Associação descritiva — sem causalidade.</p>
    <div class="executive-grid executive-grid--temporal">
      ${execChart("Principais sinais pré-cancelamento", signalHtml, "executive-chart-card--signals")}
      ${execChart("Clientes por quantidade de sinais pré-cancelamento", hBars(distItems, { wideLabels: true, compact: true }), "executive-chart-card--distribution")}
    </div>`,
    block.status,
  );
}

export function renderExecutiveDashboard(payload = {}, { chartExpanded = {} } = {}) {
  return `
    <div class="executive-dashboard">
      ${renderBase(payload.baseClients)}
      ${renderOnboarding(payload.onboarding)}
      ${renderEngagement(payload.engagement)}
      ${renderValue(payload.valueDelivery, chartExpanded)}
      ${renderHealth(payload.clientHealth)}
      ${renderIntentionDestination(payload.clientHealth)}
      ${renderEp(payload.ep)}
      ${renderTemporal(payload.temporal)}
    </div>`;
}
