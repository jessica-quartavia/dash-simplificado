import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnalyticsCacheKey,
  MemoryAnalyticsCache,
  normalizeAnalyticsFilters,
  resetAnalyticsCache,
  getAnalyticsCache,
  cacheTtlForPage,
  CALCULATION_VERSION,
} from "../../lib/cache/analytics-cache.mjs";
import { computeWithPageCache, parseForceRefresh } from "../../lib/analytics/handler-cache.mjs";

test("cache key formato analytics:v2:{page}:{version}:{hash}", () => {
  const key = buildAnalyticsCacheKey("executive_summary", { program: "Pharus" });
  assert.match(key, /^analytics:v2:executive_summary:/);
  assert.match(key, new RegExp(CALCULATION_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("cache key distingue filtros de programa", () => {
  const all = buildAnalyticsCacheKey("executive_summary", { program: "all" });
  const pharus = buildAnalyticsCacheKey("executive_summary", { program: "pharus" });
  assert.notEqual(all, pharus);
});

test("TTL centralizado — satisfaction 10 min, support 2 min, statistical 15 min", () => {
  assert.equal(cacheTtlForPage("satisfaction"), 10 * 60 * 1000);
  assert.equal(cacheTtlForPage("support"), 2 * 60 * 1000);
  assert.equal(cacheTtlForPage("statistical_crosses"), 15 * 60 * 1000);
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
  assert.equal(b.coalesced, true);
});

test("cache hit após miss", async () => {
  resetAnalyticsCache();
  let calls = 0;
  const { payload, cache } = await computeWithPageCache(
    "general",
    async () => {
      calls += 1;
      return { n: 1 };
    },
    { force: true },
  );
  assert.equal(payload.n, 1);
  assert.equal(cache.status, "bypass");
  const warm = await computeWithPageCache("general", async () => ({ n: 2 }), { force: false });
  assert.equal(warm.cache.hit, true);
  assert.equal(calls, 1);
});

test("force bypass recalcula", async () => {
  resetAnalyticsCache();
  let n = 0;
  await computeWithPageCache("renewal", async () => ({ n: ++n }), { force: false });
  const forced = await computeWithPageCache("renewal", async () => ({ n: ++n }), { force: true });
  assert.equal(forced.cache.status, "bypass");
  assert.equal(forced.payload.n, 2);
});

test("parseForceRefresh — query e header", () => {
  assert.equal(parseForceRefresh(new Request("http://x/api?page=1&force=1")), true);
  assert.equal(parseForceRefresh(new Request("http://x/api?refresh=1")), true);
  assert.equal(
    parseForceRefresh(new Request("http://x/api", { headers: { "x-force-refresh": "1" } })),
    true,
  );
  assert.equal(parseForceRefresh(new Request("http://x/api")), false);
});

test("getAnalyticsCache fallback memory sem Redis env", () => {
  resetAnalyticsCache();
  const cache = getAnalyticsCache();
  assert.equal(cache.provider, "memory");
});

test("filter hash isolation — quarter e program", () => {
  const a = buildAnalyticsCacheKey("satisfaction", normalizeAnalyticsFilters({ program: "Pharus", quarter: "2026 T1" }));
  const b = buildAnalyticsCacheKey("satisfaction", normalizeAnalyticsFilters({ program: "Davos", quarter: "2026 T1" }));
  assert.notEqual(a, b);
});

test("fail-open quando Redis indisponível", async () => {
  process.env.UPSTASH_REDIS_REST_URL = "https://invalid.example.com";
  process.env.UPSTASH_REDIS_REST_TOKEN = "bad-token";
  delete process.env.ANALYTICS_CACHE_DISABLED;
  resetAnalyticsCache();
  let calls = 0;
  const result = await computeWithPageCache("general", async () => {
    calls += 1;
    return { ok: true };
  });
  assert.equal(result.payload.ok, true);
  assert.equal(calls, 1);
  assert.match(result.cache.status, /bypass|miss/);
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  resetAnalyticsCache();
});

test("ANALYTICS_CACHE_DISABLED=1 bypassa cache", async () => {
  process.env.ANALYTICS_CACHE_DISABLED = "1";
  resetAnalyticsCache();
  const result = await computeWithPageCache("meetings", async () => ({ n: 1 }));
  assert.equal(result.cache.status, "bypass");
  assert.equal(result.cache.bypassReason, "disabled");
  delete process.env.ANALYTICS_CACHE_DISABLED;
  resetAnalyticsCache();
});

test("TTL expiry invalida entrada memory", async () => {
  const cache = new MemoryAnalyticsCache();
  const key = "ttl:test";
  await cache.getOrCompute(key, 30, async () => ({ v: 1 }));
  await new Promise((r) => setTimeout(r, 40));
  const hit = cache.get(key);
  assert.equal(hit, null);
});
