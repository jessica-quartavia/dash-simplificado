/** Projeção 31/12 — página Mecanismos × Renovação. */
import { escapeHtml } from "./general-charts.mjs";

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
  return `<article class="${classes.join(" ")}">
    <div class="kpi-label">${escapeHtml(label)}</div>
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
  const audit = exp?.modelAudit;
  if (!audit) return "";
  const perf = audit.performance || {};
  return `<details class="ims-proj-howto ims-proj-model-howto">
    <summary>Como calculamos?</summary>
    <p class="note-muted">Estimamos a chance de renovação de cada cliente usando o comportamento histórico de clientes semelhantes (estratificação programa × faixa de mecanismos). As probabilidades individuais são somadas para estimar o número esperado de renovações.</p>
    <ul class="ims-proj-howto-list">
      <li><strong>Modelo</strong> — ${escapeHtml(audit.algorithm || "—")}</li>
      <li><strong>Amostra treino</strong> — ${fmt.format(audit.sampleSizes?.nTrain ?? 0)} clientes (${fmt.format(audit.sampleSizes?.renewedTrain ?? 0)} renovados)</li>
      <li><strong>ROC-AUC (holdout)</strong> — ${perf.rocAuc ?? "—"} · <strong>PR-AUC</strong> — ${perf.prAuc ?? "—"}</li>
      <li><strong>Brier</strong> — ${perf.brier ?? "—"} (baseline ${perf.baselineBrier ?? "—"})</li>
      <li><strong>Acurácia holdout</strong> — ${perf.accuracy != null ? pctLabel(perf.accuracy * 100) : "—"} · balanced ${perf.balancedAccuracy != null ? pctLabel(perf.balancedAccuracy * 100) : "—"}</li>
      <li><strong>Precisão / Recall</strong> — ${perf.precision != null ? pctLabel(perf.precision * 100) : "—"} / ${perf.recall != null ? pctLabel(perf.recall * 100) : "—"} (limiar ${audit.performance?.threshold ?? 0.5})</li>
      <li><strong>Calibração</strong> — ${audit.calibrationOk ? "adequada para soma de probabilidades" : "atenção"}</li>
    </ul>
    ${audit.interpretationPlain ? `<p class="note-muted">${escapeHtml(audit.interpretationPlain)}</p>` : ""}
  </details>`;
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

  const top3 = (exp?.topMechanismsAdjusted || exp?.topMechanisms || [])
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
    ${renderModelHowToBlock(exp)}

    ${
      top3
        ? `<section class="ims-proj-panel ims-proj-top-mech" aria-labelledby="ims-proj-top-title">
      <h3 class="ims-proj-panel-title" id="ims-proj-top-title">Top 3 mecanismos com maior associação observada à renovação</h3>
      <div class="ims-top-mech-grid">${top3}</div>
    </section>`
        : ""
    }

    ${
      (exp?.topMechanismsByRawRate || []).length
        ? `<section class="ims-proj-panel ims-proj-top-raw" aria-labelledby="ims-proj-raw-title">
      <h3 class="ims-proj-panel-title" id="ims-proj-raw-title">Maiores taxas históricas (referência — não é o Top 3 ajustado)</h3>
      <ul class="note-muted">${(exp.topMechanismsByRawRate || [])
        .map(
          (m, i) =>
            `<li>#${i + 1} ${escapeHtml(m.mechanismName)} — ${pctLabel(m.historicalRatePct)} (N=${fmt.format(m.historicalN)})</li>`,
        )
        .join("")}</ul>
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


export { renderYearEndRenewalProjection, isRenewalProjectionRenderable, renderModelHowToBlock, kpiCard, pctLabel, num1 };
