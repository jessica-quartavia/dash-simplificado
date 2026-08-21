import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  EXECUTIVE_RECOMMENDATIONS,
  STATISTICAL_INSIGHTS,
  STATISTICAL_INSIGHT_PLACEMENTS,
  getInsightsForBlock,
  listRequiredInsightSectionIds,
} from "../../lib/analytics/statistical-insights.mjs";
import { STATISTICAL_SECTIONS } from "../../lib/analytics/statistical-sections.mjs";
import {
  renderExecutiveReadingBlock,
  renderExecutiveRecommendationsBlock,
  renderMethodologyNotice,
  renderStatisticalInsightBlock,
} from "../../js/components/statistical-insight.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scJs = readFileSync(resolve(root, "js/statistical-crosses.js"), "utf8");

test("registry contém todos os sectionIds declarados", () => {
  const ids = listRequiredInsightSectionIds();
  assert.equal(ids.length, STATISTICAL_INSIGHTS.length);
  for (const placement of STATISTICAL_INSIGHT_PLACEMENTS) {
    for (const id of placement.insightIds) {
      assert.ok(ids.includes(id), `missing insight ${id}`);
    }
  }
});

test("cada insight tem campos editoriais completos", () => {
  for (const item of STATISTICAL_INSIGHTS) {
    assert.ok(item.sectionId);
    assert.ok(item.insight);
    assert.ok(item.interpretation);
    assert.ok(item.action);
    assert.ok(Array.isArray(item.evidence) && item.evidence.length);
    assert.ok(Array.isArray(item.limitations) && item.limitations.length);
  }
});

test("render compacto — fechado por padrão com Ver análise", () => {
  const html = renderStatisticalInsightBlock(STATISTICAL_INSIGHTS[0]);
  assert.match(html, /class="sc-insight"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Ver análise/);
  assert.match(html, /hidden/);
  assert.match(html, /Evidência/);
  assert.match(html, /Ação recomendada/);
  assert.match(html, /Limitações/);
});

test("toggle markup expõe aria-controls e botão real", () => {
  const html = renderStatisticalInsightBlock(STATISTICAL_INSIGHTS[0]);
  assert.match(html, /<button type="button"/);
  assert.match(html, /aria-controls="/);
  assert.match(html, /data-sc-insight-toggle/);
  assert.doesNotMatch(html, /position:\s*absolute/);
});

test("recomendações executivas — preview 3 e Ver todas", () => {
  assert.equal(EXECUTIVE_RECOMMENDATIONS.length, 7);
  const html = renderExecutiveRecommendationsBlock(EXECUTIVE_RECOMMENDATIONS, { previewCount: 3 });
  assert.match(html, /Recomendações executivas/);
  assert.match(html, /Ver todas/);
  assert.match(html, /data-sc-recommendations-toggle/);
});

test("statistical-crosses.js injeta insights nas seções corretas", () => {
  assert.match(scJs, /renderExecutiveReadingBlock/);
  assert.match(scJs, /scInsightHtml\("scSecCancel"\)/);
  assert.match(scJs, /scInsightHtml\("scSecNps"\)/);
  assert.match(scJs, /scInsightHtml\("scSecPredict"\)/);
  assert.match(scJs, /renderExecutiveRecommendationsBlock/);
  assert.match(scJs, /renderPageConclusion/);
  assert.match(scJs, /renderMethodologyNotice/);
  assert.match(scJs, /bindStatisticalInsightToggles/);
});

test("ordem V1 das seções analíticas preservada", () => {
  const ids = STATISTICAL_SECTIONS.map((s) => s.id);
  let lastIndex = -1;
  for (const id of ids) {
    const idx = scJs.indexOf(`id="${id}"`);
    assert.ok(idx >= 0, `${id} missing`);
    assert.ok(idx > lastIndex, `${id} out of order`);
    lastIndex = idx;
  }
  const healthIdx = scJs.indexOf('id="scSecHealthCandidates"');
  const resumoIdx = scJs.indexOf('id="scSecResumo"');
  assert.ok(healthIdx > 0 && resumoIdx > healthIdx);
  assert.match(scJs, /renderExecutiveReadingBlock\(getInsightsForBlock\)/);
});

test("insights posicionados após título da seção", () => {
  const cancelH2 = scJs.indexOf("<h2>3. Cancelamento");
  const cancelInsight = scJs.indexOf('scInsightHtml("scSecCancel")');
  const cancelMatrix = scJs.indexOf("Matriz de associação com cancelamento");
  assert.ok(cancelH2 < cancelInsight && cancelInsight < cancelMatrix);
});

test("Health Score permanece bloco separado", () => {
  assert.match(scJs, /scSecHealthCandidates/);
  assert.match(scJs, /Variáveis mais relevantes para Health Score/);
  const renderBlock = scJs.slice(scJs.indexOf("function renderSuccess"));
  const healthIdx = renderBlock.indexOf("${renderHealthScoreCandidatesBlock");
  const readingIdx = renderBlock.indexOf("${renderExecutiveReadingBlock");
  assert.ok(healthIdx > 0 && readingIdx > healthIdx);
});

test("aviso metodológico compacto no topo", () => {
  const html = renderMethodologyNotice("Nota metodológica", ["Detalhe 1"], "Snapshot footnote");
  assert.match(html, /sc-methodology-banner/);
  assert.match(html, /Detalhes metodológicos/);
  assert.match(html, /Snapshot footnote/);
});

test("leitura executiva renderiza dois insights", () => {
  const html = renderExecutiveReadingBlock(getInsightsForBlock);
  assert.match(html, /Leitura executiva/);
  const count = (html.match(/class="sc-insight"/g) || []).length;
  assert.equal(count, 2);
});
