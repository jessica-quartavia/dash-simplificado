import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditPharusClientCrosswalk,
  buildPharusClientCrosswalk,
} from "../../lib/analytics/pharus-client-crosswalk.mjs";

test("crosswalk — ordem fixa prioriza linked_user_id sobre e-mail", () => {
  const clients = [
    { id: "qv1", linked_user_id: "ph1", email: "shared@test.com" },
    { id: "qv2", email: "other@test.com" },
  ];
  const profiles = new Map([["ph1", { email: "shared@test.com", name: "Ana" }]]);
  const crosswalk = buildPharusClientCrosswalk(clients, profiles);
  assert.equal(crosswalk.byUserId.get("ph1"), "qv1");
  assert.equal(crosswalk.reasonByUserId.get("ph1"), "linked_user_id");
});

test("crosswalk — nome exato como último recurso", () => {
  const clients = [{ id: "qv9", name: "Maria Silva", email: "x@test.com" }];
  const profiles = new Map([["ph9", { name: "Maria Silva", email: "other@test.com" }]]);
  const crosswalk = buildPharusClientCrosswalk(clients, profiles);
  assert.equal(crosswalk.byUserId.get("ph9"), "qv9");
  assert.equal(crosswalk.reasonByUserId.get("ph9"), "name");
});

test("crosswalk — ambíguo não entra no consolidado", () => {
  const clients = [
    { id: "qv1", email: "dup@test.com" },
    { id: "qv2", email: "dup@test.com" },
  ];
  const profiles = new Map([["phX", { email: "dup@test.com" }]]);
  const crosswalk = buildPharusClientCrosswalk(clients, profiles);
  const audit = auditPharusClientCrosswalk(crosswalk, {
    qvClientIdsWithMechanisms: new Set(["qv1"]),
    pharusUserIdsWithMechanisms: new Set(["phX"]),
  });
  assert.equal(audit.ambiguous, 1);
  assert.equal(audit.consolidatedUniquePeople, 1);
  assert.equal(audit.formulaValidated, true);
});

test("crosswalk — fórmula matched + baseOnly + unmatched", () => {
  const clients = [
    { id: "qv1", linked_user_id: "ph1" },
    { id: "qv2" },
  ];
  const profiles = new Map([
    ["ph1", {}],
    ["ph9", {}],
  ]);
  const crosswalk = buildPharusClientCrosswalk(clients, profiles);
  const audit = auditPharusClientCrosswalk(crosswalk, {
    qvClientIdsWithMechanisms: new Set(["qv1", "qv2"]),
    pharusUserIdsWithMechanisms: new Set(["ph1", "ph9"]),
  });
  assert.equal(audit.matchedInBoth, 1);
  assert.equal(audit.baseQvOnly, 1);
  assert.equal(audit.unmatchedAppPharus, 1);
  assert.equal(audit.consolidatedUniquePeople, 3);
  assert.equal(audit.consolidationMode, "partial");
});
