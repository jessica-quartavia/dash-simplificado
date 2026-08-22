import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("satisfaction-filters carrega no browser sem process.env", async () => {
  const prev = globalThis.process;
  try {
    delete globalThis.process;
    await import("../../lib/analytics/satisfaction-filters.mjs");
    await import("../../lib/analytics/satisfaction-metrics.mjs");
  } finally {
    if (prev) globalThis.process = prev;
  }
});

test("satisfaction.js tem finally e mensagem de erro dedicada", () => {
  const source = readFileSync(join(ROOT, "js/satisfaction.js"), "utf8");
  assert.match(source, /\[Satisfaction\]/);
  assert.match(source, /finally \{/);
  assert.match(source, /Não foi possível carregar a Pesquisa de Satisfação/);
  assert.match(source, /pageId: "satisfaction"/);
});

test("supabase-rest não exige process no top-level", () => {
  const source = readFileSync(join(ROOT, "lib/data/supabase-rest.mjs"), "utf8");
  assert.doesNotMatch(source, /const DEFAULT_PAGE_SIZE = Number\(process\.env/);
  assert.match(source, /typeof process !== "undefined"/);
});
