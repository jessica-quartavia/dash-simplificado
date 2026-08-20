import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildCatalogResponse,
  catalogInvariantIssues,
  VALIDATED_V2_PAGES,
} from "../../lib/analytics/metric-catalog.mjs";

const seed = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../lib/analytics/metric-catalog-seed.json"), "utf8"),
);

test("nenhum metric_id duplicado ou ausente", () => {
  const ids = seed.metrics.map((m) => m.metric_id);
  assert.equal(ids.every(Boolean), true);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(seed.duplicates.length, 0);
});

test("Dash Kids preservado nos textos originais do CSV", () => {
  const csv = seed.metrics.filter((m) => m.csv_reference);
  assert.equal(csv.length, 66);
  const statuses = new Set(csv.map((m) => m.dash_kids_status));
  assert.equal(statuses.has("Sim"), true);
  assert.equal(statuses.has("Avaliar"), true);
  assert.equal(statuses.has("Recomendação: Não Levar"), true);
  assert.equal(csv.every((m) => typeof m.dash_kids_status === "string" && m.dash_kids_status.length > 0), true);
});

test("métricas Não Levar não são marcadas como validadas", () => {
  const blocked = seed.metrics.filter((m) => /n[aã]o levar/i.test(String(m.dash_kids_status || "")));
  assert.equal(blocked.length > 0, true);
  assert.equal(blocked.every((m) => m.validated_for_v2 === false), true);
});

test("páginas ainda não validadas não são marcadas como validadas", () => {
  const others = seed.metrics.filter((m) => !VALIDATED_V2_PAGES.includes(m.page_id));
  assert.equal(others.length > 0, true);
  assert.equal(others.every((m) => m.validated_for_v2 === false), true);
  assert.equal(others.every((m) => m.dash_kids_status == null), true);
});

test("somente Dash Kids = Sim nas páginas já trabalhadas entra como validated_for_v2", () => {
  for (const metric of seed.metrics) {
    const expected = VALIDATED_V2_PAGES.includes(metric.page_id) && metric.dash_kids_status === "Sim";
    assert.equal(metric.validated_for_v2, expected, metric.metric_id);
  }
});

test("invariantes do payload público", () => {
  const payload = buildCatalogResponse(seed.metrics);
  const issues = catalogInvariantIssues(payload.metrics);
  assert.deepEqual(issues, []);
  assert.equal(payload.metrics.length, 201);
  const json = JSON.stringify(payload);
  assert.equal(json.includes("source_objects"), false);
  assert.equal(/\b1775\b/.test(json), false);
});
