/**
 * Consolidação BASE QV + App Pharus — cenários críticos A–J + regras Round 3.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMechanismsPayload } from "../../lib/analytics/mechanisms.mjs";
import {
  consolidateMechanismsPayload,
  mapPharusStatus,
  mergeLink,
} from "../../lib/analytics/mechanisms/mechanisms-consolidation.mjs";
import { buildMechanismCrosswalk } from "../../lib/analytics/mechanisms/mechanism-crosswalk.mjs";
import {
  normalizeBaseQvMechanismStatus,
  normalizePharusMechanismStatus,
} from "../../lib/analytics/mechanisms/mechanism-status.mjs";
import { defaultMechanismFilters, filterMechanismClients } from "../../lib/analytics/mechanism-filters.mjs";
import {
  computeBaseQvMechanismAudit,
  summarizeMechanismRows,
} from "../../lib/analytics/mechanism-metrics.mjs";
import { buildExecutiveContexts, extractExecutiveMetrics } from "../../lib/analytics/executive-summary-extractors.mjs";

const clientsRaw = [
  { id: "qv1", codigo: "A1", name: "Ana", email: "ana@test.com", linked_user_id: "ph1", status: "Ativo", engenheiro_patrimonial: "EP1" },
  { id: "qv2", codigo: "B2", name: "Bruno", email: "bruno@test.com", status: "Ativo", engenheiro_patrimonial: "EP2" },
];

function basePayload(clientRows) {
  return buildMechanismsPayload({
    clients: clientsRaw,
    cmRows: clientRows,
    mechanisms: [
      { id: "m1", name: "Leilão Serial (Flipping de Leilão)", categoria: "Renda" },
      { id: "m2", name: "Previdência Privada", categoria: "Proteção" },
    ],
    cancellations: [],
    financialRows: [],
  });
}

function pharusPayload(rows) {
  return {
    success: true,
    catalogRows: [
      { id: "serial-auction", name: "Leilão Serial" },
      { id: "pm2", name: "Outro Pharus" },
    ],
    rows,
  };
}

test("BASE QV — concluido mapeia para Implementado", () => {
  assert.equal(normalizeBaseQvMechanismStatus("concluido").label, "Implementado");
  assert.equal(normalizeBaseQvMechanismStatus("Concluído").label, "Implementado");
  assert.equal(normalizeBaseQvMechanismStatus("implementado").label, "Não informado");
});

test("BASE QV — auditoria distinct client_id e concluido", () => {
  const audit = computeBaseQvMechanismAudit([
    { client_id: "1", mecanismo_id: "m1", status: "apto" },
    { client_id: "1", mecanismo_id: "m2", status: "concluido" },
    { client_id: "2", mecanismo_id: "m1", status: "concluido" },
    { client_id: "3", mecanismo_id: "m1", status: "iniciado" },
  ]);
  assert.equal(audit.clientsWithMechanisms, 3);
  assert.equal(audit.clientsWithImplementedMechanism, 2);
});

test("App Pharus — suggested mapeia para Implementado", () => {
  assert.equal(normalizePharusMechanismStatus("suggested"), "Implementado");
  assert.equal(mapPharusStatus("suggested"), "Implementado");
});

test("A — cliente só BASE QV conta uma vez", () => {
  const base = basePayload([{ client_id: "qv2", mecanismo_id: "m2", status: "concluido", created_at: "2026-01-01" }]);
  const out = consolidateMechanismsPayload({ baseQvPayload: base, pharusPayload: null, clientsRaw });
  assert.equal(out.clients.length, 1);
  assert.equal(out.metadata.consolidationQuality.totals.clients.baseQv, 1);
});

test("B — cliente só App Pharus conta uma vez", () => {
  const base = basePayload([]);
  const ph = pharusPayload([{ userId: "ph9", mechanismName: "Outro Pharus", status: "suggested", createdAt: "2026-02-01", linkId: "l1" }]);
  const out = consolidateMechanismsPayload({ baseQvPayload: base, pharusPayload: ph, clientsRaw });
  assert.equal(out.clients.length, 1);
  assert.match(out.clients[0].clientId, /^pharus:/);
  assert.equal(out.clients[0].mechanisms[0].status, "Implementado");
});

test("C — mesmo cliente em ambas fontes conta uma vez", () => {
  const base = basePayload([{ client_id: "qv1", mecanismo_id: "m2", status: "apto", created_at: "2026-01-01" }]);
  const ph = pharusPayload([{ userId: "ph1", mechanismName: "Outro Pharus", status: "suggested", createdAt: "2026-02-01", linkId: "l2" }]);
  const out = consolidateMechanismsPayload({ baseQvPayload: base, pharusPayload: ph, clientsRaw });
  const ana = out.clients.find((c) => c.clientId === "qv1");
  assert.ok(ana);
  assert.equal(ana.clientSources.sort().join(","), "app_pharus,base_qv");
  assert.ok(out.metadata.consolidationQuality.clients.presentInBothSources >= 1);
});

test("D — mesmo cliente+mecanismo nas duas fontes deduplica vínculo", () => {
  const base = basePayload([
    { client_id: "qv1", mecanismo_id: "m1", status: "concluido", implemented_at: "2026-03-01", created_at: "2026-01-01" },
  ]);
  const ph = pharusPayload([
    { userId: "ph1", mechanismId: "serial-auction", mechanismName: "Leilão Serial", status: "suggested", createdAt: "2026-02-01", linkId: "l3", category: "Renda" },
  ]);
  const out = consolidateMechanismsPayload({ baseQvPayload: base, pharusPayload: ph, clientsRaw });
  const ana = out.clients.find((c) => c.clientId === "qv1");
  assert.equal(ana.available, 1);
  assert.equal(ana.mechanisms[0].status, "Implementado");
  assert.equal(out.metadata.consolidationQuality.links.overlapRemoved, 1);
});

test("E — aliases diferentes viram um tipo canônico", () => {
  const crosswalk = buildMechanismCrosswalk(
    [{ id: "m1", name: "Leilão Serial (Flipping de Leilão)" }],
    [{ id: "serial-auction", name: "Leilão Serial" }],
  );
  assert.ok(crosswalk.canonicalCatalog.some((c) => c.name === "Leilão Serial"));
  assert.ok(crosswalk.diagnostic.confirmed.length >= 1);
  const byId = crosswalk.resolvePharus("Outro nome", "serial-auction");
  assert.equal(byId.canonicalName, "Leilão Serial");
});

test("F — mecanismos realmente diferentes permanecem separados", () => {
  const crosswalk = buildMechanismCrosswalk(
    [{ id: "m1", name: "Previdência Privada" }],
    [{ id: "pm1", name: "Outro Pharus" }],
  );
  assert.ok(crosswalk.diagnostic.exclusiveBaseQv.includes("Previdência Privada"));
  assert.ok(crosswalk.diagnostic.exclusivePharus.includes("Outro Pharus"));
});

test("G — match ambíguo não consolida cliente", () => {
  const ambiguousClients = [
    { id: "qv1", email: "dup@test.com" },
    { id: "qv2", email: "dup@test.com" },
  ];
  const base = basePayload([{ client_id: "qv1", mecanismo_id: "m2", status: "apto", created_at: "2026-01-01" }]);
  const ph = pharusPayload([{ userId: "phX", userEmail: "dup@test.com", mechanismName: "Outro Pharus", status: "suggested", createdAt: "2026-02-01", linkId: "l4" }]);
  const out = consolidateMechanismsPayload({
    baseQvPayload: base,
    pharusPayload: { ...ph, rows: ph.rows.map((r) => ({ ...r, userEmail: "dup@test.com" })) },
    clientsRaw: ambiguousClients,
  });
  assert.ok(out.metadata.consolidationQuality.clients.ambiguousMatches >= 1);
  assert.ok(out.clients.some((c) => c.clientId.startsWith("pharus:")));
});

test("H — status consolidado prefere implementado", () => {
  const merged = mergeLink(
    { status: "Apto", sources: ["app_pharus"], implementedAt: null, implementedMonth: null },
    { status: "Implementado", sources: ["base_qv"], implementedAt: "2026-03-01T00:00:00.000Z", implementedMonth: "2026-03" },
  );
  assert.equal(merged.status, "Implementado");
});

test("I — datas consolidadas usam implementação mais antiga (BASE QV)", () => {
  const merged = mergeLink(
    { status: "Implementado", sources: ["base_qv"], implementedAt: "2026-04-01T00:00:00.000Z" },
    { status: "Implementado", sources: ["app_pharus"], implementedAt: null },
  );
  assert.equal(merged.implementedAt, "2026-04-01T00:00:00.000Z");
});

test("J — implementação recente usa implemented_at BASE QV", () => {
  const base = basePayload([
    { client_id: "qv1", mecanismo_id: "m2", status: "concluido", implemented_at: new Date().toISOString(), created_at: "2026-01-01" },
  ]);
  const out = consolidateMechanismsPayload({ baseQvPayload: base, pharusPayload: null, clientsRaw });
  const summary = summarizeMechanismRows(out.clients, { catalog: out.catalog, portfolioCount: 2 });
  assert.equal(summary.recentClients, 1);
});

test("filtro Fonte não existe na página de mecanismos", () => {
  assert.equal("source" in defaultMechanismFilters(), false);
});

test("Resumo Executivo — mesmos números da página de mecanismos", () => {
  const base = basePayload([
    { client_id: "qv1", mecanismo_id: "m1", status: "concluido", implemented_at: "2026-03-01", created_at: "2026-01-01" },
    { client_id: "qv2", mecanismo_id: "m2", status: "apto", created_at: "2026-01-01" },
  ]);
  const consolidated = consolidateMechanismsPayload({ baseQvPayload: base, pharusPayload: null, clientsRaw });
  const quality = consolidated.metadata.consolidationQuality;
  const pageRows = filterMechanismClients(consolidated.clients, { ...defaultMechanismFilters(), status: "all" });
  const pageSummary = summarizeMechanismRows(pageRows, {
    catalog: consolidated.catalog,
    portfolioCount: pageRows.length,
    consolidationQuality: quality,
  });

  const contexts = buildExecutiveContexts(
    { mechanisms: consolidated },
    { status: "all", program: "all", search: "" },
  );
  const metrics = extractExecutiveMetrics(contexts);

  assert.equal(metrics.clients_with_implemented_mechanisms?.value, pageSummary.clientsWithImplementedMechanism);
  assert.equal(metrics.clients_implementation_rate?.value, pageSummary.implementationPercent);
  assert.equal(pageSummary.clientsWithMechanisms, quality.clients.consolidatedUniquePeople);
  assert.equal(quality.clients.formulaValidated, true);
});

test("consolidatedUniquePeople = matchedInBoth + baseQvOnly + unmatchedAppPharus", () => {
  const base = basePayload([{ client_id: "qv1", mecanismo_id: "m1", status: "apto", created_at: "2026-01-01" }]);
  const ph = pharusPayload([
    { userId: "ph1", mechanismName: "Outro Pharus", status: "suggested", createdAt: "2026-02-01", linkId: "l5" },
    { userId: "ph9", mechanismName: "Só Pharus", status: "suggested", createdAt: "2026-02-01", linkId: "l6" },
  ]);
  const out = consolidateMechanismsPayload({ baseQvPayload: base, pharusPayload: ph, clientsRaw });
  const c = out.metadata.consolidationQuality.clients;
  assert.equal(c.consolidatedUniquePeople, c.matchedInBoth + c.baseQvOnly + c.unmatchedAppPharus);
  assert.equal(c.formulaValidated, true);
});
