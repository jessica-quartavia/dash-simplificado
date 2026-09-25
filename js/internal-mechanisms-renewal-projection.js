import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  defaultInternalMechanismsSatisfactionFilters,
  IMS_STATUS_FILTER_OPTIONS,
  internalMechanismsSatisfactionFiltersToSearchParams,
  normalizeInternalMechanismsSatisfactionFilters,
} from "../lib/analytics/internal-mechanisms-satisfaction-filters.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError, clearPageCache } from "./utils/page-load.js";
import { escapeHtml } from "./general-charts.mjs";
import { bindFilterBar, renderFilterBar } from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import { registerPageExportContext } from "./page-export-registry.js";
import { renderMetricTooltip, bindMetricTooltips, METRIC_TOOLTIPS } from "./components/metric-tooltip.js";
import { renderYearEndRenewalProjection } from "./imr-year-end-projection.mjs";
import {
  imrChartCard,
  donut,
  vBars,
  mechanismBandCombo,
  groupedMetricCompare,
  brierCompareChart,
  mechanismHorizontalBars,
  scatterSampleQuality,
  adoptionTimelineChart,
} from "./imr-charts.mjs";
import { downloadCsv, normalizeFilename, sectionsToCsvText, buildTableSection } from "./export-csv.js";

const PAGE_ID = "internal_mechanisms_renewal_projection";
const fmt = new Intl.NumberFormat("pt-BR");
const fmtPct = (v) =>
  v == null || !Number.isFinite(Number(v)) ? "—" : `${(Number(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const state = { mounted: false, payload: null, loading: false, error: null, filters: defaultInternalMechanismsSatisfactionFilters() };
let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "imrSearch", key: "search", label: "Busca" },
  { kind: "select", id: "imrProgram", key: "program", label: "Programa", options: programSelectOptions(), allLabel: "Todos" },
  { kind: "select", id: "imrStatus", key: "status", label: "Status", options: IMS_STATUS_FILTER_OPTIONS },
];

function $(id) {
  return document.getElementById(id);
}

function num(v) {
  return v == null || !Number.isFinite(Number(v)) ? "—" : fmt.format(Number(v));
}

function kpi(label, value, note = "") {
  return `<article class="kpi-card kpi-card-compact"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${value}</div>${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}</article>`;
}

function metricBlock(title, keys, metrics, tipKeys = {}) {
  const cards = keys
    .map((key) => {
      const tip = METRIC_TOOLTIPS[tipKeys[key] || key] || METRIC_TOOLTIPS[key];
      const label = renderMetricTooltip(key, tip || key);
      const val = ["brier", "baselineBrier"].includes(key) ? metrics[key]?.toFixed?.(3) ?? metrics[key] : fmtPct(metrics[key]);
      return `<article class="kpi-card kpi-card-compact imr-metric"><div class="kpi-label">${label}</div><div class="kpi-value">${val ?? "—"}</div></article>`;
    })
    .join("");
  return `<div class="imr-metric-group"><h4>${escapeHtml(title)}</h4><div class="kpi-row">${cards}</div></div>`;
}

function renderConfusionGrid(c) {
  if (!c || c.tp == null) return "";
  const cells = [
    ["tp", "ACERTOU RENOVAÇÃO", c.tp],
    ["fp", "ACHOU QUE RENOVARIA, MAS NÃO", c.fp],
    ["tn", "ACERTOU NÃO RENOVAÇÃO", c.tn],
    ["fn", "NÃO IDENTIFICOU UMA RENOVAÇÃO", c.fn],
  ];
  return `<div class="imr-confusion-grid">${cells
    .map(
      ([k, human, v]) =>
        `<div class="imr-conf-cell imr-conf-${k}"><span class="imr-conf-human">${escapeHtml(human)}</span><span class="imr-conf-sig">${renderMetricTooltip(k.toUpperCase(), METRIC_TOOLTIPS[k])}</span><strong class="imr-conf-n">${num(v)}</strong></div>`,
    )
    .join("")}</div>`;
}

function renderFormulaAccordion(def) {
  if (!def) return "";
  const f = def.formula;
  return `<details class="imr-accordion"><summary>Como funciona o cálculo?</summary>
    <p>${escapeHtml(def.plainSummary || "")}</p>
    ${f ? `<ul class="imr-formula-list">
      <li>${renderMetricTooltip("Ajuste para grupos pequenos", METRIC_TOOLTIPS.shrinkage)}</li>
      <li>${renderMetricTooltip("Limite das probabilidades", METRIC_TOOLTIPS.probabilityClip)}: ${escapeHtml(f.clipLabel || "")}</li>
      <li>${renderMetricTooltip("Amostra mínima", METRIC_TOOLTIPS.minStratum)}: ${escapeHtml(f.minStratumLabel || "")}</li>
    </ul>
    <div class="imr-formula-tech note-muted"><code>taxa_base</code> = ${escapeHtml(f.taxa_base)} · <code>taxa_ajustada</code> = ${escapeHtml(f.taxa_ajustada)}</div>` : ""}
  </details>`;
}

function renderHero(p) {
  return `<header class="imr-hero">
    <p class="eyebrow">Análises internas</p>
    <h1>Projeção Mecanismos × Renovação</h1>
    <p class="imr-lead">Comparamos duas formas de treinar o mesmo modelo para entender qual representa melhor a relação entre mecanismos e renovação.</p>
    <p class="imr-exploratory-banner" role="note">${escapeHtml(p.exploratoryNote || "")}</p>
    <div class="imr-hero-cards">
      <article class="imr-model-card imr-model-a"><span class="imr-badge imr-badge-prod">PRODUÇÃO ATUAL</span><h3>Modelo A</h3><p class="imr-model-kind">Base ativa</p><p>Aprende apenas com os clientes que estão ativos hoje.</p></article>
      <article class="imr-model-card imr-model-b"><span class="imr-badge imr-badge-exp">EXPERIMENTO</span><h3>Modelo B</h3><p class="imr-model-kind">Base completa</p><p>Aprende com todo o histórico de clientes, independentemente do status atual.</p></article>
    </div>
    <article class="imr-diff-card callout-note"><div class="imr-diff-cols"><div><strong>Modelo A</strong><p>Olha o presente.</p></div><div><strong>Modelo B</strong><p>Olha todo o histórico.</p></div></div>
    <p class="imr-diff-emphasis">Os dois usam a mesma fórmula. O que muda é quem entra no treinamento.</p></article>
  </header>`;
}

function renderModelSection(model, tagClass, title, subtitle) {
  const pop = model.population || {};
  const charts = model.charts || {};
  const popCards = tagClass === "imr-model-a"
    ? [
        ["Clientes usados", pop.clientsUsed ?? pop.cycleValid],
        ["Renovados", pop.renewed],
        ["Ainda sem renovação registrada", pop.notYetRenewedRegistered],
        ["Com mecanismo", pop.withMechanism],
        ["Sem mecanismo", pop.withoutMechanism],
      ]
    : [
        ["Total na base", pop.totalClients],
        ["Ativos", pop.active],
        ["Cancelados", pop.cancelled],
        ["Congelados", pop.frozen],
        ["Renovados", pop.renewed],
        ["Com mecanismo", pop.withMechanism],
      ];
  const statusChart =
    tagClass === "imr-model-b" && charts.statusDistribution?.length
      ? imrChartCard("Quem entra no Modelo B?", donut(charts.statusDistribution), {
          legend: "O Modelo B utiliza clientes de toda a história da BASE QV.",
        })
      : "";
  const warn =
    tagClass === "imr-model-b"
      ? `<div class="imr-callout imr-callout-warn" role="note"><strong>Ponto de atenção</strong><p>${escapeHtml(model.limitationNote || "")}</p></div>`
      : "";
  const adoption =
    tagClass === "imr-model-b" && model.adoptionTimeline
      ? imrChartCard(
          "Quando os mecanismos começaram a ser usados?",
          adoptionTimelineChart(model.adoptionTimeline.monthly, model.adoptionTimeline.firstImplementationDate),
          { legend: "Clientes muito antigos tiveram menos oportunidade de receber mecanismos." },
        )
      : "";

  return `<section class="imr-section ${tagClass}">
    <h2>${escapeHtml(title)}</h2>
    <p class="imr-section-lead">${escapeHtml(subtitle)}</p>
    ${warn}
    <h3>População</h3>
    <div class="kpi-row imr-pop-kpis">${popCards.map(([l, v]) => kpi(l, num(v))).join("")}</div>
    <div class="imr-chart-grid">
      ${imrChartCard("Com vs sem mecanismo", donut(charts.mechanismSplit || []), { note: "Clientes com pelo menos um mecanismo implementado." })}
      ${imrChartCard(
        tagClass === "imr-model-a" ? "Renovação na população" : "Renovação registrada",
        donut(charts.renewalSplit || []),
        { legend: tagClass === "imr-model-a" ? "Ativos podem ainda não ter chegado à janela de renovação." : "" },
      )}
      ${statusChart}
    </div>
    ${adoption}
    <h3>Quantidade de mecanismos</h3>
    ${mechanismBandCombo(charts.mechanismBands || [])}
    <h3>Treino e teste</h3>
    <p class="note-muted">${renderMetricTooltip("Holdout", METRIC_TOOLTIPS.trainSplit)} · ${escapeHtml(model.split?.hashHoldoutRule || model.split?.type || "80/20")}</p>
    <div class="kpi-row">${kpi("Treino", num(model.split?.nTrain))}${kpi("Teste", num(model.split?.nTest))}${kpi("Renovados treino", num(model.split?.renewedTrain))}${kpi("Renovados teste", num(model.split?.renewedTest))}</div>
    ${renderFormulaAccordion(model.modelDefinition)}
    <h3>Desempenho do modelo</h3>
    ${metricBlock("Capacidade de separar clientes", ["rocAuc", "prAuc"], model.metrics || {}, { rocAuc: "rocAuc", prAuc: "prAuc" })}
    ${metricBlock("Capacidade de encontrar renovados", ["recall", "precision", "f1"], model.metrics || {})}
    ${metricBlock("Qualidade das probabilidades", ["brier", "baselineBrier"], model.metrics || {})}
    ${metricBlock("Referência secundária", ["accuracy", "balancedAccuracy"], model.metrics || {}, { balancedAccuracy: "balancedAccuracy" })}
    <h3>Matriz de confusão (teste)</h3>
    ${renderConfusionGrid(model.confusion)}
  </section>`;
}

function renderComparison(p) {
  const rows = p.comparison?.rows || [];
  const mA = p.modelA?.metrics || {};
  const mB = p.modelB?.metrics || {};
  const groups = ["populacao", "treino", "classificacao", "ranking", "probabilidade"];
  const groupLabels = { populacao: "População", treino: "Treino", classificacao: "Classificação", ranking: "Ranking", probabilidade: "Probabilidade" };
  let tableBody = "";
  for (const g of groups) {
    const gr = rows.filter((r) => r.group === g);
    if (!gr.length) continue;
    tableBody += `<tr class="imr-cmp-group"><td colspan="4">${escapeHtml(groupLabels[g] || g)}</td></tr>`;
    tableBody += gr
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.label)}</td><td class="num">${cmpVal(r, "a", r.metric)}</td><td class="num">${cmpVal(r, "b", r.metric)}</td><td class="imr-cmp-hint">${escapeHtml(r.interpret || "")}</td></tr>`,
      )
      .join("");
  }
  const readCards = [
    { title: "Ranking", text: "ROC-AUC / PR-AUC — quanto melhor, melhor a separação de risco.", a: fmtPct(mA.rocAuc), b: fmtPct(mB.rocAuc) },
    { title: "Identificação de renovados", text: "Recall / Precision / F1.", a: fmtPct(mA.recall), b: fmtPct(mB.recall) },
    { title: "Estimativa de volume", text: "Brier — menor é melhor.", a: mA.brier?.toFixed?.(3) ?? "—", b: mB.brier?.toFixed?.(3) ?? "—" },
  ];
  return `<section class="imr-section imr-compare">
    <h2>Comparação dos modelos</h2>
    <p class="imr-section-lead">Mesma fórmula. Bases diferentes.</p>
    <div class="imr-chart-grid imr-compare-charts">
      ${imrChartCard("Métricas principais (0–1)", groupedMetricCompare(p.comparison?.chartMetrics || [], mA, mB, rows), { note: "Barras proporcionais — não declara vencedor." })}
      ${imrChartCard("Brier e baseline", brierCompareChart(mA, mB), { legend: "Menor é melhor." })}
    </div>
    <div class="table-wrap"><table class="gd-table imr-cmp-table"><thead><tr><th>Indicador</th><th class="num">Modelo A</th><th class="num">Modelo B</th><th>Como interpretar</th></tr></thead><tbody>${tableBody}</tbody></table></div>
    <div class="imr-read-cards">${readCards.map((c) => `<article class="imr-read-card"><h4>${escapeHtml(c.title)}</h4><p>${escapeHtml(c.text)}</p><p>A: <strong>${c.a}</strong> · B: <strong>${c.b}</strong></p></article>`).join("")}</div>
    <p class="imr-callout callout-note">${escapeHtml(p.comparison?.noWinnerCallout || "")}</p>
  </section>`;
}

