import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  filterPrincipalDiscoveries,
  isRenewalDiscovery,
  PRINCIPAL_DISCOVERIES_PREVIEW,
  shouldShowDiscoveriesToggle,
  visiblePrincipalDiscoveries,
} from "../../js/statistical-discoveries-ui.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scJs = readFileSync(resolve(root, "js/statistical-crosses.js"), "utf8");

const sampleInsights = [
  { id: "1", category: "Cancelamento", title: "A" },
  { id: "2", category: "NPS", title: "B" },
  { id: "3", category: "Permanência", title: "C" },
  { id: "4", category: "Reuniões", title: "D" },
  { id: "5", category: "Mecanismos", title: "E" },
  { id: "6", category: "Renovação", title: "Renovados com maior permanência" },
  { id: "7", section: "renovacao", title: "Sinal de renovação" },
  { id: "8", category: "Risco", title: "F" },
];

test("isRenewalDiscovery reconhece category e section", () => {
  assert.equal(isRenewalDiscovery({ category: "Renovação" }), true);
  assert.equal(isRenewalDiscovery({ section: "renovacao" }), true);
  assert.equal(isRenewalDiscovery({ category: "Cancelamento" }), false);
});

test("filterPrincipalDiscoveries remove Renovação antes do limite", () => {
  const filtered = filterPrincipalDiscoveries(sampleInsights);
  assert.ok(filtered.every((d) => !isRenewalDiscovery(d)));
  assert.equal(filtered.length, 6);
  assert.ok(!filtered.some((d) => /renov/i.test(d.title || "")));
});

test("visiblePrincipalDiscoveries mostra 4 no estado inicial", () => {
  const filtered = filterPrincipalDiscoveries(sampleInsights);
  assert.equal(visiblePrincipalDiscoveries(filtered, false).length, PRINCIPAL_DISCOVERIES_PREVIEW);
  assert.equal(visiblePrincipalDiscoveries(filtered, true).length, filtered.length);
});

test("shouldShowDiscoveriesToggle só com mais de 4 válidas", () => {
  const filtered = filterPrincipalDiscoveries(sampleInsights);
  assert.equal(shouldShowDiscoveriesToggle(filtered), true);
  assert.equal(shouldShowDiscoveriesToggle(filtered.slice(0, 4)), false);
  assert.equal(shouldShowDiscoveriesToggle([]), false);
});

test("ordem preservada após filtro e slice", () => {
  const filtered = filterPrincipalDiscoveries(sampleInsights);
  const visible = visiblePrincipalDiscoveries(filtered, false);
  assert.deepEqual(
    visible.map((d) => d.id),
    ["1", "2", "3", "4"],
  );
});

test("frontend — gráfico Base válida removido da página", () => {
  assert.doesNotMatch(scJs, /scDiffChartHost/);
  assert.doesNotMatch(scJs, /renderActiveCancelledDiffChart/);
  assert.doesNotMatch(scJs, /renderDiffUnitSelect/);
  assert.doesNotMatch(scJs, /Diferença entre ativos e cancelados/);
  assert.match(scJs, /Ver dados de cancelamento \(diferenças\)/);
});

test("frontend — descobertas com limite 4 e toggle condicional", () => {
  assert.match(scJs, /statistical-discoveries-ui\.mjs/);
  assert.match(scJs, /shouldShowDiscoveriesToggle/);
  assert.match(scJs, /Ver todas as descobertas/);
  assert.match(scJs, /Ver menos/);
  assert.match(scJs, /showAllDiscoveries = false/);
  assert.match(scJs, /contentEventsAbort/);
});

test("frontend — seção Renovação permanece na página", () => {
  assert.match(scJs, /id="scSecRenewal"/);
  assert.match(scJs, /Renovados vs não renovados/);
});
