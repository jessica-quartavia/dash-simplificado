import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  defaultMechanismFilters,
  filterMechanismClients,
  filterPortfolio,
  portfolioSize,
} from "../../lib/analytics/mechanism-filters.mjs";
import {
  MECHANISMS_HIDDEN,
  dedupeClientMechanisms,
  normalizeMechanismStatus,
  summarizeEngineerBars,
  summarizeMechanismRows,
} from "../../lib/analytics/mechanism-metrics.mjs";
import { buildMechanismsPayload, toPublicMechanismsPayload } from "../../lib/analytics/mechanisms.mjs";
import { excludedClientIds } from "../../lib/analytics/data-exclusions.mjs";
import { consolidateMechanismsPayload } from "../../lib/analytics/mechanisms/mechanisms-consolidation.mjs";

const now = new Date("2026-08-19T12:00:00.000Z");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fixturePayload() {
  return buildMechanismsPayload({
    now,
    clients: [
      { id: "1", codigo: "A1", name: "Ana", status: "ativo", engenheiro_patrimonial: "EP1" },
      { id: "2", codigo: "B2", name: "Bruno", status: "ativo", engenheiro_patrimonial: "EP1" },
      { id: "3", codigo: "C3", name: "Carla", status: "cancelado", engenheiro_patrimonial: "EP2", data_churn: "2026-01-01" },
      { id: "4", codigo: "D4", name: "Dora", status: "ativo", engenheiro_patrimonial: "EP2" },
      { id: "5", codigo: "E5", name: "Eva", status: "congelado", engenheiro_patrimonial: "EP1" },
    ],
    cancellations: [{ client_id: "3", churn_efetivado_at: "2026-01-01", archived_at: null }],
    mechanisms: [
      { id: "m1", name: "Previdência", categoria: "Proteção", mercado: null },
      { id: "m2", name: "Consórcio", categoria: "Alavancagem", mercado: null },
      { id: "m3", name: "Fundo", categoria: "Investimento", mercado: null },
    ],
    financialRows: [],
    cmRows: [
      { id: "old", client_id: "1", mecanismo_id: "m1", status: "apto", created_at: "2026-01-01", implemented_at: null },
      { id: "new", client_id: "1", mecanismo_id: "m1", status: "concluido", created_at: "2026-08-01", implemented_at: "2026-08-10" },
      { id: "p2", client_id: "1", mecanismo_id: "m2", status: "iniciado", created_at: "2026-07-01", implemented_at: null },
      { id: "b1", client_id: "2", mecanismo_id: "m1", status: "concluido", created_at: "2026-02-01", implemented_at: "2026-02-10" },
      { id: "c1", client_id: "3", mecanismo_id: "m3", status: "apto", created_at: "2026-03-01", implemented_at: null },
    ],
  });
}

test("default Status = Ativos (congelado não entra)", () => {
  const filters = defaultMechanismFilters();
  assert.equal(filters.status, "active");
  const payload = fixturePayload();
  const rows = filterMechanismClients(payload.clients, filters);
  assert.deepEqual(rows.map((r) => r.clientId).sort(), ["1", "2"]);
  assert.equal(rows.some((r) => r.analyticalStatus === "Congelado"), false);
});

test("denominador ativo usa a carteira filtrada, não o total", () => {
  const payload = fixturePayload();
  const filters = defaultMechanismFilters();
  const rows = filterMechanismClients(payload.clients, filters);
  const portfolio = filterPortfolio(payload.portfolio, filters);
  const summary = summarizeMechanismRows(rows, {
    catalog: payload.catalog,
    portfolio: portfolio,
    portfolioCount: portfolioSize(portfolio),
  });
  assert.equal(summary.baseQvDisplayed, 2);
  assert.equal(summary.displayedCombinedTotal, 2);
  assert.equal(summary.clientsWithMechanisms, 2);
  assert.equal(summary.coverage.total, 3);
  assert.equal(summary.coverage.percent, 66.7);
  const all = summarizeMechanismRows(payload.clients, {
    catalog: payload.catalog,
    portfolioCount: portfolioSize(payload.portfolio),
  });
  assert.equal(all.coverage.total, 5);
  assert.notEqual(summary.coverage.percent, all.coverage.percent);
});

