import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isUnknownCategoryLabel,
  sortDistributionUnknownLast,
  sortLabelsUnknownLast,
  sortUnknownLast,
} from "../../lib/analytics/filters/sort-categories.mjs";
import {
  defaultEpPerformanceFilters,
  filterEpClients,
  filterEpEngineers,
} from "../../lib/analytics/ep-performance-filters.mjs";

test("Não informado sempre por último em sortLabelsUnknownLast", () => {
  const sorted = sortLabelsUnknownLast(["PRIVATE", "Não informado", "APEX", "Sem informação"]);
  assert.deepEqual(sorted, ["APEX", "PRIVATE", "Não informado", "Sem informação"]);
});

test("sortDistributionUnknownLast mantém count desc e empurra desconhecido", () => {
  const sorted = sortDistributionUnknownLast([
    { label: "Não informado", count: 99 },
    { label: "Ativo", count: 10 },
    { label: "Congelado", count: 20 },
  ]);
  assert.equal(sorted[0].label, "Congelado");
  assert.equal(sorted[1].label, "Ativo");
  assert.equal(sorted.at(-1).label, "Não informado");
});

test("isUnknownCategoryLabel reconhece variações", () => {
  assert.equal(isUnknownCategoryLabel("NÃO INFORMADO"), true);
  assert.equal(isUnknownCategoryLabel("Sem informação"), true);
  assert.equal(isUnknownCategoryLabel("Ativo"), false);
});

test("EP status filter recorta clientes ativos", () => {
  const clients = [
    { engineer: "EP1", analyticalStatus: "Ativo", segment: "PRIVATE", program: "Pharus" },
    { engineer: "EP1", analyticalStatus: "Congelado", segment: "PRIVATE", program: "Pharus" },
  ];
  const filtered = filterEpClients(clients, { ...defaultEpPerformanceFilters(), status: "active" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].analyticalStatus, "Ativo");
});

test("EP period filter recalcula reuniões sem alterar carteira total", () => {
  const engineers = [
    {
      engineer: "EP1",
      totalClients: 2,
      activeClients: 2,
      clients: [
        {
          analyticalStatus: "Ativo",
          segment: "PRIVATE",
          program: "Pharus",
          meetingDates: ["2025-01-01", "2026-06-01"],
          totalMeetings: 2,
        },
        {
          analyticalStatus: "Ativo",
          segment: "PRIVATE",
          program: "Pharus",
          meetingDates: ["2025-01-01"],
          totalMeetings: 1,
        },
      ],
    },
  ];
  const out = filterEpEngineers(engineers, {
    ...defaultEpPerformanceFilters(),
    period: "custom",
    from: "2026-01-01",
    to: "2026-08-01",
  });
  assert.equal(out[0].totalClients, 2);
  assert.equal(out[0].totalMeetings, 1);
});
