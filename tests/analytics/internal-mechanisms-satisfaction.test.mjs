import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canAccessPage, getPageAccessMetadata } from "../../lib/access/access-policy.mjs";
import { getPageById, PAGES } from "../../js/pages.js";
import {
  buildMechanismsSatisfactionDataset,
  npsClassLabelPt,
} from "../../lib/analytics/mechanisms-satisfaction-dataset.mjs";
import {
  buildInternalMechanismsSatisfactionPayload,
  computeInternalMechanismsSatisfactionPayload,
} from "../../lib/analytics/internal-mechanisms-satisfaction.mjs";
import { filterWideClients } from "../../lib/analytics/internal-mechanisms-satisfaction-filters.mjs";
import { dedupeNpsResponses } from "../../lib/analytics/nps-metrics.mjs";
import { buildOfficialNpsProgramBreakdown } from "../../lib/analytics/satisfaction.mjs";
import {
  assertNpsPopulationPartition,
  buildNpsClientPopulation,
  diagnoseNpsClientJoin,
} from "../../lib/analytics/nps-client-join.mjs";
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
      data_fim_ciclo: "2025-01-01",
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
    { id: 1, client_id: "c1", mecanismo_id: "m1", status: "concluido", implemented_at: "2024-03-01", created_at: "2024-02-01", source: "base" },
  ];
  const npsRaw = [
    { id: 1, client_id: "c1", score: 10, tipo_de_forms: "NPS", created_at: "2024-04-01", submitted_at: "2024-04-01" },
    { id: 2, client_id: "c2", score: 6, tipo_de_forms: "NPS", created_at: "2024-05-01", submitted_at: "2024-05-01" },
  ];
  const csatRaw = [
    { id: 1, client_id: "c1", score: 5, tipo_de_forms: "CSAT", created_at: "2024-04-02", typeform_response_id: "a" },
  ];
  return buildMechanismsSatisfactionDataset({
    clientsRaw,
    cmRaw,
    mechRaw,
    cancelRaw: [],
    finRaw: [],
    npsRaw,
    csatRaw,
  });
}

test("página registrada no menu e rota", () => {
  const page = getPageById("internal_mechanisms_satisfaction");
  assert.ok(page);
  assert.equal(page.group, "internal");
  assert.equal(page.hash, "internal-mechanisms-satisfaction");
});

test("acesso owner-only — líder/produto/EP bloqueados", () => {
  assert.equal(canAccessPage({ isOwner: true, isActive: true, groups: [] }, "internal_mechanisms_satisfaction"), true);
  assert.equal(canAccessPage({ isActive: true, groups: ["leaders"] }, "internal_mechanisms_satisfaction"), false);
  assert.equal(canAccessPage({ isActive: true, groups: ["product"] }, "internal_mechanisms_satisfaction"), false);
  assert.equal(canAccessPage({ isActive: true, groups: ["eps"] }, "internal_mechanisms_satisfaction"), false);
  assert.equal(canAccessPage({ isActive: true, groups: ["quality"] }, "internal_mechanisms_satisfaction"), false);
  assert.equal(canAccessPage({ isActive: true, groups: ["finance"] }, "internal_mechanisms_satisfaction"), false);
  const meta = getPageAccessMetadata("internal_mechanisms_satisfaction");
  assert.equal(meta.ownerOnly, true);
  assert.equal(meta.preload, false);
});

test("dataset — NPS dedupe e classe", () => {
  const ds = fixtureDataset();
  assert.equal(ds.wideClients.length, 2);
  const c1 = ds.wideClients.find((c) => c.clientId === "c1");
  assert.equal(c1.latestNps, 10);
  assert.equal(npsClassLabelPt(10), "promotor");
  assert.equal(c1.implementedMechanismLabels.includes("Arcadia"), true);
  const { rows } = dedupeNpsResponses([
    { client_id: "c1", score: 8, tipo_de_forms: "NPS", created_at: "2024-01-01", submitted_at: "2024-02-01" },
    { client_id: "c1", score: 10, tipo_de_forms: "NPS", created_at: "2024-01-01", submitted_at: "2024-03-01" },
  ]);
  assert.equal(rows[0].score, 10);
});

test("payload compute — população NPS e grupos", () => {
  const ds = fixtureDataset();
  const payload = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all" } });
  assert.equal(payload.summary.clientsWithNps, 2);
  assert.equal(payload.summary.withNpsAndMechanism, 1);
  assert.equal(payload.summary.withNpsWithoutMechanism, 1);
  assert.equal(payload.npsPopulationValid, true);
  assert.equal(
    payload.summary.withNpsAndMechanism + payload.summary.withNpsWithoutMechanism,
    payload.summary.clientsWithNps,
  );
  assert.equal(payload.summary.npsIndexWithMechanism, 100);
  assert.equal(npsClassLabelPt(6), "detrator");
  assert.ok(payload.mechanismMatrix.rows.length >= 2);
  const qtyRow = payload.mechanismMatrix.rows.find((r) => r.id === "mechanism_count");
  assert.equal(qtyRow?.clients, payload.summary.clientsWithNps);
  assert.ok(payload.groupComparisonTest.test.includes("Mann"));
  assert.equal(payload.npsClientExportRows.length, 2);
  assert.match(payload.npsClientExportRows[0].mechanismNames, /Arcadia/);
  assert.match(payload.methodology.causalNote, /causou melhora/i);
  for (const r of payload.mechanismRanking) {
    assert.ok(Number.isFinite(r.clientsWithNps));
  }
});

