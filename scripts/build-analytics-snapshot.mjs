/**
 * Preview local do snapshot analítico V2.
 * Sem persistência por padrão. Não grava PII em arquivo.
 *
 * node scripts/build-analytics-snapshot.mjs
 * node scripts/build-analytics-snapshot.mjs --persist
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchMetricCatalogRows } from "../lib/data/analytics-catalog-rest.mjs";
import { buildMetricSnapshots } from "../lib/analytics/snapshot/metric-snapshot-builder.mjs";
import { analyticsSnapshotStore } from "../lib/analytics/snapshot/metric-snapshot-store.mjs";
import { findSnapshotPii } from "../lib/analytics/snapshot/metric-snapshot-pii.mjs";
import { redactSecrets } from "../lib/auth.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const persist = process.argv.includes("--persist");

function accessTokenFromArgs(argv) {
  const envToken = String(process.env.ANALYTICS_ACCESS_TOKEN || "").trim();
  if (envToken) return envToken;
  const eq = argv.find((arg) => arg.startsWith("--access-token="));
  if (eq) return eq.slice("--access-token=".length).trim();
  const idx = argv.indexOf("--access-token");
  if (idx >= 0) return String(argv[idx + 1] || "").trim();
  return "";
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function loadLocalEnv() {
  const merged = { ...parseEnvFile(join(ROOT, ".env")), ...parseEnvFile(join(ROOT, ".env.local")) };
  for (const [key, value] of Object.entries(merged)) process.env[key] = value;
}

function seedValidatedMetrics() {
  const seed = JSON.parse(readFileSync(join(ROOT, "lib", "analytics", "metric-catalog-seed.json"), "utf8"));
  return seed.metrics.filter((row) => row.validated_for_v2 === true);
}

async function loadCatalog(accessToken) {
  if (accessToken) {
    try {
      const { rows } = await fetchMetricCatalogRows({ validated: true, accessToken });
      if (rows?.length) return { rows, source: "catalog" };
    } catch {
      console.warn("[snapshot-build] catálogo remoto indisponível.");
    }
  }
  return { rows: seedValidatedMetrics(), source: "seed_fallback" };
}

function printCounts(counts) {
  const labels = {
    general: "General",
    journey: "Journey",
    meetings: "Meetings",
    patrimonial_plan: "Patrimonial Plan",
    mechanisms: "Mechanisms",
  };
  for (const [pageId, count] of Object.entries(counts || {})) {
    console.log(`${labels[pageId] || pageId}: ${count}`);
  }
}

async function main() {
  loadLocalEnv();
  const accessToken = accessTokenFromArgs(process.argv);
  const { rows, source } = await loadCatalog(accessToken);
  console.log(`Catálogo: ${source} (${rows.length} validadas)`);
  const result = await buildMetricSnapshots({ catalogRows: rows });
  const json = JSON.stringify(result.snapshots);
  const pii = findSnapshotPii(result.snapshots);
  printCounts(result.counts);
  console.log(`Total: ${result.snapshots.length}`);
  console.log(`JSON: ${Buffer.byteLength(json)} bytes`);
  console.log(`Tempo total: ${result.total_ms}ms`);
  console.log("Tempo por página:", result.timings);
  console.log("PII:", pii ? `FALHOU em ${pii}` : "nenhum");
  for (const row of result.comparison || []) {
    console.log(`compare ${row.metric_id}: ${row.match ? "ok" : "DIVERGE"}`);
  }
  if (pii) process.exitCode = 1;
  if (!persist) {
    console.log("Preview apenas. Persistência exige JWT corporativo (--access-token ou ANALYTICS_ACCESS_TOKEN).");
    return;
  }
  if (!accessToken) {
    console.error("--persist indisponível sem sessão corporativa.");
    console.error("Passe ANALYTICS_ACCESS_TOKEN ou --access-token com um JWT @quartavia.com.br.");
    console.error("Anon não tem permissão de escrita. O preview sem --persist continua disponível.");
    process.exitCode = 1;
    return;
  }
  try {
    const saved = await analyticsSnapshotStore.upsert(result.snapshots, { accessToken });
    console.log(`Persistido: ${saved.persisted}. Erros ignorados: ${saved.skipped_errors}.`);
  } catch (error) {
    console.error("Persistência indisponível:", redactSecrets(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : error));
  process.exit(1);
});
