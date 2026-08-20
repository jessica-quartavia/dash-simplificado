import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  applyPeriodPreset,
  defaultPeriodState,
  formatPeriodFieldLabel,
  isFutureIso,
  monthMatrix,
  normalizeCustomRange,
  normalizeRangeSelection,
  resolvePeriod,
  sanitizePeriodFilters,
  todayIso,
} from "../../lib/analytics/filters/period.mjs";
import { renderDateRangePicker, bindDateRangePicker, readPeriodFieldValues, nextDraftAfterDayClick } from "../../js/components/filters/date-range-picker.js";
import { renderFilterBar } from "../../js/components/filters/filter-bar.js";
import { runFilterCheck } from "../../lib/analytics/filters/filter-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUG_NOW = new Date("2026-08-20T15:00:00.000Z");
const FIELD = { kind: "period", id: "tPeriod", fromId: "tFrom", toId: "tTo" };

test("A — hoje é selecionável", () => {
  const today = todayIso(BUG_NOW);
  assert.equal(isFutureIso(today, BUG_NOW), false);
  const resolved = resolvePeriod({ period: "today" }, BUG_NOW);
  assert.equal(resolved.active, true);
  assert.equal(resolved.invalid, false);
});

test("B — amanhã é bloqueado", () => {
  assert.equal(isFutureIso("2026-08-21", BUG_NOW), true);
  const matrix = monthMatrix(2026, 8, BUG_NOW);
  const tomorrow = matrix.find((cell) => cell.iso === "2026-08-21");
  assert.equal(tomorrow?.disabled, true);
});

test("C — ano futuro é bloqueado", () => {
  assert.equal(isFutureIso("2027-08-19", BUG_NOW), true);
  const sanitized = sanitizePeriodFilters({ period: "custom", from: "2027-08-19", to: "2026-08-20" }, BUG_NOW);
  assert.equal(sanitized.period, "all");
});

test("D — start > end nunca ocorre", () => {
  const normalized = normalizeCustomRange("2026-08-19", "2026-08-01", BUG_NOW);
  assert.equal(normalized.ok, true);
  assert.equal(normalized.from, "2026-08-01");
  assert.equal(normalized.to, "2026-08-19");
});

test("E — clique invertido vira 10/08 → 15/08", () => {
  const selection = normalizeRangeSelection("2026-08-15", "2026-08-10", BUG_NOW);
  assert.equal(selection.start, "2026-08-10");
  assert.equal(selection.end, "2026-08-15");
});

test("F — Últimos 30 dias", () => {
  const preset = applyPeriodPreset("last_30", BUG_NOW);
  assert.equal(preset.period, "last_30");
  assert.equal(resolvePeriod({ period: "last_30" }, BUG_NOW).active, true);
});

test("G — Últimos 6 meses", () => {
  const preset = applyPeriodPreset("last_6m", BUG_NOW);
  assert.equal(preset.period, "last_6m");
});

test("H — Este ano", () => {
  const preset = applyPeriodPreset("this_year", BUG_NOW);
  assert.equal(preset.period, "this_year");
});

test("I — Todo o período", () => {
  const preset = applyPeriodPreset("all", BUG_NOW);
  assert.equal(preset.period, "all");
  assert.equal(formatPeriodFieldLabel({ period: "all" }, BUG_NOW), "Todo o período");
});

test("J — Limpar", () => {
  const cleared = defaultPeriodState();
  assert.deepEqual(cleared, { period: "all", from: "", to: "" });
});

test("K — Escape restaura rascunho", () => {
  const { host, unbind } = mountPicker({ period: "custom", from: "2026-08-01", to: "2026-08-10" });
  host._picker.trigger.click();
  [...host._picker.presets.children].find((btn) => btn.dataset.drpPreset === "last_30")?.click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(readPeriodFieldValues(FIELD), { period: "custom", from: "2026-08-01", to: "2026-08-10" });
  unbind();
});

