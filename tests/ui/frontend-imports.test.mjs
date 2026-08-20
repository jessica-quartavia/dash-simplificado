import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const browserEntries = [
  resolve(root, "js/app.js"),
  resolve(root, "js/pages.js"),
  resolve(root, "js/navigation.js"),
  resolve(root, "js/page-navigation.js"),
];

const browserSyntaxTargets = [
  "js/app.js",
  "js/general-data.js",
  "js/meetings.js",
  "js/onboarding.js",
  "js/patrimonial-plan.js",
  "js/mechanisms.js",
  "js/navigation.js",
  "js/pages.js",
  "js/page-navigation.js",
  "js/components/filters/filter-bar.js",
  "js/components/filters/date-range-picker.js",
  "js/components/overlay-root.js",
  "js/assistant/assistant-ui.js",
  "js/assistant/assistant-state.js",
  "js/assistant/assistant-api.js",
  "js/assistant/assistant-renderer.js",
];

const importPattern = /\bfrom\s+["']([^"']+)["']/g;

function resolveRelativeImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  if (existsSync(base)) return base;
  for (const ext of [".js", ".mjs"]) {
    const withExt = base.endsWith(ext) ? base : `${base}${ext}`;
    if (existsSync(withExt)) return withExt;
  }
  return base;
}

function collectRelativeImports(filePath) {
  const source = readFileSync(filePath, "utf8");
  const specs = [];
  for (const match of source.matchAll(importPattern)) specs.push(match[1]);
  return specs;
}

function walkModuleGraph(entry, visited = new Set(), missing = []) {
  if (visited.has(entry)) return missing;
  visited.add(entry);

  if (!existsSync(entry)) {
    missing.push(entry);
    return missing;
  }

  for (const spec of collectRelativeImports(entry)) {
    const resolved = resolveRelativeImport(entry, spec);
    if (!resolved) continue;
    walkModuleGraph(resolved, visited, missing);
  }

  return missing;
}

test("grafo ESM do frontend não referencia arquivos inexistentes", () => {
  const missing = [];
  const visited = new Set();

  for (const entry of browserEntries) {
    walkModuleGraph(entry, visited, missing);
  }

  assert.deepEqual(
    missing,
    [],
    `Imports frontend quebrados:\n${missing.map((item) => `- ${item}`).join("\n")}`,
  );
});

test("filter-bar aponta para caminhos reais dos helpers globais", () => {
  const source = readFileSync(resolve(root, "js/components/filters/filter-bar.js"), "utf8");
  assert.match(source, /from\s+["']\.\.\/\.\.\/general-charts\.mjs["']/);
  assert.match(source, /from\s+["']\.\/date-range-picker\.js["']/);
  assert.match(source, /from\s+["']\.\.\/\.\.\/\.\.\/lib\/analytics\/filters\/search\.mjs["']/);

  for (const relativePath of [
    "../../general-charts.mjs",
    "./date-range-picker.js",
    "../../../lib/analytics/filters/search.mjs",
  ]) {
    const resolved = resolveRelativeImport(
      resolve(root, "js/components/filters/filter-bar.js"),
      relativePath,
    );
    assert.ok(existsSync(resolved), `Esperado existir: ${relativePath} -> ${resolved}`);
  }
});

test("módulos browser passam validação de sintaxe (node --check)", () => {
  const failures = [];

  for (const relativePath of browserSyntaxTargets) {
    const filePath = resolve(root, relativePath);
    assert.ok(existsSync(filePath), `Arquivo ausente: ${relativePath}`);
    try {
      execFileSync(process.execPath, ["--check", filePath], { stdio: "pipe" });
    } catch (error) {
      failures.push(`${relativePath}: ${String(error.stderr || error.message).trim()}`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    `Erros de sintaxe no frontend:\n${failures.map((item) => `- ${item}`).join("\n")}`,
  );
});

test("onboarding declara FILTER_FIELDS antes de usar renderFilterBar", () => {
  const source = readFileSync(resolve(root, "js/onboarding.js"), "utf8");
  assert.match(source, /const FILTER_FIELDS = \[/);
  assert.doesNotMatch(source, /let unbindFilters = \(\) => \{\};\n  \{ kind: "search"/);
});
