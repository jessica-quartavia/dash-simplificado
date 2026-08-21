import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  multiSelectOrMatch,
  normalizeMultiSelectFilter,
  summarizeMultiSelectLabel,
} from "../../lib/analytics/filters/multiselect.mjs";
import {
  FINANCIAL_TRAIT_OPTIONS,
  filterFinancialUpdateClients,
  defaultFinancialUpdatesFilters,
} from "../../lib/analytics/financial-updates-filters.mjs";
import {
  defaultMechanismFilters,
  filterMechanismClients,
} from "../../lib/analytics/mechanism-filters.mjs";
import {
  defaultRenewalFilters,
  filterRenewalClients,
} from "../../lib/analytics/renewal-filters.mjs";
import { formatLastUpdated } from "../../js/components/page-refresh.js";
import { renderMultiSelectFilter } from "../../js/components/filters/multi-select-filter.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const FIN_ROWS = [
  {
    clientId: "1",
    clientName: "Ana",
    analyticalStatus: "Ativo",
    engineer: "EP1",
    segment: "PRIVATE",
    program: "Pharus",
    hasFinancialData: true,
    liquidityReserve: 1000,
    monthlyIncome: null,
    lastContribution: null,
  },
  {
    clientId: "2",
    clientName: "João",
    analyticalStatus: "Ativo",
    engineer: "EP2",
    segment: "APEX",
    program: "Davos",
    hasFinancialData: false,
    liquidityReserve: null,
    monthlyIncome: 5000,
    lastContribution: null,
  },
];

test("multiselect OR dentro do mesmo filtro", () => {
  const filtered = filterFinancialUpdateClients(FIN_ROWS, {
    ...defaultFinancialUpdatesFilters(),
    status: "all",
    financialTraits: ["hasLiquidityReserve", "hasMonthlyIncome"],
  });
  assert.equal(filtered.length, 2);
});

test("multiselect AND com outro filtro", () => {
  const filtered = filterFinancialUpdateClients(FIN_ROWS, {
    ...defaultFinancialUpdatesFilters(),
    status: "all",
    program: "Pharus",
    financialTraits: ["hasLiquidityReserve", "hasMonthlyIncome"],
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].clientId, "1");
});

test("multiselect Todos não recorta", () => {
  assert.equal(normalizeMultiSelectFilter([]).length, 0);
  assert.equal(
    filterFinancialUpdateClients(FIN_ROWS, { ...defaultFinancialUpdatesFilters(), status: "all" }).length,
    2,
  );
});

test("multiselect summarize label compacto", () => {
  const label = summarizeMultiSelectLabel(FINANCIAL_TRAIT_OPTIONS, ["hasLiquidityReserve", "hasMonthlyIncome"]);
  assert.match(label, /selecionados|Reserva|Renda/i);
});

test("mecanismo multiselect OR", () => {
  const rows = [
    {
      clientId: "1",
      analyticalStatus: "Ativo",
      engineer: "EP1",
      segment: "PRIVATE",
      program: "Pharus",
      mechanisms: [{ mechanismId: "a", name: "ARCADIA", status: "Apto" }],
    },
    {
      clientId: "2",
      analyticalStatus: "Ativo",
      engineer: "EP1",
      segment: "PRIVATE",
      program: "Pharus",
      mechanisms: [{ mechanismId: "b", name: "DAVOS X", status: "Apto" }],
    },
  ];
  const filtered = filterMechanismClients(rows, {
    ...defaultMechanismFilters(),
    mechanism: ["ARCADIA", "DAVOS X"],
  });
  assert.equal(filtered.length, 2);
});

test("renovou sim/no respeita ciclo válido", () => {
  const rows = [
    { clientId: "1", analyticalStatus: "Ativo", engineer: "EP1", segment: "PRIVATE", program: "Pharus", currentCycle: 3, renewed: true, cycleValid: true },
    { clientId: "2", analyticalStatus: "Ativo", engineer: "EP1", segment: "PRIVATE", program: "Davos", currentCycle: 1, renewed: false, cycleValid: true },
    { clientId: "3", analyticalStatus: "Ativo", engineer: "EP1", segment: "PRIVATE", program: "Pharus", currentCycle: null, renewed: false, cycleValid: false },
  ];
  assert.equal(filterRenewalClients(rows, { ...defaultRenewalFilters(), renewed: "yes" }).length, 1);
  assert.equal(filterRenewalClients(rows, { ...defaultRenewalFilters(), renewed: "no" }).length, 1);
  assert.equal(filterRenewalClients(rows, { ...defaultRenewalFilters(), renewed: "no" }).some((r) => r.clientId === "3"), false);
});

test("page refresh timestamp mesmo dia", () => {
  const now = new Date("2026-08-20T18:17:00.000Z");
  const ts = formatLastUpdated(new Date("2026-08-20T15:17:00.000Z"), now);
  assert.match(ts, /^\d{2}:\d{2}$/);
});

test("page refresh timestamp dia diferente", () => {
  const now = new Date("2026-08-20T18:17:00.000Z");
  const ts = formatLastUpdated(new Date("2026-08-19T15:17:00.000Z"), now);
  assert.match(ts, /19\/08\/2026/);
  assert.match(ts, /às/);
});

test("multiselect component exportado no filter-bar", () => {
  const filterBar = readFileSync(resolve(root, "js/components/filters/filter-bar.js"), "utf8");
  const multi = readFileSync(resolve(root, "js/components/filters/multi-select-filter.js"), "utf8");
  assert.match(filterBar, /renderMultiSelectFilter/);
  assert.match(multi, /bindMultiSelectFilter/);
  assert.ok(existsSync(resolve(root, "js/components/page-refresh.js")));
});

test("render multiselect inclui checkboxes", () => {
  const html = renderMultiSelectFilter({
    field: {
      id: "tTraits",
      key: "financialTraits",
      label: "Dados financeiros",
      options: FINANCIAL_TRAIT_OPTIONS,
    },
    filters: { financialTraits: ["hasFinancialData"] },
  });
  assert.match(html, /type="checkbox"/);
  assert.match(html, /data-msf-trigger/);
});

test("multiSelectOrMatch helper", () => {
  const row = { hasFinancialData: true, liquidityReserve: 10 };
  assert.equal(
    multiSelectOrMatch(row, ["hasFinancialData", "hasLiquidityReserve"], {
      hasFinancialData: (r) => r.hasFinancialData,
      hasLiquidityReserve: (r) => r.liquidityReserve != null,
    }),
    true,
  );
});
