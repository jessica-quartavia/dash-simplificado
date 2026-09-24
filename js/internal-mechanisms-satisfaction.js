import { onPageChange, getCurrentPageId } from "./navigation.js";
import {
  defaultInternalMechanismsSatisfactionFilters,
  IMS_HAS_MECHANISM_OPTIONS,
  IMS_NPS_CLASS_OPTIONS,
  IMS_NPS_SCORE_OPTIONS,
  IMS_RENEWED_OPTIONS,
  IMS_STATUS_FILTER_OPTIONS,
  internalMechanismsSatisfactionFiltersToSearchParams,
  normalizeInternalMechanismsSatisfactionFilters,
} from "../lib/analytics/internal-mechanisms-satisfaction-filters.mjs";
import { normalizeProgramFilter, programSelectOptions } from "../lib/analytics/filters/program.mjs";
import { createPageRefresh } from "./components/page-refresh.js";
import { fetchPageJson, mapLoadError, clearPageCache } from "./utils/page-load.js";
import { escapeHtml } from "./general-charts.mjs";
import {
  bindFilterBar,
  bindTableExport,
  fillDynamicSelect,
  renderFilterBar,
  renderTableToolbar,
} from "./components/filters/filter-bar.js";
import { mountPageFilters } from "./components/filters/filter-shell.js";
import {
  bindMatrixExpand,
  bindMatrixTooltips,
  bindMatrixViewToggle,
  renderProportionalHeatmapTable,
} from "./components/statistical-matrix.js";
import { registerPageExportContext } from "./page-export-registry.js";
import { exportFilename, exportToCsv, exportToExcel } from "./utils/table-export.js";
import {
  matrixAssociationInterpretation,
  matrixAssociationStrengthLabel,
} from "../lib/analytics/internal-mechanisms-nps-focus.mjs";

const PAGE_ID = "internal_mechanisms_satisfaction";
const IMS_SMALL_SAMPLE_N = 10;
const fmt = new Intl.NumberFormat("pt-BR");

const state = {
  mounted: false,
  payload: null,
  detailPayload: null,
  loading: false,
  detailLoading: false,
  error: null,
  filters: defaultInternalMechanismsSatisfactionFilters(),
  sortKey: "npsScore",
  sortDir: "desc",
  page: 1,
  pageSize: 10,
  clientSearch: "",
  tablePager: {},
};

let eventsBound = false;
let unbindFilters = () => {};
let unbindFilterMount = () => {};
let pageRefresh = null;

const FILTER_FIELDS = [
  { kind: "search", id: "imsSearch", key: "search", label: "Busca" },
  { kind: "select", id: "imsProgram", key: "program", label: "Programa", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "imsEngineer", key: "engineer", label: "EP", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "imsSegment", key: "segment", label: "Segmento", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "imsStatus", key: "status", label: "Status", options: IMS_STATUS_FILTER_OPTIONS },
  { kind: "select", id: "imsMechanism", key: "mechanism", label: "Mecanismo", dynamic: true, allLabel: "Todos" },
  { kind: "select", id: "imsHasMech", key: "hasMechanism", label: "Possui mecanismo", options: IMS_HAS_MECHANISM_OPTIONS },
  { kind: "select", id: "imsNpsScore", key: "npsScore", label: "Nota NPS", options: IMS_NPS_SCORE_OPTIONS },
  { kind: "select", id: "imsNpsClass", key: "npsClass", label: "Classificação NPS", options: IMS_NPS_CLASS_OPTIONS.filter((o) => o.value !== "none") },
  { kind: "select", id: "imsRenewed", key: "renewed", label: "Renovou", options: IMS_RENEWED_OPTIONS },
];

function $(id) {
  return document.getElementById(id);
}

function filtersFromForm() {
  return normalizeInternalMechanismsSatisfactionFilters({
    search: $("imsSearch")?.value || "",
    program: normalizeProgramFilter($("imsProgram")?.value || "all"),
    engineer: $("imsEngineer")?.value || "all",
    segment: $("imsSegment")?.value || "all",
    status: $("imsStatus")?.value || "active",
    mechanism: $("imsMechanism")?.value || "all",
    hasMechanism: $("imsHasMech")?.value || "all",
    npsClass: $("imsNpsClass")?.value || "all",
    npsScore: $("imsNpsScore")?.value || "all",
    renewed: $("imsRenewed")?.value || "all",
  });
}

const IMS_CLIENT_CACHE_VERSION = "2026-09-24-ims-renewal-proxy-v2";
const IMS_EXPECTED_SERVER_CALCULATION_VERSION = "v2.2026-09-24-ims-renewal-proxy-projection";

function buildApiUrl(extra = {}) {
  const params = internalMechanismsSatisfactionFiltersToSearchParams(state.filters);
  params.set("page", "internal_mechanisms_satisfaction");
  params.set("cv", IMS_CLIENT_CACHE_VERSION);
  if (extra.detail) params.set("detail", "1");
  if (extra.detailPage) params.set("detailPage", String(extra.detailPage));
  if (extra.detailPageSize) params.set("detailPageSize", String(extra.detailPageSize));
  const q = params.toString();
  return `/api/dashboard?${q}`;
}

