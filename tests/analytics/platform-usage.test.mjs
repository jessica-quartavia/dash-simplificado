import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("platform-usage não referencia metrics.events diretamente", () => {
  const source = readFileSync(join(ROOT, "lib/analytics/platform-usage.mjs"), "utf8");
  assert.doesNotMatch(source, /metrics\.events/);
  assert.match(source, /analytics\.platform_login_events|platform_login_events/);
  assert.match(source, /PHARUS_LOGIN_EVENTS_SCHEMA\s*=\s*"analytics"/);
});

test("platform usage com view retorna connected e KPIs reais", async () => {
  const prevUrl = process.env.PHARUS_SUPABASE_URL;
  const prevKey = process.env.PHARUS_SUPABASE_ANON_KEY;
  process.env.PHARUS_SUPABASE_URL = "https://example.supabase.co";
  process.env.PHARUS_SUPABASE_ANON_KEY = "anon-test-key";

  const rows = Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    user_id: i === 2 ? "user-b" : "user-a",
    event_name: i % 2 === 0 ? "login_succeeded" : "login_success",
    created_at: `2026-01-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
  }));

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/rest/v1/platform_login_events")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(rows),
        headers: { get: () => `0-${rows.length - 1}/${rows.length}` },
      };
    }
    return { ok: true, status: 200, text: async () => "[]", headers: { get: () => "0-0/0" } };
  };

  try {
    const { computePlatformUsagePayload } = await import("../../lib/analytics/platform-usage.mjs");
    const payload = await computePlatformUsagePayload();
    assert.equal(payload.status, "connected");
    assert.equal(payload.metricsSourceUnavailable, false);
    assert.equal(payload.summary.eventsLoaded, 3);
    assert.equal(payload.summary.totalLogins, 3);
    assert.equal(payload.summary.totalUsers, 2);
    assert.equal(payload.summary.usersWithLogin, 2);
    assert.ok(payload.summary.typicalDaysSinceLastAccess != null);
    assert.equal(payload.message, null);
  } finally {
    global.fetch = originalFetch;
    if (prevUrl) process.env.PHARUS_SUPABASE_URL = prevUrl;
    else delete process.env.PHARUS_SUPABASE_URL;
    if (prevKey) process.env.PHARUS_SUPABASE_ANON_KEY = prevKey;
    else delete process.env.PHARUS_SUPABASE_ANON_KEY;
  }
});

test("platform usage com view bloqueada retorna partial sem zeros falsos", async () => {
  const prevUrl = process.env.PHARUS_SUPABASE_URL;
  const prevKey = process.env.PHARUS_SUPABASE_ANON_KEY;
  process.env.PHARUS_SUPABASE_URL = "https://example.supabase.co";
  process.env.PHARUS_SUPABASE_ANON_KEY = "anon-test-key";
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/rest/v1/platform_login_events")) {
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: "permission denied for schema analytics" }),
        headers: { get: () => null },
      };
    }
    return { ok: true, status: 200, text: async () => "[]", headers: { get: () => "0-0/0" } };
  };
  try {
    const { computePlatformUsagePayload } = await import(`../../lib/analytics/platform-usage.mjs?blocked=${Date.now()}`);
    const payload = await computePlatformUsagePayload();
    assert.equal(payload.metricsSourceUnavailable, true);
    assert.equal(payload.summary.totalUsers, null);
    assert.equal(payload.summary.totalLogins, null);
  } finally {
    global.fetch = originalFetch;
    if (prevUrl) process.env.PHARUS_SUPABASE_URL = prevUrl;
    else delete process.env.PHARUS_SUPABASE_URL;
    if (prevKey) process.env.PHARUS_SUPABASE_ANON_KEY = prevKey;
    else delete process.env.PHARUS_SUPABASE_ANON_KEY;
  }
});
