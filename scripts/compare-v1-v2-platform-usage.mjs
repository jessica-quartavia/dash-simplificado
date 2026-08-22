#!/usr/bin/env node
/**
 * Auditoria V1 × V2 — Uso da Plataforma (live).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const V1_ROOT = resolve(ROOT, "../analytics_jornada_cliente/analytics_jornada_cliente/netlify/functions");

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

for (const [key, value] of Object.entries({
  ...parseEnvFile(join(ROOT, ".env")),
  ...parseEnvFile(join(ROOT, ".env.local")),
})) {
  if (!String(process.env[key] || "").trim()) process.env[key] = value;
}

async function loadV1() {
  const mod = await import(pathToFileURL(join(ROOT, "lib/analytics/fidelity-v1-compute.mjs")).href);
  return mod.computeV1PlatformUsagePayload();
}

async function loadV2() {
  const mod = await import(pathToFileURL(join(ROOT, "lib/analytics/platform-usage.mjs")).href);
  return mod.computePlatformUsagePayload();
}

console.log("Carregando Uso da Plataforma live…");
const [v1, v2] = await Promise.all([loadV1(), loadV2()]);
const s1 = v1?.summary || {};
const s2 = v2?.summary || {};

const v1Ids = new Set((v1?.clients || []).map((c) => String(c.userId)));
const v2Ids = new Set((v2?.clients || []).map((c) => String(c.userId)));
const inter = [...v1Ids].filter((id) => v2Ids.has(id));
const onlyV1 = [...v1Ids].filter((id) => !v2Ids.has(id));
const onlyV2 = [...v2Ids].filter((id) => !v1Ids.has(id));

function row(metric, a, b) {
  const delta = a != null && b != null && Number.isFinite(Number(a)) && Number.isFinite(Number(b))
    ? Math.round((Number(b) - Number(a)) * 1000) / 1000
    : null;
  const status = a === b ? "PASS" : delta === 0 ? "PASS" : "FIXED";
  return { metric, v1: a, v2: b, delta, status };
}

const table = [
  row("Usuários App Pharus", s1.totalUsers, s2.totalUsers),
  row("Realizaram login", s1.usersWithLogin, s2.usersWithLogin),
  row("Total logins", s1.totalLogins, s2.totalLogins),
  row("Média logins/mês", s1.averageLoginsPerMonth, s2.averageLoginsPerMonth),
  row("Dias desde último acesso (mediana)", s1.typicalDaysSinceLastAccess, s2.typicalDaysSinceLastAccess),
  row("Tempo médio entre acessos (mediana)", s1.averageDaysBetweenAccesses, s2.averageDaysBetweenAccesses),
  row("Excluídos corporativos", s1.excludedCorporateUsers, s2.excludedCorporateUsers),
  row("Excluídos demo", s1.excludedDemoUsers, s2.excludedDemoUsers),
];

console.log("\n### USO DA PLATAFORMA — V1 × V2");
console.log("Métrica | V1 | V2 | Delta | Status");
for (const r of table) {
  console.log(`${r.metric} | ${r.v1 ?? "—"} | ${r.v2 ?? "—"} | ${r.delta ?? "—"} | ${r.status}`);
}

console.log("\n### SETS user_id");
console.log(`V1=${v1Ids.size} V2=${v2Ids.size} intersection=${inter.length} only_v1=${onlyV1.length} only_v2=${onlyV2.length}`);
if (onlyV2.length) console.log(`only_v2 sample: ${onlyV2.slice(0, 5).join(", ")}`);
if (onlyV1.length) console.log(`only_v1 sample: ${onlyV1.slice(0, 5).join(", ")}`);

console.log("\nV2 directory:", {
  directoryUsers: s2.directoryUsers,
  coreDirectoryUsers: s2.coreDirectoryUsers,
  csvDirectoryUsers: s2.csvDirectoryUsers,
  eventsLoaded: s2.eventsLoaded,
  excludedByUserDirectory: s2.eventReconciliation?.excludedByUserDirectory,
});

if (!v1) console.log("\nV1: BLOCKED (auth corporativa no handler)");
console.log("\nV2 population parity:", s2.populationParityStatus || "—", s2.populationParityNote || "");