function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.highlight) classes.push("kpi-card-highlight");
  if (options.compact) classes.push("kpi-card-compact");
  return `<article class="${classes.join(" ")}">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}

const fmt1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function num1(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return fmt1.format(Number(v));
}

function pctLabel(v) {
  if (v == null || !Number.isFinite(Number(v))) return "Sem dados";
  return `${Number(v).toLocaleString("pt-BR")}%`;
}

function renewalProjectionFromPayload(p) {
  return p?.renewalYearEndProjection ?? null;
}

function isRenewalProjectionRenderable(proj) {
  if (!proj || proj.error === true) return false;
  const classif = proj.proxyClassification || proj.proxyCycleEndDate?.validation?.classification;
  const proxyAvailable =
    proj.proxyAvailable === true
    || proj.proxyOperational === true
    || classif === "A"
    || classif === "B";
  const horizonTotal = proj.metrics?.horizon?.total ?? proj.horizonClientCount ?? 0;
  if (proj.projectionAvailable === true) return true;
  return proxyAvailable && horizonTotal > 0;
}

function imsProjMetricCell(label, value) {
  return `<div class="ims-proj-metric"><span class="ims-proj-metric-label">${escapeHtml(label)}</span><span class="ims-proj-metric-value">${value}</span></div>`;
}

function imsProjStatRow(label, valueHtml) {
  return `<div class="ims-proj-stat-row"><span class="ims-proj-stat-label">${escapeHtml(label)}</span><span class="ims-proj-stat-value">${valueHtml}</span></div>`;
}

function renderYearEndRenewalProjection(proj) {
  if (!proj) {
    return `<p class="placeholder-note">Indisponível.</p><p class="note-muted">Dados de validação do proxy ainda não carregados. Use Atualizar ou force=1.</p>`;
  }
  if (proj.error === true && !isRenewalProjectionRenderable(proj)) {
    return `<p class="placeholder-note">Indisponível.</p><p class="note-muted">${
      proj.validationSummary || "Não foi possível calcular a validação do proxy neste carregamento."
    }</p>`;
  }

  const proxy = proj.proxyCycleEndDate || {};
  const val = proxy.validation || {};
  const classif = proj.proxyClassification || val.classification;
  const metrics = proj.metrics || proxy.metrics || {};
  const cov = metrics.coverage || {};
  const qual = metrics.quality || {};
  const horizon = metrics.horizon || {};
  const dur1 = metrics.durationByCycle?.["1"] || {};
  const exp = proj.exploratory;
  const proxyOk =
    proj.projectionAvailable === true
    || proj.proxyAvailable === true
    || proj.proxyOperational === true
    || classif === "A"
    || classif === "B";
  const withoutEnd = Math.max(0, (cov.active ?? 0) - (cov.withEnd ?? 0));
  const monthRows = horizon.byMonth || horizon.monthly || [];
  const yearPrefix = String(proj.horizonEnd || horizon.horizonEnd || "").slice(0, 4) || "2026";
  const monthLabels = {
    [`${yearPrefix}-09`]: "Setembro",
    [`${yearPrefix}-10`]: "Outubro",
    [`${yearPrefix}-11`]: "Novembro",
    [`${yearPrefix}-12`]: "Dezembro",
  };

  if (!proxyOk) {
    return `
    <div class="ims-projection-block ims-projection-unavailable">
      <p class="placeholder-note">${escapeHtml(proj.headline || "Indisponível.")}</p>
      <p class="ims-projection-headline"><strong>${escapeHtml(proj.validationMessage || "Não foi possível validar data_fim_ciclo como uma janela confiável de renovação.")}</strong></p>
      <p class="note-muted">${escapeHtml(proj.validationSummary || (val.reasons || []).slice(0, 3).join(" "))}</p>
    </div>`;
  }

  const horizonTotal = horizon.total ?? proj.horizonClientCount ?? 0;
  const expectedRatePct = exp?.expectation?.expectedRenewalRatePct;
  const expectedRenewals = exp?.expectation?.expectedRenewals;
  const intervalLow = exp?.expectation?.intervalLow;
  const intervalHigh = exp?.expectation?.intervalHigh;
  const faixaEstimada =
    intervalLow != null && intervalHigh != null ? `${fmt.format(intervalLow)}–${fmt.format(intervalHigh)}` : "—";
  const hasModelKpis = (proj.modelProjectionPublished || exp?.available) && exp?.expectation;
  const monthMax = Math.max(1, ...monthRows.map((m) => m.count || 0));

  const monthBars = monthRows
    .map((m) => {
      const label = monthLabels[m.month] || m.label || m.month;
      const count = m.count ?? 0;
      const width = Math.max(count > 0 ? 4 : 0, Math.round((count / monthMax) * 100));
      return `<div class="ims-proj-month-row">
        <span class="ims-proj-month-label">${escapeHtml(label)}</span>
        <div class="ims-proj-month-track" role="presentation"><div class="ims-proj-month-fill" style="width:${width}%"></div></div>
        <span class="ims-proj-month-value">${fmt.format(count)}</span>
      </div>`;
    })
    .join("");

  const calloutText =
    proj.disclaimer
    || "Usamos data_fim_ciclo como aproximação da próxima janela de renovação. Esta é uma análise exploratória e não uma métrica oficial de renovação.";

  const modelPanel =
    (proj.modelProjectionPublished || exp?.available) && exp?.model
      ? `<section class="ims-proj-panel ims-proj-model" aria-labelledby="ims-proj-model-title">
      <h3 class="ims-proj-panel-title" id="ims-proj-model-title">Validação do modelo exploratório</h3>
      <div class="ims-proj-metrics-grid">
        ${imsProjMetricCell("Treino", fmt.format(exp.model.trainN ?? 0))}
        ${imsProjMetricCell("Renovados", fmt.format(exp.model.trainEvents ?? 0))}
        ${imsProjMetricCell("Taxa base", exp.model.baseRate != null ? pctLabel(exp.model.baseRate * 100) : "—")}
        ${imsProjMetricCell("ROC-AUC", exp.model.rocAuc ?? "—")}
        ${imsProjMetricCell("Brier", exp.model.brierScore ?? "—")}
        ${imsProjMetricCell("Calibração", exp.model.calibrationOk ? "adequada" : "insuficiente")}
      </div>
      ${
        exp.expectation?.narrative
          ? `<p class="ims-proj-model-narrative">${escapeHtml(exp.expectation.narrative)}</p>`
          : ""
      }
    </section>`
      : `<p class="note-muted ims-proj-model-placeholder">${escapeHtml(proj.modelProjectionNote || exp?.expectation?.message || "Modelo em validação — expectativa numérica indisponível.")}</p>`;

  const top3 = (exp?.topMechanisms || [])
    .map((m, i) => {
      const diff =
        m.diffPp != null ? `${m.diffPp >= 0 ? "+" : ""}${num1(m.diffPp)} p.p.` : "—";
      return `<article class="ims-top-mech-card">
        <div class="ims-top-mech-rank">#${i + 1}</div>
        <h4 class="ims-top-mech-name">${escapeHtml(m.mechanismName)}</h4>
        <div class="ims-top-mech-stats">
          ${imsProjStatRow("Clientes no proxy até 31/12", fmt.format(m.horizonClientsWithEndDate ?? 0))}
          ${imsProjStatRow("Taxa histórica", `${pctLabel(m.historicalRatePct)} <span class="note-muted">(N=${fmt.format(m.historicalN ?? 0)})</span>`)}
          ${imsProjStatRow("Δ vs sem mecanismo", diff)}
          ${imsProjStatRow("Prob. média prevista", pctLabel((m.meanPredictedProbability ?? 0) * 100))}
          ${imsProjStatRow("Renovações esperadas", num1(m.expectedRenewalsAmongHorizon))}
        </div>
      </article>`;
    })
    .join("");

  const mechBandsTable = (exp?.mechanismCountBands || []).length
    ? `<section class="ims-proj-panel ims-proj-bands" aria-labelledby="ims-proj-bands-title">
      <h3 class="ims-proj-panel-title" id="ims-proj-bands-title">Quantidade de mecanismos no horizonte</h3>
      <div class="table-wrap">
        <table class="gd-table ims-table ims-proj-bands-table">
          <thead><tr>
            <th>Faixa</th><th class="num">Clientes</th><th class="num">Prob. média</th><th class="num">Esperado</th>
          </tr></thead>
          <tbody>${(exp.mechanismCountBands || [])
            .map(
              (b) => `<tr>
                <td><strong>${escapeHtml(b.band)}</strong> mecanismos</td>
                <td class="num">${fmt.format(b.horizonClients ?? 0)}</td>
                <td class="num">${pctLabel((b.meanProbability ?? 0) * 100)}</td>
                <td class="num">${num1(b.expectedRenewals)}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>
      </div>
    </section>`
    : "";

  const distPanel =
    exp?.available && exp?.probabilityDistribution?.length
      ? `<section class="ims-proj-panel ims-proj-dist" aria-labelledby="ims-proj-dist-title">
      <h3 class="ims-proj-panel-title" id="ims-proj-dist-title">Distribuição de probabilidades previstas</h3>
      <div class="ims-proj-dist-chart">${exp.probabilityDistribution
        .map((b) => {
          const max = Math.max(1, ...exp.probabilityDistribution.map((x) => x.count));
          const h = Math.max(4, Math.round((b.count / max) * 88));
          return `<div class="ims-proj-dist-col">
            <span class="ims-proj-dist-value">${fmt.format(b.count)}</span>
            <div class="ims-proj-dist-bar" style="height:${h}px" role="presentation"></div>
            <span class="ims-proj-dist-label">${escapeHtml(b.label)}</span>
          </div>`;
        })
        .join("")}</div>
    </section>`
      : "";

  const extraWarnings = (proj.uiWarnings || [])
    .filter(Boolean)
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("");

  return `
  <div class="ims-projection-layout ims-projection-exploratory">
    <header class="ims-proj-header">
      <span class="ims-proxy-badge">PROJEÇÃO EXPLORATÓRIA · ${escapeHtml(proj.badge || "PROXY")}</span>
      <div class="ims-proj-callout" role="note">
        <p>${escapeHtml(calloutText)}</p>
      </div>
    </header>

    <div class="kpi-row kpi-row-primary ims-proj-kpi-primary">
      ${kpiCard("Clientes no horizonte até 31/12", fmt.format(horizonTotal), "Proxy · fim de ciclo no ano", { featured: true, highlight: true })}
      ${kpiCard("Expectativa de renovação", hasModelKpis ? pctLabel(expectedRatePct) : "—", "Modelo exploratório", { featured: true })}
      ${kpiCard("Renovações esperadas", hasModelKpis ? fmt.format(Math.round(expectedRenewals ?? 0)) : "—", "Soma das probabilidades", { featured: true, highlight: true })}
      ${kpiCard("Faixa estimada", faixaEstimada, "Intervalo plausível", { featured: true })}
    </div>

    <div class="kpi-row kpi-row-secondary ims-proj-kpi-secondary">
      ${kpiCard("Pharus", fmt.format(horizon.pharus ?? 0), "No horizonte", { compact: true })}
      ${kpiCard("Davos", fmt.format(horizon.davos ?? 0), "No horizonte", { compact: true })}
      <article class="kpi-card kpi-card-compact ims-proj-kpi-proxy">
        <div class="kpi-label">Classificação do proxy</div>
        <div class="kpi-value ims-proj-proxy-class">${escapeHtml(classif || "—")}</div>
        <div class="kpi-note">${escapeHtml(val.classificationLabel || "Proxy razoável")}</div>
      </article>
      ${kpiCard("Cobertura data_fim_ciclo", pctLabel(cov.endPct), "Carteira ativa", { compact: true })}
    </div>

    <p class="note-muted ims-proj-coverage-meta">
      Ativos sem data: ${fmt.format(withoutEnd)} · Fim de ciclo no passado: ${fmt.format(qual.pastEndOnActive ?? 0)} ·
      Duração ciclo 1 — mediana ${dur1.median ?? "—"} d (p25 ${dur1.p25 ?? "—"}, p75 ${dur1.p75 ?? "—"})
    </p>

    ${
      monthRows.length
        ? `<section class="ims-proj-panel ims-proj-months" aria-labelledby="ims-proj-months-title">
      <h3 class="ims-proj-panel-title" id="ims-proj-months-title">Clientes por mês no horizonte</h3>
      <div class="ims-proj-month-bars">${monthBars}</div>
    </section>`
        : ""
    }

    <details class="ims-proj-howto">
      <summary>Como ler esta seção</summary>
      <ul class="ims-proj-howto-list">
        <li><strong>Clientes no horizonte</strong> — clientes com fim de ciclo até 31/12 usando o proxy.</li>
        <li><strong>Expectativa de renovação</strong> — percentual médio estimado pelo modelo exploratório.</li>
        <li><strong>Renovações esperadas</strong> — soma aproximada das probabilidades.</li>
        <li><strong>Faixa estimada</strong> — intervalo plausível, não garantia.</li>
        <li><strong>Top mecanismos</strong> — associações observadas, não causalidade.</li>
      </ul>
      ${extraWarnings ? `<ul class="note-muted ims-proj-howto-warnings">${extraWarnings}</ul>` : ""}
    </details>

    ${modelPanel}

    ${
      top3
        ? `<section class="ims-proj-panel ims-proj-top-mech" aria-labelledby="ims-proj-top-title">
      <h3 class="ims-proj-panel-title" id="ims-proj-top-title">Top 3 mecanismos associados à renovação</h3>
      <div class="ims-top-mech-grid">${top3}</div>
    </section>`
        : ""
    }

    ${mechBandsTable}
    ${distPanel}

    <div id="imsProjecaoHorizonteTable" class="ims-proj-table-host"></div>

    <p class="note-muted ims-proj-footnote">${escapeHtml(proj.permanenceBiasNote || "")}</p>
    <p class="note-muted ims-proj-footnote">${escapeHtml(proj.causalNote || "")}</p>
  </div>`;
}

function fillProjecaoHorizonteTable(p) {
  const host = $("imsProjecaoHorizonteTable");
  const rows = p?.renewalYearEndProjection?.exploratory?.horizonClientsDetail || [];
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = `<p class="note-muted">Tabela de clientes disponível quando o modelo exploratório publicar probabilidades.</p>`;
    return;
  }
  host.innerHTML = `
    <section class="ims-proj-panel ims-proj-clients-table" aria-labelledby="ims-proj-clients-title">
      <header class="ims-proj-clients-head">
        <div>
          <h3 class="ims-proj-panel-title" id="ims-proj-clients-title">Clientes com fim de ciclo até 31/12 (proxy)</h3>
          <p class="ims-proj-panel-sub">${fmt.format(rows.length)} clientes</p>
        </div>
      </header>
      ${renderGenericTable(
        [
          { label: "Cliente", key: "clientName" },
          { label: "Código", key: "clientCode" },
          { label: "EP", key: "ep" },
          { label: "Programa", key: "program" },
          { label: "Segmento", key: "segment" },
          { label: "Fim de ciclo", key: "renewalDueDate" },
          { label: "Qtde. mecanismos", key: "mechanismCount", num: true, format: (r) => fmt.format(r.mechanismCount ?? 0) },
          {
            label: "Prob. renovação",
            key: "predictedRenewalProbability",
            num: true,
            format: (r) => pctLabel((r.predictedRenewalProbability ?? 0) * 100),
          },
          {
            label: "Contrib. esperada",
            key: "expectedRenewalContribution",
            num: true,
            format: (r) => num1(r.expectedRenewalContribution),
          },
        ],
        rows,
        "projecao-horizonte",
        "",
      )}
    </section>`;
}