test("join NPS — dedupe oficial e população canônica", () => {
  const ds = fixtureDataset();
  const join = diagnoseNpsClientJoin(ds.wideClients, ds.npsDedupedRows, ds.npsMeta);
  assert.equal(join.matchedToBaseClients, 2);
  assert.equal(join.unmatchedDeduped, 0);
  const canonical = buildNpsClientPopulation(ds.wideClients, ds.npsDedupedRows);
  assert.equal(canonical.length, 2);
  const part = assertNpsPopulationPartition(canonical);
  assert.equal(part.valid, true);
});

test("fidelity — clientes únicos NPS alinhados à Pesquisa de Satisfação (status all)", () => {
  const ds = fixtureDataset();
  const clientMap = new Map(
    [
      { id: "c1", codigo: "QV001", name: "Cliente A", programa: "Pharus", status: "Ativo" },
      { id: "c2", codigo: "QV002", name: "Cliente B", programa: "Pharus", status: "Ativo" },
    ].map((c) => [String(c.id), c]),
  );
  const npsRaw = [
    { id: 1, client_id: "c1", score: 10, tipo_de_forms: "NPS", created_at: "2024-04-01", submitted_at: "2024-04-01" },
    { id: 2, client_id: "c2", score: 6, tipo_de_forms: "NPS", created_at: "2024-05-01", submitted_at: "2024-05-01" },
  ];
  const { breakdown } = buildOfficialNpsProgramBreakdown(npsRaw, clientMap);
  const payload = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all" } });
  assert.equal(payload.summary.clientsWithNps, breakdown.total.n);
});

test("filtro nota NPS", () => {
  const ds = fixtureDataset();
  const payload = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all", npsScore: "10" } });
  assert.equal(payload.summary.clientsWithNps, 1);
});

test("filtro status ativo", () => {
  const ds = fixtureDataset();
  const activeOnly = filterWideClients(ds.wideClients, { status: "active" });
  assert.ok(activeOnly.length >= 1);
});

test("export registry", () => {
  assert.ok(PAGE_EXPORT_BUILDERS.internal_mechanisms_satisfaction);
});

test("frontend boot file existe", () => {
  const js = readFileSync(resolve(root, "js/internal-mechanisms-satisfaction.js"), "utf8");
  assert.match(js, /bootInternalMechanismsSatisfaction/);
  assert.match(js, /Clientes com NPS/);
  assert.match(js, /mechanismNames/);
  assert.doesNotMatch(js, /clientsWithNps\s*\?\?\s*r\.clients/);
  assert.match(js, /renderFilterBar\(\{\s*fields:\s*FILTER_FIELDS/);
});

test("invariantes — população única e partição", () => {
  const ds = fixtureDataset();
  const p = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all" } });
  assert.equal(p.invariants.clientsWithNpsEqualsCanonical, true);
  assert.equal(p.invariants.partitionValid, true);
  assert.equal(p.invariants.rankingSubsetValid, true);
  assert.equal(p.invariants.summaryMatchesPopulation, true);
  assert.equal(p.canonicalNpsClients.length, p.summary.clientsWithNps);
});

test("matriz — sem coluna Nota NPS 0–10", () => {
  const ds = fixtureDataset();
  const payload = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all" } });
  const ids = (payload.mechanismMatrix?.columns || []).map((c) => c.id);
  assert.ok(!ids.includes("score"));
  assert.ok(ids.includes("promoter"));
});

test("payload — CSAT e temporal no recorte", () => {
  const ds = fixtureDataset();
  const payload = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all" } });
  assert.ok(payload.csatAnalysis?.comVsSem);
  assert.ok(payload.temporal?.npsSummary);
  assert.equal(payload.summary.clientsWithNps, payload.summary.withNpsAndMechanism + payload.summary.withNpsWithoutMechanism);
});

test("frontend — distribuição e export hosts", () => {
  const js = readFileSync(resolve(root, "js/internal-mechanisms-satisfaction.js"), "utf8");
  assert.match(js, /renderScoreDistributionChart/);
  assert.match(js, /ims-score-bar-v/);
  assert.match(js, /data-ims-export-host=\"matrix\"/);
  assert.match(js, /clients-with-mech/);
  assert.match(js, /clients-without-mech/);
});

test("payload — sectionDiagnostics", () => {
  const ds = fixtureDataset();
  const payload = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all" } });
  assert.ok(payload.sectionDiagnostics?.csat);
  assert.equal(payload.sectionDiagnostics.csat.hasData, true);
});

test("payload — distribuição 0–10 com buckets", () => {
  const ds = fixtureDataset();
  const payload = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all" } });
  const dist = payload.charts?.scoreDistribution || payload.scoreDistribution || [];
  assert.equal(dist.length, 11);
  assert.ok(dist.some((b) => b.score === 10 && (b.withMechanism >= 0 || b.withoutMechanism >= 0)));
});

test("insights — sem Mann–Whitney", () => {
  const ds = fixtureDataset();
  const payload = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all" } });
  const texts = (payload.insights || []).map((i) => i.text || "");
  assert.ok(!texts.some((t) => t.includes("Mann–Whitney")));
});
