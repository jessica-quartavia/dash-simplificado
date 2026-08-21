/**
 * Camada Pharus REST — anon key only, schema explícito, fidelidade V1.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getPharusEnv, pharusConfigurationError } from "../../lib/env.mjs";
import {
  createPharusRestClient,
  getPharusRestConfig,
  pharusFetch,
  pharusRestFetch,
} from "../../lib/data/pharus-rest.mjs";
import { computePlatformUsagePayload } from "../../lib/analytics/platform-usage.mjs";
import { consolidateMechanismsPayload } from "../../lib/analytics/mechanisms/mechanisms-consolidation.mjs";

test("getPharusEnv usa somente anon key (sem service role)", () => {
  const prevAnon = process.env.PHARUS_SUPABASE_ANON_KEY;
  const prevSr = process.env.PHARUS_SUPABASE_SERVICE_ROLE_KEY;
  process.env.PHARUS_SUPABASE_URL = "https://example.supabase.co";
  process.env.PHARUS_SUPABASE_ANON_KEY = "anon-test-key";
  process.env.PHARUS_SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
  const env = getPharusEnv();
  assert.equal(env.restKey, "anon-test-key");
  assert.equal(env.anonKey, "anon-test-key");
  assert.equal("serviceRoleKey" in env, false);
  if (prevAnon) process.env.PHARUS_SUPABASE_ANON_KEY = prevAnon;
  else delete process.env.PHARUS_SUPABASE_ANON_KEY;
  if (prevSr) process.env.PHARUS_SUPABASE_SERVICE_ROLE_KEY = prevSr;
  else delete process.env.PHARUS_SUPABASE_SERVICE_ROLE_KEY;
});

test("pharusConfigurationError exige anon key", () => {
  const prevUrl = process.env.PHARUS_SUPABASE_URL;
  const prevAnon = process.env.PHARUS_SUPABASE_ANON_KEY;
  process.env.PHARUS_SUPABASE_URL = "https://example.supabase.co";
  delete process.env.PHARUS_SUPABASE_ANON_KEY;
  assert.match(pharusConfigurationError(), /PHARUS_SUPABASE_ANON_KEY/);
  if (prevUrl) process.env.PHARUS_SUPABASE_URL = prevUrl;
  else delete process.env.PHARUS_SUPABASE_URL;
  if (prevAnon) process.env.PHARUS_SUPABASE_ANON_KEY = prevAnon;
});

test("getPharusRestConfig rejeita service role no anon", () => {
  const prev = process.env.PHARUS_SUPABASE_ANON_KEY;
  process.env.PHARUS_SUPABASE_URL = "https://example.supabase.co";
  process.env.PHARUS_SUPABASE_ANON_KEY = "eyJhbGci.service_role.test";
  const cfg = getPharusRestConfig();
  assert.equal(cfg.ok, false);
  if (prev) process.env.PHARUS_SUPABASE_ANON_KEY = prev;
  else delete process.env.PHARUS_SUPABASE_ANON_KEY;
});

test("createPharusRestClient usa schema explícito por chamada", () => {
  const prevUrl = process.env.PHARUS_SUPABASE_URL;
  const prevKey = process.env.PHARUS_SUPABASE_ANON_KEY;
  process.env.PHARUS_SUPABASE_URL = "https://example.supabase.co";
  process.env.PHARUS_SUPABASE_ANON_KEY = "anon-test-key";
  const client = createPharusRestClient({ schema: "core" });
  assert.equal(client.schema, "core");
  const metricsClient = createPharusRestClient({ schema: "metrics" });
  assert.equal(metricsClient.schema, "metrics");
  if (prevUrl) process.env.PHARUS_SUPABASE_URL = prevUrl;
  else delete process.env.PHARUS_SUPABASE_URL;
  if (prevKey) process.env.PHARUS_SUPABASE_ANON_KEY = prevKey;
  else delete process.env.PHARUS_SUPABASE_ANON_KEY;
});

test("pharusFetch exige schema explícito", async () => {
  const prevUrl = process.env.PHARUS_SUPABASE_URL;
  const prevKey = process.env.PHARUS_SUPABASE_ANON_KEY;
  process.env.PHARUS_SUPABASE_URL = "https://example.supabase.co";
  process.env.PHARUS_SUPABASE_ANON_KEY = "anon-test-key";
  try {
    await assert.rejects(
      () => pharusFetch({ table: "events" }),
      (err) => err.code === "pharus_config",
    );
  } finally {
    if (prevUrl) process.env.PHARUS_SUPABASE_URL = prevUrl;
    else delete process.env.PHARUS_SUPABASE_URL;
    if (prevKey) process.env.PHARUS_SUPABASE_ANON_KEY = prevKey;
    else delete process.env.PHARUS_SUPABASE_ANON_KEY;
  }
});

test("pharusRestFetch propaga postgrest error sem converter em zero", async () => {
  const prevUrl = process.env.PHARUS_SUPABASE_URL;
  const prevKey = process.env.PHARUS_SUPABASE_ANON_KEY;
  process.env.PHARUS_SUPABASE_URL = "https://example.supabase.co";
  process.env.PHARUS_SUPABASE_ANON_KEY = "anon-test-key";
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ code: "42501", message: "permission denied for schema metrics" }),
    headers: { get: () => null },
  });
  try {
    const page = await pharusRestFetch("events", { schema: "metrics", select: "id", limit: 1 });
    assert.equal(page.ok, false);
    assert.equal(page.status, 401);
    assert.match(page.postgrest.message, /permission denied/);
  } finally {
    global.fetch = originalFetch;
    if (prevUrl) process.env.PHARUS_SUPABASE_URL = prevUrl;
    else delete process.env.PHARUS_SUPABASE_URL;
    if (prevKey) process.env.PHARUS_SUPABASE_ANON_KEY = prevKey;
    else delete process.env.PHARUS_SUPABASE_ANON_KEY;
  }
});

test("consolidação sem App Pharus marca partial e não inventa App=0", () => {
  const baseQvPayload = {
    generatedAt: new Date().toISOString(),
    catalog: [],
    portfolio: [],
    clients: [{ clientId: "1", clientName: "A", mechanisms: [{ name: "M1", status: "Implementado" }] }],
    metadata: { sources: ["BASE QV"] },
  };
  const payload = consolidateMechanismsPayload({ baseQvPayload, pharusPayload: null, clientsRaw: [] });
  assert.equal(payload.metadata.consolidationQuality.clients.consolidationMode, "partial");
  assert.equal(payload.metadata.consolidationQuality.clients.pharusUsersWithMechanisms, null);
});

test("platform usage sem config retorna unavailable (não zero)", async () => {
  const prevUrl = process.env.PHARUS_SUPABASE_URL;
  const prevKey = process.env.PHARUS_SUPABASE_ANON_KEY;
  delete process.env.PHARUS_SUPABASE_URL;
  delete process.env.PHARUS_SUPABASE_ANON_KEY;
  const payload = await computePlatformUsagePayload();
  assert.equal(payload.status, "unavailable");
  assert.equal(payload.available, false);
  assert.equal(payload.summary, null);
  assert.equal(payload.clients.length, 0);
  if (prevUrl) process.env.PHARUS_SUPABASE_URL = prevUrl;
  if (prevKey) process.env.PHARUS_SUPABASE_ANON_KEY = prevKey;
});
