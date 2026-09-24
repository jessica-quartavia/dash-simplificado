import test from "node:test";
import assert from "node:assert/strict";
import { validateDataFimCicloProxy } from "../../lib/analytics/cycle-end-date-proxy-validation.mjs";

function client(partial) {
  return {
    clientId: partial.clientId || "1",
    analyticalStatus: "Ativo",
    entryDate: "2025-01-01",
    cycleEndDate: "2025-12-31",
    currentCycle: 1,
    cycleValid: true,
    renewed: false,
    program: "Pharus",
    ep: "EP Teste",
    segment: "APEX",
    totalImplementedMechanisms: 0,
    ...partial,
  };
}

test("validateDataFimCicloProxy — cobertura e horizonte", () => {
  const rows = [
    client({ clientId: "a", cycleEndDate: "2026-10-15" }),
    client({ clientId: "b", cycleEndDate: "2027-01-01" }),
    client({ clientId: "c", cycleEndDate: null, entryDate: null, analyticalStatus: "Ativo" }),
  ];
  const out = validateDataFimCicloProxy(rows, { refDate: new Date("2026-09-24T12:00:00-03:00") });
  assert.equal(out.metrics.coverage.active, 3);
  assert.equal(out.metrics.coverage.withBoth, 2);
  assert.equal(out.metrics.horizon.total, 1);
  assert.ok(out.evidence.classification);
});

test("validateDataFimCicloProxy — duração ciclo 1 mediana 365", () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    client({
      clientId: String(i),
      entryDate: "2025-01-01",
      cycleEndDate: "2026-01-01",
      currentCycle: 1,
    }),
  );
  const out = validateDataFimCicloProxy(rows, { refDate: new Date("2026-06-01T12:00:00-03:00") });
  assert.equal(out.metrics.durationByCycle["1"].median, 365);
});
