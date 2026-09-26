import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canAccessPage, getPageAccessMetadata } from "../../lib/access/access-policy.mjs";
import { getPageById } from "../../js/pages.js";
import { buildInternalMechanismsSatisfactionPayload } from "../../lib/analytics/internal-mechanisms-satisfaction.mjs";
import { buildInternalMechanismsRenewalProjectionPagePayload } from "../../lib/analytics/internal-mechanisms-renewal-projection-page.mjs";
import { buildMechanismsSatisfactionDataset } from "../../lib/analytics/mechanisms-satisfaction-dataset.mjs";
import { renderMetricTooltip, METRIC_TOOLTIPS } from "../../js/components/metric-tooltip.js";
import { PAGE_EXPORT_BUILDERS } from "../../lib/analytics/page-csv-builders.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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
      data_fim_ciclo: "2025-12-31",
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
  ];
  const mechRaw = [{ id: "m1", name: "Arcadia", categoria: "X", mercado: "", programa: "", status: "", codigo: "" }];
  const cmRaw = [
    {
      id: 1,
      client_id: "c1",
      mecanismo_id: "m1",
      status: "concluido",
      implemented_at: "2024-03-01",
      created_at: "2024-02-01",
      source: "base",
    },
  ];
  const npsRaw = [
    {
      id: 1,
      client_id: "c1",
      score: 10,
      tipo_de_forms: "NPS",
      created_at: "2024-04-01",
      submitted_at: "2024-04-01",
    },
    {
      id: 2,
      client_id: "c2",
      score: 6,
      tipo_de_forms: "NPS",
      created_at: "2024-05-01",
      submitted_at: "2024-05-01",
    },
  ];
  return buildMechanismsSatisfactionDataset({
    clientsRaw,
    cmRaw,
    mechRaw,
    cancelRaw: [],
    finRaw: [],
    npsRaw,
    csatRaw: [],
  });
}

function fixtureRawFromDataset(ds) {
  return {
    clientsRaw: ds.clientsRaw || [],
    cmRaw: ds.cmRaw || [],
    mechRaw: ds.mechRaw || [],
    cancelRaw: [],
    finRaw: [],
    npsRaw: ds.npsRaw || [],
    csatRaw: [],
  };
}

test("página Projeção registrada após Mecanismos × Satisfação", () => {
  const ims = getPageById("internal_mechanisms_satisfaction");
  const imr = getPageById("internal_mechanisms_renewal_projection");
  assert.ok(ims && imr);
  assert.equal(imr.hash, "internal-mechanisms-renewal-projection");
  assert.equal(imr.group, "internal");
  const idxIms = ims.group === "internal" ? 0 : -1;
  assert.ok(idxIms >= 0);
});

test("permissão owner-only espelhada", () => {
  assert.equal(canAccessPage({ isOwner: true, isActive: true, groups: [] }, "internal_mechanisms_renewal_projection"), true);
  assert.equal(canAccessPage({ isActive: true, groups: ["leaders"] }, "internal_mechanisms_renewal_projection"), false);
  const meta = getPageAccessMetadata("internal_mechanisms_renewal_projection");
  assert.equal(meta.ownerOnly, true);
  assert.equal(meta.preload, false);
});

test("payload satisfação sem renovação", () => {
  const ds = fixtureDataset();
  const payload = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all" } });
  assert.equal(payload.renewalAnalysis, undefined);
  assert.equal(payload.renewalYearEndProjection, undefined);
  assert.ok(payload.csatAnalysis);
});

test("payload projeção inclui modelos A e B", () => {
  const ds = fixtureDataset();
  const raw = fixtureRawFromDataset(ds);
  const payload = buildInternalMechanismsRenewalProjectionPagePayload(ds, raw, { filters: { status: "all" } });
  assert.ok(payload.modelA?.population);
  assert.equal(payload.modelB?.label, "BASE COMPLETA");
  assert.ok(payload.historicalComparablePopulation);
  assert.ok(Array.isArray(payload.comparison?.rows));
  assert.equal(payload.productionModel, "A");
});

