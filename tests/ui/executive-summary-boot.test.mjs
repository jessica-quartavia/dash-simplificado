import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("boot do Executive não dispara fetch antes da navegação", () => {
  const source = readFileSync(join(ROOT, "js/executive-summary.js"), "utf8");
  assert.match(source, /onPageChange/);
  assert.match(source, /pageId: "executive_summary"/);
  assert.match(source, /applyLoadError/);
  assert.match(source, /Não foi possível carregar o Resumo Executivo/);
  assert.match(source, /Tentar novamente/);
  assert.doesNotMatch(source, /if \(getCurrentPageId\(\) === "executive_summary"\)/);
});

test("access registry e rota do Executive apontam para o mesmo pageId", () => {
  const policy = readFileSync(join(ROOT, "lib/access/access-policy.mjs"), "utf8");
  const filters = readFileSync(join(ROOT, "lib/analytics/executive-summary-filters.mjs"), "utf8");
  assert.match(policy, /executive_summary:/);
  assert.match(policy, /"\/api\/executive-summary": "executive_summary"/);
  assert.match(filters, /page=executive_summary/);
});
