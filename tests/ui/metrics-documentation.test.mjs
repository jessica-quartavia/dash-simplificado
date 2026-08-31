import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  METRIC_DOCUMENTATION,
  METRIC_DOCUMENTATION_SECTIONS,
  getMetricDocumentationById,
  metricDocumentationSummary,
  searchMetricDocumentation,
} from "../../lib/analytics/metric-documentation-registry.mjs";
import { getPageById, resolvePageFromHash } from "../../js/pages.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

globalThis.location ??= {
  hostname: "localhost",
  search: "",
  hash: "",
  href: "http://localhost:3000/",
  origin: "http://localhost:3000",
};
globalThis.window ??= { location: globalThis.location };
globalThis.document ??= { addEventListener() {}, getElementById() { return null; } };

const {
  renderMetricDocumentationPage,
  scrollToDocumentationSection,
} = await import("../../js/metrics-documentation.js");

test("página possui rota SPA, menu e boot próprios", () => {
  const page = getPageById("metrics_documentation");
  assert.equal(page?.implemented, true);
  assert.equal(page?.group, "system");
  assert.equal(page?.navLabel, "Documentação de Métricas");
  assert.equal(resolvePageFromHash("#metrics-documentation")?.id, "metrics_documentation");
  const appSource = readFileSync(resolve(ROOT, "js/app.js"), "utf8");
  assert.match(appSource, /bootMetricsDocumentation/);
});

test("registry tem campos obrigatórios, seções válidas e métricas únicas", () => {
  const sectionIds = new Set(METRIC_DOCUMENTATION_SECTIONS.map((section) => section.id));
  const ids = new Set();
  const titles = new Set();
  for (const item of METRIC_DOCUMENTATION) {
    assert.ok(item.id);
    assert.ok(item.title);
    assert.ok(item.meaning);
    assert.ok(item.rule);
    assert.ok(item.source);
    assert.ok(item.status);
    assert.ok(sectionIds.has(item.section), `seção inválida: ${item.section}`);
    assert.equal(ids.has(item.id), false, `id duplicado: ${item.id}`);
    assert.equal(titles.has(item.title), false, `título duplicado: ${item.title}`);
    ids.add(item.id);
    titles.add(item.title);
  }
  assert.equal(metricDocumentationSummary().sections, 14);
});

test("busca encontra NPS e reunião sem request", () => {
  assert.ok(searchMetricDocumentation("NPS").some((item) => item.id === "nps"));
  assert.ok(searchMetricDocumentation("reunião").some((item) => item.id === "total-meetings"));
});

test("busca sem resultado renderiza estado vazio", () => {
  const previousDocument = globalThis.document;
  const content = { innerHTML: "" };
  globalThis.document = { getElementById: (id) => (id === "page-content" ? content : null) };
  try {
    renderMetricDocumentationPage("termo-que-nao-existe-987");
    assert.match(content.innerHTML, /Nenhuma métrica encontrada/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("accordions e índice interno são renderizados", () => {
  const previousDocument = globalThis.document;
  const content = { innerHTML: "" };
  globalThis.document = { getElementById: (id) => (id === "page-content" ? content : null) };
  try {
    renderMetricDocumentationPage("");
    assert.match(content.innerHTML, /<details class="metric-doc-section"/);
    assert.match(content.innerHTML, /data-doc-section="meetings"/);
    assert.match(content.innerHTML, /id="metric-doc-clients"[^>]* open/);
    assert.match(content.innerHTML, /id="metric-doc-cancellation"[^>]* open/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("índice abre a seção e solicita rolagem", () => {
  let scrolled = false;
  const target = {
    open: false,
    scrollIntoView(options) {
      scrolled = options?.behavior === "smooth";
    },
  };
  const root = { getElementById: (id) => (id === "metric-doc-meetings" ? target : null) };
  assert.equal(scrollToDocumentationSection("meetings", root), true);
  assert.equal(target.open, true);
  assert.equal(scrolled, true);
});

test("Health Score contém somente Reuniões e Possui mecanismo", () => {
  const health = getMetricDocumentationById("health-components");
  assert.deepEqual(health.components, ["meetingCount", "hasMechanism"]);
  assert.match(health.rule, /quantidade de mecanismos não é usada/i);
});

test("NPS usa fórmula oficial e programa da BASE QV", () => {
  const nps = getMetricDocumentationById("nps");
  assert.match(nps.rule, /\(Promotores − Detratores\) ÷ respostas válidas × 100/);
  assert.ok(nps.ruleKeys.includes("programFromBaseQv"));
  assert.match(nps.rule, /não é a média entre Pharus e Davos/i);
});

test("cliente ativo usa status analítico, não apenas status cru", () => {
  const active = getMetricDocumentationById("active-client");
  assert.ok(active.ruleKeys.includes("analyticalStatus"));
  assert.ok(active.ruleKeys.includes("effectiveCancellation"));
  assert.match(active.rule, /congelados não entram/i);
});

test("Resumo Executivo referencia regras compartilhadas existentes", () => {
  const executive = getMetricDocumentationById("executive-summary");
  assert.ok(executive.sharedRules.length >= 4);
  for (const id of executive.sharedRules) {
    assert.ok(getMetricDocumentationById(id), `regra compartilhada ausente: ${id}`);
  }
  assert.match(executive.meaning, /não cria métricas novas/i);
});
