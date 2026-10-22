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

test("aquisição × churn — tooltip pt-BR e linha zero", () => {
  const html = acquisitionChurnBalanceCombo([{ month: "2026-02", acquisitions: 719, churn: 42 }], 12);
  assert.match(html, /Mês:/);
  assert.match(html, /Aquisições: 719/);
  assert.match(html, /Churns: 42/);
  assert.match(html, /Balança: \+677/);
  assert.match(html, /exec-chart-zero/);
  assert.match(html, /Balança acumulada/);
});

test("aquisição × churn — zeros sem rótulo no topo", () => {
  const html = acquisitionChurnBalanceCombo(
    [{ month: "2026-02", acquisitions: 0, churn: 0 }],
    12,
  );
  const labels = [...html.matchAll(/class="exec-chart-bar-value"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.equal(labels.length, 0);
});

test("cancelamentos — tooltip único com três séries em cada barra", () => {
  const ref = new Date("2026-07-20T12:00:00Z");
  const html = cancellationFlowGrouped(
    [{ month: "2026-07", intentions: 9, pedidos: 11, effective: 368 }],
    12,
    ref,
  );
  const titles = [...html.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]);
  const monthTips = titles.filter((t) => /Churn efetivo: 368/.test(t));
  assert.ok(monthTips.length >= 3, "cada barra do mês + hit-area devem compartilhar o mesmo tooltip");
  for (const t of monthTips) {
    assert.match(t, /Intenções: 9/);
    assert.match(t, /Pedidos: 11/);
    assert.match(t, /Churn efetivo: 368/);
  }
});

test("cancelamentos — remove Pedido → churn e renomeia razão", () => {
  const ref = new Date("2026-07-20T12:00:00Z");
  const html = cancellationFlowGrouped(
    [{ month: "2026-03", intentions: 10, pedidos: 9, effective: 1 }],
    12,
    ref,
  );
  assert.doesNotMatch(html, /Pedido\s*→\s*[Cc]hurn/i);
  assert.match(html, /Pedidos \/ Intenções/);
  assert.match(html, /exec-chart-series-note/);
  assert.match(html, /séries são independentes/i);
});
