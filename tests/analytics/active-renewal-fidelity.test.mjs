import assert from "node:assert/strict";
import { test } from "node:test";
import { filterGeneralClients, defaultGeneralFilters } from "../../lib/analytics/general-filters.mjs";
import { summarizeGeneralRows } from "../../lib/analytics/general-metrics.mjs";
import {
  buildExecutiveContexts,
  extractExecutiveMetrics,
} from "../../lib/analytics/executive-summary-extractors.mjs";
import { defaultExecutiveSummaryFilters } from "../../lib/analytics/executive-summary-filters.mjs";
import { filterRenewalClients, defaultRenewalFilters } from "../../lib/analytics/renewal-filters.mjs";
import { summarizeRenewalRows } from "../../lib/analytics/renewal-metrics.mjs";
import {
  buildCanonicalRenewalPopulation,
} from "../../lib/analytics/internal-mechanisms-renewal-population.mjs";
import { renewalFromCycle, countRenewedClients, sumRenewalCounts } from "../../lib/analytics/client-cycle-renewal.mjs";
import { filterWideClientsForRenewalAnalysis } from "../../lib/analytics/internal-mechanisms-renewal-population.mjs";

function wideRow(partial) {
  return {
    clientId: partial.clientId,
    analyticalStatus: partial.analyticalStatus ?? "Ativo",
    program: partial.program ?? "Pharus",
    ep: partial.ep ?? "EP1",
    segment: partial.segment ?? "APEX",
    tenureDays: partial.tenureDays ?? 100,
    renewed: partial.renewed ?? false,
    renewalCount: partial.renewalCount ?? 0,
    currentCycle: partial.currentCycle ?? 1,
    cycleValid: partial.cycleValid ?? true,
    totalImplementedMechanisms: partial.totalImplementedMechanisms ?? 0,
    ...partial,
  };
}

test("active KPI vem de general (status Ativo), não de canonicalRenewalPopulation", () => {
  const generalClients = [
    { clientId: "1", analyticalStatus: "Ativo", engineer: "EP1", segment: "APEX", program: "Pharus", cycleValid: false, currentCycle: null },
    { clientId: "2", analyticalStatus: "Ativo", engineer: "EP1", segment: "APEX", program: "Pharus", cycleValid: true, currentCycle: 1 },
  ];
  const wide = generalClients.map((c) => wideRow({ ...c, clientId: c.clientId }));
  const canonical = buildCanonicalRenewalPopulation(wide, { status: "active" });
  const gf = filterGeneralClients(generalClients, defaultGeneralFilters());
  const activeKpi = summarizeGeneralRows(gf).activeClients;
  assert.equal(activeKpi, 2);
  assert.equal(canonical.length, 2);
  assert.equal(generalClients.filter((c) => c.cycleValid).length, 1);
  assert.notEqual(generalClients.filter((c) => c.cycleValid).length, activeKpi);
});

test("Executive active_clients usa contexto general, não renewal summary", () => {
  const sources = {
    general: {
      clients: [
        { clientId: "1", analyticalStatus: "Ativo", engineer: "EP1", segmentLabel: "APEX", program: "Pharus" },
        { clientId: "2", analyticalStatus: "Ativo", engineer: "EP1", segmentLabel: "APEX", program: "Pharus", cycleValid: false },
      ],
    },
    renewal: {
      clients: [
        {
          clientId: "1",
          analyticalStatus: "Ativo",
          engineer: "EP1",
          segment: "APEX",
          program: "Pharus",
          cycleValid: true,
          renewed: true,
          currentCycle: 2,
          renewalCount: 1,
        },
        {
          clientId: "9",
          analyticalStatus: "Cancelado",
          engineer: "EP1",
          segment: "APEX",
          program: "Pharus",
          cycleValid: true,
          renewed: true,
          currentCycle: 2,
          renewalCount: 1,
        },
      ],
    },
  };
  const contexts = buildExecutiveContexts(sources, defaultExecutiveSummaryFilters());
  const metrics = extractExecutiveMetrics(contexts);
  assert.equal(metrics.active_clients?.value, 2);
  assert.equal(contexts.renewal?.summary?.renewedClients, 2);
});

