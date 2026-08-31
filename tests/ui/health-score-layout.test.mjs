import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildHealthScoreAnalysis,
  computeFinalHealthScore,
  weightsFromMechanismSlider,
} from "../../lib/analytics/health-score-metrics.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(join(ROOT, "js/health-score.js"), "utf8");

test("health-score.js usa um único slider de peso de mecanismos", () => {
  assert.match(source, /id="hsWeightSlider"/);
  assert.match(source, /type="range"/);
  assert.match(source, /min="0"/);
  assert.match(source, /max="1"/);
  assert.match(source, /step="\$\{HEALTH_SCORE_SLIDER_STEP\}"/);
  assert.match(source, /DEFAULT_MECHANISM_SLIDER/);
  assert.match(source, /Peso das variáveis/);
  assert.match(source, /Engajamento \(Reuniões\)/);
  assert.match(source, /Mecanismos/);
  assert.doesNotMatch(source, /hsWeightMeetings|hsWeightMechanism|hs-presets|HEALTH_SCORE_WEIGHT_PRESETS/);
});

test("health-score.js recalcula no browser sem novo fetch ao mover slider", () => {
  assert.match(source, /state\.mechanismSlider = Number\(slider\.value\)/);
  assert.match(source, /renderPageShell\(\)/);
  const bindBlock = source.slice(source.indexOf("function bindWeightControls"), source.indexOf("function renderFilters"));
  assert.doesNotMatch(bindBlock, /loadData/);
  assert.doesNotMatch(bindBlock, /fetchPageJson/);
});

test("health-score.js mantém filtros e slider visíveis quando API falha", () => {
  assert.match(source, /renderWeightControls\(\)/);
  assert.match(source, /renderResultsArea\(\)/);
  assert.match(source, /Não foi possível carregar os dados do Health Score\./);
  assert.match(source, /id="hsRetry"/);
  assert.doesNotMatch(source, /Não foi possível consultar Health Score\./);
});

test("análise recalcula scores ao mudar slider", () => {
  const rows = [{ clientId: "1", clientName: "A", meetingCount: 10, hasMechanism: false }];
  const meetingsHeavy = buildHealthScoreAnalysis(rows, weightsFromMechanismSlider(0));
  const mechanismHeavy = buildHealthScoreAnalysis(rows, weightsFromMechanismSlider(1));
  assert.equal(meetingsHeavy.clients[0].healthScore, 100);
  assert.equal(mechanismHeavy.clients[0].healthScore, 0);
});

test("score individual muda com slider sem alterar features", () => {
  const meetingScore = 40;
  const mechanismScore = 100;
  const lowMechanism = computeFinalHealthScore(meetingScore, mechanismScore, weightsFromMechanismSlider(0.2));
  const highMechanism = computeFinalHealthScore(meetingScore, mechanismScore, weightsFromMechanismSlider(0.8));
  assert.equal(lowMechanism, 52);
  assert.equal(highMechanism, 88);
});
