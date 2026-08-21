import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("navigation limpa shell e incrementa generation ao navegar", async () => {
  const source = readFileSync(join(ROOT, "js/navigation.js"), "utf8");
  assert.match(source, /pageGeneration \+= 1/);
  assert.match(source, /resetPageFetchContext\(\)/);
  assert.match(source, /clearPageShell\(\)/);
  assert.match(source, /export function getPageGeneration/);
});

test("page-load aborta fetch stale e deduplica cache", async () => {
  const source = readFileSync(join(ROOT, "js/utils/page-load.js"), "utf8");
  assert.match(source, /STALE_NAVIGATION/);
  assert.match(source, /inflight\.set/);
  assert.match(source, /CACHE_TTL_MS/);
  assert.match(source, /resetPageFetchContext/);
});

test("race Reuniões→Cancelamento: load ignora resposta stale", async () => {
  const meetings = readFileSync(join(ROOT, "js/meetings.js"), "utf8");
  const cancellations = readFileSync(join(ROOT, "js/cancellations.js"), "utf8");
  const pageLoad = readFileSync(join(ROOT, "js/utils/page-load.js"), "utf8");
  assert.match(pageLoad, /assertNavigationFresh/);
  assert.match(meetings, /state\.mounted/);
  assert.match(cancellations, /state\.mounted/);
});

test("donut categorias desconhecidas recebem cores distintas por índice", async () => {
  const { donut } = await import("../../js/general-charts.mjs");
  const html = donut([
    { label: "Categoria A", count: 10, percent: 25 },
    { label: "Categoria B", count: 20, percent: 50 },
    { label: "Categoria C", count: 10, percent: 25 },
  ]);
  const strokes = [...html.matchAll(/stroke="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(strokes).size, strokes.length);
});
