import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

import {
  RENEWAL_COUNT_BAND_ORDER,
  renewalCountDistributionLabel,
} from "../../lib/analytics/client-cycle-renewal.mjs";
import { distributionsFromRenewalRows } from "../../lib/analytics/renewal-metrics.mjs";

test("renewal count band não confunde 0 com Não informado", () => {
  assert.equal(renewalCountDistributionLabel(0), "0");
  assert.equal(renewalCountDistributionLabel(null), "Sem dado");
  const dist = distributionsFromRenewalRows([
    { renewalCount: 0, cycleValid: true, renewed: false, engineer: "A" },
    { renewalCount: 1, cycleValid: true, renewed: true, engineer: "A" },
    { renewalCount: null, cycleValid: false, engineer: "B" },
  ]);
  const zero = dist.renewalCountBands.find((b) => b.label === "0");
  const semDado = dist.renewalCountBands.find((b) => b.label === "Sem dado");
  assert.equal(zero?.count, 1);
  assert.equal(semDado?.count, 1);
  assert.ok(!dist.renewalCountBands.some((b) => b.label === "Não informado"));
});

test("renewal band order inclui Sem dado por último", () => {
  assert.deepEqual(RENEWAL_COUNT_BAND_ORDER.at(-1), "Sem dado");
});

test("support UI regression cards", () => {
  const source = readFileSync(join(ROOT, "js/support.js"), "utf8");
  assert.match(source, /Clientes Identificados no Base QV/);
  assert.doesNotMatch(source, /Reclamações/);
  assert.doesNotMatch(source, /Elogios/);
});

test("renewal UI remove aptos", () => {
  const source = readFileSync(join(ROOT, "js/renewal.js"), "utf8");
  assert.doesNotMatch(source, /Clientes aptos para renovação/);
});

test("satisfaction UI NPS Pharus/Davos", () => {
  const source = readFileSync(join(ROOT, "js/satisfaction.js"), "utf8");
  assert.match(source, /NPS Pharus:/);
  assert.match(source, /NPS Davos:/);
});
