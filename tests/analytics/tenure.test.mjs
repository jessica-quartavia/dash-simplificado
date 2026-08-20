import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRenewalTenureAdjustment,
  calculateAnalyticalTenure,
  calculateBaseTenureDays,
} from "../../lib/analytics/index.mjs";

test("ativo: permanência até hoje, sem +365 no ciclo 1", () => {
  const result = calculateAnalyticalTenure({
    hireDate: "2024-01-01",
    now: "2024-01-31",
    currentCycle: 1,
  });
  assert.equal(result.stayDaysBase, 30);
  assert.equal(result.stayDaysChronological, 30);
  assert.equal(result.stayDays, 30);
  assert.equal(result.adjusted, false);
});

test("renovado com base < 365: +365 só no indicador analítico", () => {
  const result = calculateAnalyticalTenure({
    hireDate: "2024-01-01",
    now: "2024-04-10",
    currentCycle: 2,
  });
  assert.equal(result.stayDaysBase, 100);
  assert.equal(result.stayDaysChronological, 100);
  assert.equal(result.stayDays, 465);
  assert.equal(result.adjusted, true);
});

test("renovado com base >= 365: não soma +365", () => {
  assert.equal(applyRenewalTenureAdjustment(400, 2), 400);
});

test("cancelado com data usa a data de cancelamento", () => {
  const result = calculateBaseTenureDays({
    hireDate: "2024-01-01",
    isCancelled: true,
    cancellationDate: "2024-03-01",
  });
  assert.equal(result.stayDaysBase, 60);
  assert.equal(result.status, "calculated_cancellation_date");
});

test("cancelado sem data: permanência excluída", () => {
  const result = calculateAnalyticalTenure({
    hireDate: "2024-01-01",
    isCancelled: true,
    currentCycle: 2,
  });
  assert.equal(result.stayDaysBase, null);
  assert.equal(result.stayDaysChronological, null);
  assert.equal(result.status, "missing_cancellation_date");
});