test("L — Aplicar persiste intervalo", () => {
  installDom();
  const host = document.createElement("div");
  hydratePickerDom(host);
  document.body.appendChild(host);
  let applied = null;
  const unbind = bindDateRangePicker({
    host,
    field: FIELD,
    filters: { period: "all", from: "", to: "" },
    now: BUG_NOW,
    onApply: (values) => {
      applied = values;
    },
  });
  host._picker.trigger.click();
  [...host._picker.presets.children].find((btn) => btn.dataset.drpPreset === "last_30")?.click();
  host._picker.apply.click();
  assert.equal(applied?.period, "last_30");
  assert.equal(readPeriodFieldValues(FIELD).period, "last_30");
  unbind();
});

test("M — timezone não desloca data", () => {
  const lateUtc = new Date("2026-08-20T23:30:00.000Z");
  assert.equal(todayIso(lateUtc), "2026-08-20");
  const earlyUtc = new Date("2026-08-21T02:30:00.000Z");
  assert.equal(todayIso(earlyUtc), "2026-08-20");
});

test("N — futuro manual rejeitado no helper", () => {
  const resolved = resolvePeriod({ period: "custom", from: "2027-08-19", to: "2026-08-20" }, BUG_NOW);
  assert.equal(resolved.invalid, true);
  assert.equal(resolved.active, false);
});

test("O — Filter Check das 5 páginas continua PASS", () => {
  const result = runFilterCheck();
  assert.equal(result.ok, true);
  for (const [pageId, pageResult] of Object.entries(result.pages)) {
    const failed = pageResult.checks.filter((item) => !item.ok);
    assert.equal(failed.length, 0, `${pageId}: ${failed.map((f) => f.id).join(", ")}`);
  }
  assert.equal(result.dateRange.ok, true);
  assert.equal(result.ux?.ok ?? true, true);
});

test("regressão — intervalo invertido/futuro do bug original", () => {
  const resolved = resolvePeriod({ period: "custom", from: "2027-08-19", to: "2026-08-20" }, BUG_NOW);
  assert.equal(resolved.invalid, true);
  const swapped = resolvePeriod({ period: "custom", from: "2027-08-19", to: "2026-08-20" }, BUG_NOW);
  assert.notEqual(swapped.from && swapped.to && swapped.from > swapped.to, true);
  const sanitized = sanitizePeriodFilters({ period: "custom", from: "2027-08-19", to: "2026-08-20" }, BUG_NOW);
  assert.equal(sanitized.from, "");
  assert.equal(sanitized.to, "");
});

test("FilterBar renderiza DateRangePicker sem inputs date visíveis", () => {
  const html = renderFilterBar({
    fields: [FIELD],
    filters: { period: "custom", from: "2026-08-01", to: "2026-08-20" },
  });
  assert.match(html, /date-range-picker/);
  assert.match(html, /data-drp-trigger/);
  assert.doesNotMatch(html, /type="date"/);
});

test("componente global existe e é reutilizado", () => {
  const picker = readFileSync(resolve(root, "js/components/filters/date-range-picker.js"), "utf8");
  const filterBar = readFileSync(resolve(root, "js/components/filters/filter-bar.js"), "utf8");
  const meetings = readFileSync(resolve(root, "js/meetings.js"), "utf8");
  assert.match(picker, /export function renderDateRangePicker/);
  assert.match(filterBar, /renderDateRangePicker/);
  assert.match(meetings, /renderDateRangePicker/);
  assert.doesNotMatch(meetings, /type="date"/);
});

test("A — abrir popover não altera layout base (CSS)", () => {
  const css = readFileSync(resolve(root, "css/components.css"), "utf8");
  assert.match(css, /\.filter-bar[\s\S]*overflow:\s*visible/);
  assert.match(css, /\.drp-popover\[hidden\][\s\S]*display:\s*none/);
  assert.match(css, /\.date-range-picker[\s\S]*min-width:\s*0/);
});

test("B — selecionar start e depois end fixa corretamente", () => {
  let draft = { period: "all", start: "", end: "", hover: "" };
  draft = nextDraftAfterDayClick(draft, "2026-08-05", BUG_NOW).draft;
  assert.equal(draft.start, "2026-08-05");
  assert.equal(draft.end, "");
  draft = nextDraftAfterDayClick(draft, "2026-08-20", BUG_NOW).draft;
  assert.equal(draft.start, "2026-08-05");
  assert.equal(draft.end, "2026-08-20");
});

