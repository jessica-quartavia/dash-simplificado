import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMechanismsSatisfactionDataset } from "../../lib/analytics/mechanisms-satisfaction-dataset.mjs";
import { buildInternalMechanismsRenewalProjectionPagePayload } from "../../lib/analytics/internal-mechanisms-renewal-projection-page.mjs";
import {
  buildCanonicalRenewalPopulation,
  filterWideClientsForRenewalAnalysis,
} from "../../lib/analytics/internal-mechanisms-renewal-population.mjs";
import { classificationMetrics, prAuc } from "../../lib/analytics/internal-mechanisms-renewal-model-audit.mjs";

function fixtureDataset() {
  const clientsRaw = [
    {
      id: "c1",
      codigo: "QV001",
      name: "Cliente A",
      status: "Ativo",
      engenheiro_patrimonial: "EP1",
      programa: "Pharus",
      data_inicio_ciclo: "2024-01-01",
      data_fim_ciclo: "2025-12-20",
      ciclo: 2,
      davos_contrato_assinado: false,
    },
    {
      id: "c2",
      codigo: "QV002",
      name: "Cliente B",
      status: "Ativo",
      engenheiro_patrimonial: "EP2",
      programa: "Pharus",
      data_inicio_ciclo: "2024-06-01",
      data_fim_ciclo: "2025-06-01",
      ciclo: 1,
      davos_contrato_assinado: false,
    },
    {
      id: "c3",
      codigo: "QV003",
      name: "Cliente C",
      status: "Ativo",
      engenheiro_patrimonial: "EP1",
      programa: "Pharus",
      data_inicio_ciclo: "2023-01-01",
      data_fim_ciclo: "2025-11-01",
      ciclo: 2,
      davos_contrato_assinado: false,
    },
  ];
  const mechRaw = [{ id: "m1", name: "Arcadia", categoria: "X", mercado: "", programa: "", status: "", codigo: "" }];
  const cmRaw = [
    { id: 1, client_id: "c1", mecanismo_id: "m1", status: "concluido", implemented_at: "2024-03-01", created_at: "2024-02-01", source: "base" },
    { id: 2, client_id: "c3", mecanismo_id: "m1", status: "concluido", implemented_at: "2023-06-01", created_at: "2023-05-01", source: "base" },
  ];
  const npsRaw = [
    { id: 1, client_id: "c1", score: 10, tipo_de_forms: "NPS", created_at: "2024-04-01", submitted_at: "2024-04-01" },
  ];
  return buildMechanismsSatisfactionDataset({
    clientsRaw,
    mechRaw,
    cmRaw,
    cancelRaw: [],
    finRaw: [],
    npsRaw,
    csatRaw: [],
  });
}

test("renewal population — independe de filtro NPS", () => {
  const ds = fixtureDataset();
  const base = buildCanonicalRenewalPopulation(ds.wideClients, { status: "all" });
  const withNpsFilter = buildCanonicalRenewalPopulation(ds.wideClients, {
    status: "all",
    npsScore: "10",
    npsClass: "promotor",
  });
  assert.equal(base.length, withNpsFilter.length);
});

test("payload projeção — model A usa canonicalRenewalPopulation", () => {
  const ds = fixtureDataset();
  const raw = {
    clientsRaw: ds.clientsRaw || [],
    cmRaw: ds.cmRaw || [],
    mechRaw: ds.mechRaw || [],
    cancelRaw: [],
    finRaw: [],
  };
  const payload = buildInternalMechanismsRenewalProjectionPagePayload(ds, raw, { filters: { status: "all" } });
  assert.ok(payload.modelA?.population?.cycleValid >= 1);
  assert.ok(Array.isArray(payload.modelA?.mechanismRanking));
});

test("model audit — métricas de holdout", () => {
  const probs = [0.2, 0.8, 0.1, 0.9];
  const labels = [0, 1, 0, 1];
  const m = classificationMetrics(probs, labels, 0.5);
  assert.equal(m.tp, 2);
  assert.equal(m.tn, 2);
  assert.ok(m.accuracy >= 0.99);
  assert.ok(prAuc(probs, labels) > 0.9);
});

test("exploratory projection — modelAudit presente quando modelo publica", () => {
  const ds = fixtureDataset();
  const raw = {
    clientsRaw: ds.clientsRaw || [],
    cmRaw: ds.cmRaw || [],
    mechRaw: ds.mechRaw || [],
    cancelRaw: [],
    finRaw: [],
  };
  const payload = buildInternalMechanismsRenewalProjectionPagePayload(ds, raw, { filters: { status: "all" } });
  const exp = payload.modelA?.renewalYearEndProjection?.exploratory;
  if (exp?.modelAudit) {
    assert.ok(exp.modelAudit.algorithm);
    assert.equal(exp.modelAudit.target.positive, 1);
    assert.equal(exp.modelAudit.featuresExcluded.some((f) => f.name.includes("nps")), true);
  }
});

test("filterWideClientsForRenewalAnalysis ignora npsClass", () => {
  const ds = fixtureDataset();
  const a = filterWideClientsForRenewalAnalysis(ds.wideClients, { status: "all", npsClass: "all" });
  const b = filterWideClientsForRenewalAnalysis(ds.wideClients, { status: "all", npsClass: "detrator" });
  assert.equal(a.length, b.length);
});
