import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANALYTICAL_STATUS,
  isActiveClient,
  isCancelledClient,
  isFrozenClient,
} from "../../lib/analytics/index.mjs";

test("Ativo → true", () => {
  assert.equal(isActiveClient("Ativo"), true);
  assert.equal(isActiveClient({ analyticalStatus: ANALYTICAL_STATUS.ACTIVE }), true);
});

test("Congelado → false", () => {
  assert.equal(isActiveClient("Congelado"), false);
  assert.equal(isFrozenClient("Congelado"), true);
});

test("Cancelado → false", () => {
  assert.equal(isActiveClient("Cancelado"), false);
  assert.equal(isCancelledClient("Cancelado"), true);
  assert.equal(isActiveClient("Cancelado efetivado sem data"), false);
});