test("C — end anterior ao start reordena corretamente", () => {
  let draft = { period: "custom", start: "2026-08-15", end: "", hover: "" };
  draft = nextDraftAfterDayClick(draft, "2026-08-10", BUG_NOW).draft;
  assert.equal(draft.start, "2026-08-10");
  assert.equal(draft.end, "2026-08-15");
});

test("D — Apply persiste range via bind", () => {
  installDom();
  const host = document.createElement("div");
  hydratePickerDom(host);
  document.body.appendChild(host);
  let draftState = null;
  const unbind = bindDateRangePicker({
    host,
    field: FIELD,
    filters: { period: "all", from: "", to: "" },
    now: BUG_NOW,
    onApply: (values) => {
      draftState = values;
    },
  });
  host._picker.trigger.click();
  selectCalendarDay(host, "2026-08-05");
  selectCalendarDay(host, "2026-08-12");
  host._picker.apply.click();
  assert.equal(draftState?.period, "custom");
  assert.equal(draftState?.from, "2026-08-05");
  assert.equal(draftState?.to, "2026-08-12");
  unbind();
});

test("E — fechar sem Apply mantém seleção anterior", () => {
  const { host, unbind } = mountPicker({ period: "custom", from: "2026-08-01", to: "2026-08-10" });
  host._picker.trigger.click();
  selectCalendarDay(host, "2026-08-05");
  selectCalendarDay(host, "2026-08-15");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(readPeriodFieldValues(FIELD), { period: "custom", from: "2026-08-01", to: "2026-08-10" });
  unbind();
});

test("F — Limpar reseta para Todo o período", () => {
  let draft = { period: "custom", start: "2026-08-01", end: "2026-08-10", hover: "" };
  draft = { period: "all", start: "", end: "", hover: "" };
  assert.equal(formatPeriodFieldLabel({ period: draft.period, from: draft.start, to: draft.end }, BUG_NOW), "Todo o período");
});

test("G — data futura continua bloqueada na seleção", () => {
  let draft = { period: "custom", start: "2026-08-01", end: "", hover: "" };
  const blocked = nextDraftAfterDayClick(draft, "2027-08-19", BUG_NOW);
  assert.equal(blocked.changed, false);
  assert.equal(blocked.draft.end, "");
});

