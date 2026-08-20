import assert from "node:assert/strict";
import { test } from "node:test";
import { ANALYTICAL_STATUS } from "../../lib/analytics/index.mjs";
import { buildPayload } from "../../lib/analytics/general-data.mjs";
import { calculateClientSegment } from "../../lib/analytics/client-segment.mjs";
import {
  DEFAULT_STATUS_FILTER,
  defaultGeneralFilters,
  filterGeneralClients,
} from "../../lib/analytics/general-filters.mjs";

function payloadFromFixture() {
  const clients = [
    {
      id: "a1",
      codigo: "C1",
      name: "Ana Ativa",
      status: "Ativo",
      data_inicio_ciclo: "2024-01-10",
      created_at: "2024-01-10",
      engenheiro_patrimonial: "EP Um",
      ciclo: 1,
      programa: "Pharus",
    },
    {
      id: "b2",
      codigo: "C2",
      name: "Bruno Cancelado",
      status: "Ativo",
      data_inicio_ciclo: "2023-02-01",
      created_at: "2023-02-01",
      data_churn: "2024-06-15",
      engenheiro_patrimonial: "EP Dois",
      ciclo: 1,
      programa: "Davos",
    },
    {
      id: "c3",
      codigo: "C3",
      name: "Carla Congelada",
      status: "Congelado",
      data_inicio_ciclo: "2024-03-01",
      created_at: "2024-03-01",
      engenheiro_patrimonial: "EP Um",
      ciclo: 1,
      programa: "Pharus",
    },
  ];
  const cancellations = [
    {
      id: "x1",
      client_id: "b2",
      churn_efetivado_at: "2024-06-15",
      distrato_assinado_at: null,
      distrato: null,
      archived_at: null,
    },
  ];
  const financial = [
    {
      id: "f1",
      client_id: "a1",
      ultima_renda_mensal: 25000,
      ultimo_aporte: 5000,
      reserva_liquidez: 80000,
      valor_imoveis_quitados: 0,
      possui_imovel: true,
      possui_carro: false,
      possui_consorcio: false,
      cheque_especial: "nao",
      parcelamento_cartao: "nao",
      credito_pessoal: "nao",
      credito_consignado: "nao",
      updated_at: "2024-12-01",
    },
  ];
  return buildPayload(clients, cancellations, financial, new Map());
}

test("payload possui estrutura esperada e status analítico do kernel", () => {
  const payload = payloadFromFixture();
  assert.ok(payload.generatedAt);
  assert.ok(payload.summary);
  assert.ok(payload.distributions);
  assert.ok(Array.isArray(payload.clients));
  assert.equal(payload.defaultStatusFilter, "active");
  assert.equal(payload.summary.totalClients, 3);
  assert.equal(payload.summary.activeClients, 1);
  assert.equal(payload.summary.frozenClients, 1);

  const byName = Object.fromEntries(payload.clients.map((c) => [c.clientName, c]));
  assert.equal(byName["Ana Ativa"].analyticalStatus, ANALYTICAL_STATUS.ACTIVE);
  assert.equal(byName["Ana Ativa"].status, byName["Ana Ativa"].analyticalStatus);
  assert.equal(byName["Bruno Cancelado"].analyticalStatus, ANALYTICAL_STATUS.CANCELLED_CONFIRMED);
  assert.equal(byName["Carla Congelada"].analyticalStatus, ANALYTICAL_STATUS.FROZEN);
  assert.equal(byName["Ana Ativa"].segmentLabel, "PRINCIPAL");
});

test("default active aplica recorte Ativo no dataset exibido", () => {
  const payload = payloadFromFixture();
  const filtered = filterGeneralClients(payload.clients, defaultGeneralFilters());
  assert.equal(DEFAULT_STATUS_FILTER, "active");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].analyticalStatus, "Ativo");
});

test("sem renda e sem dívida/APEX → Dados insuficientes", () => {
  const result = calculateClientSegment({}, {});
  assert.equal(result.segmentLabel, "Dados insuficientes");
  assert.equal(result.segmentStatus, "insufficient_data");
  assert.equal(result.segment, null);
});
