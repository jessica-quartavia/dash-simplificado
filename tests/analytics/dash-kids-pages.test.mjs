/**
 * Dash Kids — Atualização Financeira, Satisfação, Cancelamento, Renovação.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { isFinancialRecordUpdated } from "../../lib/analytics/financial-updates-metrics.mjs";
import { buildSatisfactionPayload } from "../../lib/analytics/satisfaction.mjs";
import { buildRenewalPayload } from "../../lib/analytics/renewal.mjs";
import { renewalFromCycle } from "../../lib/analytics/client-cycle-renewal.mjs";
import { resolveConsolidatedCancellation } from "../../lib/analytics/analytical-cancellation.mjs";
import { pageShowsPeriodUi, resolveVisibleFilterFields } from "../../lib/analytics/filters/page-contracts.mjs";
import { runFilterCheck } from "../../lib/analytics/filters/filter-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("Atualização Financeira — updated_at > created_at", () => {
  assert.equal(isFinancialRecordUpdated({ created_at: "2024-01-01", updated_at: "2024-01-01" }), false);
  assert.equal(isFinancialRecordUpdated({ created_at: "2024-01-01", updated_at: "2024-02-01" }), true);
});

test("Atualização Financeira — período global na UI (Reuniões/Financeiro/Cancelamento)", () => {
  assert.equal(pageShowsPeriodUi("financial_updates"), true);
  assert.equal(pageShowsPeriodUi("cancellations"), true);
  const fields = resolveVisibleFilterFields("financial_updates", [
    { kind: "search", key: "search" },
    { kind: "period", key: "period" },
    { kind: "select", key: "status" },
    { kind: "multiselect", key: "financialTraits" },
  ]);
  assert.equal(fields.some((f) => f.kind === "period"), true);
  assert.equal(fields.some((f) => f.key === "financialTraits"), true);
});

test("Pesquisa — 7 indicadores, CES ausente", () => {
  const payload = buildSatisfactionPayload({
    clients: [{ id: "1", codigo: "A", name: "Ana", status: "Ativo" }],
    clientMap: new Map([["1", { id: "1", codigo: "A", name: "Ana", status: "Ativo" }]]),
    npsRowsRaw: [
      { id: "n1", client_id: "1", score: 10, created_at: "2026-01-01", typeform_response_id: "r1" },
      { id: "n2", client_id: "1", score: 8, created_at: "2026-02-01", typeform_response_id: "r2" },
    ],
    csatRowsRaw: [{ id: "c1", client_id: "1", score: 5, created_at: "2026-01-01", tipo_de_forms: "CSAT" }],
    npsSends: [],
  });
  assert.equal(payload.summary.nps, 0);
  assert.equal(payload.summary.latestNps, 8);
  assert.match(payload.methodology.npsRule, /submitted_at desc/);
  assert.equal(payload.benchmarks.total.n, 1);
  assert.equal("ces" in payload.summary, false);
});

test("Cancelamento — regra consolidada igual Dados Gerais", () => {
  const info = resolveConsolidatedCancellation(
    { churn_efetivado_at: "2026-03-01T12:00:00.000Z", data_pedido: "2026-01-01T12:00:00.000Z" },
    null,
  );
  assert.equal(info.isCancelled, true);
  const dateText = info.cancellationDate instanceof Date
    ? info.cancellationDate.toISOString()
    : String(info.cancellationDate);
  assert.match(dateText, /2026-03-01/);
});

test("Renovação — ciclo > 1 e renewalCount", () => {
  assert.deepEqual(renewalFromCycle(1), { currentCycle: 1, renewalCount: 0, hasRenewed: false, renewed: false, valid: true, renewedValid: true, invalidReason: null });
  assert.deepEqual(renewalFromCycle(3).renewalCount, 2);
  const payload = buildRenewalPayload({
    clients: [
      { id: "1", codigo: "A", name: "Ana", status: "Ativo", ciclo: 3, engenheiro_patrimonial: "EP" },
      { id: "2", codigo: "B", name: "Bob", status: "Ativo", ciclo: 1, engenheiro_patrimonial: "EP" },
    ],
    cancellations: [],
    financialRows: [],
  });
  assert.equal(payload.summary.renewedClients, 1);
  assert.equal(payload.summary.totalRenewals, 2);
  assert.equal(payload.summary.maxCurrentCycle, 3);
});

test("Renovação — métricas sem fonte não entram no payload", () => {
  const src = readFileSync(resolve(root, "js/renewal.js"), "utf8");
  assert.doesNotMatch(src, /Tempo até renovação/);
  assert.doesNotMatch(src, /Valor da renovação/);
});

test("Filter Check PASS inclui novas páginas", () => {
  const result = runFilterCheck();
  for (const pageId of ["financial_updates", "satisfaction", "cancellations", "renewal"]) {
    assert.equal(result.pages[pageId]?.ok, true, `${pageId}: ${result.pages[pageId]?.checks?.filter((c) => !c.ok).map((c) => c.id).join(", ")}`);
  }
});