test("Modelo B usa base completa (status all)", () => {
  const clientsRaw = [
    {
      id: "c1",
      codigo: "QV001",
      name: "Ativo",
      status: "Ativo",
      engenheiro_patrimonial: "EP1",
      programa: "Pharus",
      data_inicio_ciclo: "2024-01-01",
      data_fim_ciclo: "2025-12-31",
      ciclo: 2,
      davos_contrato_assinado: false,
    },
    {
      id: "c2",
      codigo: "QV002",
      name: "Cancelado",
      status: "Cancelado confirmado",
      engenheiro_patrimonial: "EP2",
      programa: "Pharus",
      data_inicio_ciclo: "2023-01-01",
      data_fim_ciclo: "2024-06-01",
      ciclo: 1,
      davos_contrato_assinado: false,
    },
  ];
  const ds = buildMechanismsSatisfactionDataset({
    clientsRaw,
    cmRaw: [],
    mechRaw: [],
    cancelRaw: [{ client_id: "c2", status: "confirmado", data_cancelamento: "2024-01-01" }],
    finRaw: [],
    npsRaw: [],
    csatRaw: [],
  });
  const raw = { clientsRaw, cmRaw: [], mechRaw: [], cancelRaw: [], finRaw: [], npsRaw: [], csatRaw: [] };
  const payload = buildInternalMechanismsRenewalProjectionPagePayload(ds, raw, { filters: { status: "active" } });
  assert.ok((payload.modelB.population?.totalClients ?? 0) >= 2);
  assert.ok((payload.modelB.population?.cancelled ?? 0) >= 1);
  assert.equal(payload.modelB.projectionOperational, false);
});

test("frontend satisfação sem projeção", () => {
  const js = readFileSync(resolve(root, "js/internal-mechanisms-satisfaction.js"), "utf8");
  assert.doesNotMatch(js, /imsRenewalProjection/);
  assert.doesNotMatch(js, /Renovação × Mecanismos/);
});

test("frontend projeção montado", () => {
  const js = readFileSync(resolve(root, "js/internal-mechanisms-renewal-projection.js"), "utf8");
  assert.match(js, /bootInternalMechanismsRenewalProjection/);
  assert.match(js, /renderMetricTooltip/);
});

test("payload inclui businessRenewal do Modelo A", () => {
  const ds = fixtureDataset();
  const raw = fixtureRawFromDataset(ds);
  const payload = buildInternalMechanismsRenewalProjectionPagePayload(ds, raw, { filters: { status: "active" } });
  assert.ok(payload.businessRenewal?.comVsSem?.withMechanism);
  assert.ok(Array.isArray(payload.businessRenewal.mechanismRanking));
});

test("frontend ordem negócio antes dos modelos", () => {
  const js = readFileSync(resolve(root, "js/internal-mechanisms-renewal-projection.js"), "utf8");
  assert.match(js, /Renovação × Mecanismos/);
  const biz = js.indexOf("renderBusinessRenewal");
  const models = js.indexOf("renderModelsIntro");
  assert.ok(biz > 0 && models > biz);
  const order = js.indexOf("${renderBusinessRenewal(p)}");
  const orderModels = js.indexOf("${renderModelsIntro()}");
  assert.ok(order > 0 && orderModels > order);
});

test("frontend projeção usa gráficos e accordion auxiliar", () => {
  const js = readFileSync(resolve(root, "js/internal-mechanisms-renewal-projection.js"), "utf8");
  assert.match(js, /imr-charts/);
  assert.match(js, /historicalComparablePopulation/);
  assert.match(js, /renderConfusionGrid/);
});

test("tooltips métricas", () => {
  const html = renderMetricTooltip("ROC-AUC", METRIC_TOOLTIPS.rocAuc);
  assert.match(html, /metric-tooltip-trigger/);
  assert.match(html, /role="tooltip"/);
});

test("export registry projeção", () => {
  assert.ok(PAGE_EXPORT_BUILDERS.internal_mechanisms_renewal_projection);
});

test("produção permanece modelo A", () => {
  const ds = fixtureDataset();
  const raw = fixtureRawFromDataset(ds);
  const payload = buildInternalMechanismsRenewalProjectionPagePayload(ds, raw, { filters: { status: "active" } });
  assert.equal(payload.productionModel, "A");
  assert.equal(payload.modelB.projectionOperational, false);
});
