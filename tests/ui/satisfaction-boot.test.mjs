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

test("contexto analítico não importa node:async_hooks no top-level", async () => {
  const source = readFileSync(join(ROOT, "lib/analytics/analytics-data-context.mjs"), "utf8");
  assert.doesNotMatch(source, /import \{ AsyncLocalStorage \} from "node:async_hooks"/);
  assert.match(source, /import\("node:async_hooks"\)/);
  const { isNodeRuntime, createFallbackAls, createAnalyticsAls } = await import(
    "../../lib/analytics/analytics-data-context.mjs"
  );
  const als = createFallbackAls();
  const value = als.run({ page: "satisfaction" }, () => als.getStore());
  assert.equal(value.page, "satisfaction");
  assert.equal(typeof isNodeRuntime(), "boolean");
  const storage = await createAnalyticsAls();
  assert.equal(typeof storage.run, "function");
});

test("satisfaction.js importa no grafo do browser sem node:async_hooks estático", async () => {
  const page = readFileSync(join(ROOT, "js/satisfaction.js"), "utf8");
  const filters = readFileSync(join(ROOT, "lib/analytics/satisfaction-filters.mjs"), "utf8");
  assert.match(page, /from "\.\.\/lib\/analytics\/satisfaction-filters\.mjs"/);
  assert.match(filters, /from "\.\/satisfaction\.mjs"/);
  const context = readFileSync(join(ROOT, "lib/analytics/analytics-data-context.mjs"), "utf8");
  assert.doesNotMatch(context, /^import .*node:async_hooks/m);
});

test("satisfaction.js tem finally e mensagem de erro dedicada", () => {
  const source = readFileSync(join(ROOT, "js/satisfaction.js"), "utf8");
  assert.match(source, /\[Satisfaction\]/);
  assert.match(source, /finally \{/);
  assert.match(source, /Não foi possível carregar a Pesquisa de Satisfação/);
  assert.match(source, /pageId: "satisfaction"/);
  assert.match(source, /Tentar novamente/);
});

test("portal registra páginas antes de navegar", () => {
  const source = readFileSync(join(ROOT, "js/app.js"), "utf8");
  const satisfactionBoot = source.indexOf('["satisfaction"');
  const navigationBoot = source.indexOf('safeBoot("navigation"');
  assert.ok(satisfactionBoot > 0);
  assert.ok(navigationBoot > satisfactionBoot);
});

test("navegação não deixa Preparando eterno e trata Acionamentos legado", () => {
  const source = readFileSync(join(ROOT, "js/navigation.js"), "utf8");
  assert.match(source, /Preparando a página selecionada/);
  assert.match(source, /recoverPageBoot/);
  assert.match(source, /ACCESS_LEGACY_OWNER_MESSAGE/);
  assert.match(source, /aria-disabled/);
  assert.match(source, /nav-badge/);
});

test("supabase-rest não exige process no top-level", () => {
  const source = readFileSync(join(ROOT, "lib/data/supabase-rest.mjs"), "utf8");
  assert.doesNotMatch(source, /const DEFAULT_PAGE_SIZE = Number\(process\.env/);
  assert.match(source, /typeof process !== "undefined"/);
});
