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
      { id: "b1", client_id: "2", mecanismo_id: "m1", status: "implementado", created_at: "2026-02-01", implemented_at: "2026-02-10" },
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
    portfolioCount: portfolioSize(portfolio),
  });
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

test("status oficial: disponível = vínculos; implementado e em andamento pelo compute da V1", () => {
  assert.equal(normalizeMechanismStatus("apto").label, "Apto");
  assert.equal(normalizeMechanismStatus("eligible").label, "Apto");
  assert.equal(normalizeMechanismStatus("iniciado").label, "Em andamento");
  assert.equal(normalizeMechanismStatus("em andamento").label, "Em andamento");
  assert.equal(normalizeMechanismStatus("concluido").label, "Implementado");
  assert.equal(normalizeMechanismStatus("implementado").label, "Implementado");
  assert.equal(normalizeMechanismStatus("xyz").label, "Não informado");

  const payload = fixturePayload();
  const ana = payload.clients.find((c) => c.clientId === "1");
  assert.equal(ana.available, 2);
  assert.equal(ana.implemented, 1);
  assert.equal(ana.inProgress, 1);
  const rows = filterMechanismClients(payload.clients, defaultMechanismFilters());
  const summary = summarizeMechanismRows(rows, { catalog: payload.catalog, portfolioCount: 3 });
  assert.equal(summary.availableMechanisms, 3);
  assert.equal(summary.implementedMechanisms, 2);
  assert.equal(summary.inProgressMechanisms, 1);
  assert.equal(summary.implementationPercent, 66.7);
});

test("percentual implementado usa vínculos, não clientes", () => {
  const summary = summarizeMechanismRows(
    [{ available: 4, implemented: 1, inProgress: 0, mechanisms: [] }],
    { catalog: [], portfolioCount: 10 },
  );
  assert.equal(summary.implementationPercent, 25);
  assert.equal(summary.clientsWithMechanisms, 1);
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

test("payload público não envia joins internos nem consulta Pharus", () => {
  const payload = fixturePayload();
  const publicPayload = toPublicMechanismsPayload(payload);
  assert.equal(publicPayload.defaultStatusFilter, "active");
  assert.equal(publicPayload.metadata.pharusConsulted, false);
  assert.equal(publicPayload.metadata.sources.includes("BASE QV"), true);
  assert.ok(publicPayload.clients[0].mechanisms[0].mechanismId);
  assert.equal(publicPayload.clients[0].mechanisms[0].rawStatus, undefined);
  assert.equal(publicPayload.clients[0].entryDate, undefined);
});
