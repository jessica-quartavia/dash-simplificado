import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  computePopoverPosition,
  ensureOverlayRoot,
  mountPopoverPortal,
  OVERLAY_ROOT_ID,
  unmountPopoverPortal,
  VIEWPORT_MARGIN,
} from "../../js/components/overlay-root.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("overlay-root existe no shell", () => {
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  assert.match(html, /id="overlay-root"/);
});

test("popover portal usa position fixed e z-index global", () => {
  const css = readFileSync(resolve(root, "css/components.css"), "utf8");
  const styles = readFileSync(resolve(root, "css/styles.css"), "utf8");
  assert.match(styles, /--z-overlay:\s*500/);
  assert.match(css, /\.drp-popover--portal[\s\S]*position:\s*fixed/);
  assert.match(css, /z-index:\s*calc\(var\(--z-overlay\) \+ 1\)/);
});

test("posicionamento usa anchorRect (getBoundingClientRect)", () => {
  const pos = computePopoverPosition({
    anchorRect: { top: 100, bottom: 140, left: 200, right: 420 },
    popoverWidth: 300,
    popoverHeight: 320,
    viewportWidth: 1280,
    viewportHeight: 800,
  });
  assert.equal(pos.mode, "desktop");
  assert.equal(pos.top, 148);
  assert.equal(pos.left, 200);
  assert.equal(pos.placement, "bottom");
});

test("flip vertical quando não cabe abaixo", () => {
  const pos = computePopoverPosition({
    anchorRect: { top: 600, bottom: 640, left: 100, right: 300 },
    popoverWidth: 280,
    popoverHeight: 360,
    viewportWidth: 1280,
    viewportHeight: 720,
  });
  assert.equal(pos.placement, "top");
  assert.ok(pos.top < 600);
});

test("shift horizontal próximo da borda direita", () => {
  const pos = computePopoverPosition({
    anchorRect: { top: 80, bottom: 120, left: 1180, right: 1260 },
    popoverWidth: 300,
    popoverHeight: 320,
    viewportWidth: 1280,
    viewportHeight: 800,
  });
  assert.equal(pos.left, 1280 - VIEWPORT_MARGIN - 300);
});

test("mobile usa sheet compacto", () => {
  const pos = computePopoverPosition({
    anchorRect: { top: 80, bottom: 120, left: 16, right: 200 },
    popoverWidth: 300,
    popoverHeight: 320,
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assert.equal(pos.mode, "mobile");
  assert.equal(pos.placement, "sheet");
  assert.equal(pos.bottom, VIEWPORT_MARGIN);
});

test("mount/unmount portal — popover fora da FilterBar", () => {
  installPortalDom();
  globalThis.__overlayRoot.children = [];
  const filterBar = document.createElement("div");
  filterBar.className = "filter-bar";
  const anchor = document.createElement("button");
  const popover = document.createElement("div");
  popover.dataset.drpPopover = "";
  popover.hidden = true;
  popover.innerHTML = "<div style='height:200px'>cal</div>";
  filterBar.appendChild(anchor);
  filterBar.appendChild(popover);
  document.body.appendChild(filterBar);

  const overlay = ensureOverlayRoot();
  const { backdrop } = mountPopoverPortal({
    anchor,
    popover,
    overlayRoot: overlay,
    onDismiss: () => {},
  });

  assert.notEqual(popover.parentElement, filterBar);
  assert.equal(popover.parentElement?.id, OVERLAY_ROOT_ID);
  assert.ok(overlay.querySelector("[data-drp-backdrop]"));
  assert.equal(popover.classList.contains("drp-popover--portal"), true);

  unmountPopoverPortal({ overlayRoot: overlay, backdrop, popover });
  assert.equal(popover.hidden, true);
  assert.equal(overlay.querySelector("[data-drp-backdrop]"), null);
  assert.equal(overlay.getAttribute("aria-hidden"), "true");
});

test("close remove overlay invisível", () => {
  installPortalDom();
  globalThis.__overlayRoot.children = [];
  const overlay = ensureOverlayRoot();
  const popover = document.createElement("div");
  popover.hidden = true;
  overlay.appendChild(popover);
  const backdrop = document.createElement("div");
  backdrop.dataset.drpBackdrop = "";
  overlay.appendChild(backdrop);
  overlay.setAttribute("aria-hidden", "false");

  unmountPopoverPortal({ overlayRoot: overlay, backdrop, popover });
  assert.equal(overlay.childElementCount, 1);
  assert.equal(overlay.getAttribute("aria-hidden"), "true");
});

test("date-range-picker importa overlay-root", () => {
  const source = readFileSync(resolve(root, "js/components/filters/date-range-picker.js"), "utf8");
  assert.match(source, /mountPopoverPortal/);
  assert.match(source, /ensureOverlayRoot/);
  assert.doesNotMatch(source, /pointerdown.*onOutside/);
});

function installPortalDom() {
  if (globalThis.__portalDomInstalled) return;
  globalThis.__portalDomInstalled = true;

  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.classList = {
        values: new Set(),
        add(...items) { items.forEach((item) => this.values.add(item)); },
        remove(...items) { items.forEach((item) => this.values.delete(item)); },
        toggle(item, force) {
          if (force === true || (force == null && !this.values.has(item))) this.add(item);
          else this.remove(item);
        },
        contains(item) {
          return this.values.has(item);
        },
      };
      this.dataset = {};
      this.style = {};
      this.hidden = false;
      this.attributes = {};
      this._listeners = {};
      this.offsetWidth = 300;
      this.offsetHeight = 360;
    }

    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      child.parentNode = this;
      return child;
    }

    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      }
    }

    get childElementCount() {
      return this.children.length;
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    getAttribute(name) {
      return this.attributes[name];
    }

    querySelector(selector) {
      if (selector === "[data-drp-backdrop]") {
        return this.children.find((c) => c.dataset?.drpBackdrop != null) || null;
      }
      return null;
    }

    addEventListener() {}
    removeEventListener() {}
  }

  const body = new MockElement("div");
  globalThis.document = {
    body,
    createElement(tag) {
      return new MockElement(tag);
    },
    getElementById(id) {
      if (id === OVERLAY_ROOT_ID) return globalThis.__overlayRoot || null;
      return null;
    },
  };

  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
  };

  globalThis.__overlayRoot = ensureOverlayRoot();
}
