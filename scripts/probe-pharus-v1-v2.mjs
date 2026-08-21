/**
 * Diagnóstico read-only: compara request V1 × V2 ao App Pharus (sem imprimir chaves).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const V1_ENV = resolve(ROOT, "../analytics_jornada_cliente/analytics_jornada_cliente/netlify/functions/_shared/env.mjs");

function loadEnv() {
  for (const name of [".env", ".env.local"]) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      const key = trimmed.slice(0, eq).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
  delete process.env.PHARUS_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.APP_PHARUS_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.QVTQUFDIVPBMUBOOAWDM_SERVICE_ROLE_KEY;
}

loadEnv();

const v1Env = await import(pathToFileURL(V1_ENV).href);
const v2Rest = await import(pathToFileURL(join(ROOT, "lib/data/pharus-rest.mjs")).href);

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function probeV1(label, schema, table, select = "id") {
  const client = v1Env.getPharusSupabaseClient({ schema });
  const page = await client.rest(table, { select, limit: 1, countExact: true });
  return {
    label,
    host: host(v1Env.getPharusEnv().url),
    schema,
    table,
    query: `${select} limit=1`,
    apikey: "anon",
    authorization: "Bearer anon",
    acceptProfile: schema,
    contentProfile: schema,
    endpoint: "direct PostgREST",
    http: page.status,
    ok: page.ok,
    rows: page.data?.length ?? 0,
    total: page.total,
    error: page.ok ? null : (page.raw || "").slice(0, 180),
  };
}

async function probeV2(label, schema, table, select = "id") {
  const page = await v2Rest.pharusRestFetch(table, { schema, select, limit: 1 });
  const cfg = v2Rest.getPharusRestConfig();
  return {
    label,
    host: host(cfg.ok ? cfg.url : v1Env.getPharusEnv().url),
    schema,
    table,
    query: `${select} limit=1`,
    apikey: cfg.authMode || "anon",
    authorization: `Bearer ${cfg.authMode || "anon"}`,
    acceptProfile: schema,
    contentProfile: schema,
    endpoint: "direct PostgREST",
    http: page.status,
    ok: page.ok,
    rows: page.data?.length ?? 0,
    total: page.total,
    error: page.ok ? null : (page.postgrest?.message || (page.raw || "").slice(0, 180)),
  };
}

const cases = [
  ["core.mechanisms", "core", "mechanisms"],
  ["core.user_mechanisms", "core", "user_mechanisms"],
  ["metrics.events", "metrics", "events", "id,event_name,created_at"],
];

const out = [];
for (const [name, schema, table, select] of cases) {
  out.push({ metric: name, v1: await probeV1("V1", schema, table, select), v2: await probeV2("V2", schema, table, select) });
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  v1_effective_key: v1Env.getPharusEnv().serviceRoleKey ? "service_role" : "anon",
  v2_effective_key: v2Rest.getPharusRestConfig().authMode,
  comparisons: out,
}, null, 2));
