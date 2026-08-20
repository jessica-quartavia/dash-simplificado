import assert from "node:assert/strict";
import { test } from "node:test";
import { renewalFromCycle } from "../../lib/analytics/index.mjs";

test("ciclo 1 → 0 renovações", () => {
  const result = renewalFromCycle(1);
  assert.equal(result.valid, true);
  assert.equal(result.hasRenewed, false);
  assert.equal(result.renewalCount, 0);
});

test("ciclo 2 → 1 renovação", () => {
  const result = renewalFromCycle(2);
  assert.equal(result.hasRenewed, true);
  assert.equal(result.renewalCount, 1);
});

test("ciclo 3 → 2 renovações", () => {
  const result = renewalFromCycle(3);
  assert.equal(result.hasRenewed, true);
  assert.equal(result.renewalCount, 2);
});
