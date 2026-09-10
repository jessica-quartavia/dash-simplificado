/**
 * Diagnóstico read-only das tabelas de acesso no Business Data.
 * Não imprime JWT, anon key nem Authorization.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[trimmed.slice(0, eq).trim()] = value;
  }
  return parsed;
}

const root = process.cwd();
const env = { ...parseEnvFile(join(root, ".env")), ...parseEnvFile(join(root, ".env.local")) };
const url = String(env.AUTH_SUPABASE_URL || env.BUSINESS_DATA_SUPABASE_URL || "").replace(/\/$/, "");
const anon = String(env.AUTH_SUPABASE_ANON_KEY || "").trim();
const host = url ? new URL(url).hostname : "";
const projectRef = host.split(".")[0] || "";

console.info("[probe] project_ref=", projectRef || "(ausente)");
console.info("[probe] analytics_url_ok=", Boolean(url));
console.info("[probe] anon_key_ok=", Boolean(anon));
console.info("[probe] is_base_qv=", host.includes("lacinxsvjdwalkchxyeo"));

if (!url || !anon) {
  console.error("[probe] env AUTH incompleto");
  process.exit(1);
}

async function probe(table) {
  const endpoint = new URL(`/rest/v1/${table}`, url);
  endpoint.searchParams.set("select", "id");
  endpoint.searchParams.set("limit", "1");
  const response = await fetch(endpoint, {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      Accept: "application/json",
      "Accept-Profile": "analytics",
    },
  });
  const text = await response.text();
  let body = text;
  try {
    const parsed = JSON.parse(text);
    body = {
      code: parsed.code || null,
      message: parsed.message || parsed.error || null,
      hint: parsed.hint || null,
      details: parsed.details || null,
      rowCount: Array.isArray(parsed) ? parsed.length : null,
    };
  } catch {
    body = text.slice(0, 240);
  }
  console.info(`[probe] table=${table} status=${response.status}`, body);
}

for (const table of [
  "metric_catalog",
  "dashboard_users",
  "dashboard_access_groups",
  "dashboard_user_groups",
  "dashboard_access_audit",
]) {
  await probe(table);
}
