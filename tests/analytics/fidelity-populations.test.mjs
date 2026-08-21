import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCancellationScope,
  buildMechanismConsolidatedSet,
  compareSets,
  extractCancellationEffectiveSet,
  extractEarlyCancellationSet,
  extractNonRenewalsSet,
} from "../../lib/analytics/fidelity-populations.mjs";
import { filterCancellationClients } from "../../lib/analytics/cancellations-filters.mjs";
import { buildPharusClientCrosswalk } from "../../lib/analytics/pharus-client-crosswalk.mjs";

test("consolidated people = matched + baseOnly + unmatchedApp (sem ambíguos)", () => {
  const crosswalk = buildPharusClientCrosswalk(
    [
      { id: "1", email: "a@test.com", linked_user_id: "u1" },
      { id: "2", email: "b@test.com" },
    ],
    new Map([
      ["u1", { email: "a@test.com" }],
      ["u2", { email: "c@test.com" }],
      ["u3", { email: "b@test.com" }],
      ["u4", { email: "b@test.com" }],
    ]),
  );
  const qv = new Set(["1", "2"]);
  const pharus = new Set(["u1", "u2", "u3", "u4"]);
  const set = buildMechanismConsolidatedSet({
    crosswalk,
    qvClientIdsWithMechanisms: qv,
    pharusUserIdsWithMechanisms: pharus,
  });
  assert.equal(set.has("1"), true);
  assert.equal(set.has("pharus:u2"), true);
  assert.equal(set.has("2"), true);
  assert.equal(set.has("pharus:u3"), false);
  assert.equal(set.has("pharus:u4"), false);
  assert.equal(set.size, 3);
});

test("applyCancellationScope v1_ui_default exclui arquivados", () => {
  const rows = [
    { clientId: "a", isArchived: false, hasEfetivado: true },
    { clientId: "b", isArchived: true, hasEfetivado: true },
  ];
  assert.deepEqual(
    [...extractCancellationEffectiveSet(rows, "v1_ui_default")],
    ["a"],
  );
});

test("filterCancellationClients default archived=no alinha escopo V1", () => {
  const rows = [
    { clientId: "a", isArchived: false, analyticalStatus: "Ativo" },
    { clientId: "b", isArchived: true, analyticalStatus: "Ativo" },
  ];
  const filtered = filterCancellationClients(rows);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].clientId, "a");
});

test("compareSets calcula only_v1 e only_v2", () => {
  const diff = compareSets(new Set(["1", "2"]), new Set(["2", "3"]));
  assert.equal(diff.intersection_count, 1);
  assert.deepEqual(diff.only_v1, ["1"]);
  assert.deepEqual(diff.only_v2, ["3"]);
});

test("cycle timing sets respeitam dedupe por cliente", () => {
  const rows = [
    {
      clientId: "1",
      isArchived: false,
      hasEfetivado: true,
      cancellationDate: "2024-06-01",
      cycleEndDate: "2024-12-01",
      cancellationTiming: "Antes do fim do ciclo",
    },
    {
      clientId: "2",
      isArchived: false,
      hasEfetivado: true,
      cancellationDate: "2025-01-01",
      cycleEndDate: "2024-12-01",
      cancellationTiming: "Não renovação",
    },
  ];
  assert.equal(extractEarlyCancellationSet(rows).size, 1);
  assert.equal(extractNonRenewalsSet(rows).size, 1);
  assert.equal(applyCancellationScope(rows, "v1_ui_default").length, 2);
});