function cmpVal(row, side, metric) {
  const v = row[side];
  if (v == null || v === "") return "—";
  if (["accuracy", "balanced_accuracy", "precision", "recall", "f1"].includes(metric)) return fmtPct(v);
  if (["roc_auc", "pr_auc"].includes(metric)) return Number(v).toFixed(3);
  if (["brier", "baseline_brier"].includes(metric)) return Number(v).toFixed(3);
  return num(v);
}

function renderMechanisms(p) {
  const ins = p.mechanismInsights || {};
  return `<section class="imr-section">
    <h2>Mecanismos × renovação</h2>
    <p class="note-muted">${escapeHtml(ins.note || p.causalNote || "")}</p>
    <div class="imr-chart-grid">
      ${imrChartCard(
        "Taxa de renovação por quantidade de mecanismos",
        vBars(
          (ins.bands || []).map((b) => ({
            label: b.band === "4+" ? "4+" : b.band,
            count: b.renewalRatePct ?? 0,
            percent: b.renewalRatePct,
          })),
        ),
        { legend: "Percentual de clientes da população analisada que já renovaram (Modelo A · ciclo válido)." },
      )}
      ${imrChartCard("Top mecanismos (taxa)", mechanismHorizontalBars(ins.ranking || []), {
        legend: "Taxa maior não prova que o mecanismo causou a renovação.",
      })}
      ${imrChartCard("Taxa × tamanho da amostra", scatterSampleQuality(ins.scatter || []), {
        note: "Cautela com taxas altas e N pequeno.",
      })}
    </div>
  </section>`;
}

