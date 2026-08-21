import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROGRAM_ALLOWLIST,
  normalizeProgramFilter,
  normalizeProgramToken,
  programMatches,
  programSelectOptions,
  programTokensFromRow,
  resolveClientProgram,
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

test("resolveClientProgram usa clients.programa e davos_contrato_assinado", () => {
  assert.equal(resolveClientProgram({ program: "PHARUS" }), "Pharus");
  assert.equal(resolveClientProgram({ program: " davos " }), "Davos");
  assert.equal(resolveClientProgram({ davosContractSigned: true }), "Davos");
  assert.equal(resolveClientProgram({ program: "LANDLORD" }), "Não informado");
  assert.equal(resolveClientProgram({ program: "Pharus + Davos" }), "Davos");
});

test("davos_contrato_assinado adiciona token Davos ao filtro", () => {
  assert.equal(programMatches({ davos_contrato_assinado: true }, "Davos"), true);
  assert.equal(programMatches({ davos_contrato_assinado: true, program: "Pharus" }, "Pharus"), true);
  assert.equal(programMatches({ davos_contrato_assinado: true, program: "Pharus" }, "Davos"), true);
});