test("renewed oficial: ciclo >= 2; renewalCount = max(ciclo-1,0); cycleValid gate em summarizeRenewalRows", () => {
  const r3 = renewalFromCycle(3);
  assert.equal(r3.hasRenewed, true);
  assert.equal(r3.renewalCount, 2);
  assert.equal(r3.valid, true);
  const r1 = renewalFromCycle(1);
  assert.equal(r1.hasRenewed, false);
  assert.equal(r1.renewalCount, 0);
  const r0 = renewalFromCycle(0);
  assert.equal(r0.valid, false);

  const rows = [
    { analyticalStatus: "Ativo", cycleValid: true, renewed: true, currentCycle: 2, renewalCount: 1 },
    { analyticalStatus: "Ativo", cycleValid: false, renewed: true, currentCycle: 2, renewalCount: 1 },
    { analyticalStatus: "Congelado", cycleValid: true, renewed: true, currentCycle: 2, renewalCount: 1 },
  ];
  const summary = summarizeRenewalRows(rows);
  assert.equal(summary.renewedClients, 2);
  assert.equal(countRenewedClients(rows), 3);
  assert.equal(summary.totalRenewals, 2);
  assert.equal(sumRenewalCounts(rows), 3);
});

test("NPS não entra na população de renovação IMS", () => {
  const wide = [
    wideRow({ clientId: "a", cycleValid: true, renewed: true, currentCycle: 2, renewalCount: 1, latestNps: 10 }),
    wideRow({ clientId: "b", cycleValid: true, renewed: false, currentCycle: 1, latestNps: null }),
  ];
  const withNpsFilter = filterWideClientsForRenewalAnalysis(wide, {
    status: "active",
    npsScore: "detractor",
    npsClass: "detractor",
  });
  const canonical = filterWideClientsForRenewalAnalysis(wide, { status: "active" });
  assert.equal(withNpsFilter.length, canonical.length);
});

test("Renovação — default status Ativo alinha KPIs ao recorte da carteira ativa", () => {
  assert.equal(defaultRenewalFilters().status, "active");
  const rows = [
    {
      clientId: "1",
      analyticalStatus: "Ativo",
      engineer: "EP1",
      segment: "PRIVATE",
      program: "Pharus",
      currentCycle: 3,
      renewalCount: 2,
      renewed: true,
      cycleValid: true,
    },
    {
      clientId: "2",
      analyticalStatus: "Congelado",
      engineer: "EP1",
      segment: "PRIVATE",
      program: "Pharus",
      currentCycle: 2,
      renewalCount: 1,
      renewed: true,
      cycleValid: true,
    },
    {
      clientId: "3",
      analyticalStatus: "Ativo",
      engineer: "EP1",
      segment: "PRIVATE",
      program: "Pharus",
      currentCycle: 1,
      renewalCount: 0,
      renewed: false,
      cycleValid: true,
    },
  ];
  const activeSummary = summarizeRenewalRows(filterRenewalClients(rows, defaultRenewalFilters()));
  const allSummary = summarizeRenewalRows(filterRenewalClients(rows, { ...defaultRenewalFilters(), status: "all" }));
  assert.equal(activeSummary.renewedClients, 1);
  assert.equal(activeSummary.totalRenewals, 2);
  assert.equal(allSummary.renewedClients, 2);
  assert.equal(allSummary.totalRenewals, 3);
});

test("Executive e Dados Gerais convergem em ativos com filtros equivalentes", () => {
  const clients = [
    { clientId: "1", analyticalStatus: "Ativo", engineer: "EP1", segment: "APEX", program: "Pharus" },
    { clientId: "2", analyticalStatus: "Congelado", engineer: "EP1", segment: "APEX", program: "Pharus" },
  ];
  const gf = filterGeneralClients(clients, defaultGeneralFilters());
  const exec = buildExecutiveContexts({ general: { clients } }, defaultExecutiveSummaryFilters());
  assert.equal(summarizeGeneralRows(gf).activeClients, exec.general?.summary?.activeClients);
});
