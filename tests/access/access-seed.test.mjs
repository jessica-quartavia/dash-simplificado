import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAccessSeedUsers, INITIAL_OWNERS, PRODUCT_SEED_USERS, summarizeAccessSeed } from "../../lib/access/access-seed.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

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

test("seed 016 de Produto é idempotente e isolado dos cinco emails", () => {
  assert.equal(PRODUCT_SEED_USERS.length, 5);
  assert.equal(new Set(PRODUCT_SEED_USERS).size, 5);
  const original = buildAccessSeedUsers();
  for (const email of PRODUCT_SEED_USERS) {
    assert.equal(original.some((user) => user.email === email), false, email);
  }
  const sql = readFileSync(join(ROOT, "sql/analytics/016_dashboard_access_product.sql"), "utf8");
  assert.match(sql, /code, name, description, is_active/);
  assert.match(sql, /'product', 'Produto'/);
  assert.match(sql, /ON CONFLICT \(email\) DO UPDATE\s+SET is_active = true/);
  assert.doesNotMatch(sql, /ON CONFLICT \(email\) DO UPDATE[\s\S]{0,180}is_owner/);
  for (const email of PRODUCT_SEED_USERS) {
    assert.match(sql, new RegExp(email.replace(".", "\\.")));
  }
  assert.match(sql, /'leaders', 'eps', 'team_leaders_ep', 'quality', 'finance', 'product'/);
});
