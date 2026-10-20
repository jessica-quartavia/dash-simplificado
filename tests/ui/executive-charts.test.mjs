import assert from "node:assert/strict";
import { test } from "node:test";
import { acquisitionChurnBalanceCombo, cancellationFlowGrouped } from "../../js/executive-charts.mjs";

test("cancelamentos × intenções — série esparso renderiza 12 meses no eixo", () => {
  const ref = new Date("2026-07-20T12:00:00Z");
  const html = cancellationFlowGrouped(
    [
      { month: "2026-03", intentions: 2, pedidos: 1, effective: 0 },
      { month: "2026-05", intentions: 1, pedidos: 2, effective: 1 },
      { month: "2026-07", intentions: 0, pedidos: 1, effective: 2 },
    ],
    12,
    ref,
  );
  const axisLabels = html.match(/exec-chart-axis-x/g);
  assert.ok(axisLabels);
  assert.equal(axisLabels.length, 12);
  assert.match(html, /Intenções: 0/);
});

test("aquisição × churn — rótulos no topo das barras", () => {
  const html = acquisitionChurnBalanceCombo(
    [
      { month: "2026-01", acquisitions: 720, churn: 42 },
      { month: "2026-02", acquisitions: 0, churn: 0 },
    ],
    12,
  );
  assert.match(html, /exec-chart-bar-value/);
  assert.match(html, />720</);
  assert.match(html, />42</);
  assert.match(html, /exec-chart-balance-line/);
  assert.doesNotMatch(html, /exec-chart-line-label[\s\S]*>720</);
});

test("cancelamentos × intenções — rótulos só quando valor > 0", () => {
  const ref = new Date("2026-07-20T12:00:00Z");
  const html = cancellationFlowGrouped(
    [{ month: "2026-03", intentions: 61, pedidos: 389, effective: 0 }],
    12,
    ref,
  );
  const valueLabels = [...html.matchAll(/class="exec-chart-bar-value"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.ok(valueLabels.includes("61"));
  assert.ok(valueLabels.includes("389"));
  assert.equal(valueLabels.filter((t) => t === "0").length, 0);
});

test("responsividade — janela densa marca classe para ocultar rótulos", () => {
  const ref = new Date("2026-07-20T12:00:00Z");
  const sparse = [{ month: "2026-03", intentions: 5, pedidos: 0, effective: 1 }];
  const html12 = cancellationFlowGrouped(sparse, 12, ref);
  assert.match(html12, /exec-combo-chart--dense-labels/);
});
