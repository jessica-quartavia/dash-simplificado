import { getCurrentPageId, onPageChange } from "./navigation.js";
import {
  METRIC_DOCUMENTATION,
  METRIC_DOCUMENTATION_SECTIONS,
  metricDocumentationSummary,
  searchMetricDocumentation,
} from "../lib/analytics/metric-documentation-registry.mjs";

const PAGE_ID = "metrics_documentation";
let eventsBound = false;
let query = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusClass(status) {
  if (status === "Oficial") return "is-official";
  if (status === "Experimental") return "is-experimental";
  return "is-validating";
}

export function renderMetricDocumentationCard(item) {
  const fields = [
    ["O que significa", item.meaning],
    ["Como calculamos", item.rule],
    ["Por que essa regra existe", item.why],
    ["Exemplo", item.example],
  ];
  return `<article class="metric-doc-card" data-metric-id="${escapeHtml(item.id)}">
    <header class="metric-doc-card__head">
      <h3>${escapeHtml(item.title)}</h3>
      <span class="metric-doc-status ${statusClass(item.status)}">${escapeHtml(item.status)}</span>
    </header>
    <div class="metric-doc-card__body">
      ${fields.map(([label, value]) => `<div class="metric-doc-field"><h4>${label}</h4><p>${escapeHtml(value)}</p></div>`).join("")}
    </div>
    <footer class="metric-doc-source"><span>Fonte</span><strong>${escapeHtml(item.source)}</strong></footer>
  </article>`;
}

function renderFilters() {
  const host = document.getElementById("page-filters");
  if (!host) return;
  host.classList.add("metric-doc-search-panel");
  host.innerHTML = `<label class="metric-doc-search" for="metricDocumentationSearch">
    <span class="metric-doc-search__icon" aria-hidden="true">⌕</span>
    <span class="sr-only">Buscar métrica</span>
    <input id="metricDocumentationSearch" type="search" placeholder="Buscar métrica" autocomplete="off" value="${escapeHtml(query)}" />
  </label>
  <p class="metric-doc-search-hint">Tente: NPS, reunião, cancelamento ou mecanismo.</p>`;
}

export function renderMetricDocumentationPage(searchQuery = "") {
  const content = document.getElementById("page-content");
  if (!content) return;
  const matches = searchMetricDocumentation(searchQuery);
  const summary = metricDocumentationSummary();
  const searching = Boolean(String(searchQuery).trim());

  const sectionsHtml = METRIC_DOCUMENTATION_SECTIONS.map((section) => {
    const items = matches.filter((item) => item.section === section.id);
    if (!items.length) return "";
    const open = searching || section.open ? " open" : "";
    return `<details class="metric-doc-section" id="metric-doc-${section.id}" data-section-id="${section.id}"${open}>
      <summary>
        <span>${escapeHtml(section.label)}</span>
        <span class="metric-doc-section__count">${items.length} ${items.length === 1 ? "métrica" : "métricas"}</span>
      </summary>
      <div class="metric-doc-grid">${items.map(renderMetricDocumentationCard).join("")}</div>
    </details>`;
  }).join("");

  content.innerHTML = `<div class="metric-doc-page">
    <section class="metric-doc-intro" aria-label="Sobre esta documentação">
      <div>
        <p>Algumas informações do banco precisam de regras para evitar contagens erradas. Aqui mostramos essas regras de forma simples.</p>
        <span>${summary.metrics} métricas em ${summary.sections} seções</span>
      </div>
    </section>
    <nav class="metric-doc-index" aria-label="Índice da documentação">
      ${METRIC_DOCUMENTATION_SECTIONS.map((section) => `<button type="button" data-doc-section="${section.id}">${escapeHtml(section.shortLabel)}</button>`).join("")}
    </nav>
    <div id="metricDocumentationResults" aria-live="polite">
      ${matches.length ? sectionsHtml : `<div class="metric-doc-empty"><span aria-hidden="true">⌕</span><h2>Nenhuma métrica encontrada</h2><p>Tente buscar com outra palavra.</p></div>`}
    </div>
  </div>`;
}

export function scrollToDocumentationSection(sectionId, root = document) {
  const target = root.getElementById?.(`metric-doc-${sectionId}`);
  if (!target) return false;
  target.open = true;
  target.scrollIntoView?.({ behavior: "smooth", block: "start" });
  return true;
}

function mountPage() {
  if (getCurrentPageId() !== PAGE_ID) return;
  query = "";
  renderFilters();
  renderMetricDocumentationPage(query);
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;
  document.addEventListener("input", (event) => {
    const input = event.target.closest?.("#metricDocumentationSearch");
    if (!input || getCurrentPageId() !== PAGE_ID) return;
    query = input.value;
    renderMetricDocumentationPage(query);
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-doc-section]");
    if (!button || getCurrentPageId() !== PAGE_ID) return;
    scrollToDocumentationSection(button.dataset.docSection);
  });
}

export function bootMetricsDocumentation() {
  bindEvents();
  onPageChange((page) => {
    if (page.id === PAGE_ID) mountPage();
  });
  if (getCurrentPageId() === PAGE_ID) mountPage();
}

export const METRICS_DOCUMENTATION_PAGE_ID = PAGE_ID;
export const DOCUMENTED_METRICS = METRIC_DOCUMENTATION;
