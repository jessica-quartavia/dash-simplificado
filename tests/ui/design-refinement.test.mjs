import assert from "node:assert/strict";
import { test } from "node:test";
import { donut } from "../../js/general-charts.mjs";
import { isPageImplemented } from "../../js/pages.js";

test("donut NPS usa cores distintas por categoria", () => {
  const html = donut([
    { label: "Promotores", count: 40, percent: 40 },
    { label: "Neutros", count: 35, percent: 35 },
    { label: "Detratores", count: 25, percent: 25 },
  ]);
  assert.match(html, /stroke="#0a0a0a"/);
  assert.match(html, /stroke="#c4c4c4"/);
  assert.match(html, /stroke="#e85d3a"/);
  assert.doesNotMatch(html, /stroke="#737373".*stroke="#737373".*stroke="#737373"/);
});

test("donut CSAT usa cores distintas", () => {
  const html = donut([
    { label: "Satisfeitos (5)", count: 70, percent: 70 },
    { label: "Não satisfeitos (1-4)", count: 30, percent: 30 },
  ]);
  assert.match(html, /Satisfeitos \(5\)/);
  assert.match(html, /stroke="#0a0a0a"/);
  assert.match(html, /stroke="#737373"/);
});

test("Uso da Plataforma e Acionamentos estão implementados", () => {
  assert.equal(isPageImplemented("platform_usage"), true);
  assert.equal(isPageImplemented("support"), true);
});
