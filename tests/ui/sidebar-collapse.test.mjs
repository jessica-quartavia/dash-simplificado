import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  SIDEBAR_COLLAPSE_STORAGE_KEY,
  applySidebarCollapsed,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "../../js/components/sidebar-collapse.js";

const root = resolve(import.meta.dirname, "../..");

test("toggle da sidebar existe no shell e no boot", () => {
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  const nav = readFileSync(resolve(root, "js/navigation.js"), "utf8");
  assert.match(html, /sidebar-collapse-toggle/);
  assert.match(html, /Ocultar menu lateral/);
  assert.match(html, /sidebar-logo/);
  assert.match(html, /favicon\.ico/);
  assert.match(nav, /initSidebarCollapse/);
});

test("CSS define larguras aberta e recolhida", () => {
  const css = readFileSync(resolve(root, "css/layout.css"), "utf8");
  assert.match(css, /--sidebar-width: 260px/);
  assert.match(css, /body\.sidebar-collapsed #portal-root/);
  assert.match(css, /--sidebar-width: 48px/);
  assert.match(css, /body\.sidebar-collapsed \.sidebar-logo/);
  assert.match(css, /transition: grid-template-columns 180ms ease/);
});

test("persistência localStorage", () => {
  const store = new Map();
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  try {
    assert.equal(SIDEBAR_COLLAPSE_STORAGE_KEY, "qv:sidebarCollapsed");
    writeSidebarCollapsed(true);
    assert.equal(readSidebarCollapsed(), true);
    writeSidebarCollapsed(false);
    assert.equal(readSidebarCollapsed(), false);
  } finally {
    globalThis.localStorage = original;
  }
});

test("applySidebarCollapsed altera classe, aria-label e expanded", () => {
  const originalBody = global.document?.body;
  const button = {
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    getAttribute(name) {
      return this.attrs[name];
    },
  };
  global.document = {
    body: { classList: { value: new Set(), toggle(_name, on) { if (on) this.value.add("sidebar-collapsed"); else this.value.delete("sidebar-collapsed"); }, contains(name) { return this.value.has(name); } } },
    getElementById(id) {
      return id === "sidebar-collapse-toggle" ? button : null;
    },
  };
  global.window = { dispatchEvent: () => {} };

  try {
    applySidebarCollapsed(true, { persist: false });
    assert.ok(global.document.body.classList.contains("sidebar-collapsed"));
    assert.equal(button.getAttribute("aria-label"), "Mostrar menu lateral");
    assert.equal(button.getAttribute("aria-expanded"), "false");

    applySidebarCollapsed(false, { persist: false });
    assert.equal(button.getAttribute("aria-label"), "Ocultar menu lateral");
    assert.equal(button.getAttribute("aria-expanded"), "true");
  } finally {
    global.document = originalBody ? { body: originalBody } : undefined;
  }
});

test("mobile esconde toggle desktop e respeita reduced motion", () => {
  const css = readFileSync(resolve(root, "css/layout.css"), "utf8");
  assert.match(css, /@media \(max-width: 1024px\)[\s\S]*\.sidebar-collapse-toggle[\s\S]*display: none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("sidebar recolhida não remove navegação do DOM", () => {
  const nav = readFileSync(resolve(root, "js/navigation.js"), "utf8");
  assert.match(nav, /renderSidebar/);
  assert.match(nav, /navigateTo/);
  assert.doesNotMatch(nav, /sidebar-nav.*remove/);
});