function renderAuxiliary(h) {
  if (!h) return "";
  const sens = (h.sensitivity || [])
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.cutoff?.label || s.cutoff?.id || "—")}</td><td class="num">${num(s.summary?.total)}</td><td class="num">${s.metrics?.rocAuc?.toFixed?.(3) ?? "—"}</td><td class="num">${s.metrics?.prAuc?.toFixed?.(3) ?? "—"}</td><td class="num">${s.metrics?.brier?.toFixed?.(3) ?? "—"}</td></tr>`,
    )
    .join("");
  return `<details class="imr-section imr-aux"><summary>${escapeHtml(h.title || "Análise auxiliar")}</summary>
    <p class="note-muted">${escapeHtml(h.note || "")}</p>
    ${h.primary?.metrics ? `<p>Corte principal (${escapeHtml(h.era?.primaryCutoff?.label || "intermediário")}): N=${num(h.primary.summary?.total)} · ROC-AUC=${h.primary.metrics.rocAuc?.toFixed?.(3) ?? "—"}</p>` : ""}
    <div class="table-wrap"><table class="gd-table"><thead><tr><th>Corte</th><th class="num">N</th><th class="num">ROC-AUC</th><th class="num">PR-AUC</th><th class="num">Brier</th></tr></thead><tbody>${sens}</tbody></table></div>
  </details>`;
}

function renderFooter() {
  const how = [
    ["Accuracy", "Acertos totais — pode parecer alta quando renovação é minoria."],
    ["ROC-AUC", "Capacidade de ordenar risco."],
    ["Recall", "Quanto dos renovados encontramos."],
    ["Brier", "Qualidade das probabilidades."],
    ["Associação", "Relação observada, não causa."],
  ];
  return `<section class="imr-section imr-footer">
    <h2>Como interpretar esta análise</h2>
    <div class="imr-read-cards">${how.map(([t, d]) => `<article class="imr-read-card"><h4>${escapeHtml(t)}</h4><p>${escapeHtml(d)}</p></article>`).join("")}</div>
    <h2>Limitações</h2>
    <ul class="imr-limits"><li><strong>Modelo A:</strong> usa apenas ativos; clientes no 1º ciclo podem ainda não ter chegado à renovação.</li>
    <li><strong>Modelo B:</strong> usa toda a base histórica; inclui épocas com pouca utilização de mecanismos.</li>
    <li><strong>Ambos:</strong> renovação inferida por ciclo; data_fim_ciclo é proxy; mecanismos não provam causalidade.</li></ul>
  </section>`;
}

function renderSuccess() {
  const root = $("page-content");
  if (!root || !state.payload) return;
  const p = state.payload;
  root.innerHTML = `<div class="imr-page">
    ${renderHero(p)}
    ${renderModelSection(p.modelA || {}, "imr-model-a", "Modelo A — Base ativa", "Usa somente clientes atualmente ativos.")}
    ${renderModelSection(p.modelB || {}, "imr-model-b", "Modelo B — Base completa", "Usa todo o histórico de clientes disponível, independentemente do status atual.")}
    ${renderComparison(p)}
    ${renderMechanisms(p)}
    <section class="imr-section imr-projection"><h2>Projeção operacional</h2><span class="imr-badge imr-badge-prod">MODELO A · PRODUÇÃO</span>
    <h3>Projeção atual até 31/12</h3>
    ${renderYearEndRenewalProjection(p.modelA?.renewalYearEndProjection)}
    <p class="note-muted">${escapeHtml(p.modelB?.projectionNote || "")}</p></section>
    ${renderAuxiliary(p.historicalComparablePopulation)}
    ${renderFooter()}
  </div>`;
  bindMetricTooltips(root);
}

function renderStateView() {
  const root = $("page-content");
  if (!root) return;
  if (state.error && !state.payload) {
    root.innerHTML = `<p class="placeholder-note">${escapeHtml(state.error)}</p>`;
    return;
  }
  if (state.loading && !state.payload) {
    root.innerHTML = `<p class="placeholder-note">Carregando projeção…</p>`;
    return;
  }
  if (state.payload) renderSuccess();
}

function buildExportSections(p) {
  return [
    buildTableSection("Comparacao", ["indicador", "modelo_a", "modelo_b"], (p.comparison?.rows || []).map((r) => ({ indicador: r.label, modelo_a: r.a, modelo_b: r.b }))),
    buildTableSection("Populacao_A", ["campo", "valor"], Object.entries(p.modelA?.population || {}).map(([k, v]) => ({ campo: k, valor: v }))),
    buildTableSection("Populacao_B", ["campo", "valor"], Object.entries(p.modelB?.population || {}).map(([k, v]) => ({ campo: k, valor: v }))),
  ];
}

async function loadData(force = false) {
  state.loading = true;
  state.error = null;
  renderStateView();
  try {
    const res = await fetchPageJson(`/api/internal-mechanisms-renewal-projection?${internalMechanismsSatisfactionFiltersToSearchParams(state.filters).toString()}`, {
      force,
      pageId: PAGE_ID,
    });
    state.payload = res.payload ?? res;
    registerPageExportContext(PAGE_ID, () => ({ payload: state.payload, filters: state.filters }));
    renderStateView();
  } catch (e) {
    state.error = mapLoadError(e).error || String(e);
    renderStateView();
  } finally {
    state.loading = false;
    pageRefresh?.setLoading?.(false);
  }
}

function mountPage() {
  if (state.mounted) return;
  state.mounted = true;
  const host = $("page-filters");
  if (host) {
    unbindFilterMount = mountPageFilters({
      host,
      pageId: PAGE_ID,
      innerHtml: renderFilterBar({ fields: FILTER_FIELDS, filters: state.filters }),
      onBodyReady: (body) => {
        unbindFilters = bindFilterBar({
          host: body,
          fields: FILTER_FIELDS,
          filters: state.filters,
          onChange: () => {
            state.filters = normalizeInternalMechanismsSatisfactionFilters({
              search: $("imrSearch")?.value,
              program: $("imrProgram")?.value,
              status: $("imrStatus")?.value,
            });
            void loadData(true);
          },
          onClear: () => {
            state.filters = defaultInternalMechanismsSatisfactionFilters();
            mountPage();
            void loadData(true);
          },
        });
        return unbindFilters;
      },
    });
  }
  pageRefresh = createPageRefresh({ pageId: PAGE_ID, onRefresh: () => loadData(true) });
  pageRefresh.mount();
}

export function bootInternalMechanismsRenewalProjection() {
  if (!eventsBound) {
    eventsBound = true;
    onPageChange((page) => {
      if (page.id !== PAGE_ID) return;
      clearPageCache(PAGE_ID);
      mountPage();
      void loadData(true);
    });
  }
  if (getCurrentPageId() === PAGE_ID) {
    clearPageCache(PAGE_ID);
    mountPage();
    void loadData(true);
  }
}
