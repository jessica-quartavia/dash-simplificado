import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROGRAM_ALLOWLIST,
  normalizeProgramFilter,
  normalizeProgramToken,
  programMatches,
  programSelectOptions,
  programTokensFromRow,
} from "../../lib/analytics/filters/program.mjs";
import { defaultGeneralFilters, filterGeneralClients } from "../../lib/analytics/general-filters.mjs";

const ROWS = [
  { clientId: "1", analyticalStatus: "Ativo", program: "PHARUS" },
  { clientId: "2", analyticalStatus: "Ativo", program: " davos " },
  { clientId: "3", analyticalStatus: "Ativo", program: "LANDLORD" },
  { clientId: "4", analyticalStatus: "Ativo", program: "Pharus + Davos" },
];

test("J — seletor lista somente Todos, Pharus, Davos", () => {
  assert.deepEqual(programSelectOptions(ROWS), PROGRAM_ALLOWLIST);
  assert.deepEqual(PROGRAM_ALLOWLIST, ["Pharus", "Davos"]);
});

test("K — LANDLORD não aparece nas opções", () => {
  assert.equal(programSelectOptions(ROWS).includes("LANDLORD"), false);
});

test("L — Programa Pharus filtra corretamente", () => {
  const rows = filterGeneralClients(ROWS, { ...defaultGeneralFilters(), status: "all", program: "Pharus" });
  assert.deepEqual(rows.map((row) => row.clientId).sort(), ["1", "4"]);
});

test("M — Programa Davos filtra corretamente", () => {
  const rows = filterGeneralClients(ROWS, { ...defaultGeneralFilters(), status: "all", program: "Davos" });
  assert.deepEqual(rows.map((row) => row.clientId).sort(), ["2", "4"]);
});

test("normalização trim e case insensitive", () => {
  assert.equal(normalizeProgramToken(" pharus "), "Pharus");
  assert.equal(normalizeProgramToken("DAVOS"), "Davos");
  assert.equal(normalizeProgramFilter(" pharus "), "Pharus");
});

test("valor fora da allowlist não gera token", () => {
  assert.equal(normalizeProgramToken("LANDLORD"), null);
  assert.equal(programTokensFromRow({ program: "LANDLORD" }).size, 0);
  assert.equal(programMatches({ program: "LANDLORD" }, "Pharus"), false);
});
