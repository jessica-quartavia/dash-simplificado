/** Projeção 31/12 — página Mecanismos × Renovação. */
import { escapeHtml } from "./general-charts.mjs";
import { renderMetricTooltip, METRIC_TOOLTIPS } from "./components/metric-tooltip.js";
import { horizonMonthColumnChart, projectionTopMechanismsHBars } from "./imr-charts.mjs";

const fmt = new Intl.NumberFormat("pt-BR");
const fmt1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function num1(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return fmt1.format(Number(v));
}

function pctLabel(v) {
  if (v == null || !Number.isFinite(Number(v))) return "Sem dados";
  return `${Number(v).toLocaleString("pt-BR")}%`;
}

function kpiCard(label, value, note, options = {}) {
  const classes = ["kpi-card"];
  if (options.highlight) classes.push("kpi-card-highlight");
  if (options.compact) classes.push("kpi-card-compact");
  const labelHtml = options.rawLabel ? label : escapeHtml(label);
  return `<article class="${classes.join(" ")}">
    <div class="kpi-label">${labelHtml}</div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}

function _renewalProjectionFromPayloadUnused(p) {
  return p?.renewalYearEndProjection ?? null;
}

function _renderRenewalPopulationNoteUnused(p) {
  const sum = p?.renewalAnalysis?.populationSummary;
  if (!sum) return "";
  return `<p class="note-muted ims-renewal-universe">Universo: <strong>canonicalRenewalPopulation</strong> — clientes com ciclo/mecanismos no recorte da página, <em>sem exigir NPS</em>. Elegíveis: ${fmt.format(sum.eligible ?? 0)} · Renovados sem mecanismo: ${fmt.format(sum.renewedWithoutMechanism ?? 0)}.</p>`;
}

function renderModelHowToBlock(exp) {
  if (!exp?.available && !exp?.model) return "";
  return `<details class="imr-proj-howto">
    <summary>Como calculamos?</summary>
    <div class="imr-proj-howto-body">
      <ol class="imr-proj-howto-steps">
        <li>Cada cliente no horizonte recebe uma <strong>probabilidade</strong> de renovação.</li>
        <li><strong>Somamos</strong> todas as probabilidades.</li>
        <li>O total é o número <strong>esperado</strong> de renovações.</li>
      </ol>
      <div class="imr-proj-formula-cards">
        <p><span class="imr-proj-formula-label">Renovações esperadas</span> <code class="imr-proj-formula">Σ p<sub>i</sub></code></p>
        <p><span class="imr-proj-formula-label">Expectativa média</span> <code class="imr-proj-formula">Σ p<sub>i</sub> / N</code></p>
      </div>
      <p class="note-muted">Usamos o histórico de clientes semelhantes (programa × quantidade de mecanismos) — sem alterar o Modelo A em produção.</p>
    </div>
  </details>`;
}

function imrProjMiniCard(labelHtml, value, { tip = "" } = {}) {
  const tipAttr = tip ? ` title="${escapeHtml(tip)}"` : "";
  return `<article class="imr-proj-mini-card"${tipAttr}>
    <div class="imr-proj-mini-label">${labelHtml}</div>
    <div class="imr-proj-mini-value">${value}</div>
  </article>`;
}

function imrProjMetricCard(labelHtml, value, note = "") {
  return `<article class="imr-proj-metric-card">
    <div class="imr-proj-metric-card-label">${labelHtml}</div>
    <div class="imr-proj-metric-card-value">${value}</div>
    ${note ? `<div class="imr-proj-metric-card-note">${escapeHtml(note)}</div>` : ""}
  </article>`;
}

function formatRocPct(roc) {
  if (roc == null || !Number.isFinite(Number(roc))) return "—";
  const n = Number(roc);
  const pct = n <= 1 ? n * 100 : n;
  return `${pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function ppDisplay(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return `${n >= 0 ? "+" : ""}${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`;
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
    [`${yearPrefix}-09`]: "set",
    [`${yearPrefix}-10`]: "out",
    [`${yearPrefix}-11`]: "nov",
    [`${yearPrefix}-12`]: "dez",
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
  const durationTip = `p25 = ${dur1.p25 ?? "—"} · mediana = ${dur1.median ?? "—"} · p75 = ${dur1.p75 ?? "—"} (dias)`;
  const durationDisplay =
    dur1.median != null ? `${fmt.format(dur1.median)} dias` : "—";

  const calloutText =
    proj.disclaimer
    || "Usamos data_fim_ciclo como aproximação da próxima janela de renovação. Esta projeção apoia o planejamento — não é métrica oficial de renovação.";

  const horizonSummary = `<section class="imr-proj-block imr-proj-horizon-summary" aria-labelledby="imr-proj-horizon-summary-title">
    <h3 class="imr-proj-block-title" id="imr-proj-horizon-summary-title">Resumo do horizonte</h3>
    <p class="imr-proj-block-sub note-muted">Clientes com fim de ciclo previsto até 31/12 (proxy <code>data_fim_ciclo</code>).</p>
    <div class="imr-proj-horizon-kpis">
      ${imrProjMetricCard("Clientes no horizonte", `<span class="imr-proj-num-lg">${fmt.format(horizonTotal)}</span>`)}
      ${imrProjMetricCard("Pharus", fmt.format(horizon.pharus ?? 0))}
      ${imrProjMetricCard("Davos", fmt.format(horizon.davos ?? 0))}
    </div>
    <p class="imr-proj-callout note-muted" role="note">${escapeHtml(calloutText)}</p>
  </section>`;

  const monthSection =
    monthRows.length
      ? `<section class="imr-proj-block imr-proj-months" aria-labelledby="imr-proj-months-title">
      <h3 class="imr-proj-block-title" id="imr-proj-months-title">Clientes por mês no horizonte</h3>
      <p class="imr-proj-block-sub note-muted">Quantidade de clientes com fim de ciclo previsto em cada mês até 31/12.</p>
      <div class="imr-proj-mini-row">
        ${imrProjMiniCard("Sem data", fmt.format(withoutEnd))}
        ${imrProjMiniCard("Fim de ciclo no passado", fmt.format(qual.pastEndOnActive ?? 0))}
        ${imrProjMiniCard(
          renderMetricTooltip("Duração típica do ciclo 1", METRIC_TOOLTIPS.cycle1DurationMedian),
          durationDisplay,
          { tip: durationTip },
        )}
      </div>
      ${horizonMonthColumnChart(monthRows, monthLabels, horizonTotal)}
    </section>`
      : "";

  const projectionHero = `<section class="imr-proj-block imr-proj-highlight" aria-labelledby="imr-proj-highlight-title">
    <p class="imr-proj-highlight-eyebrow">Projeção até 31/12</p>
    <div class="imr-proj-highlight-grid">
      <div class="imr-proj-highlight-item">
        <span class="imr-proj-highlight-label">Clientes no horizonte</span>
        <span class="imr-proj-highlight-value">${fmt.format(horizonTotal)}</span>
      </div>
      <div class="imr-proj-highlight-item">
        <span class="imr-proj-highlight-label">${renderMetricTooltip("Expectativa média", METRIC_TOOLTIPS.expectativa || METRIC_TOOLTIPS.expectedRate)}</span>
        <span class="imr-proj-highlight-value">${hasModelKpis ? `~${pctLabel(expectedRatePct)}` : "—"}</span>
      </div>
      <div class="imr-proj-highlight-item imr-proj-highlight-accent">
        <span class="imr-proj-highlight-label">${renderMetricTooltip("Renovações esperadas", METRIC_TOOLTIPS.expectedRenewals)}</span>
        <span class="imr-proj-highlight-value">${hasModelKpis ? num1(expectedRenewals) : "—"}</span>
      </div>
      <div class="imr-proj-highlight-item">
        <span class="imr-proj-highlight-label">${renderMetricTooltip("Faixa esperada", METRIC_TOOLTIPS.faixa || METRIC_TOOLTIPS.projectionBand)}</span>
        <span class="imr-proj-highlight-value">${faixaEstimada}</span>
      </div>
    </div>
    <p class="imr-proj-highlight-foot note-muted">Esse número é obtido somando as probabilidades individuais dos clientes no horizonte.</p>
  </section>`;

  const modelPanel =
    (proj.modelProjectionPublished || exp?.available) && exp?.model
      ? `<section class="imr-proj-block imr-proj-validation" aria-labelledby="imr-proj-validation-title">
      <h3 class="imr-proj-block-title" id="imr-proj-validation-title">Validação do modelo</h3>
      <p class="imr-proj-block-sub note-muted">Como avaliamos se as probabilidades do modelo fazem sentido.</p>
      <div class="imr-proj-validation-grid">
        ${imrProjMetricCard("Treino", `<span class="imr-proj-num-md">${fmt.format(exp.model.trainN ?? 0)}</span>`, "clientes")}
        ${imrProjMetricCard("Renovados no treino", fmt.format(exp.model.trainEvents ?? 0))}
        ${imrProjMetricCard(renderMetricTooltip("Taxa base", METRIC_TOOLTIPS.baseRateTraining), exp.model.baseRate != null ? pctLabel(exp.model.baseRate * 100) : "—")}
        ${imrProjMetricCard(renderMetricTooltip("ROC-AUC", METRIC_TOOLTIPS.rocAucExplainer), formatRocPct(exp.model.rocAuc))}
        ${imrProjMetricCard(renderMetricTooltip("Brier", METRIC_TOOLTIPS.brierExplainer), exp.model.brierScore != null ? Number(exp.model.brierScore).toFixed(3) : "—")}
        ${imrProjMetricCard(
          renderMetricTooltip("Calibração", METRIC_TOOLTIPS.calibrationOk),
          exp.model.calibrationOk ? "Adequada" : "Insuficiente",
        )}
      </div>
    </section>`
      : `<p class="note-muted imr-proj-model-placeholder">${escapeHtml(proj.modelProjectionNote || exp?.expectation?.message || "Modelo em validação — expectativa numérica indisponível.")}</p>`;

  const topMechList = exp?.topMechanismsAdjusted || exp?.topMechanisms || [];
  const top3Cards = topMechList
    .map((m, i) => {
      const histRate = m.historicalRatePct != null ? pctLabel(m.historicalRatePct) : "—";
      const meanProb = pctLabel((m.meanPredictedProbability ?? 0) * 100);
      return `<article class="imr-proj-mech-card">
        <div class="imr-proj-mech-rank">#${i + 1}</div>
        <h4 class="imr-proj-mech-name">${escapeHtml(m.mechanismName)}</h4>
        <div class="imr-proj-mech-hero">
          <span class="imr-proj-mech-hero-label">${renderMetricTooltip("Taxa histórica", METRIC_TOOLTIPS.historicalMechanismRate)}</span>
          <span class="imr-proj-mech-hero-value">${histRate}</span>
        </div>
        <div class="imr-proj-mech-meta">
          <div class="imr-proj-mech-meta-row">
            <span class="imr-proj-mech-meta-label">${renderMetricTooltip("Δ vs sem mecanismo", METRIC_TOOLTIPS.deltaVsWithoutMechanism)}</span>
            <span class="imr-proj-mech-meta-value">${ppDisplay(m.diffPp)}</span>
          </div>
          <div class="imr-proj-mech-meta-row">
            <span class="imr-proj-mech-meta-label">N histórico</span>
            <span class="imr-proj-mech-meta-value">${fmt.format(m.historicalN ?? 0)}</span>
          </div>
        </div>
        <div class="imr-proj-mech-horizon">
          <p class="imr-proj-mech-horizon-title">No horizonte atual</p>
          <div class="imr-proj-mech-meta-row">
            <span class="imr-proj-mech-meta-label">Clientes</span>
            <span class="imr-proj-mech-meta-value">${fmt.format(m.horizonClientsWithEndDate ?? 0)}</span>
          </div>
          <div class="imr-proj-mech-meta-row">
            <span class="imr-proj-mech-meta-label">Probabilidade média prevista</span>
            <span class="imr-proj-mech-meta-value">${meanProb}</span>
          </div>
          <div class="imr-proj-mech-meta-row">
            <span class="imr-proj-mech-meta-label">${renderMetricTooltip("Renovações esperadas", METRIC_TOOLTIPS.expectedRenewalsMechanism)}</span>
            <span class="imr-proj-mech-meta-value">${num1(m.expectedRenewalsAmongHorizon)}</span>
          </div>
        </div>
      </article>`;
    })
    .join("");

  const top3Section = top3Cards
    ? `<section class="imr-proj-block imr-proj-top-mech" aria-labelledby="imr-proj-top-title">
      <div class="imr-proj-block-head">
        <span class="imr-proj-badge imr-proj-badge-assoc">${renderMetricTooltip("ASSOCIAÇÃO OBSERVADA", METRIC_TOOLTIPS.associationBadge)}</span>
        <h3 class="imr-proj-block-title" id="imr-proj-top-title">Top 3 mecanismos com maior associação observada à renovação</h3>
      </div>
      <p class="imr-proj-block-sub note-muted">Esses mecanismos apareceram com taxas de renovação historicamente mais altas que o grupo sem mecanismos.</p>
      <p class="imr-proj-causal-note callout-note">Isso não significa que o mecanismo causou a renovação.</p>
      <div class="imr-proj-mech-grid">${top3Cards}</div>
    </section>
    <section class="imr-proj-block imr-proj-top-chart" aria-labelledby="imr-proj-top-chart-title">
      <h4 class="imr-proj-block-title imr-proj-block-title-sm" id="imr-proj-top-chart-title">Taxa histórica — top 3</h4>
      ${projectionTopMechanismsHBars(topMechList)}
    </section>`
    : "";

  const rawRows = exp?.topMechanismsByRawRate || [];
  const rawTable = rawRows.length
    ? `<section class="imr-proj-block imr-proj-raw-rates" aria-labelledby="imr-proj-raw-title">
      <div class="imr-proj-block-head">
        <span class="imr-proj-badge imr-proj-badge-raw">${renderMetricTooltip("TAXA BRUTA", METRIC_TOOLTIPS.rawRateBadge)}</span>
        <h3 class="imr-proj-block-title" id="imr-proj-raw-title">Maiores taxas históricas de renovação</h3>
      </div>
      <p class="imr-proj-block-sub note-muted">Ranking descritivo. Não é o mesmo que associação ajustada.</p>
      <div class="table-wrap">
        <table class="gd-table imr-proj-raw-table">
          <thead><tr>
            <th>Mecanismo</th><th class="num">Taxa</th><th class="num">N</th><th class="num">Renovados</th><th class="num">Δ vs sem mecanismo</th>
          </tr></thead>
          <tbody>${rawRows
            .map(
              (m) => `<tr>
                <td>${escapeHtml(m.mechanismName)}</td>
                <td class="num">${pctLabel(m.historicalRatePct)}</td>
                <td class="num">${fmt.format(m.historicalN ?? 0)}</td>
                <td class="num">${fmt.format(m.historicalRenewed ?? 0)}</td>
                <td class="num">—</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>
      </div>
    </section>`
    : "";

  const mechBandsTable = (exp?.mechanismCountBands || []).length
    ? `<section class="imr-proj-block imr-proj-bands" aria-labelledby="imr-proj-bands-title">
      <h3 class="imr-proj-block-title" id="imr-proj-bands-title">Quantidade de mecanismos no horizonte</h3>
      <div class="table-wrap">
        <table class="gd-table ims-table imr-proj-bands-table">
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
      ? `<section class="imr-proj-block imr-proj-dist" aria-labelledby="imr-proj-dist-title">
      <h3 class="imr-proj-block-title" id="imr-proj-dist-title">Como estão distribuídas as chances de renovação?</h3>
      <p class="note-muted imr-proj-block-sub">Mostra quantos clientes estão em cada faixa de probabilidade estimada pelo Modelo A.</p>
      <div class="imr-proj-dist-chart">${exp.probabilityDistribution
        .map((b) => {
          const max = Math.max(1, ...exp.probabilityDistribution.map((x) => x.count));
          const h = Math.max(4, Math.round((b.count / max) * 88));
          return `<div class="imr-proj-dist-col">
            <span class="imr-proj-dist-value">${fmt.format(b.count)}</span>
            <div class="imr-proj-dist-bar" style="height:${h}px" role="presentation"></div>
            <span class="imr-proj-dist-label">${escapeHtml(b.label)}</span>
          </div>`;
        })
        .join("")}</div>
    </section>`
      : "";

  const extraWarnings = (proj.uiWarnings || [])
    .filter(Boolean)
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("");

  const readHowTo = `<details class="imr-proj-howto imr-proj-howto-read">
      <summary>Como ler esta seção</summary>
      <ul class="imr-proj-howto-list">
        <li><strong>Horizonte</strong> — clientes com fim de ciclo até 31/12 pelo proxy.</li>
        <li><strong>Projeção</strong> — soma das probabilidades individuais.</li>
        <li><strong>Top mecanismos</strong> — associação histórica, não causalidade.</li>
      </ul>
      ${extraWarnings ? `<ul class="note-muted imr-proj-howto-warnings">${extraWarnings}</ul>` : ""}
    </details>`;

  return `
  <div class="imr-projection-layout">
    ${horizonSummary}
    ${monthSection}
    ${projectionHero}
    ${modelPanel}
    ${top3Section}
    ${rawTable}
    ${renderModelHowToBlock(exp)}
    ${readHowTo}
    ${mechBandsTable}
    ${distPanel}
    <div id="imsProjecaoHorizonteTable" class="imr-proj-table-host"></div>
    <p class="note-muted imr-proj-footnote">${escapeHtml(proj.permanenceBiasNote || "")}</p>
    <p class="note-muted imr-proj-footnote">${escapeHtml(proj.causalNote || "")}</p>
  </div>`;
}


export { renderYearEndRenewalProjection, isRenewalProjectionRenderable, renderModelHowToBlock, kpiCard, pctLabel, num1 };
