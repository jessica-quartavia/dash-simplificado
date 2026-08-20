import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  pageShowsPeriodUi,
  resolveVisibleFilterFields,
} from "../../lib/analytics/filters/page-contracts.mjs";
import {
  readStickyPinned,
  renderFilterShell,
  writeStickyPinned,
  bindFilterShell,
  resolveFilterScrollTarget,
} from "../../js/components/filters/filter-shell.js";
import { bootScrollToTop } from "../../js/components/scroll-to-top.js";
import { runFilterCheck } from "../../lib/analytics/filters/filter-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE = [
  { kind: "search", key: "search" },
  { kind: "period", key: "period" },
  { kind: "select", key: "status" },
];

test("A — período aparece apenas em Reuniões", () => {
  assert.equal(pageShowsPeriodUi("meetings"), true);
  assert.equal(pageShowsPeriodUi("general"), false);
  assert.equal(pageShowsPeriodUi("journey"), false);
  assert.equal(pageShowsPeriodUi("patrimonial_plan"), false);
  assert.equal(pageShowsPeriodUi("mechanisms"), false);
});

test("B — período não aparece nas demais páginas", () => {
  assert.equal(resolveVisibleFilterFields("general", SAMPLE).some((f) => f.kind === "period"), false);
  assert.equal(resolveVisibleFilterFields("journey", SAMPLE).some((f) => f.kind === "period"), false);
  assert.equal(resolveVisibleFilterFields("patrimonial_plan", SAMPLE).some((f) => f.kind === "period"), false);
  assert.equal(resolveVisibleFilterFields("mechanisms", SAMPLE).some((f) => f.kind === "period"), false);
  assert.equal(resolveVisibleFilterFields("meetings", SAMPLE).some((f) => f.kind === "period"), true);
});

test("C — checkbox Fixar filtros ao rolar existe", () => {
  const html = renderFilterShell({ pageId: "general", innerHtml: "<div class='filter-bar'></div>" });
  assert.match(html, /Fixar filtros ao rolar/);
  assert.match(html, /data-filter-sticky/);
  assert.doesNotMatch(html, /filter-shell is-sticky-pinned/);
});

test("C2 — scroll container real é window quando portal-main não scrolla", () => {
  if (typeof document === "undefined") return;
  document.body.innerHTML = `
    <div class="portal-main"><main class="page"><section class="page-filters" id="page-filters"></section></main></div>`;
  assert.equal(resolveFilterScrollTarget(), window);
});

test("D — checkbox marcado adiciona sticky no host page-filters", () => {
  if (typeof document === "undefined") return;
  document.body.innerHTML = `<section class="page-filters" id="page-filters"></section>`;
  const host = document.getElementById("page-filters");
  host.innerHTML = renderFilterShell({ pageId: "general", innerHtml: "<div></div>" });
  const unbind = bindFilterShell(host, "general");
  const checkbox = host.querySelector("[data-filter-sticky]");
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  assert.equal(host.classList.contains("is-sticky-pinned"), true);
  checkbox.checked = false;
  checkbox.dispatchEvent(new Event("change"));
  assert.equal(host.classList.contains("is-sticky-pinned"), false);
  unbind();
});

test("D2 — desativar sticky remove estado persistido", () => {
  writeStickyPinned("general", false);
  assert.equal(readStickyPinned("general"), false);
  writeStickyPinned("general", true);
  assert.equal(readStickyPinned("general"), true);
  writeStickyPinned("general", false);
});

test("E — sticky CSS em page-filters com position sticky", () => {
  const css = readFileSync(resolve(root, "css/components.css"), "utf8");
  assert.match(css, /\.page-filters\.is-sticky-pinned[\s\S]*position:\s*sticky/);
  assert.match(css, /top:\s*0/);
  assert.match(css, /z-index:\s*var\(--z-filter-sticky\)/);
  assert.match(css, /width:\s*100%/);
  assert.match(css, /background:\s*var\(--surface\)/);
});

test("F — sticky z-index abaixo do overlay", () => {
  const css = readFileSync(resolve(root, "css/styles.css"), "utf8");
  assert.match(css, /--z-filter-sticky/);
  assert.match(css, /--z-overlay/);
});

test("G — botão assistente sem ícone de robô", () => {
  const source = readFileSync(resolve(root, "js/assistant/assistant-ui.js"), "utf8");
  assert.doesNotMatch(source, /ROBOT_ICON/);
  assert.doesNotMatch(source, /assistant-fab-icon/);
  assert.match(source, /Assistente da Jornada/);
});

test("H — botão assistente alinhado ao V2, sem gold", () => {
  const css = readFileSync(resolve(root, "css/assistant.css"), "utf8");
  assert.doesNotMatch(css, /assistant-fab-gold/);
  assert.doesNotMatch(css, /assistant-gold-to/);
  assert.match(css, /background:\s*var\(--surface\)/);
  assert.match(css, /border-left:\s*3px solid var\(--primary\)/);
});

test("H2 — botão assistente com shimmer sutil e reduced motion", () => {
  const css = readFileSync(resolve(root, "css/assistant.css"), "utf8");
  assert.match(css, /assistant-fab::before/);
  assert.match(css, /assistant-fab-shimmer/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("I — botão Topo aparece após scroll", () => {
  const source = readFileSync(resolve(root, "js/components/scroll-to-top.js"), "utf8");
  assert.match(source, /SHOW_AFTER_PX/);
  assert.match(source, /hidden = !visible/);
});

test("J — botão Topo usa scroll suave", () => {
  const source = readFileSync(resolve(root, "js/components/scroll-to-top.js"), "utf8");
  assert.match(source, /behavior: "smooth"/);
});

test("K — header do chat usa ícones", () => {
  const source = readFileSync(resolve(root, "js/assistant/assistant-ui.js"), "utf8");
  assert.match(source, /aria-label="Nova conversa"/);
  assert.match(source, /aria-label="Fechar assistente"/);
  assert.doesNotMatch(source, />Nova conversa</);
  assert.doesNotMatch(source, />Fechar</);
});

test("L — clique em sugestão prepara envio automático", () => {
  const source = readFileSync(resolve(root, "js/assistant/assistant-ui.js"), "utf8");
  assert.match(source, /await sendMessage\(chipMessage\(trimmed\)\)/);
  assert.match(source, /function chipMessage/);
});

test("M — anti-spam de sugestões no código", () => {
  const source = readFileSync(resolve(root, "js/assistant/assistant-ui.js"), "utf8");
  assert.match(source, /lastChipSentAt/);
  assert.match(source, /state\.sending/);
});

test("bootScrollToTop monta botão", () => {
  if (typeof document === "undefined") return;
  document.body.innerHTML = "";
  const cleanup = bootScrollToTop();
  const btn = document.getElementById("scroll-top-btn");
  assert.ok(btn);
  assert.equal(btn.getAttribute("aria-label"), "Voltar ao topo");
  cleanup?.();
});

test("Filter Check UX PASS", () => {
  const result = runFilterCheck();
  assert.equal(result.ux.ok, true, result.ux.checks.filter((c) => !c.ok).map((c) => c.id).join(", "));
});
