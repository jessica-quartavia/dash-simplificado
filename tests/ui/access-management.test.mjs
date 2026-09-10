import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildAccessUserTags } from "../../lib/access/access-policy.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(join(ROOT, "js/access-management.js"), "utf8");
const css = readFileSync(join(ROOT, "css/components.css"), "utf8");

test("listagem de acessos usa table-panel alinhado e tags Owner", () => {
  assert.match(page, /buildAccessUserTags/);
  assert.match(page, /am-badge-\$\{tag\.kind\}/);
  assert.match(page, /table-panel am-table-panel/);
  assert.match(page, /table-scroll/);
  assert.match(page, /class="gd-table am-table"/);
  assert.match(page, /am-tag-list/);
  assert.match(page, /am-edit-btn/);
  assert.doesNotMatch(page, /hs-section-head/);
  assert.doesNotMatch(page, /class="am-groups"/);
});

test("CSS da tela de acessos tem tag Owner distinta e tabela estável", () => {
  assert.match(css, /\.am-badge-owner/);
  assert.match(css, /\.am-table \{\s*table-layout: fixed;/);
  assert.match(css, /data-page="access_management"/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

test("regra visual Owner / Sem time", () => {
  assert.equal(buildAccessUserTags({ isOwner: true, groupLabels: [] })[0].label, "Owner");
  assert.ok(!buildAccessUserTags({ isOwner: true, groupLabels: [] }).some((tag) => tag.label === "Sem time"));
  assert.equal(buildAccessUserTags({ isOwner: false, groupLabels: [] })[0].label, "Sem time");
});
