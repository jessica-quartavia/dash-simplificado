import { escapeHtml } from "../general-charts.mjs";

function insightDomId(sectionId, suffix = "") {
  const base = String(sectionId || "insight")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-");
  return suffix ? `${base}-${suffix}` : base;
}

export function renderStatisticalInsightBlock(insight, options = {}) {
  if (!insight?.insight) return "";
  const sectionId = options.sectionId || insight.sectionId;
  const panelId = insightDomId(sectionId, "panel");
  const evidence = (insight.evidence || [])
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  const limitations = (insight.limitations || [])
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");

  return `<aside class="sc-insight" data-sc-insight="${escapeHtml(sectionId)}">
    <div class="sc-insight-head">
      <span class="sc-insight-icon" aria-hidden="true"></span>
      <span class="sc-insight-label">Insight</span>
    </div>
    <p class="sc-insight-summary">${escapeHtml(insight.insight)}</p>
    <button type="button" class="sc-insight-toggle" data-sc-insight-toggle aria-expanded="false" aria-controls="${panelId}">Ver análise</button>
    <div class="sc-insight-panel" id="${panelId}" hidden>
      <div class="sc-insight-section">
        <h4 class="sc-insight-section-title">Evidência</h4>
        <ul class="sc-insight-list">${evidence}</ul>
      </div>
      <div class="sc-insight-section">
        <h4 class="sc-insight-section-title">Interpretação</h4>
        <p class="sc-insight-text">${escapeHtml(insight.interpretation || "")}</p>
      </div>
      <div class="sc-insight-section sc-insight-section--action">
        <h4 class="sc-insight-section-title"><span class="sc-insight-action-icon" aria-hidden="true">→</span> Ação recomendada</h4>
        <p class="sc-insight-text">${escapeHtml(insight.action || "")}</p>
      </div>
      <div class="sc-insight-section sc-insight-section--limits">
        <h4 class="sc-insight-section-title">Limitações</h4>
        <ul class="sc-insight-list sc-insight-list--muted">${limitations}</ul>
      </div>
      <button type="button" class="sc-insight-toggle sc-insight-toggle--collapse" data-sc-insight-toggle aria-expanded="false" aria-controls="${panelId}">Ocultar análise</button>
    </div>
  </aside>`;
}

export function renderStatisticalInsightsForBlock(blockId, getInsightsForBlock) {
  return getInsightsForBlock(blockId)
    .map((insight) => renderStatisticalInsightBlock(insight))
    .join("");
}

export function renderExecutiveReadingBlock(getInsightsForBlock) {
  const items = getInsightsForBlock("scSecExecutiveReading");
  if (!items.length) return "";
  return `<section class="section-block sc-executive-reading" id="scSecExecutiveReading">
    <h2>Leitura executiva</h2>
    ${items.map((insight) => renderStatisticalInsightBlock(insight)).join("")}
  </section>`;
}

export function renderMethodologyNotice(note, details = [], footnote = "") {
  const detailItems = details.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  return `<div class="sc-methodology-banner">
    <p class="sc-methodology-note">${escapeHtml(note)}</p>
    ${details.length ? `<details class="sc-methodology-details"><summary>Detalhes metodológicos</summary><ul>${detailItems}</ul></details>` : ""}
    ${footnote ? `<p class="sc-insight-snapshot-note">${escapeHtml(footnote)}</p>` : ""}
  </div>`;
}

export function renderExecutiveRecommendationsBlock(recommendations, { previewCount = 3 } = {}) {
  const list = Array.isArray(recommendations) ? recommendations : [];
  if (!list.length) return "";
  const preview = list.slice(0, previewCount);
  const rest = list.slice(previewCount);
  const panelId = "scExecRecommendationsPanel";
  const renderItem = (text, index) =>
    `<li><span class="sc-rec-index">${index + 1}.</span> ${escapeHtml(text)}</li>`;

  return `<section class="section-block sc-recommendations-block" id="scSecRecommendations">
    <h2>Recomendações executivas</h2>
    <ol class="sc-recommendations-list">${preview.map((text, i) => renderItem(text, i)).join("")}</ol>
    ${
      rest.length
        ? `<div class="sc-recommendations-more" id="${panelId}" hidden><ol class="sc-recommendations-list" start="${previewCount + 1}">${rest.map((text, i) => renderItem(text, previewCount + i)).join("")}</ol></div>
    <button type="button" class="sc-insight-toggle" data-sc-recommendations-toggle aria-expanded="false" aria-controls="${panelId}">Ver todas</button>`
        : ""
    }
  </section>`;
}

export function renderPageConclusion(text) {
  if (!text) return "";
  return `<section class="section-block sc-page-conclusion" id="scSecConclusion">
    <h2 class="sc-conclusion-title">Conclusão</h2>
    <p class="sc-conclusion-text">${escapeHtml(text)}</p>
  </section>`;
}

function setInsightExpanded(insightRoot, expanded) {
  const panel = insightRoot.querySelector(".sc-insight-panel");
  if (!panel) return;
  panel.hidden = !expanded;
  for (const toggle of insightRoot.querySelectorAll("[data-sc-insight-toggle]")) {
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.textContent = expanded ? "Ocultar análise" : "Ver análise";
  }
}

export function bindStatisticalInsightToggles(root = document) {
  const scope = root?.querySelector ? root : document;
  const unbind = [];

  for (const btn of scope.querySelectorAll("[data-sc-insight-toggle]")) {
    const handler = () => {
      const insightRoot = btn.closest(".sc-insight");
      if (!insightRoot) return;
      const expanded = btn.getAttribute("aria-expanded") === "true";
      setInsightExpanded(insightRoot, !expanded);
    };
    btn.addEventListener("click", handler);
    unbind.push(() => btn.removeEventListener("click", handler));
  }

  for (const btn of scope.querySelectorAll("[data-sc-recommendations-toggle]")) {
    const handler = () => {
      const panelId = btn.getAttribute("aria-controls");
      const panel = panelId ? scope.querySelector(`#${panelId}`) : null;
      if (!panel) return;
      const expanded = btn.getAttribute("aria-expanded") === "true";
      const next = !expanded;
      panel.hidden = !next;
      btn.setAttribute("aria-expanded", next ? "true" : "false");
      btn.textContent = next ? "Ver menos" : "Ver todas";
    };
    btn.addEventListener("click", handler);
    unbind.push(() => btn.removeEventListener("click", handler));
  }

  return () => {
    for (const fn of unbind) fn();
  };
}
