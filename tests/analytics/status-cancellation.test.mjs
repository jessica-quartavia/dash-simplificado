import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANALYTICAL_STATUS,
  buildAnalyticalCancellationMap,
  getAnalyticalCancellation,
  isActiveClient,
  isCancelledClient,
  resolveAnalyticalStatus,
  resolveAnalyticalStatusFromMaps,
  resolveConsolidatedCancellation,
  portfolioStatusBucket,
} from "../../lib/analytics/index.mjs";

test("ativo bruto sem cancelamento → Ativo", () => {
  assert.equal(resolveAnalyticalStatusFromMaps("Ativo", null), ANALYTICAL_STATUS.ACTIVE);
  assert.equal(isActiveClient(ANALYTICAL_STATUS.ACTIVE), true);
});

test("congelado sem cancelamento → Congelado", () => {
  const status = resolveAnalyticalStatusFromMaps("Congelado", null);
  assert.equal(status, ANALYTICAL_STATUS.FROZEN);
  assert.equal(isActiveClient(status), false);
  assert.equal(portfolioStatusBucket(status), "frozen");
});

test("congelado com cancelamento efetivo → Cancelado confirmado (não Congelado)", () => {
  const status = resolveAnalyticalStatusFromMaps("Congelado", {
    isCancelled: true,
    hasConfirmedDate: true,
    date: new Date("2024-06-01T00:00:00Z"),
  });
  assert.equal(status, ANALYTICAL_STATUS.CANCELLED_CONFIRMED);
  assert.notEqual(status, ANALYTICAL_STATUS.FROZEN);
});

test("status bruto ativo + churn efetivado → Cancelado", () => {
  const info = {
    isCancelled: true,
    hasConfirmedDate: true,
    date: new Date("2024-06-01T00:00:00Z"),
    source: "churn_efetivado_at",
  };
  const status = resolveAnalyticalStatusFromMaps("Ativo", info);
  assert.equal(status, ANALYTICAL_STATUS.CANCELLED_CONFIRMED);
  assert.equal(isActiveClient(status), false);
  assert.equal(isCancelledClient(status), true);
});

test("status bruto ativo + distrato assinado → Cancelado", () => {
  const consolidated = resolveConsolidatedCancellation(
    { distrato_assinado_at: "2024-03-10", distrato: "Assinado" },
    { status: "Ativo" },
  );
  assert.equal(consolidated.isCancelled, true);
  assert.equal(consolidated.source, "distrato_assinado_at");
  const status = resolveAnalyticalStatusFromMaps("Ativo", {
    isCancelled: true,
    hasConfirmedDate: consolidated.hasConfirmedDate,
    date: consolidated.cancellationDate,
  });
  assert.equal(status, ANALYTICAL_STATUS.CANCELLED_CONFIRMED);
});

test("status bruto cancelado sem evidência → Marcado como cancelado sem confirmação", () => {
  const status = resolveAnalyticalStatusFromMaps("Cancelado", null);
  assert.equal(status, ANALYTICAL_STATUS.CANCELLED_MARKED_NO_EVIDENCE);
  assert.equal(isActiveClient(status), false);
  assert.equal(isCancelledClient(status), false);
});

test("status vazio → Não informado", () => {
  assert.equal(resolveAnalyticalStatusFromMaps("", null), ANALYTICAL_STATUS.UNKNOWN);
  assert.equal(resolveAnalyticalStatus(null), ANALYTICAL_STATUS.UNKNOWN);
});

test("prioridade: churn > distrato > data_churn", () => {
  const consolidated = resolveConsolidatedCancellation(
    {
      churn_efetivado_at: "2024-04-01",
      distrato_assinado_at: "2024-03-01",
    },
    { data_churn: "2024-02-01" },
  );
  assert.equal(consolidated.source, "churn_efetivado_at");
  assert.equal(consolidated.hasConfirmedDate, true);

  const withoutChurn = resolveConsolidatedCancellation(
    { distrato_assinado_at: "2024-03-01" },
    { data_churn: "2024-02-01" },
  );
  assert.equal(withoutChurn.source, "distrato_assinado_at");

  const onlyDataChurn = resolveConsolidatedCancellation(null, { data_churn: "2024-02-01" });
  assert.equal(onlyDataChurn.source, "clients.data_churn");
});

test("data_pedido e intenção NÃO efetivam churn", () => {
  const fromPedido = getAnalyticalCancellation({
    data_pedido: "2024-01-15",
    intencao_registrada_at: "2024-01-10",
  });
  assert.equal(fromPedido.isCancelled, false);

  const consolidated = resolveConsolidatedCancellation(
    { data_pedido: "2024-01-15", intencao_registrada_at: "2024-01-10" },
    { status: "Ativo" },
  );
  assert.equal(consolidated.isCancelled, false);
  assert.equal(resolveAnalyticalStatusFromMaps("Ativo", consolidated), ANALYTICAL_STATUS.ACTIVE);
});

test("distrato texto Assinado sem data → Cancelado efetivado sem data", () => {
  const consolidated = resolveConsolidatedCancellation(
    { distrato: "Assinado" },
    { status: "Ativo" },
  );
  assert.equal(consolidated.isCancelled, true);
  assert.equal(consolidated.hasConfirmedDate, false);
  const status = resolveAnalyticalStatusFromMaps("Ativo", {
    isCancelled: true,
    hasConfirmedDate: false,
    date: null,
  });
  assert.equal(status, ANALYTICAL_STATUS.CANCELLED_EFFECTIVE_NO_DATE);
});

test("Não assinado não conta como distrato efetivado", () => {
  const fromCancel = getAnalyticalCancellation({ distrato: "Não assinado" });
  assert.equal(fromCancel.isCancelled, false);
});

test("archived não entra no mapa analítico padrão", () => {
  const archived = getAnalyticalCancellation({
    churn_efetivado_at: "2024-05-01",
    archived_at: "2024-06-01",
  });
  assert.equal(archived.isCancelled, false);
});

test("data_churn sozinha efetiva cancelamento", () => {
  const consolidated = resolveConsolidatedCancellation(null, { data_churn: "2024-02-15" });
  assert.equal(consolidated.isCancelled, true);
  assert.equal(consolidated.source, "clients.data_churn");
});

test("cliente não é contado duas vezes na união", () => {
  const cancellations = [
    { client_id: "1", churn_efetivado_at: "2024-01-01", archived_at: null },
    { client_id: "1", distrato_assinado_at: "2024-02-01", archived_at: null },
  ];
  const clients = [{ id: "1", data_churn: "2024-03-01" }];
  const { map, audit } = buildAnalyticalCancellationMap(cancellations, clients);
  assert.equal(map.size, 1);
  assert.equal(audit.totalDistinct, 1);
  assert.ok(audit.multipleSources >= 1);
});
