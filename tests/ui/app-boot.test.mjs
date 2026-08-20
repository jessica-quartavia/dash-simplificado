import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const appJs = readFileSync(resolve(root, "js/app.js"), "utf8");

function installBrowserGlobals() {
  globalThis.location = {
    hostname: "localhost",
    search: "",
    href: "http://localhost:3000/",
    hash: "",
    origin: "http://localhost:3000",
  };
  globalThis.window = {
    location: globalThis.location,
    addEventListener() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
  };
  globalThis.document = {
    getElementById() {
      return null;
    },
    body: {
      classList: {
        add() {},
        remove() {},
      },
      dataset: {},
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
  };
}

test("app.js não importa assistant-ui estaticamente no boot crítico", () => {
  assert.doesNotMatch(
    appJs,
    /import\s+\{[^}]*bootAssistant[^}]*\}\s+from\s+["']\.\/assistant\/assistant-ui\.js["']/,
  );
  assert.match(appJs, /import\s*\(\s*["']\.\/assistant\/assistant-ui\.js["']\s*\)/);
  assert.match(appJs, /bootAssistantNonBlocking\s*\(\s*\)/);
});

test("startPortal marca portal pronto antes do assistant dinâmico", () => {
  const startPortalBlock = appJs.slice(appJs.indexOf("function startPortal"));
  const dataReadyIndex = startPortalBlock.indexOf('setAttribute("data-ready", "true")');
  const assistantBootCallIndex = startPortalBlock.indexOf("bootAssistantNonBlocking()");
  assert.ok(dataReadyIndex >= 0, "data-ready deve ser definido");
  assert.ok(assistantBootCallIndex >= 0, "assistant deve ser iniciado após o core");
  assert.ok(
    dataReadyIndex < assistantBootCallIndex,
    "portal deve ser liberado antes do boot do Assistente",
  );
  assert.match(appJs, /import\s*\(\s*["']\.\/assistant\/assistant-ui\.js["']\s*\)/);
});

test("bootAssistant tolera ausência de #assistant-slot", async () => {
  installBrowserGlobals();
  const moduleUrl = pathToFileURL(resolve(root, "js/assistant/assistant-ui.js")).href;
  const { bootAssistant } = await import(`${moduleUrl}?slot-missing=${Date.now()}`);
  assert.doesNotThrow(() => bootAssistant());
});

test("assistant-ui usa navegação neutra, não app.js", () => {
  const assistantUi = readFileSync(resolve(root, "js/assistant/assistant-ui.js"), "utf8");
  assert.match(assistantUi, /from\s+["']\.\.\/page-navigation\.js["']/);
  assert.doesNotMatch(assistantUi, /from\s+["']\.\.\/app\.js["']/);
  assert.doesNotMatch(assistantUi, /from\s+["']\.\.\/navigation\.js["']/);
});

test("assistant frontend não importa backend server-only", () => {
  const files = [
    "js/assistant/assistant-ui.js",
    "js/assistant/assistant-state.js",
    "js/assistant/assistant-api.js",
    "js/assistant/assistant-renderer.js",
  ];
  for (const relativePath of files) {
    const source = readFileSync(resolve(root, relativePath), "utf8");
    assert.doesNotMatch(source, /lib\/assistant\//);
    assert.doesNotMatch(source, /lib\/env\.mjs/);
    assert.doesNotMatch(source, /gemini-client/);
  }
});

test("auth-config possui timeout no bootstrap", () => {
  const authSource = readFileSync(resolve(root, "js/auth.mjs"), "utf8");
  const loadPublicConfigBlock = authSource.slice(
    authSource.indexOf("async function loadPublicConfig"),
    authSource.indexOf("function resolveCreateClient"),
  );
  assert.match(loadPublicConfigBlock, /withTimeout\s*\(/);
  assert.match(loadPublicConfigBlock, /auth-config/);
});

test("portal core continua se um módulo secundário falhar no boot", () => {
  assert.match(appJs, /function safeBoot\(/);
  assert.match(appJs, /safeBoot\("navigation"/);
  assert.match(appJs, /setAttribute\("data-ready", "true"\)/);
});

test("falha simulada do dynamic import do assistant não impede data-ready", () => {
  assert.match(appJs, /\.catch\(\(error\)\s*=>\s*\{[\s\S]*\[Assistant\] initialization failed/);
});