function corrColor(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { bg: "#eee", text: "#666" };
  if (n >= 0.35) return { bg: "#dc5025", text: "#fff" };
  if (n >= 0.15) return { bg: "#f47920", text: "#fff" };
  if (n <= -0.35) return { bg: "#3b82f6", text: "#fff" };
  if (n <= -0.15) return { bg: "#93c5fd", text: "#111" };
  return { bg: "#e5e5e5", text: "#333" };
}

function imsTableToolbar(countLabel, exportId) {
  return renderTableToolbar({ countLabel, exportPrefix: exportId });
}

function bindImsExport(root, exportId, getExportData) {
  const host = root.querySelector(`[data-ims-export-host="${exportId}"]`) || root;
  bindTableExport(host, (format) => {
    const { columns, rows, slug } = getExportData();
    if (!rows?.length) return;
    const ext = format === "xlsx" ? "xlsx" : "csv";
    const filename = exportFilename(`analise_interna_nps_mecanismos_${slug}`, ext);
    if (format === "xlsx") exportToExcel({ rows, columns, filename });
    else exportToCsv({ rows, columns, filename });
  });
}

function formatComparisonCell(indicator, value) {
  if (value == null || value === "") return "—";
  if (typeof value === "number" && !Number.isFinite(value)) return "—";
  if (indicator.includes("%") || indicator.includes("Promotores") || indicator.includes("Neutros") || indicator.includes("Detratores")) {
    return pctLabel(value);
  }
  if (indicator.includes("NPS") && !indicator.includes("Nota")) return value;
  if (indicator.includes("NPS (índice)")) return value;
  if (indicator === "Clientes") return fmt.format(value);
  if (typeof value === "number") return num1(value);
  return String(value);
}