test("dedupe client_id + mecanismo_id mantém o mais recente", () => {
  const { rows, duplicatePairs } = dedupeClientMechanisms([
    { id: "old", client_id: "1", mecanismo_id: "m1", status: "apto", created_at: "2026-01-01" },
    { id: "new", client_id: "1", mecanismo_id: "m1", status: "concluido", created_at: "2026-08-01", implemented_at: "2026-08-10" },
    { id: "other", client_id: "1", mecanismo_id: "m2", status: "iniciado", created_at: "2026-07-01" },
  ]);
  assert.equal(duplicatePairs, 1);
  assert.equal(rows.length, 2);
  const kept = rows.find((r) => r.mecanismo_id === "m1");
  assert.equal(kept.id, "new");
  assert.equal(kept.status, "concluido");
});

test("status oficial BASE QV: concluido=Implementado; apto e em andamento reconhecidos", () => {
  assert.equal(normalizeMechanismStatus("apto").label, "Apto");
  assert.equal(normalizeMechanismStatus("iniciado").label, "Em andamento");
  assert.equal(normalizeMechanismStatus("em andamento").label, "Em andamento");
  assert.equal(normalizeMechanismStatus("concluido").label, "Implementado");
  assert.equal(normalizeMechanismStatus("implementado").label, "Não informado");
  assert.equal(normalizeMechanismStatus("xyz").label, "Não informado");

  const payload = fixturePayload();
  const ana = payload.clients.find((c) => c.clientId === "1");
  assert.equal(ana.available, 2);
  assert.equal(ana.implemented, 1);
  assert.equal(ana.inProgress, 1);
  const rows = filterMechanismClients(payload.clients, defaultMechanismFilters());
  const portfolio = filterPortfolio(payload.portfolio, defaultMechanismFilters());
  const summary = summarizeMechanismRows(rows, {
    catalog: payload.catalog,
    portfolio,
    portfolioCount: portfolioSize(portfolio),
  });
  assert.equal(summary.availableMechanisms, 3);
  assert.equal(summary.implementedMechanisms, 2);
  assert.equal(summary.clientsWithImplementedMechanism, 2);
  assert.equal(summary.inProgressMechanisms, 1);
  assert.equal(summary.activeClientsWithImplemented, 2);
  assert.equal(summary.activeClientTotal, 2);
  assert.equal(summary.clientsWithLinkedMechanisms, 2);
  assert.equal(summary.mechanismImplementationRate, 100);
  assert.equal(summary.implementationPercent, 100);
  assert.equal(summary.statusDist.some((item) => item.label === "Apto"), false);
});

test("percentual implantado = clientes com impl. ÷ clientes com mecanismo vinculado", () => {
  const summary = summarizeMechanismRows(
    [{
      clientId: "1",
      analyticalStatus: "Ativo",
      available: 4,
      implemented: 1,
      mechanisms: [
        { status: "Implementado", mechanismId: "m1" },
        { status: "Apto", mechanismId: "m2" },
        { status: "Apto", mechanismId: "m3" },
        { status: "Apto", mechanismId: "m4" },
      ],
    }],
    {
      catalog: [],
      portfolio: [{ analyticalStatus: "Ativo", engineer: "EP1", segment: "APEX", count: 10 }],
      portfolioCount: 10,
      consolidationQuality: { clients: { pharusUsersWithMechanisms: 73 } },
      pharusAvailable: true,
    },
  );
  assert.equal(summary.mechanismImplementationRate, 100);
  assert.equal(summary.implementationPercent, 100);
  assert.equal(summary.implementationPercentLinks, 25);
  assert.equal(summary.baseQvDisplayed, 1);
  assert.equal(summary.appPharusDisplayed, 0);
  assert.equal(summary.displayedCombinedTotal, 1);
  assert.equal(summary.clientsWithMechanisms, 1);
  assert.equal(summary.clientsWithImplementedMechanism, 1);
  assert.equal(summary.clientsWithLinkedMechanisms, 1);
});

test("filtros recortam clientes e o denominador de cobertura", () => {
  const payload = fixturePayload();
  const filters = { ...defaultMechanismFilters(), engineer: "EP2" };
  const rows = filterMechanismClients(payload.clients, filters);
  const portfolio = filterPortfolio(payload.portfolio, filters);
  assert.equal(rows.length, 0);
  assert.equal(portfolioSize(portfolio), 1);
  const withImpl = filterMechanismClients(payload.clients, { ...defaultMechanismFilters(), hasImpl: "yes" });
  assert.deepEqual(withImpl.map((r) => r.clientId).sort(), ["1", "2"]);
  const byMech = filterMechanismClients(payload.clients, { ...defaultMechanismFilters(), mechanism: "m2" });
  assert.deepEqual(byMech.map((r) => r.clientId), ["1"]);
});

