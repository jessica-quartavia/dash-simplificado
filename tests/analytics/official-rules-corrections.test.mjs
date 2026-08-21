import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANALYTICAL_STATUS,
  isDistratoTextSigned,
  portfolioStatusBucket,
  PORTFOLIO_STATUS_BUCKET,
  resolveAnalyticalStatusFromMaps,
} from "../../lib/analytics/analytical-cancellation.mjs";
import { buildIntentionDestinationBranches } from "../../lib/analytics/cancellations-metrics.mjs";
import { buildCancellationProcessMap } from "../../lib/analytics/cancellation-process.mjs";
import { summarizeMechanismRows } from "../../lib/analytics/mechanism-metrics.mjs";
import { summarizeGeneralRows } from "../../lib/analytics/general-metrics.mjs";
import { extractExecutiveMetrics } from "../../lib/analytics/executive-summary-extractors.mjs";

test("A — Congelado + churn efetivado → Cancelado confirmado, não Congelado", () => {
  const status = resolveAnalyticalStatusFromMaps("Congelado", {
    isCancelled: true,
    hasConfirmedDate: true,
    date: new Date("2024-06-01T00:00:00Z"),
  });
  assert.equal(status, ANALYTICAL_STATUS.CANCELLED_CONFIRMED);
  assert.notEqual(status, ANALYTICAL_STATUS.FROZEN);
  const summary = summarizeGeneralRows([
    { analyticalStatus: status },
    { analyticalStatus: ANALYTICAL_STATUS.FROZEN },
  ]);
  assert.equal(summary.frozenClients, 1);
});

test("B — Status Cancelado sem evidência → marcado sem confirmação", () => {
  const status = resolveAnalyticalStatusFromMaps("Cancelado", null);
  assert.equal(status, ANALYTICAL_STATUS.CANCELLED_MARKED_NO_EVIDENCE);
  assert.equal(portfolioStatusBucket(status), PORTFOLIO_STATUS_BUCKET.UNCONFIRMED_CANCELLATION);
});

test("C/D — distrato Não assinado vs Assinado", () => {
  assert.equal(isDistratoTextSigned("Não assinado"), false);
  assert.equal(isDistratoTextSigned("Assinado"), true);
});

test("E — archived sem efetivação → Arquivado no destino, não confirmado", () => {
  const rows = [{ clientId: "1", hasIntentionOrPedido: true, hasEfetivado: false, isArchived: true, isRetido: false }];
  const dest = buildIntentionDestinationBranches(rows);
  assert.equal(dest.branches.find((b) => b.key === "arquivado")?.count, 1);
  assert.equal(dest.branches.find((b) => b.key === "cancelado")?.count, 0);
  const status = resolveAnalyticalStatusFromMaps("Ativo", null);
  assert.equal(status, ANALYTICAL_STATUS.ACTIVE);
});

test("F/G/H/I — destinos exclusivos e fechamento", () => {
  const rows = [
    { clientId: "1", hasIntentionOrPedido: true, hasEfetivado: false, isArchived: false, isRetido: false, inProcessCurrently: true },
    { clientId: "2", hasIntentionOrPedido: true, hasEfetivado: false, isArchived: false, isRetido: true, inProcessCurrently: true },
    { clientId: "3", hasIntentionOrPedido: true, hasEfetivado: false, isArchived: true, isRetido: false, inProcessCurrently: true },
    { clientId: "4", hasIntentionOrPedido: true, hasEfetivado: true, isArchived: false, isRetido: false, inProcessCurrently: false },
  ];
  const dest = buildIntentionDestinationBranches(rows);
  assert.equal(dest.total, 4);
  assert.equal(dest.closure.matchesUniverse, true);
  assert.equal(dest.branches.find((b) => b.key === "em_processo")?.count, 1);
  assert.equal(dest.branches.find((b) => b.key === "retido")?.count, 1);
  assert.equal(dest.branches.find((b) => b.key === "arquivado")?.count, 1);
  assert.equal(dest.branches.find((b) => b.key === "cancelado")?.count, 1);
});

test("J/K — % implantado = implementados ÷ vinculados (clientes distintos)", () => {
  const summary = summarizeMechanismRows(
    [
      {
        clientId: "1",
        available: 3,
        mechanisms: [
          { status: "Implementado", mechanismId: "m1" },
          { status: "Implementado", mechanismId: "m2" },
          { status: "Apto", mechanismId: "m3" },
        ],
      },
      {
        clientId: "2",
        available: 1,
        mechanisms: [{ status: "Apto", mechanismId: "m4" }],
      },
    ],
    { catalog: [], portfolioCount: 2 },
  );
  assert.equal(summary.clientsWithImplementedMechanism, 1);
  assert.equal(summary.clientsWithLinkedMechanisms, 2);
  assert.equal(summary.mechanismImplementationRate, 50);
});

test("process map inclui archived para destino sem efetivar cancelamento confirmado", () => {
  const map = buildCancellationProcessMap(
    [
      {
        client_id: "1",
        intencao_registrada_at: "2024-01-01",
        archived_at: "2024-02-01",
      },
    ],
    { includeArchived: true, clients: [{ id: "1", status: "Ativo" }] },
  );
  const proc = map.map.get("1");
  assert.ok(proc?.hasArchivedRecord || proc?.isArchived);
  assert.equal(proc?.hasEfetivado, false);
});

test("executive mechanismImplementationRate === mechanisms page rate", () => {
  const summary = summarizeMechanismRows(
    [
      { clientId: "1", available: 2, mechanisms: [{ status: "Implementado", mechanismId: "m1" }, { status: "Apto", mechanismId: "m2" }] },
      { clientId: "2", available: 1, mechanisms: [{ status: "Em andamento", mechanismId: "m3" }] },
    ],
    { catalog: [], portfolioCount: 2 },
  );
  const executive = extractExecutiveMetrics({
    mechanisms: { summary, rows: [] },
  });
  assert.equal(executive.clients_implementation_rate?.value, summary.mechanismImplementationRate);
  assert.equal(executive.clients_implementation_rate?.numerator, summary.clientsWithImplementedMechanism);
  assert.equal(executive.clients_implementation_rate?.denominator, summary.clientsWithLinkedMechanisms);
});
