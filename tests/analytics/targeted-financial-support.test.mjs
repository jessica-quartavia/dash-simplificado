import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

import {
  distributionsFromFinancialRows,
  financialUpdatesLeader,
  formatFinancialLeaderNote,
} from "../../lib/analytics/financial-updates-metrics.mjs";
import { summarizeFilteredSupport } from "../../lib/analytics/support-filters.mjs";
import { financialUpdateColumns, priorityBars } from "../../js/general-charts.mjs";

test("recência usa faixas V1 completas", () => {
  const rows = [
    { clientId: "1", recencyBand: "Atualizado nos últimos 30 dias", hasPostCreationUpdate: true, financialUpdateDate: "2026-08-01T00:00:00.000Z" },
    { clientId: "2", recencyBand: "Sem dados financeiros", hasFinancialData: false },
  ];
  const dist = distributionsFromFinancialRows(rows);
  assert.equal(dist.updateRecency.length, 7);
  assert.equal(dist.updateRecency.find((i) => i.label === "Sem dados financeiros")?.count, 1);
});

test("atualizações por mês deduplica clientes", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  const rows = [
    { clientId: "1", hasPostCreationUpdate: true, financialUpdateDate: "2026-08-10T00:00:00.000Z" },
    { clientId: "1", hasPostCreationUpdate: true, financialUpdateDate: "2026-08-12T00:00:00.000Z" },
    { clientId: "2", hasPostCreationUpdate: true, financialUpdateDate: "2026-08-05T00:00:00.000Z" },
  ];
  const dist = distributionsFromFinancialRows(rows, { monthRange: 6, now });
  const aug = dist.updatesByMonth.find((m) => m.month === "2026-08");
  assert.equal(aug?.count, 2);
});

test("financialUpdateColumns exibe valor no topo", () => {
  const html = financialUpdateColumns([{ month: "2026-05", count: 125 }], 6);
  assert.match(html, /125/);
  assert.match(html, /acq-col-value/);
  assert.match(html, /acq-col-bar/);
});

test("financial leader note empate", () => {
  const note = formatFinancialLeaderNote({ leaders: ["Ana", "Bruno"], count: 3 });
  assert.match(note, /Ana e Bruno lideram/);
});

test("support summarize inclui reclamações e prioridade ordenada", () => {
  const summary = summarizeFilteredSupport([
    { priority: "Baixa", clientIdentified: true, primaryClientId: "1", type: "Reclamação", title: "", description: "" },
    { priority: "Urgente", clientIdentified: false, type: "Elogio", title: "elogio ao time", description: "" },
  ]);
  assert.equal(summary.complaints, 1);
  assert.equal(summary.praiseTickets, 1);
  assert.equal(summary.byPriority[0].label, "Urgente");
  assert.equal(summary.byPriority.at(-1).label, "Não informado");
});

test("priorityBars mostra count e percentual", () => {
  const html = priorityBars([{ label: "Urgente", count: 2, percent: 50 }], { Urgente: "#c0392b" });
  assert.match(html, /Urgente/);
  assert.match(html, /50%/);
});

test("support.js UI targeted changes", () => {
  const source = readFileSync(join(ROOT, "js/support.js"), "utf8");
  assert.match(source, /Total de Acionamentos/);
  assert.match(source, /Clientes Identificados no Base QV/);
  assert.doesNotMatch(source, /kpiCard\("Identificados no Base QV"/);
  assert.doesNotMatch(source, /Identificação/);
  assert.doesNotMatch(source, /Com cliente/);
  assert.match(source, /Acionamentos por prioridade/);
});

test("financial-updates.js gráfico vertical e leader note", () => {
  const source = readFileSync(join(ROOT, "js/financial-updates.js"), "utf8");
  assert.match(source, /financialUpdateColumns/);
  assert.match(source, /formatFinancialLeaderNote/);
  assert.match(source, /monthRange: 6/);
});