function renderMechanismMatrix(model) {
  if (!model?.rows?.length) return `<p class="placeholder-note">Sem dados no recorte NPS.</p>`;
  const guide = `
    <div class="ims-matrix-guide">
      <h3>Como ler esta matriz?</h3>
      <p>Cada linha representa um mecanismo. As colunas mostram como esse mecanismo se relaciona com satisfação ou renovação.</p>
      <p>Valores próximos de 0 indicam pouca relação. Valores positivos indicam que as duas coisas tendem a aparecer juntas. Valores negativos indicam relação no sentido oposto.</p>
      <p>Quanto mais forte a cor, maior a relação observada. Isso não significa que o mecanismo causou a mudança.</p>
      <div class="ims-matrix-scale">
        <span>0,00–0,10 · muito fraca</span>
        <span>0,10–0,30 · fraca</span>
        <span>0,30–0,50 · moderada</span>
        <span>&gt; 0,50 · forte</span>
        <span>+ positiva · − negativa</span>
      </div>
    </div>`;
  const columns = (model.columns || []).map((c) => ({
    label: c.label,
    sublabel: c.sublabel,
    title: c.label,
  }));
  const assocCols = new Set(["promoter", "neutral", "detractor"]);
  const rows = model.rows.map((row) => ({
    label: row.smallSample ? `${row.label} ⚠` : row.label,
    cells: (model.columns || []).map((col) => {
      const cell = row.cells?.[col.id] || {};
      const isAssoc = assocCols.has(col.id);
      const v = isAssoc ? cell.association : cell.value;
      const txt =
        v == null
          ? "—"
          : isAssoc
            ? Number(v).toFixed(2).replace(".", ",")
            : String(v).replace(".", ",");
      const colors = isAssoc ? corrColor(v) : { bg: row.smallSample ? "#fde8e8" : "#fff7ed", text: "#111" };
      const strength = isAssoc ? matrixAssociationStrengthLabel(v) : "";
      const tip = isAssoc
        ? `Mecanismo: ${row.label}\nIndicador: ${col.label}\nAssociação: ${txt}\nForça: ${strength}\nN: ${cell.n ?? "—"}\n${matrixAssociationInterpretation(v)}`
        : cell.tip || `${row.label} · ${col.label}: ${txt}`;
      return {
        display: txt,
        bg: colors.bg,
        color: colors.text,
        tooltip: tip,
        className: v == null ? "matrix-empty" : "",
      };
    }),
  }));
  return `${guide}<div class="ims-table-block" data-ims-export-host="matrix">${imsTableToolbar("Matriz Mecanismos × NPS", "matrix")}${renderProportionalHeatmapTable({
    columns,
    rows,
    cornerLabel: model.cornerLabel || "Mecanismo",
    legendHtml: `<span class="note-muted">${escapeHtml(model.title || "Matriz Mecanismos × NPS")} · ⚠ amostra abaixo do mínimo</span>`,
    note: model.note || "",
    labelWidth: 240,
  })}</div>`;
}

