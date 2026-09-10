import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { orderedPreloadEntries } from "../../lib/preload/page-preload-registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("menu e preload respeitam permissões no código", () => {
  const navigation = readFileSync(join(ROOT, "js/navigation.js"), "utf8");
  const preloader = readFileSync(join(ROOT, "js/page-preloader.js"), "utf8");
  const pageLoad = readFileSync(join(ROOT, "js/utils/page-load.js"), "utf8");
  const auth = readFileSync(join(ROOT, "js/auth.mjs"), "utf8");
  assert.match(navigation, /getMenuGroups/);
  assert.match(navigation, /canCurrentUserAccessPage/);
  assert.match(preloader, /canCurrentUserPreloadPage/);
  assert.match(pageLoad, /canCurrentUserAccessPage/);
  assert.match(auth, /fetchCurrentAccess/);
  assert.match(auth, /Acesso não autorizado|ACCESS_UNAUTHORIZED_MESSAGE/);
  assert.match(auth, /Acesso desativado|ACCESS_DISABLED_MESSAGE/);
});

test("preload de EP não inclui inteligência", () => {
  const allowed = new Set(["executive_summary", "general", "meetings", "mechanisms", "satisfaction"]);
  const queued = orderedPreloadEntries({
    canPreloadPage: (pageId) => allowed.has(pageId),
  });
  assert.ok(queued.every((entry) => allowed.has(entry.pageId)));
  assert.ok(!queued.some((entry) => entry.pageId === "statistical_crosses"));
  assert.ok(!queued.some((entry) => entry.pageId === "access_management"));
});

test("página de gerenciamento existe só para Owner no registry", () => {
  const pages = readFileSync(join(ROOT, "js/pages.js"), "utf8");
  const app = readFileSync(join(ROOT, "js/app.js"), "utf8");
  assert.match(pages, /id: "access_management"/);
  assert.match(pages, /group: "system"/);
  assert.match(app, /access-management/);
});