test("EP usa a carteira do engenheiro como denominador", () => {
  const payload = fixturePayload();
  const rows = filterMechanismClients(payload.clients, defaultMechanismFilters());
  const portfolio = filterPortfolio(payload.portfolio, defaultMechanismFilters());
  const bars = summarizeEngineerBars(rows, portfolio);
  const ep1 = bars.find((b) => b.label === "EP1");
  assert.equal(ep1.count, 2);
  assert.equal(ep1.total, 2);
  assert.equal(ep1.percent, 100);
});

test("métricas Não Levar não vão para a UI nem para o payload público de tempos", () => {
  const ui = readFileSync(resolve(ROOT, "js/mechanisms.js"), "utf8");
  assert.equal(ui.includes("Tempo médio até a primeira implementação"), false);
  assert.equal(ui.includes("mkSource"), false);
  assert.equal(ui.includes('label: "Fonte"'), false);
  assert.equal(ui.includes("Tempo até a primeira implementação"), false);
  assert.equal(ui.includes("Dias desde a última implementação"), false);
  assert.equal(ui.includes("Somente clientes ativos"), false);
  assert.equal(ui.includes("averageDaysToFirst"), false);
  assert.equal(ui.includes("🔧"), false);
  assert.ok(MECHANISMS_HIDDEN.includes("averageDaysToFirstImplementation"));
  const payload = fixturePayload();
  const publicPayload = toPublicMechanismsPayload(payload);
  const json = JSON.stringify(publicPayload);
  assert.equal(json.includes("daysToFirstImplementation"), false);
  assert.equal(json.includes("daysSinceLastImplementation"), false);
  assert.ok(publicPayload.clients[0].mechanisms[0].implementedAt);
  assert.deepEqual(publicPayload.metadata.hiddenMetrics, [
    "Tempo médio até a primeira implementação",
    "Tempo até a primeira implementação",
    "Dias desde a última implementação",
  ]);
});

test("payload público inclui metadados consolidados sem PII de matching", () => {
  const payload = fixturePayload();
  const consolidated = consolidateMechanismsPayload({
    baseQvPayload: payload,
    pharusPayload: null,
    clientsRaw: [{ id: "1", email: "a@test.com" }],
  });
  const publicPayload = toPublicMechanismsPayload(consolidated);
  assert.equal(publicPayload.defaultStatusFilter, "active");
  assert.equal(publicPayload.metadata.consolidated, true);
  assert.equal(publicPayload.metadata.sources.includes("BASE QV"), true);
  assert.ok(publicPayload.clients[0].mechanisms[0].mechanismId);
  assert.equal(publicPayload.clients[0].mechanisms[0].rawStatus, undefined);
  assert.equal(publicPayload.clients[0].entryDate, undefined);
  assert.equal(publicPayload.clients[0].userEmail, undefined);
  assert.ok(publicPayload.metadata.consolidationQuality);
});

test("client_mecanismos de cliente excluído é filtrado antes do BASE QV (fidelidade V1)", () => {
  const clientsRaw = [
    { id: "1", codigo: "A1", name: "Ana", status: "ativo", engenheiro_patrimonial: "EP1" },
    { id: "ex", codigo: "X1", name: "liliane reus", email: "casoisolado32@gmail.com", status: "ativo", engenheiro_patrimonial: "EP1" },
  ];
  const removedIds = excludedClientIds(clientsRaw);
  const cmRowsAll = [
    { id: "ok", client_id: "1", mecanismo_id: "m1", status: "concluido", created_at: "2026-08-01", implemented_at: "2026-08-10" },
    { id: "bad", client_id: "ex", mecanismo_id: "m1", status: "concluido", created_at: "2026-08-01", implemented_at: "2026-08-10" },
  ];
  const cmRows = cmRowsAll.filter((row) => !removedIds.has(String(row.client_id || "")));
  const payload = buildMechanismsPayload({
    now,
    clients: clientsRaw.filter((c) => !removedIds.has(String(c.id))),
    cancellations: [],
    mechanisms: [{ id: "m1", name: "Previdência", categoria: "Proteção", mercado: null }],
    financialRows: [],
    cmRows,
  });
  assert.equal(payload.clients.length, 1);
  assert.equal(payload.clients[0].clientId, "1");
});
