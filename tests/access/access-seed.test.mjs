import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAccessSeedUsers, INITIAL_OWNERS, summarizeAccessSeed } from "../../lib/access/access-seed.mjs";

test("seed do CSV é idempotente, único e preserva múltiplos grupos", () => {
  const first = buildAccessSeedUsers();
  const second = buildAccessSeedUsers();
  assert.deepEqual(first, second);
  const emails = first.map((user) => user.email);
  assert.equal(new Set(emails).size, emails.length);
  const summary = summarizeAccessSeed(first);
  assert.equal(summary.uniqueUsers, 47);
  assert.equal(summary.owners, 5);
  assert.equal(summary.groupCounts.leaders, 7);
  assert.equal(summary.groupCounts.eps, 30);
  assert.equal(summary.groupCounts.team_leaders_ep, 5);
  assert.equal(summary.groupCounts.quality, 3);
  assert.equal(summary.groupCounts.finance, 5);
  assert.equal(summary.multiGroup.length, 6);
  const maximo = first.find((user) => user.email === "maximomarmund@quartavia.com.br");
  assert.deepEqual(maximo.groups, ["finance", "leaders"]);
  const tales = first.find((user) => user.email === "talesrozo@quartavia.com.br");
  assert.deepEqual(tales.groups, ["eps", "team_leaders_ep"]);
  for (const email of INITIAL_OWNERS) {
    assert.equal(first.find((user) => user.email === email)?.isOwner, true);
  }
});
