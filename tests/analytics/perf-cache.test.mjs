import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnalyticsCacheKey,
  MemoryAnalyticsCache,
  normalizeAnalyticsFilters,
} from "../../lib/cache/analytics-cache.mjs";
import {
  computeCoverageFromRows,
  isMissingFieldValue,
} from "../../lib/analytics/quality-coverage.mjs";

test("cache key distingue filtros de programa", () => {
  const all = buildAnalyticsCacheKey("executive_summary", { program: "all" });
  const pharus = buildAnalyticsCacheKey("executive_summary", { program: "pharus" });
  assert.notEqual(all, pharus);
});

test("cache key normaliza filtros equivalentes", () => {
  const a = buildAnalyticsCacheKey("general", { program: " all ", status: "ativo" });
  const b = buildAnalyticsCacheKey("general", normalizeAnalyticsFilters({ program: "all", status: "ativo" }));
  assert.equal(a, b);
});

test("MemoryAnalyticsCache coalesce inflight", async () => {
  const cache = new MemoryAnalyticsCache();
  let calls = 0;
  const compute = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true };
  };
  const key = "test:key";
  const [a, b] = await Promise.all([
    cache.getOrCompute(key, 5000, compute),
    cache.getOrCompute(key, 5000, compute),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.value.ok, true);
  assert.equal(b.value.ok, true);
});

test("quality coverage missing semantics", () => {
  assert.equal(isMissingFieldValue(null, false), true);
  assert.equal(isMissingFieldValue("", false), false);
  assert.equal(isMissingFieldValue("", true), true);
  const { totalRows, missingRows } = computeCoverageFromRows(
    [{ name: null }, { name: "" }, { name: "x" }],
    "name",
    true,
  );
  assert.equal(totalRows, 3);
  assert.equal(missingRows, 2);
});