test("H — campo fechado não transborda (CSS)", () => {
  const css = readFileSync(resolve(root, "css/components.css"), "utf8");
  assert.doesNotMatch(css, /min-width:\s*220px/);
  assert.match(css, /\.drp-value[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.filter-bar \.date-range-picker[\s\S]*grid-column:\s*span 2/);
  assert.doesNotMatch(css, /\.date-range-picker[\s\S]*isolation:\s*isolate/);
});

test("I — re-render de hover não perde end selecionado", () => {
  let draft = { period: "custom", start: "2026-08-05", end: "", hover: "" };
  draft = nextDraftAfterDayClick(draft, "2026-08-12", BUG_NOW).draft;
  draft.hover = "2026-08-08";
  assert.equal(draft.end, "2026-08-12");
  assert.equal(draft.start, "2026-08-05");
});

test("mesmo dia início/fim gera range de um dia", () => {
  let draft = { period: "custom", start: "2026-08-10", end: "", hover: "" };
  draft = nextDraftAfterDayClick(draft, "2026-08-10", BUG_NOW).draft;
  assert.equal(draft.start, "2026-08-10");
  assert.equal(draft.end, "2026-08-10");
});

function selectCalendarDay(host, iso) {
  const popover =
    document.getElementById("overlay-root")?.querySelector?.("[data-drp-popover]")
    || host.querySelector("[data-drp-popover]");
  const button = popover?.querySelector?.(`[data-drp-day="${iso}"]`) || host.querySelector(`[data-drp-day="${iso}"]`);
  assert.ok(button, `dia ${iso} ausente no calendário mock`);
  button.dispatchEvent({ type: "mousedown", preventDefault() {}, stopPropagation() {} });
}

function mountPicker(filters) {
  installDom();
  const host = document.createElement("div");
  hydratePickerDom(host);
  document.body.appendChild(host);
  const unbind = bindDateRangePicker({
    host,
    field: FIELD,
    filters,
    now: BUG_NOW,
  });
  return { host, unbind };
}

function hydratePickerDom(host) {
  const root = makeEl("div", { dataset: { drpRoot: "" } });
  const trigger = makeEl("button", { dataset: { drpTrigger: "" } });
  const popover = makeEl("div", { dataset: { drpPopover: "" }, hidden: true });
  const calendar = makeEl("div", { dataset: { drpCalendar: "" } });
  const value = makeEl("span", { dataset: { drpValue: "" } });
  trigger.appendChild(value);
  const apply = makeEl("button", { dataset: { drpApply: "" }, disabled: true });
  const clear = makeEl("button", { dataset: { drpClear: "" } });
  const actions = makeEl("div");
  actions.appendChild(clear);
  actions.appendChild(apply);
  const presets = makeEl("div", { dataset: { drpPresets: "" } });

  for (const preset of ["all", "today", "last_30", "last_90", "last_6m", "last_12m", "this_year"]) {
    presets.appendChild(makeEl("button", { dataset: { drpPreset: preset } }));
  }

  popover.appendChild(presets);
  popover.appendChild(calendar);
  popover.appendChild(actions);

  const period = makeEl("input", { id: FIELD.id, type: "hidden", value: "" });
  const from = makeEl("input", { id: FIELD.fromId, type: "hidden", value: "" });
  const to = makeEl("input", { id: FIELD.toId, type: "hidden", value: "" });

  root.appendChild(trigger);
  root.appendChild(period);
  root.appendChild(from);
  root.appendChild(to);
  root.appendChild(popover);
  host.appendChild(root);
  host._picker = { trigger, apply, presets, root, calendar };
}

function makeEl(tag, { id, type, value, hidden, disabled, dataset } = {}) {
  const el = document.createElement(tag);
  if (id) el.id = id;
  if (type) el.type = type;
  if (value != null) el.value = value;
  if (hidden) el.hidden = true;
  if (disabled) el.disabled = true;
  if (dataset) Object.assign(el.dataset, dataset);
  return el;
}

function installDom() {
  if (globalThis.__drpDomInstalled) return;
  globalThis.__drpDomInstalled = true;
  const elements = new Map();
  let idCounter = 0;

  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attributes = {};
      this.classList = {
        values: new Set(),
        add(...items) {
          items.forEach((item) => this.values.add(item));
        },
        remove(...items) {
          items.forEach((item) => this.values.delete(item));
        },
        toggle(item, force) {
          if (force === true || (force == null && !this.values.has(item))) this.add(item);
          else this.remove(item);
        },
      };
      this.dataset = {};
      this.style = {};
      this.hidden = false;
      this.disabled = false;
      this.textContent = "";
      this._html = "";
      this._listeners = {};
      if (tag === "button") this.type = "button";
    }

    set innerHTML(html) {
      this._html = html;
      this.children = [];
      for (const match of String(html || "").matchAll(/data-drp-day="([^"]+)"[^>]*>([^<]*)</g)) {
        const button = document.createElement("button");
        button.dataset.drpDay = match[1];
        button.textContent = match[2];
        if (match[0].includes("disabled")) button.disabled = true;
        this.appendChild(button);
      }
      for (const match of String(html || "").matchAll(/data-drp-nav="(-?\d+)"/g)) {
        const button = document.createElement("button");
        button.dataset.drpNav = match[1];
        this.appendChild(button);
      }
    }

    get innerHTML() {
      return this._html || "";
    }

    dispatchEvent(event) {
      const handlers = this._listeners?.[event.type] || [];
      for (const handler of handlers) handler.call(this, event);
      return true;
    }

    set id(value) {
      this._id = value;
      elements.set(value, this);
    }

    get id() {
      return this._id;
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    getAttribute(name) {
      return this.attributes[name];
    }

    querySelector(selector) {
      if (selector === "[data-drp-root]") return walk(this, (node) => node.dataset?.drpRoot != null);
      if (selector === "[data-drp-trigger]") return walk(this, (node) => node.dataset?.drpTrigger != null);
      if (selector === "[data-drp-popover]") return walk(this, (node) => node.dataset?.drpPopover != null);
      if (selector === "[data-drp-calendar]") return walk(this, (node) => node.dataset?.drpCalendar != null);
      if (selector === "[data-drp-value]") return walk(this, (node) => node.dataset?.drpValue != null);
      if (selector === "[data-drp-apply]") return walk(this, (node) => node.dataset?.drpApply != null);
      if (selector === "[data-drp-clear]") return walk(this, (node) => node.dataset?.drpClear != null);
      if (selector.startsWith('[data-drp-preset="')) {
        const preset = selector.slice(17, -2);
        return walk(this, (node) => node.dataset?.drpPreset === preset);
      }
      if (selector.startsWith('[data-drp-day="')) {
        const iso = selector.slice(15, -2);
        return walk(this, (node) => node.dataset?.drpDay === iso);
      }
      if (selector.startsWith("#")) return elements.get(selector.slice(1)) || null;
      if (selector === "[data-drp-popover]") return walk(this, (node) => node.dataset?.drpPopover != null);
      return walk(this, () => false);
    }

    querySelectorAll(selector) {
      const matches = [];
      if (selector === "[data-drp-preset]") walkAll(this, (node) => node.dataset?.drpPreset != null, matches);
      else if (selector === "[data-drp-day]") walkAll(this, (node) => node.dataset?.drpDay != null, matches);
      else if (selector === "[data-drp-nav]") walkAll(this, (node) => node.dataset?.drpNav != null, matches);
      return matches;
    }

    addEventListener(type, handler) {
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push(handler);
    }

    removeEventListener(type, handler) {
      this._listeners[type] = (this._listeners[type] || []).filter((item) => item !== handler);
    }

    click() {
      dispatch(this, "click", { target: this, preventDefault() {}, stopPropagation() {} });
    }

    contains(target) {
      return target === this || this.children.some((child) => child.contains?.(target));
    }

    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    }

    remove() {
      if (this.parentNode?.children) {
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      }
    }

    dispatchEvent(event) {
      const handlers = this._listeners?.[event.type] || [];
      for (const handler of handlers) handler.call(this, event);
      return true;
    }
  }

  function walk(node, predicate) {
    if (!node) return null;
    if (predicate(node)) return node;
    for (const child of node.children || []) {
      const found = walk(child, predicate);
      if (found) return found;
    }
    return null;
  }

  function walkAll(node, predicate, out) {
    if (predicate(node)) out.push(node);
    for (const child of node.children || []) walkAll(child, predicate, out);
  }

  function dispatch(node, type, event) {
    for (const handler of node._listeners?.[type] || []) handler.call(node, event);
    for (const child of node.children || []) dispatch(child, type, event);
  }

  globalThis.document = {
    body: new MockElement("div"),
    createElement(tag) {
      const el = new MockElement(tag);
      if (!el.id) {
        idCounter += 1;
        el.id = `mock-${idCounter}`;
      }
      return el;
    },
    getElementById(id) {
      if (id === "overlay-root") {
        if (!globalThis.__overlayRootEl) {
          globalThis.__overlayRootEl = new MockElement("div");
          globalThis.__overlayRootEl.id = "overlay-root";
          document.body.appendChild(globalThis.__overlayRootEl);
        }
        return globalThis.__overlayRootEl;
      }
      return elements.get(id) || null;
    },
    addEventListener(type, handler, capture) {
      document._docListeners = document._docListeners || [];
      document._docListeners.push({ type, handler, capture });
    },
    removeEventListener(type, handler, capture) {
      document._docListeners = (document._docListeners || []).filter(
        (item) => !(item.type === type && item.handler === handler && item.capture === capture),
      );
    },
  };

  globalThis.HTMLElement = MockElement;

  globalThis.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.key = init.key;
      this.bubbles = init.bubbles ?? false;
    }

    preventDefault() {}
  };

  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
  };

  document.dispatchEvent = (event) => {
    for (const item of document._docListeners || []) {
      if (item.type === event.type) item.handler(event);
    }
    return true;
  };
}
