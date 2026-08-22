#!/usr/bin/env node
/**
 * Comparação live V1 × V2 — página Reuniões (sem cache, force compute).
 *
 * Uso:
 *   node scripts/compare-v1-v2-meetings.mjs
 *   node scripts/compare-v1-v2-meetings.mjs --preset=comparable_30d_active
 *   node scripts/compare-v1-v2-meetings.mjs --preset=all_history_active --preset=v2_ui_default
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MEETINGS_FILTER_PRESETS,
  compareMeetingsPayloads,
  diagnoseClientMeetingDiff,
} from "../lib/analytics/meetings-fidelity.mjs";

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

function parseArgs(argv) {
  const presets = [];
  let sample = 8;
  for (const arg of argv) {
    if (arg.startsWith("--preset=")) presets.push(arg.slice("--preset=".length));
    else if (arg.startsWith("--sample=")) sample = Number(arg.slice("--sample=".length)) || 8;
  }
  return {
    presets: presets.length ? presets : ["comparable_30d_active", "all_history_active", "v2_ui_default"],
    sample,
  };
}

async function loadV1Meetings() {
  const mod = await import(pathToFileURL(join(V1_ROOT, "meetings.mjs")).href);
  return mod.computeMeetingsPayload({ includeMeetingTypes: true });
}

async function loadV2Meetings() {
  const mod = await import(pathToFileURL(join(ROOT, "lib/analytics/meetings.mjs")).href);
  return mod.computeMeetingsPayload({ includeMeetingTypes: true });
}

function printTable(report) {
  console.log(`\n=== ${report.presetLabel} (${report.preset}) ===`);
  console.log("Filtros auditados:", JSON.stringify(report.filtersAudit || report.filters, null, 0));
  console.log("Métrica | V1 | V2 | Delta | Status | Causa");
  for (const row of report.metrics) {
    console.log(
      [
        row.metric,
        row.v1 ?? "—",
        row.v2 ?? "—",
        row.delta ?? "—",
        row.status,
        row.cause,
      ].join(" | "),
    );
  }
  console.log(
    `Assertions: coverage=${report.assertions.coverageIdentity ? "OK" : "FAIL"} neverMet=${report.assertions.neverMetIdentity ? "OK" : "FAIL"}`,
  );
  console.log(
    `Sets clientes c/ reunião: v1=${report.sets.clientsWithMeeting.v1Count} v2=${report.sets.clientsWithMeeting.v2Count} intersection=${report.sets.clientsWithMeeting.intersection} only_v1=${report.sets.clientsWithMeeting.onlyV1} only_v2=${report.sets.clientsWithMeeting.onlyV2}`,
  );
  console.log(
    `Sets primeira reunião: v1=${report.sets.firstMeeting.v1Count} v2=${report.sets.firstMeeting.v2Count} intersection=${report.sets.firstMeeting.intersection} only_v1=${report.sets.firstMeeting.onlyV1} only_v2=${report.sets.firstMeeting.onlyV2}`,
  );
  console.log(
    `Sets meetings: v1=${report.sets.meetings?.v1Count ?? "—"} v2=${report.sets.meetings?.v2Count ?? "—"} intersection=${report.sets.meetings?.intersection ?? "—"} only_v1=${report.sets.meetings?.onlyV1 ?? "—"} only_v2=${report.sets.meetings?.onlyV2 ?? "—"}`,
  );
  if (report.sets.meetingDiffCauses) {
    console.log("Causas only_v1:", report.sets.meetingDiffCauses.onlyV1);
    console.log("Causas only_v2:", report.sets.meetingDiffCauses.onlyV2);
  }
}

function sampleDiff(report, v1Clients, v2Clients, sample) {
  const byIdV1 = new Map((v1Clients || []).map((c) => [String(c.clientId), c]));
  const byIdV2 = new Map((v2Clients || []).map((c) => [String(c.clientId), c]));
  const onlyV1 = report.sets.clientsWithMeeting.onlyV1Ids.slice(0, sample);
  const onlyV2 = report.sets.clientsWithMeeting.onlyV2Ids.slice(0, sample);
  if (!onlyV1.length && !onlyV2.length) return;
  console.log("\nAmostra divergência clientes com reunião (sem PII):");
  for (const id of onlyV1) {
    console.log(`  only_v1 ${id}: ${diagnoseClientMeetingDiff(byIdV1.get(id), byIdV2.get(id))}`);
  }
  for (const id of onlyV2) {
    console.log(`  only_v2 ${id}: ${diagnoseClientMeetingDiff(byIdV1.get(id), byIdV2.get(id))}`);
  }
}

const { presets, sample } = parseArgs(process.argv.slice(2));
console.log("Carregando payloads live (BASE QV read-only, force=1)…");
const t0 = Date.now();
let v1Payload = null;
let v2Payload = null;
let v1Error = null;
let v2Error = null;
try {
  v1Payload = await loadV1Meetings();
} catch (error) {
  v1Error = error instanceof Error ? error.message : String(error);
}
try {
  v2Payload = await loadV2Meetings();
} catch (error) {
  v2Error = error instanceof Error ? error.message : String(error);
}
console.log(`Compute em ${Math.round((Date.now() - t0) / 1000)}s`);
if (v1Error || v2Error) {
  console.error(JSON.stringify({ v1Error, v2Error }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      unfilteredClients: { v1: v1Payload.clients?.length ?? 0, v2: v2Payload.clients?.length ?? 0 },
      defaults: {
        v1_html_period: "all (Todo o histórico)",
        v1_html_status: "all (Todos)",
        v2_ui_period: MEETINGS_FILTER_PRESETS.v2_ui_default.filters.period,
        v2_ui_status: MEETINGS_FILTER_PRESETS.v2_ui_default.filters.status,
      },
    },
    null,
    2,
  ),
);

const reports = [];
for (const preset of presets) {
  if (!MEETINGS_FILTER_PRESETS[preset]) {
    console.error(`Preset desconhecido: ${preset}`);
    continue;
  }
  const report = compareMeetingsPayloads(v1Payload, v2Payload, preset);
  reports.push(report);
  printTable(report);
  if (preset === "comparable_30d_active") {
    sampleDiff(report, v1Payload.clients, v2Payload.clients, sample);
  }
}

const divergent = reports.flatMap((r) => r.metrics.filter((m) => m.status !== "OK"));
console.log(`\nResumo: ${reports.length} recortes · ${divergent.length} métricas divergentes`);
process.exit(divergent.length ? 1 : 0);
