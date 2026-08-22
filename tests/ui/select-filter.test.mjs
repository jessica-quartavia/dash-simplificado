import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { renderSelectFilter } from "../../js/components/filters/select-filter.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("SelectFilter renderiza popover moderno com chevron e hidden input", () => {
  const html = renderSelectFilter({
    id: "cxSegment",
    label: "Segmento",
    options: [{ value: "APEX", label: "APEX" }, { value: "PRIVATE", label: "PRIVATE" }],
    value: "APEX",
  });
  assert.match(html, /class="select-filter"/);
  assert.match(html, /sf-chevron/);
  assert.match(html, /id="cxSegment"/);
  assert.match(html, /data-sf-popover/);
  assert.match(html, /APEX/);
});

test("Cancelamento e Satisfação usam kind selectfilter", () => {
  const cancellations = readFileSync(join(ROOT, "js/cancellations.js"), "utf8");
  const satisfaction = readFileSync(join(ROOT, "js/satisfaction.js"), "utf8");
  assert.match(cancellations, /kind: "selectfilter"/);
  assert.match(satisfaction, /kind: "selectfilter"/);
  assert.match(cancellations, /fillDynamicSelectFilter/);
  assert.match(satisfaction, /fillDynamicSelectFilter/);
});

test("SelectFilter integra click outside e Escape via coordinator", () => {
  const selectSource = readFileSync(join(ROOT, "js/components/filters/select-filter.js"), "utf8");
  const coordinatorSource = readFileSync(join(ROOT, "js/components/dropdown-coordinator.js"), "utf8");
  assert.match(selectSource, /closeOpenDropdown/);
  assert.match(selectSource, /registerOpenDropdown/);
  assert.match(selectSource, /containsEvent/);
  assert.match(selectSource, /mountPopoverPortal/);
  assert.match(coordinatorSource, /pointerdown/);
  assert.match(coordinatorSource, /Escape/);
});

test("filter-bar suporta selectfilter", () => {
  const source = readFileSync(join(ROOT, "js/components/filters/filter-bar.js"), "utf8");
  assert.match(source, /selectfilter/);
  assert.match(source, /bindSelectFilter/);
});
