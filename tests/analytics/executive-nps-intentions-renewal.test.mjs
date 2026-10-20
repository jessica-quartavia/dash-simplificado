import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyNpsScore } from "../../lib/analytics/nps-metrics.mjs";
import { resolveNpsKpiForClientIds } from "../../lib/analytics/satisfaction-metrics.mjs";
import { npsClassificationDistribution } from "../../lib/analytics/satisfaction.mjs";
import {
  buildIntentionVsEffectiveMonthSeries,
  normalizeCancellationIntentionMonthSeries,
} from "../../lib/analytics/cancellations-metrics.mjs";
import { buildRenewalsInferredByMonth } from "../../lib/analytics/renewal-metrics.mjs";
import { renewalFromCycle } from "../../lib/analytics/client-cycle-renewal.mjs";

test("NPS — classes oficiais 9–10 / 7–8 / 0–6", () => {
  assert.equal(classifyNpsScore(10), "promoter");
  assert.equal(classifyNpsScore(8), "passive");
  assert.equal(classifyNpsScore(6), "detractor");
});

test("NPS — dedupe antes de agregar no recorte", () => {
  const kpi = resolveNpsKpiForClientIds(
    [
      { client_id: "a", score: 6, submitted_at: "2026-01-01", tipo_de_forms: "NPS" },
      { client_id: "a", score: 10, submitted_at: "2026-02-01", tipo_de_forms: "NPS" },
    ],
    ["a"],
    new Map(),
    "all",
  );
  assert.equal(kpi.promoters, 1);
  assert.equal(kpi.detractors, 0);
  assert.equal(kpi.nps, 100);
});

test("NPS — promotores/neutros/detratores para render", () => {
  const dist = npsClassificationDistribution({ n: 10, promoters: 7, neutrals: 1, detractors: 2 });
  assert.equal(dist.find((d) => d.label === "Promotores")?.count, 7);
  assert.equal(dist.find((d) => d.label === "Neutros")?.count, 1);
  assert.equal(dist.find((d) => d.label === "Detratores")?.count, 2);
  assert.equal(dist.find((d) => d.label === "Promotores")?.percent, 70);
});

test("NPS KPI recorte — percentuais do split bar batem com NPS", () => {
  const kpi = resolveNpsKpiForClientIds(
    [
      { client_id: "a", score: 10, submitted_at: "2026-02-01", tipo_de_forms: "NPS" },
      { client_id: "b", score: 5, submitted_at: "2026-02-01", tipo_de_forms: "NPS" },
    ],
    ["a", "b"],
    new Map(),
    "all",
  );
  const dist = npsClassificationDistribution(kpi);
  assert.equal(kpi.n, 2);
  assert.equal(dist.find((d) => d.label === "Promotores")?.percent, 50);
  assert.equal(dist.find((d) => d.label === "Detratores")?.percent, 50);
});

test("renovação — filtro de período restringe meses", () => {
  const rows = [
    { cycleValid: true, renewed: true, contractDate: "2026-01-15" },
    { cycleValid: true, renewed: true, contractDate: "2026-03-15" },
  ];
  const jan = buildRenewalsInferredByMonth(rows, {
    period: { active: true, from: new Date("2026-01-01"), to: new Date("2026-01-31T23:59:59") },
  });
  const all = buildRenewalsInferredByMonth(rows, { period: { active: false } });
  assert.equal(jan.length, 1);
  assert.equal(all.length, 2);
});

test("cancelamentos mensais — payload esparso preenche 12 meses", () => {
  const ref = new Date("2026-07-20T12:00:00Z");
  const filled = normalizeCancellationIntentionMonthSeries(
    [
      { month: "2026-03", intentions: 2, pedidos: 1, effective: 0 },
      { month: "2026-05", intentions: 1, pedidos: 2, effective: 1 },
      { month: "2026-07", intentions: 0, pedidos: 1, effective: 2 },
    ],
    ref,
    12,
  );
  assert.equal(filled.length, 12);
  assert.equal(filled.find((r) => r.month === "2026-04")?.intentions, 0);
  assert.equal(filled.find((r) => r.month === "2026-03")?.pedidos, 1);
});

test("intenções — pedido e churn em séries separadas", () => {
  const series = buildIntentionVsEffectiveMonthSeries(
    [
      {
        clientId: "1",
        intencaoAt: "2026-03-10",
        pedidoAt: "2026-03-12",
        effectiveCancellationDate: "2026-04-01",
        hasEfetivado: true,
      },
    ],
    { active: false },
    new Date("2026-06-01T12:00:00Z"),
  );
  const mar = series.find((r) => r.month === "2026-03");
  const apr = series.find((r) => r.month === "2026-04");
  assert.equal(mar?.intentions, 1);
  assert.equal(mar?.pedidos, 1);
  assert.equal(apr?.effective, 1);
  assert.equal(mar?.effective, 0);
});

test("renovação — proxy mensal e ciclo oficial", () => {
  assert.deepEqual(renewalFromCycle(3).renewalCount, 2);
  const monthly = buildRenewalsInferredByMonth(
    [
      {
        cycleValid: true,
        renewed: true,
        contractDate: "2026-02-15",
        renewalCount: 2,
        currentCycle: 3,
      },
    ],
    { period: { active: false } },
    new Date("2026-06-01T12:00:00Z"),
  );
  assert.equal(monthly[0].count, 1);
  assert.equal(monthly[0].month, "2026-02");
});
