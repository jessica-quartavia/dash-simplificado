import assert from "node:assert/strict";
import { test } from "node:test";
import { renewalFromCycle } from "../../lib/analytics/index.mjs";
import { summarizeRenewalActiveClients } from "../../lib/analytics/renewal-metrics.mjs";

test("ciclo 1 → 0 renovações", () => {
  const result = renewalFromCycle(1);
  assert.equal(result.valid, true);
  assert.equal(result.hasRenewed, false);
  assert.equal(result.renewalCount, 0);
});

test("ciclo 2 → 1 renovação", () => {
  const result = renewalFromCycle(2);
  assert.equal(result.hasRenewed, true);
  assert.equal(result.renewalCount, 1);
});

test("ciclo 3 → 2 renovações", () => {
  const result = renewalFromCycle(3);
  assert.equal(result.hasRenewed, true);
  assert.equal(result.renewalCount, 2);
});

test("renewedActiveRate — ativos renovados sobre ativos, exclui cancelados", () => {
  const summary = summarizeRenewalActiveClients([
    { analyticalStatus: "Ativo", cycleValid: true, renewed: true },
    { analyticalStatus: "Ativo", cycleValid: true, renewed: false },
    { analyticalStatus: "Cancelado", cycleValid: true, renewed: true },
    { analyticalStatus: "Congelado", cycleValid: true, renewed: true },
  ]);
  assert.equal(summary.activeClients, 2);
  assert.equal(summary.renewedActiveClients, 1);
  assert.equal(summary.renewedActiveRate, 50);
});
