#!/usr/bin/env node
/**
 * Auditoria targeted V1 × V2 — general_data, journey, meetings (live, sem cache).
 *
 *   node scripts/compare-v1-v2-targeted.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  compareGeneralAcquisition,
  compareJourneyCharts,
  compareMeetingsFull,
  GENERAL_ACQ_PRESET,
  JOURNEY_PRESET,
} from "../lib/analytics/targeted-fidelity.mjs";

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

async function loadV1(name) {
  return import(pathToFileURL(join(V1_ROOT, `${name}.mjs`)).href);
}

async function loadV2(name) {
  return import(pathToFileURL(join(ROOT, `lib/analytics/${name}.mjs`)).href);
}

console.log("Carregando payloads live…");
const t0 = Date.now();
const [v1General, v2General, v1Onboarding, v2Onboarding, v1Meetings, v2Meetings] = await Promise.all([
  loadV1("general-data").then((m) => m.computeGeneralDataPayload()),
  loadV2("general-data").then((m) => m.computeGeneralDataPayload()),
  loadV1("onboarding").then((m) => m.computeOnboardingPayload()),
  loadV2("onboarding").then((m) => m.computeOnboardingPayload()),
  loadV1("meetings").then((m) => m.computeMeetingsPayload({ includeMeetingTypes: false })),
  loadV2("meetings").then((m) => m.computeMeetingsPayload({ includeMeetingTypes: false })),
]);
console.log(`Compute ${Math.round((Date.now() - t0) / 1000)}s\n`);

// --- Dados Gerais ---
console.log("### DADOS GERAIS — Evolução mensal (Ativos · 6 meses)");
const general = compareGeneralAcquisition(v1General.clients, v2General.clients, GENERAL_ACQ_PRESET);
console.log("Mês | V1 | V2 | Delta | Status");
for (const row of general.byMonth) {
  console.log(`${row.month} | ${row.v1} | ${row.v2} | ${row.delta} | ${row.status}`);
}
console.log("Cards:", JSON.stringify(general.cards, null, 2));
console.log("População filtrada:", general.population);

for (const limit of [12, 24]) {
  const g = compareGeneralAcquisition(v1General.clients, v2General.clients, { ...GENERAL_ACQ_PRESET, acqRange: limit });
  const divergent = g.byMonth.filter((r) => r.v1 !== r.v2).length;
  console.log(`Janela ${limit}m: ${divergent} meses divergentes`);
}

// --- Jornada ---
console.log("\n### JORNADA");
const journey = compareJourneyCharts(v1Onboarding, v2Onboarding, JOURNEY_PRESET);
for (const chart of journey.charts) {
  console.log(`\n${chart.chart}: V1=${chart.v1Median} V2=${chart.v2Median} N=${chart.v1N}/${chart.v2N} status=${chart.status}`);
  if (chart.note) console.log(`  nota: ${chart.note}`);
  for (const b of chart.buckets.filter((x) => x.delta !== 0).slice(0, 6)) {
    console.log(`  bucket ${b.bucket}: V1=${b.v1} V2=${b.v2} Δ=${b.delta}`);
  }
}

// --- Reuniões ---
console.log("\n### REUNIÕES — Ativos · Todo o histórico");
const mtActive = compareMeetingsFull(v1Meetings, v2Meetings, "all_history_active");
const totalRow = mtActive.metrics.find((m) => m.metric === "Total de reuniões");
console.log(`Total: V1=${totalRow?.v1} V2=${totalRow?.v2} Δ=${totalRow?.delta} ${totalRow?.status}`);
console.log(
  `Meeting sets: v1=${mtActive.meetingSets.v1Count} v2=${mtActive.meetingSets.v2Count} only_v1=${mtActive.meetingSets.onlyV1} only_v2=${mtActive.meetingSets.onlyV2}`,
);
if (mtActive.meetingDiagnostics.onlyV1.length || mtActive.meetingDiagnostics.onlyV2.length) {
  console.log("only_v1:", JSON.stringify(mtActive.meetingDiagnostics.onlyV1, null, 2));
  console.log("only_v2:", JSON.stringify(mtActive.meetingDiagnostics.onlyV2, null, 2));
}

console.log("\n### REUNIÕES — Todos status · Todo o histórico");
const mtAll = compareMeetingsFull(v1Meetings, v2Meetings, "all_history_all_status");
const totalAll = mtAll.metrics.find((m) => m.metric === "Total de reuniões");
console.log(`Total: V1=${totalAll?.v1} V2=${totalAll?.v2} Δ=${totalAll?.delta}`);
console.log(
  `Meeting sets: only_v1=${mtAll.meetingSets.onlyV1} only_v2=${mtAll.meetingSets.onlyV2}`,
);
if (mtAll.meetingDiagnostics.onlyV1.length) {
  console.log("only_v1:", JSON.stringify(mtAll.meetingDiagnostics.onlyV1.slice(0, 12), null, 2));
}
if (mtAll.meetingDiagnostics.onlyV2.length) {
  console.log("only_v2:", JSON.stringify(mtAll.meetingDiagnostics.onlyV2.slice(0, 12), null, 2));
}

console.log("\nNo-show buckets:");
for (const b of mtActive.distributions.noShowFrequency) {
  if (b.v1 !== b.v2) console.log(`  ${b.bucket}: V1=${b.v1} V2=${b.v2} Δ=${b.delta}`);
}

console.log("\nDistribuições com delta:");
for (const [name, rows] of Object.entries(mtActive.distributions)) {
  const diffs = rows.filter((r) => r.delta !== 0);
  if (!diffs.length) continue;
  console.log(`  ${name}:`, diffs.slice(0, 5).map((d) => `${d.bucket}(${d.v1}→${d.v2})`).join(", "));
}

const divergent =
  general.byMonth.some((r) => r.v1 !== r.v2) ||
  mtActive.meetingSets.onlyV1 + mtActive.meetingSets.onlyV2 > 0;
process.exit(divergent ? 1 : 0);
