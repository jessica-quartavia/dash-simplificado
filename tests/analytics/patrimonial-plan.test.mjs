import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildPatrimonialPlanSummary,
  daysToApproval,
  meanDays,
  toPublicPatrimonialPlanPayload,
} from "../../lib/analytics/patrimonial-plan.mjs";

const now = new Date("2026-08-19T12:00:00.000Z");

test("cálculo de dias até aprovação: contratação → última reunião Central", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const last = new Date("2026-01-11T00:00:00.000Z");
  assert.equal(daysToApproval(start, last, { now }), 10);
});

test("negativos inválidos", () => {
  const start = new Date("2026-02-01T00:00:00.000Z");
  const earlier = new Date("2026-01-15T00:00:00.000Z");
  assert.equal(daysToApproval(start, earlier, { now }), null);
  assert.equal(meanDays([10, -4, 20, null]), 15);
});

test("datas futuras inválidas", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const future = new Date("2026-12-01T00:00:00.000Z");
  assert.equal(daysToApproval(start, future, { now, excludeFuture: true }), null);
  assert.equal(daysToApproval(start, future, { now, excludeFuture: false }), 334);
});

test("cobertura é calculada sobre a carteira", () => {
  const summary = buildPatrimonialPlanSummary({
    now,
    clients: [
      { id: "1", name: "Ana", data_inicio_ciclo: "2026-01-01" },
      { id: "2", name: "Bruno", data_inicio_ciclo: "2026-01-01" },
      { id: "3", name: "Carla", data_inicio_ciclo: "2026-01-01" },
      { id: "4", name: "Dora", data_inicio_ciclo: "2026-01-01" },
    ],
    meetings: [
      { client_id: "1", event_name: "Central de Inteligência", start_time: "2026-01-11T12:00:00.000Z" },
    ],
  });
  assert.equal(summary.eligibleClients, 1);
  assert.equal(summary.totalPopulation, 4);
  assert.equal(summary.coveragePercent, 25);
  assert.equal(summary.value, 10);
  assert.equal(summary.calculation, "mean");
});

test("usa média, não mediana", () => {
  assert.equal(meanDays([10, 20, 100]), 43.33);
});

test("indicadores Plano aprovado e Status do plano ausentes da UI", () => {
  const ui = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../js/patrimonial-plan.js"), "utf8");
  assert.equal(ui.includes("Plano aprovado"), false);
  assert.equal(ui.includes("Status do plano"), false);
  assert.equal(ui.includes("Tempo médio até aprovação"), true);
  const publicPayload = toPublicPatrimonialPlanPayload({
    approvalTime: { value: 40, eligibleClients: 10, totalPopulation: 100, coveragePercent: 10 },
    clients: [{ clientId: "1", clientName: "Ana", planApproved: true, status: "aprovado" }],
  });
  assert.equal(Array.isArray(publicPayload.clients), true);
  assert.equal(publicPayload.clients[0].planApproved, undefined);
  assert.equal(publicPayload.clients[0].status, undefined);
  assert.equal("planApproved" in publicPayload, false);
});
