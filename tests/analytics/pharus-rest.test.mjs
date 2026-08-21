/**
 * Camada Pharus REST — config anon-only e payload indisponível.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getPharusEnv, pharusConfigurationError } from "../../lib/env.mjs";
import { getPharusRestConfig } from "../../lib/data/pharus-rest.mjs";
import { computePlatformUsagePayload } from "../../lib/analytics/platform-usage.mjs";

test("getPharusEnv não expõe service role", () => {
  const env = getPharusEnv();
  assert.equal("serviceRoleKey" in env, false);
  assert.equal("restKey" in env, false);
});

test("pharusConfigurationError exige anon key", () => {
  const prevUrl = process.env.PHARUS_SUPABASE_URL;
  const prevKey = process.env.PHARUS_SUPABASE_ANON_KEY;
  delete process.env.PHARUS_SUPABASE_URL;
  delete process.env.PHARUS_SUPABASE_ANON_KEY;
  assert.match(pharusConfigurationError() || "", /PHARUS_SUPABASE_URL/);
  process.env.PHARUS_SUPABASE_URL = "https://example.supabase.co";
  assert.match(pharusConfigurationError() || "", /PHARUS_SUPABASE_ANON_KEY/);
  process.env.PHARUS_SUPABASE_ANON_KEY = "anon-test-key";
  assert.equal(pharusConfigurationError(), null);
  if (prevUrl) process.env.PHARUS_SUPABASE_URL = prevUrl;
  else delete process.env.PHARUS_SUPABASE_URL;
  if (prevKey) process.env.PHARUS_SUPABASE_ANON_KEY = prevKey;
  else delete process.env.PHARUS_SUPABASE_ANON_KEY;
});

test("getPharusRestConfig rejeita service role no anon", () => {
  const prev = process.env.PHARUS_SUPABASE_ANON_KEY;
  process.env.PHARUS_SUPABASE_ANON_KEY = "eyJhbGci.service_role.test";
  const cfg = getPharusRestConfig();
  assert.equal(cfg.ok, false);
  if (prev) process.env.PHARUS_SUPABASE_ANON_KEY = prev;
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
