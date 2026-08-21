import assert from "node:assert/strict";
import { test } from "node:test";
import { crosswalkFromIdentityMatch, matchPharusToBaseQv } from "../../lib/analytics/identity-match.mjs";

test("shared_id: pharus userId igual QV client id", () => {
  const matched = matchPharusToBaseQv(
    [{ id: "abc", email: "a@test.com", mechanismCount: 2 }],
    [{ userId: "abc", email: "other@test.com", mechanismCount: 1 }],
  );
  assert.equal(matched.crossSourceCoverage.matchedInBoth, 1);
  assert.equal(matched.crossSourceRows[0].matchMethod, "shared_id");
});

test("crosswalkFromIdentityMatch produz byUserId", () => {
  const cw = crosswalkFromIdentityMatch(
    [{ id: "u1", email: "x@client.com", mechanismCount: 1 }],
    [{ userId: "ph1", email: "x@client.com", mechanismCount: 1 }],
  );
  assert.equal(cw.byUserId.get("ph1"), "u1");
  assert.equal(cw.reasonByUserId.get("ph1"), "email");
});
