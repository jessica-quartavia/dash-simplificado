import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EP_EXECUTIVE_MIN_SAMPLE,
  rankEpImplementationShare,
  rankEpRenewedShare,
} from "../../lib/analytics/ep-executive-ranking.mjs";
import {
  buildExecutiveContexts,
  extractExecutiveMetrics,
} from "../../lib/analytics/executive-summary-extractors.mjs";
import { executiveSignalDisplayLabel, executiveSignalDistributionLabel } from "../../lib/analytics/executive-signal-labels.mjs";

const engineers = [
  {
    engineer: "Gabriel Oliveira",
    totalClients: 20,
    renewedClients: 14,
    renewedPortfolioPercentage: 70,
    clientsWithImplementedMechanisms: 8,
    implementationShare: 40,
  },
  {
    engineer: "Ana Souza",
    totalClients: 18,
    renewedClients: 9,
    renewedPortfolioPercentage: 50,
    clientsWithImplementedMechanisms: 15,
    implementationShare: 83.3,
  },
  {
    engineer: "Carlos Lima",
    totalClients: 12,
    renewedClients: 2,
    renewedPortfolioPercentage: 16.7,
    clientsWithImplementedMechanisms: 3,
    implementationShare: 25,
  },
  {
    engineer: "Pequeno",
    totalClients: 3,
    renewedClients: 3,
    renewedPortfolioPercentage: 100,
    clientsWithImplementedMechanisms: 3,
    implementationShare: 100,
  },
];

test("ranking EP respeita mínimo de amostra", () => {
  const renewed = rankEpRenewedShare(engineers);
  assert.equal(renewed.minSample, EP_EXECUTIVE_MIN_SAMPLE);
  assert.equal(renewed.high.engineer, "Gabriel Oliveira");
  assert.equal(renewed.low.engineer, "Carlos Lima");
  assert.ok(!renewed.high.engineer.includes("Pequeno"));
});

test("ranking implementação usa mesma população elegível", () => {
  const impl = rankEpImplementationShare(engineers);
  assert.equal(impl.high.engineer, "Ana Souza");
  assert.equal(impl.low.engineer, "Carlos Lima");
});

test("rótulos amigáveis de sinais preservam chaves existentes", () => {
  assert.equal(
    executiveSignalDisplayLabel({ key: "no_meeting_60", label: "Sem reunião em 60 dias" }),
    "Muitos dias desde a última reunião",
  );
  assert.equal(
    executiveSignalDistributionLabel("2 sinais"),
    "2 sinais de atrito",
  );
});

test("executive EP bate com ranking compartilhado no mesmo recorte", () => {
  const contexts = buildExecutiveContexts(
    {
      ep_performance: {
        engineers: engineers.map((e) => ({
          ...e,
          engineer: e.engineer,
        })),
      },
    },
    { program: "all" },
  );
  contexts.ep = {
    engineers: engineers.map((e) => ({
      ...e,
      implementationShare: e.implementationShare,
    })),
  };
  const metrics = extractExecutiveMetrics(contexts);
  const renewedRank = rankEpRenewedShare(engineers);
  const implRank = rankEpImplementationShare(engineers);
  assert.deepEqual(metrics.top_ep_renewed_share.value.high, renewedRank.high);
  assert.deepEqual(metrics.top_ep_renewed_share.value.low, renewedRank.low);
  assert.deepEqual(metrics.top_ep_implementation_share.value.high, implRank.high);
  assert.deepEqual(metrics.top_ep_implementation_share.value.low, implRank.low);
});
