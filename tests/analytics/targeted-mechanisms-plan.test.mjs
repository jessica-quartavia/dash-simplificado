import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accumulateMechanismSourceSum,
  mechanismDataOriginLabel,
  summarizeMechanismRows,
} from "../../lib/analytics/mechanism-metrics.mjs";
import {
  defaultMechanismFilters,
  filterMechanismClients,
} from "../../lib/analytics/mechanism-filters.mjs";
import { medianDays } from "../../lib/analytics/patrimonial-plan.mjs";
import { summarizeFilteredPlanClients } from "../../lib/analytics/patrimonial-plan-filters.mjs";
import { comparePlanApproval } from "../../lib/analytics/targeted-fidelity.mjs";

test("accumulateMechanismSourceSum conta BASE e App no mesmo cliente", () => {
  const sum = accumulateMechanismSourceSum([
    {
      clientId: "1",
      pharusUserId: "u1",
      mechanisms: [
        { status: "Implementado", mechanismId: "m1", sources: ["base_qv"], pharusUserId: null },
        { status: "Implementado", mechanismId: "m2", sources: ["app_pharus"], pharusUserId: "u1" },
      ],
    },
  ]);
  assert.equal(sum.baseQvDisplayed, 1);
  assert.equal(sum.appPharusDisplayed, 1);
  assert.equal(sum.displayedCombinedTotal, 2);
  assert.equal(sum.clientsWithImplementedMechanism, 2);
  assert.equal(sum.implementedMechanisms, 2);
  assert.equal(sum.aggregationMode, "source_sum");
});

test("Programa=Pharus não infla App Pharus fora do recorte", () => {
  const clients = [
    {
      clientId: "1",
      analyticalStatus: "Ativo",
      program: "Pharus",
      available: 1,
      mechanisms: [{ status: "Implementado", mechanismId: "m1" }],
    },
    {
      clientId: "pharus:99",
      analyticalStatus: "Não informado",
      program: null,
      available: 1,
      mechanisms: [{ status: "Implementado", mechanismId: "m2", sources: ["app_pharus"] }],
    },
  ];
  const filtered = filterMechanismClients(clients, { ...defaultMechanismFilters(), program: "Pharus" });
  const summary = summarizeMechanismRows(filtered, {
    catalog: [],
    portfolioCount: 10,
    pharusAvailable: true,
    consolidationQuality: { clients: { pharusUsersWithMechanisms: 73 } },
  });
  assert.equal(filtered.length, 1);
  assert.equal(summary.baseQvDisplayed, 1);
  assert.equal(summary.appPharusDisplayed, 0);
  assert.equal(summary.clientsWithImplementedMechanism, 1);
});

test("mechanismDataOriginLabel", () => {
  assert.equal(mechanismDataOriginLabel(true, true), "BASE QV + App Pharus");
  assert.equal(mechanismDataOriginLabel(true, false), "BASE QV");
  assert.equal(mechanismDataOriginLabel(false, true), "App Pharus");
});

test("plano patrimonial usa mediana no recorte filtrado", () => {
  const summary = summarizeFilteredPlanClients([
    { daysToApproval: 10 },
    { daysToApproval: 20 },
    { daysToApproval: 30 },
  ]);
  assert.equal(summary.calculation, "median");
  assert.equal(summary.value, 20);
  assert.equal(medianDays([10, 20, 30]), 20);
});

test("comparePlanApproval alinha V1 mediana UI", () => {
  const v1 = {
    clients: [
      { program: "Pharus", daysToApproval: 10 },
      { program: "Pharus", daysToApproval: 30 },
      { program: "Davos", daysToApproval: 100 },
    ],
  };
  const v2 = { clients: v1.clients };
  const cmp = comparePlanApproval(v1, v2, "Pharus");
  assert.equal(cmp.v1Median, 20);
  assert.equal(cmp.v2Median, 20);
  assert.equal(cmp.status, "PASS");
});
