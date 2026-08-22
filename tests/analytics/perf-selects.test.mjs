import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const contextSource = readFileSync(resolve(root, "lib/analytics/analytics-data-context.mjs"), "utf8");

test("selects canônicos não usam wildcard", () => {
  assert.doesNotMatch(contextSource, /CANONICAL_SELECT[\s\S]*select:\s*"\*"/);
  assert.match(contextSource, /clients:\s*\n\s*"id,codigo/);
  assert.match(contextSource, /client_meetings:/);
  assert.match(contextSource, /nps_responses:/);
});

test("supabase-rest page size configurável via env", () => {
  const source = readFileSync(resolve(root, "lib/data/supabase-rest.mjs"), "utf8");
  assert.match(source, /DATA_REST_PAGE_SIZE/);
});