function renderComparisonTable(comVsSem, exportId = "com-sem") {
  const rows = comVsSem?.table || [];
  if (!rows.length) return `<p class="placeholder-note">Sem comparação.</p>`;
  const body = rows
    .map(
      (r) => `<tr>
      <td class="col-indicator">${escapeHtml(r.indicator)}</td>
      <td class="num">${formatComparisonCell(r.indicator, r.with)}</td>
      <td class="num">${formatComparisonCell(r.indicator, r.without)}</td>
      <td class="num">${formatComparisonCell(r.indicator, r.diff)}</td>
    </tr>`,
    )
    .join("");
  const label =
    exportId === "csat-com-sem"
      ? "CSAT com/sem mecanismo"
      : exportId === "renewal-com-sem"
        ? "Renovação com/sem mecanismo"
        : "Comparação com/sem mecanismo";
  return `<div class="table-wrap ims-table-block" data-ims-export-host="${exportId}">
    ${imsTableToolbar(label, exportId)}
    <table class="gd-table ims-table ims-comparison-table">
    <thead><tr><th class="col-indicator">Indicador</th><th class="num">Com mecanismo</th><th class="num">Sem mecanismo</th><th class="num">Diferença</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function barValueLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return `<span class="ims-bar-value">${fmt.format(n)}</span>`;
}

function renderScoreDistributionChart(buckets, withTotal, withoutTotal) {
  if (!buckets?.length) return `<p class="placeholder-note">Sem distribuição no recorte.</p>`;
  const max = Math.max(1, ...buckets.flatMap((b) => [b.withMechanism, b.withoutMechanism]));
  const cols = buckets
    .map((b) => {
      const wH = Math.max(2, Math.round((b.withMechanism / max) * 100));
      const woH = Math.max(2, Math.round((b.withoutMechanism / max) * 100));
      const wPct = withTotal ? pctLabel((b.withMechanism / withTotal) * 100) : "—";
      const woPct = withoutTotal ? pctLabel((b.withoutMechanism / withoutTotal) * 100) : "—";
      const tip = `Nota: ${b.score}\nCom mecanismo: ${b.withMechanism} clientes (${wPct})\nSem mecanismo: ${b.withoutMechanism} clientes (${woPct})`;
      return `<div class="ims-score-col" title="${escapeHtml(tip)}">
        <div class="ims-score-bar-stack">
          <div class="ims-score-bar-group">
            ${barValueLabel(b.withMechanism)}
            <div class="ims-score-bar-v ims-with" style="height:${wH}%" aria-label="Com mecanismo ${b.score}: ${b.withMechanism}"></div>
          </div>
          <div class="ims-score-bar-group">
            ${barValueLabel(b.withoutMechanism)}
            <div class="ims-score-bar-v ims-without" style="height:${woH}%" aria-label="Sem mecanismo ${b.score}: ${b.withoutMechanism}"></div>
          </div>
        </div>
        <span class="ims-score-col-label">${b.score}</span>
      </div>`;
    })
    .join("");
  return `<div class="ims-score-dist">
    <div class="ims-score-bars">${cols}</div>
    <div class="ims-score-legend">
      <span><i class="ims-legend-dot ims-with"></i> Com mecanismo (${fmt.format(withTotal || 0)} clientes)</span>
      <span><i class="ims-legend-dot ims-without"></i> Sem mecanismo (${fmt.format(withoutTotal || 0)} clientes)</span>
    </div>
  </div>`;
}

function renderInsights(list) {
  const filtered = (list || []).filter((i) => i.kind !== "teste" && !(String(i.text || i).includes("Mann–Whitney")));
  if (!filtered.length) return `<p class="placeholder-note">Nenhum insight automático para o recorte.</p>`;
  return `<ul class="ims-insights">${filtered
    .map((i) => `<li class="ims-insight-card">${escapeHtml(i.text || i)}</li>`)
    .join("")}</ul>`;
}

function renderSectionLead(diag) {
  if (!diag) return "";
  if (diag.hasData && diag.summary) return `<p class="ims-section-lead">${escapeHtml(diag.summary)}</p>`;
  if (!diag.hasData && diag.emptyReason) {
    return `<p class="ims-empty-reason" role="status">${escapeHtml(diag.emptyReason)}</p>`;
  }
  return "";
}

function getTablePager(exportId) {
  if (!state.tablePager[exportId]) state.tablePager[exportId] = { page: 1, pageSize: 10 };
  return state.tablePager[exportId];
}

function paginateTableRows(rows, exportId) {
  const pager = getTablePager(exportId);
  const total = (rows || []).length;
  const start = (pager.page - 1) * pager.pageSize;
  return { total, pager, pageRows: (rows || []).slice(start, start + pager.pageSize) };
}

function renderTablePagination(exportId, total) {
  const pager = getTablePager(exportId);
  const pages = Math.max(1, Math.ceil(total / pager.pageSize) || 1);
  return `<div class="table-pagination ims-table-pagination" data-ims-table-export="${exportId}">
    <button type="button" class="btn btn-secondary btn-sm ims-table-prev" data-table-export="${exportId}" ${pager.page <= 1 ? "disabled" : ""}>Anterior</button>
    <label class="ims-page-size-label">Por página<select class="ims-table-page-size" data-table-export="${exportId}">
      <option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option>
    </select></label>
    <span>Página ${pager.page} · ${fmt.format(total)} linhas</span>
    <button type="button" class="btn btn-secondary btn-sm ims-table-next" data-table-export="${exportId}" ${pager.page >= pages ? "disabled" : ""}>Próxima</button>
  </div>`;
}

function renderMechanismNamesCell(names) {
  const raw = String(names || "").trim();
  if (!raw || raw === "Sem mecanismo") return `<span class="note-muted">Sem mecanismo</span>`;
  const parts = raw.split(/\s*·\s*/).filter(Boolean);
  return `<div class="ims-mech-chips">${parts.map((n) => `<span class="ims-mech-chip">${escapeHtml(n)}</span>`).join("")}</div>`;
}

function filterClientRowsByKind(kind) {
  let list = [...(state.payload?.npsClientExportRows || [])];
  const q = String(state.clientSearch || "").trim().toLowerCase();
  if (q) {
    list = list.filter(
      (r) =>
        String(r.clientName || "").toLowerCase().includes(q)
        || String(r.clientCode || "").toLowerCase().includes(q)
        || String(r.mechanismNames || "").toLowerCase().includes(q),
    );
  }
  if (kind === "withMech") list = list.filter((r) => r.hasMechanism);
  if (kind === "withoutMech") list = list.filter((r) => !r.hasMechanism);
  return list;
}

function paginateClientRows(allRows, kind) {
  const list = kind ? filterClientRowsByKind(kind) : [...(allRows || [])];
  const dir = state.sortDir === "asc" ? 1 : -1;
  const key = state.sortKey;
  list.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), "pt-BR") * dir;
  });
  const total = list.length;
  const size = state.pageSize;
  const start = (state.page - 1) * size;
  return { total, rows: list.slice(start, start + size) };
}

function renderClientTableSection(tableKey) {
  const isAll = tableKey === "all";
  const showMechCols = tableKey === "withMech" || isAll;
  const { total, rows } = paginateClientRows(null, tableKey);
  const body = rows
    .map(
      (r) => `<tr>
      <td>${escapeHtml(r.clientName || "—")}</td>
      <td>${escapeHtml(r.clientCode || "—")}</td>
      <td>${escapeHtml(r.ep || "—")}</td>
      <td>${escapeHtml(r.program || "—")}</td>
      <td>${escapeHtml(r.segment || "—")}</td>
      <td class="num">${r.npsScore ?? "—"}</td>
      <td>${escapeHtml(r.npsClass || "—")}</td>
      <td>${escapeHtml(r.npsDate || "—")}</td>
      ${isAll ? `<td>${r.hasMechanism ? "Sim" : "Não"}</td>` : ""}
      ${showMechCols ? `<td class="num">${r.mechanismCount ?? 0}</td><td>${renderMechanismNamesCell(r.mechanismNames)}</td>` : ""}
    </tr>`,
    )
    .join("");
  const exportHost =
    tableKey === "withMech" ? "clients-with-mech" : tableKey === "withoutMech" ? "clients-without-mech" : "clients-all-nps";
  const extraHead = `${isAll ? "<th>Possui mecanismo</th>" : ""}${showMechCols ? '<th class="num">Qtd. mec.</th><th>Mecanismos</th>' : ""}`;
  const colCount = 8 + (isAll ? 1 : 0) + (showMechCols ? 2 : 0);
  return `<div class="ims-client-toolbar" data-ims-table-key="${tableKey}">
    <label>Busca<input type="search" class="ims-client-search" value="${escapeHtml(state.clientSearch)}" placeholder="Nome ou código" /></label>
    <label>Por página<select class="ims-page-size">
      <option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option>
    </select></label>
    <span class="note-muted">${fmt.format(total)} clientes</span>
  </div>
  <div class="table-wrap ims-table-block" data-ims-export-host="${exportHost}">
    ${imsTableToolbar(`${fmt.format(total)} clientes`, exportHost)}
    <table class="gd-table ims-table">
    <thead><tr>
      <th>Cliente</th><th>Código</th><th>EP</th><th>Programa</th><th>Segmento</th>
      <th class="num">Nota NPS</th><th>Classe</th><th>Data NPS</th>${extraHead}
    </tr></thead>
    <tbody>${body || `<tr><td colspan="${colCount}">Sem linhas no recorte.</td></tr>`}</tbody>
    </table>
  </div>
  <div class="table-pagination" data-ims-table-key="${tableKey}">
    <button type="button" class="btn btn-secondary btn-sm ims-client-prev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>
    <span>Página ${state.page} · ${fmt.format(total)} total</span>
    <button type="button" class="btn btn-secondary btn-sm ims-client-next" ${state.page * state.pageSize >= total ? "disabled" : ""}>Próxima</button>
  </div>`;
}

function renderGenericTable(columns, allRows, exportId, countLabel) {
  const { total, pageRows } = paginateTableRows(allRows, exportId);
  const head = columns.map((c) => `<th class="${c.num ? "num" : ""}">${escapeHtml(c.label)}</th>`).join("");
  const body = pageRows
    .map((r) => {
      const cells = columns.map((c, idx) => {
        if (idx === 0) {
          const label = r[c.key] ?? r.mechanismName ?? "—";
          return `<td>${escapeHtml(label)}${r.smallSample ? `<span class="ims-tag-small">Amostra pequena</span>` : ""}</td>`;
        }
        const v = typeof c.format === "function" ? c.format(r) : r[c.key];
        return `<td class="${c.num ? "num" : ""}">${v ?? "—"}</td>`;
      });
      return `<tr class="${r.smallSample ? "row-warning" : ""}">${cells.join("")}</tr>`;
    })
    .join("");
  return `<div class="table-wrap ims-table-block" data-ims-export-host="${exportId}">
    ${imsTableToolbar(`${countLabel} · ${fmt.format(total)}`, exportId)}
    <table class="gd-table ims-table"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}">Sem dados no recorte.</td></tr>`}</tbody></table>
    ${renderTablePagination(exportId, total)}
  </div>`;
}

function populateFilterOptions() {
  const catalog = state.payload?.catalog || [];
  fillDynamicSelect(
    $("imsMechanism"),
    catalog.map((c) => ({ value: c.id, label: c.name })),
    "Todos",
    state.filters.mechanism,
  );
  fillDynamicSelect($("imsEngineer"), state.payload?.filterOptions?.engineers || [], "Todos", state.filters.engineer);
  fillDynamicSelect($("imsSegment"), state.payload?.filterOptions?.segments || [], "Todos", state.filters.segment);
  fillDynamicSelect($("imsProgram"), programSelectOptions([]), "Todos", state.filters.program);
}

function bindClientTableEvents() {
  const root = $("page-content");
  if (!root || root.dataset.imsClientTablesBound) return;
  root.dataset.imsClientTablesBound = "1";
  root.addEventListener("input", (e) => {
    if (!e.target.classList?.contains("ims-client-search")) return;
    state.clientSearch = e.target.value;
    state.page = 1;
    refreshClientTables();
  });
  root.addEventListener("change", (e) => {
    if (e.target.classList?.contains("ims-page-size")) {
      state.pageSize = Number(e.target.value) || 10;
      state.page = 1;
      refreshClientTables();
      return;
    }
    if (e.target.classList?.contains("ims-table-page-size")) {
      const exportId = e.target.dataset.tableExport;
      if (!exportId) return;
      getTablePager(exportId).pageSize = Number(e.target.value) || 10;
      getTablePager(exportId).page = 1;
      updatePaginatedGenericTables();
    }
  });
  root.addEventListener("click", (e) => {
    if (e.target.classList?.contains("ims-client-prev")) {
      state.page -= 1;
      refreshClientTables();
    }
    if (e.target.classList?.contains("ims-client-next")) {
      state.page += 1;
      refreshClientTables();
    }
    if (e.target.classList?.contains("ims-table-prev")) {
      const exportId = e.target.dataset.tableExport;
      if (!exportId) return;
      getTablePager(exportId).page -= 1;
      updatePaginatedGenericTables();
    }
    if (e.target.classList?.contains("ims-table-next")) {
      const exportId = e.target.dataset.tableExport;
      if (!exportId) return;
      getTablePager(exportId).page += 1;
      updatePaginatedGenericTables();
    }
  });
}

function refreshClientTables() {
  const withHost = $("imsClientsWithMech");
  const withoutHost = $("imsClientsWithoutMech");
  const allHost = $("imsClientsAllNps");
  if (withHost) withHost.innerHTML = renderClientTableSection("withMech");
  if (withoutHost) withoutHost.innerHTML = renderClientTableSection("withoutMech");
  if (allHost) allHost.innerHTML = renderClientTableSection("all");
  rootSyncClientControls();
  bindImsExportsForPage($("page-content"));
}

function rootSyncClientControls() {
  const root = $("page-content");
  if (!root) return;
  root.querySelectorAll(".ims-client-search").forEach((el) => {
    el.value = state.clientSearch;
  });
  root.querySelectorAll(".ims-page-size").forEach((el) => {
    el.value = String(state.pageSize);
  });
  rootSyncTableControls();
}

function rootSyncTableControls() {
  const root = $("page-content");
  if (!root) return;
  root.querySelectorAll(".ims-table-page-size").forEach((el) => {
    const id = el.dataset.tableExport;
    if (id) el.value = String(getTablePager(id).pageSize);
  });
}

function updatePaginatedGenericTables() {
  const p = state.payload;
  if (!p) return;
  fillImsGenericTableSections(p);
  fillProjecaoHorizonteTable(p);
  rootSyncTableControls();
  bindImsExportsForPage($("page-content"));
}

function fillImsGenericTableSections(p) {
  const rankRows = (p.mechanismRanking || []).map((r) => ({
    ...r,
    smallSample: r.clientsWithNps < IMS_SMALL_SAMPLE_N,
  }));
  const rankHost = $("imsNpsRanking");
  if (rankHost) {
    rankHost.innerHTML = renderGenericTable(
      [
        { label: "Mecanismo", key: "mechanismName" },
        { label: "Clientes c/ NPS", key: "clientsWithNps", num: true, format: (r) => fmt.format(r.clientsWithNps ?? 0) },
        { label: "Nota média", key: "meanScore", num: true, format: (r) => num1(r.meanScore) },
        { label: "NPS", key: "npsIndex", num: true, format: (r) => (r.npsIndex ?? "—") },
        { label: "Prom. %", key: "promotersPct", num: true, format: (r) => pctLabel(r.promotersPct) },
        { label: "Cobertura", key: "coveragePct", num: true, format: (r) => pctLabel(r.coveragePct) },
      ],
      rankRows,
      "nps-ranking",
      "Ranking NPS por mecanismo",
    );
  }
  const csatHost = $("imsCsatRanking");
  if (csatHost) {
    csatHost.innerHTML = renderGenericTable(
      [
        { label: "Mecanismo", key: "mechanismName" },
        { label: "Clientes c/ CSAT", key: "clientsWithCsat", num: true, format: (r) => fmt.format(r.clientsWithCsat) },
        { label: "CSAT médio", key: "meanCsat", num: true, format: (r) => num1(r.meanCsat) },
        { label: "Mediana", key: "medianCsat", num: true, format: (r) => (r.medianCsat ?? "—") },
        { label: "Satisfeitos %", key: "satisfiedPct", num: true, format: (r) => pctLabel(r.satisfiedPct) },
        { label: "Não satisfeitos %", key: "unsatisfiedPct", num: true, format: (r) => pctLabel(r.unsatisfiedPct) },
        { label: "Cobertura", key: "coveragePct", num: true, format: (r) => pctLabel(r.coveragePct) },
      ],
      (p.csatAnalysis?.mechanismRanking || []).map((r) => ({ ...r, smallSample: r.clientsWithCsat < IMS_SMALL_SAMPLE_N })),
      "csat-ranking",
      "CSAT por mecanismo",
    );
  }
  const renHost = $("imsRenewalRanking");
  if (renHost) {
    renHost.innerHTML = renderGenericTable(
      [
        { label: "Mecanismo", key: "mechanismName" },
        { label: "Elegíveis", key: "eligible", num: true, format: (r) => fmt.format(r.eligible) },
        { label: "Renovaram", key: "renewed", num: true, format: (r) => fmt.format(r.renewed) },
        { label: "Taxa %", key: "renewalRatePct", num: true, format: (r) => pctLabel(r.renewalRatePct) },
        { label: "Δ vs sem mec.", key: "diffVsWithoutMechanismPct", num: true, format: (r) => pctLabel(r.diffVsWithoutMechanismPct) },
      ],
      (p.renewalAnalysis?.mechanismRanking || []).map((r) => ({ ...r, smallSample: r.eligible < IMS_SMALL_SAMPLE_N })),
      "renewal-ranking",
      "Renovação por mecanismo",
    );
  }
  const tempHost = $("imsTemporalTable");
  if (tempHost) {
    tempHost.innerHTML = renderGenericTable(
      [
        { label: "Mecanismo", key: "mechanismName" },
        { label: "Antes NPS", key: "before", num: true, format: (r) => fmt.format(r.before) },
        { label: "Depois NPS", key: "after", num: true, format: (r) => fmt.format(r.after) },
        { label: "Sem data", key: "noData", num: true, format: (r) => fmt.format(r.noData) },
      ],
      p.temporal?.byMechanism || [],
      "temporal-mech",
      "Temporal por mecanismo",
    );
  }
}

function matrixExportRows(model) {
  if (!model?.rows?.length) return [];
  const cols = model.columns || [];
  return model.rows.map((row) => {
    const out = { mechanism: row.label };
    for (const col of cols) {
      const cell = row.cells?.[col.id] || {};
      const isAssoc = ["promoter", "neutral", "detractor"].includes(col.id);
      const v = isAssoc ? cell.association : cell.value;
      out[col.id] = v == null ? "" : v;
      if (isAssoc && cell.n != null) out[`${col.id}_n`] = cell.n;
    }
    return out;
  });
}

function clientExportColumns(showMechanismCols) {
  const base = [
    { header: "Cliente", key: "clientName" },
    { header: "Código", key: "clientCode" },
    { header: "EP", key: "ep" },
    { header: "Programa", key: "program" },
    { header: "Segmento", key: "segment" },
    { header: "Nota NPS", key: "npsScore", type: "number" },
    { header: "Classe NPS", key: "npsClass" },
    { header: "Data NPS", key: "npsDate" },
  ];
  if (showMechanismCols) {
    base.push({ header: "Quantidade mecanismos", key: "mechanismCount", type: "number" });
    base.push({ header: "Mecanismos", key: "mechanismNames" });
  }
  return base;
}

function bindImsExportsForPage(root) {
  if (!root || !state.payload) return;
  const p = state.payload;
  bindImsExport(root, "com-sem", () => ({
    slug: "comparacao_nps",
    columns: [
      { header: "Indicador", key: "indicator" },
      { header: "Com mecanismo", key: "with" },
      { header: "Sem mecanismo", key: "without" },
      { header: "Diferença", key: "diff" },
    ],
    rows: p.comVsSem?.table || [],
  }));
  bindImsExport(root, "csat-com-sem", () => ({
    slug: "csat_comparacao",
    columns: [
      { header: "Indicador", key: "indicator" },
      { header: "Com mecanismo", key: "with" },
      { header: "Sem mecanismo", key: "without" },
      { header: "Diferença", key: "diff" },
    ],
    rows: p.csatAnalysis?.comVsSem?.table || [],
  }));
  bindImsExport(root, "renewal-com-sem", () => ({
    slug: "renovacao_comparacao",
    columns: [
      { header: "Indicador", key: "indicator" },
      { header: "Com mecanismo", key: "with" },
      { header: "Sem mecanismo", key: "without" },
      { header: "Diferença", key: "diff" },
    ],
    rows: p.renewalAnalysis?.comVsSem?.table || [],
  }));
  bindImsExport(root, "nps-ranking", () => ({
    slug: "mecanismos_nps",
    columns: [
      { header: "Mecanismo", key: "mechanismName" },
      { header: "Clientes c/ NPS", key: "clientsWithNps", type: "number" },
      { header: "Nota média", key: "meanScore", type: "number" },
      { header: "NPS", key: "npsIndex", type: "number" },
    ],
    rows: p.mechanismRanking || [],
  }));
  bindImsExport(root, "csat-ranking", () => ({
    slug: "mecanismos_csat",
    columns: [
      { header: "Mecanismo", key: "mechanismName" },
      { header: "Clientes c/ CSAT", key: "clientsWithCsat", type: "number" },
      { header: "CSAT médio", key: "meanCsat", type: "number" },
    ],
    rows: p.csatAnalysis?.mechanismRanking || [],
  }));
  bindImsExport(root, "renewal-ranking", () => ({
    slug: "mecanismos_renovacao",
    columns: [
      { header: "Mecanismo", key: "mechanismName" },
      { header: "Elegíveis", key: "eligible", type: "number" },
      { header: "Renovaram", key: "renewed", type: "number" },
      { header: "Taxa %", key: "renewalRatePct", type: "number" },
    ],
    rows: p.renewalAnalysis?.mechanismRanking || [],
  }));
  bindImsExport(root, "temporal-mech", () => ({
    slug: "temporal_mecanismos",
    columns: [
      { header: "Mecanismo", key: "mechanismName" },
      { header: "Antes NPS", key: "before", type: "number" },
      { header: "Depois NPS", key: "after", type: "number" },
      { header: "Sem data", key: "noData", type: "number" },
    ],
    rows: p.temporal?.byMechanism || [],
  }));
  bindImsExport(root, "matrix", () => {
    const cols = p.mechanismMatrix?.columns || [];
    const columns = [
      { header: "Mecanismo", key: "mechanism" },
      ...cols.map((c) => ({ header: c.label, key: c.id, type: "number" })),
    ];
    return { slug: "matriz_mecanismos_nps", columns, rows: matrixExportRows(p.mechanismMatrix) };
  });
  bindImsExport(root, "clients-with-mech", () => ({
    slug: "clientes_com_mecanismo_nps",
    columns: clientExportColumns(true),
    rows: filterClientRowsByKind("withMech"),
  }));
  bindImsExport(root, "clients-without-mech", () => ({
    slug: "clientes_sem_mecanismo_nps",
    columns: clientExportColumns(false),
    rows: filterClientRowsByKind("withoutMech"),
  }));
  bindImsExport(root, "clients-all-nps", () => ({
    slug: "clientes_por_nota_nps",
    columns: [
      ...clientExportColumns(false),
      { header: "Possui mecanismo", key: "hasMechanism" },
      { header: "Quantidade mecanismos", key: "mechanismCount", type: "number" },
      { header: "Mecanismos", key: "mechanismNames" },
    ],
    rows: filterClientRowsByKind("all").map((r) => ({
      ...r,
      hasMechanism: r.hasMechanism ? "Sim" : "Não",
    })),
  }));
  bindImsExport(root, "projecao-horizonte", () => {
    const exp = p.renewalYearEndProjection?.exploratory;
    return {
      slug: "projecao_renovacao_proxy_ate_31_12",
      columns: [
        { header: "client_id", key: "client_id" },
        { header: "client_name", key: "client_name" },
        { header: "client_code", key: "client_code" },
        { header: "program", key: "program" },
        { header: "ep", key: "ep" },
        { header: "segment", key: "segment" },
        { header: "cycle_end_date", key: "cycle_end_date" },
        { header: "mechanism_count", key: "mechanism_count", type: "number" },
        { header: "mechanism_names", key: "mechanism_names" },
        { header: "predicted_probability", key: "predicted_probability", type: "number" },
        { header: "expected_contribution", key: "expected_contribution", type: "number" },
      ],
      rows: exp?.exportRows || [],
    };
  });
}

function bindImsClientExports() {
  bindImsExportsForPage($("page-content"));
}

function renderErrorView(message) {
  const content = $("page-content");
  if (!content) return;
  content.innerHTML = `<div class="gd-status" role="alert">
    <strong>Não foi possível carregar Mecanismos × Satisfação.</strong>
    <span>${escapeHtml(message || "Erro desconhecido.")}</span>
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="imsRetry">Tentar novamente</button></div>
  </div>`;
  $("imsRetry")?.addEventListener("click", () => void loadData(true));
}

function renderLoadingView() {
  const content = $("page-content");
  if (!content) return;
  content.innerHTML = `<div class="gd-status" role="status">
    <strong>Carregando análise interna</strong>
    <span>Consultando mecanismos, NPS, CSAT e renovação…</span>
  </div>`;
}

function renderStateView() {
  if (state.error && !state.payload) {
    renderErrorView(state.error);
    return;
  }
  if (state.loading && !state.payload) {
    renderLoadingView();
    return;
  }
  if (state.payload) renderSuccess();
}

function renderSuccess() {
  const p = state.payload;
  const s = p?.summary || {};
  const pop = p?.population || {};
  const join = p?.npsJoin || pop?.npsMeta || {};
  const npsTotal =
    Number(s.clientsWithNps)
    || Number(pop.clientsWithNps)
    || (Number(s.withNpsAndMechanism) || 0) + (Number(s.withNpsWithoutMechanism) || 0);
  const content = $("page-content");
  if (!content || !p) return;

  content.classList.add("ims-page");
  content.innerHTML = `
    <p class="sc-methodology-banner"><span class="badge badge-meta">Análise interna</span> ${escapeHtml(p.methodology?.causalNote || "")}</p>
    <p class="note-muted">${escapeHtml(p.methodology?.primaryUniverse || "")} · ${escapeHtml(p.filterDefaults?.note || "")}
      ${join.rawResponses != null ? ` · Respostas NPS (bruto): ${join.rawResponses} · Dedupe: ${join.dedupedClients ?? "—"} · Match BASE: ${join.matchedToBaseClients ?? "—"}` : ""}</p>
    <section class="section-block">
      <h2>1. População com NPS válido</h2>
      <div class="kpi-row">
        ${kpiCard("Clientes com NPS", fmt.format(npsTotal), "Clientes únicos com NPS válido")}
        ${kpiCard("Com NPS + mecanismo", fmt.format(s.withNpsAndMechanism ?? 0), "Grupo A")}
        ${kpiCard("Com NPS + sem mecanismo", fmt.format(s.withNpsWithoutMechanism ?? 0), "Grupo B")}
        ${kpiCard("Cobertura de mecanismo", pctLabel(s.mechanismCoverageAmongNpsPct), "Entre quem respondeu NPS")}
        ${kpiCard("NPS — com mecanismo", s.npsIndexWithMechanism ?? "—", "Índice −100 a 100", { highlight: true })}
        ${kpiCard("NPS — sem mecanismo", s.npsIndexWithoutMechanism ?? "—", "Índice −100 a 100")}
        ${kpiCard("Nota média — com mec.", num1(s.meanScoreWithMechanism), "Média 0–10")}
        ${kpiCard("Nota média — sem mec.", num1(s.meanScoreWithoutMechanism), "Mediana com/sem no bloco 2")}
      </div>
    </section>
    <section class="section-block">
      <h2>2. Com mecanismo × sem mecanismo (nota e classe NPS)</h2>
      <div id="imsComSem"></div>
    </section>
    <section class="section-block">
      <h2>3. Distribuição das notas 0–10</h2>
      <div id="imsScoreDist"></div>
    </section>
    <section class="section-block">
      <h2>4. Matriz de relações — Mecanismos × NPS</h2>
      <div id="imsMechMatrix"></div>
    </section>
    <section class="section-block">
      <h2>5. Mecanismos específicos (clientes com NPS)</h2>
      <div id="imsNpsRanking"></div>
    </section>
    <section class="section-block">
      <h2>6. Principais insights</h2>
      <div id="imsInsights"></div>
    </section>
    <section class="section-block">
      <h2>7. CSAT × Mecanismos</h2>
      <div id="imsCsat"></div>
    </section>
    <section class="section-block">
      <h2>8. Renovação × Mecanismos</h2>
      <div id="imsRenewal"></div>
    </section>
    <section class="section-block">
      <h2>9. Projeção de renovação até o final do ano</h2>
      <div id="imsRenewalProjection"></div>
    </section>
    <section class="section-block">
      <h2>10. Temporalidade — mecanismo antes do NPS</h2>
      <div id="imsTemporal"></div>
    </section>
    <section class="section-block">
      <h2>11. Clientes com mecanismo + NPS</h2>
      <div id="imsClientsWithMech"></div>
    </section>
    <section class="section-block">
      <h2>12. Clientes com NPS e sem mecanismo</h2>
      <div id="imsClientsWithoutMech"></div>
    </section>
    <section class="section-block">
      <h2>13. Clientes por nota de NPS (todos)</h2>
      <div id="imsClientsAllNps"></div>
    </section>`;

  $("imsComSem").innerHTML = renderComparisonTable(p.comVsSem);
  const dist = p.charts?.scoreDistribution || p.scoreDistribution || [];
  $("imsScoreDist").innerHTML = renderScoreDistributionChart(
    dist,
    s.withNpsAndMechanism,
    s.withNpsWithoutMechanism,
  );
  $("imsMechMatrix").innerHTML = renderMechanismMatrix(p.mechanismMatrix);

  fillImsGenericTableSections(p);

  $("imsInsights").innerHTML = renderInsights(p.insights);

  const diag = p.sectionDiagnostics || {};
  const csat = p.csatAnalysis?.comVsSem;
  const csatDist = p.csatAnalysis?.scoreDistribution || [];
  const csatWithN = csat?.withMechanism?.clientsWithCsat ?? 0;
  const csatWithoutN = csat?.withoutMechanism?.clientsWithCsat ?? 0;
  $("imsCsat").innerHTML = `
    ${renderSectionLead(diag.csat)}
    <div class="ims-subsection"><h3>Com vs sem mecanismo</h3>${diag.csat?.hasData ? renderComparisonTable({ table: csat?.table || [] }, "csat-com-sem") : `<p class="placeholder-note">Sem tabela — ver motivo acima.</p>`}</div>
    <div class="ims-subsection"><h3>Distribuição CSAT (1–5)</h3>${diag.csat?.hasData ? renderScoreDistributionChart(csatDist, csatWithN, csatWithoutN) : `<p class="placeholder-note">Sem respostas CSAT no recorte.</p>`}</div>
    <div class="ims-subsection"><h3>CSAT por mecanismo</h3><div id="imsCsatRanking"></div></div>`;

  const ren = p.renewalAnalysis?.comVsSem;
  $("imsRenewal").innerHTML = `
    ${renderSectionLead(diag.renewal)}
    <div class="ims-subsection"><h3>Com vs sem mecanismo</h3>${diag.renewal?.hasData ? renderComparisonTable({ table: ren?.table || [] }, "renewal-com-sem") : `<p class="placeholder-note">Sem tabela — ver motivo acima.</p>`}</div>
    <div class="ims-subsection"><h3>Renovação por mecanismo</h3><div id="imsRenewalRanking"></div></div>`;

  $("imsRenewalProjection").innerHTML = renderYearEndRenewalProjection(renewalProjectionFromPayload(p));
  fillProjecaoHorizonteTable(p);

  const temp = p.temporal?.npsSummary || {};
  $("imsTemporal").innerHTML = `
    ${renderSectionLead(diag.temporal)}
    <ul class="note-muted">
      <li>Com NPS + mecanismo: ${fmt.format(temp.clientsWithMechanismAndNps ?? 0)}</li>
      <li>Implementado antes do NPS: ${fmt.format(temp.implementedBeforeNps ?? 0)} (${pctLabel(temp.beforePct)})</li>
      <li>Implementado depois do NPS: ${fmt.format(temp.implementedAfterNps ?? 0)} (${pctLabel(temp.afterPct)})</li>
      <li>Sem data suficiente: ${fmt.format(temp.insufficientDates ?? 0)} (${pctLabel(temp.noDataPct)})</li>
    </ul>
    <div id="imsTemporalTable"></div>`;
  fillImsGenericTableSections(p);

  $("imsClientsWithMech").innerHTML = renderClientTableSection("withMech");
  $("imsClientsWithoutMech").innerHTML = renderClientTableSection("withoutMech");
  $("imsClientsAllNps").innerHTML = renderClientTableSection("all");

  bindClientTableEvents();
  bindMatrixTooltips(content);
  bindMatrixViewToggle(content);
  bindMatrixExpand(content);
  bindImsExportsForPage(content);
}

async function loadData(force = false) {
  state.loading = true;
  state.error = null;
  state.detailPayload = null;
  state.page = 1;
  state.tablePager = {};
  renderStateView();
  try {
    let payload = await fetchPageJson(buildApiUrl(), { force, pageId: PAGE_ID });
    if (!renewalProjectionFromPayload(payload)) {
      payload = await fetchPageJson(buildApiUrl(), { force: true, pageId: PAGE_ID });
    }
    state.payload = payload;
    const meta = state.payload?.meta || {};
    const serverCv = meta.serverCalculationVersion || meta.calculationVersion;
    if (
      serverCv
      && serverCv !== IMS_EXPECTED_SERVER_CALCULATION_VERSION
      && typeof console !== "undefined"
      && console.warn
    ) {
      console.warn(
        `[IMS] calculationVersion mismatch client=${IMS_EXPECTED_SERVER_CALCULATION_VERSION} server=${serverCv}`,
      );
    }
    populateFilterOptions();
    registerPageExportContext(PAGE_ID, () => ({
      payload: state.payload,
      filters: state.filters,
      loading: state.loading,
    }));
    renderStateView();
  } catch (error) {
    const mapped = mapLoadError(error);
    state.error = mapped.error || (error instanceof Error ? error.message : String(error));
    if (!state.payload) renderStateView();
  } finally {
    state.loading = false;
    renderStateView();
  }
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
      if (state.payload) populateFilterOptions();
      $("imsStatus") && ($("imsStatus").value = state.filters.status || "active");
      $("imsProgram") && ($("imsProgram").value = state.filters.program || "all");
      $("imsEngineer") && ($("imsEngineer").value = state.filters.engineer || "all");
      $("imsSegment") && ($("imsSegment").value = state.filters.segment || "all");
      $("imsMechanism") && ($("imsMechanism").value = state.filters.mechanism || "all");
      $("imsHasMech") && ($("imsHasMech").value = state.filters.hasMechanism || "all");
      $("imsNpsScore") && ($("imsNpsScore").value = state.filters.npsScore || "all");
      $("imsNpsClass") && ($("imsNpsClass").value = state.filters.npsClass || "all");
      $("imsRenewed") && ($("imsRenewed").value = state.filters.renewed || "all");
      unbindFilters = bindFilterBar({
        host: body,
        fields: FILTER_FIELDS,
        filters: state.filters,
        onChange: () => {
          state.filters = filtersFromForm();
          state.page = 1;
          void loadData(true);
        },
        onClear: () => {
          state.filters = defaultInternalMechanismsSatisfactionFilters();
          state.page = 1;
          renderFilters();
          void loadData(true);
        },
      });
      return unbindFilters;
    },
  });
}

function mountPage() {
  if (state.mounted) return;
  state.mounted = true;
  renderFilters();
  pageRefresh = createPageRefresh({ onRefresh: () => loadData(true) });
  pageRefresh.mount();
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id !== PAGE_ID) return;
    clearPageCache(PAGE_ID);
    mountPage();
    void loadData(true);
  });
}

export function bootInternalMechanismsSatisfaction() {
  bindEvents();
  if (getCurrentPageId() === PAGE_ID) {
    clearPageCache(PAGE_ID);
    mountPage();
    void loadData(true);
  }
}
