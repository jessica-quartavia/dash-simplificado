#!/usr/bin/env node
/**
 * Auditoria live do KPI Total de Reuniões (regra oficial BASE QV).
 *
 * Uso:
 *   node scripts/audit-meetings-total.mjs
 *   node scripts/audit-meetings-total.mjs --status=active
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultMeetingFilters, applyMeetingFilters } from "../lib/analytics/meeting-filters.mjs";
import { isAnalyticMeeting } from "../lib/analytics/meeting-metrics.mjs";
import {
  aggregateTotalMeetingBreakdown,
  buildCurrentV2TotalMeetingSet,
  buildExpectedTotalMeetingSet,
  compareTotalMeetingSets,
  countTotalMeetingsForClient,
  meetingStartCorrespondenceKey,
} from "../lib/analytics/meeting-total-count.mjs";
import { parseDate } from "../lib/analytics/meeting-metrics.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
  let status = "active";
  for (const arg of argv) {
    if (arg.startsWith("--status=")) status = arg.slice("--status=".length);
  }
  return { status };
}

function resolveClientEntry(client) {
  const cycle = parseDate(client.data_inicio_ciclo);
  const created = parseDate(client.created_at);
  if (cycle) return cycle;
  if (created) return created;
  return null;
}

function legacyDedupedTotal(rows) {
  const meetings = rows.flatMap((c) => (c.meetings || []).filter(isAnalyticMeeting));
  const uniqueIds = new Set();
  let total = 0;
  for (const m of meetings) {
    const key = m.meetingId || `${m.source}|${m.startTime}|${m.title || ""}`;
    if (uniqueIds.has(key)) continue;
    uniqueIds.add(key);
    total += 1;
  }
  return total;
}

function legacyFlatTotal(rows) {
  return rows.flatMap((c) => (c.meetings || []).filter(isAnalyticMeeting)).length;
}

function legacyTotalFromClientRows(rows) {
  return rows.reduce((sum, client) => {
    const n = (client.meetings || []).filter(
      (m) => m.meetingDateStatus !== "before_client_entry" && m.meetingDateStatus !== "invalid",
    ).length;
    return sum + n;
  }, 0);
}

function countManualDuplicatesInConsolidated(rows, calendlyRows) {
  const calendlyKeys = new Set(
    calendlyRows
      .map((row) => meetingStartCorrespondenceKey(row.client_id, row.start_time))
      .filter(Boolean),
  );
  let manualDuplicateIncluded = 0;
  let rawClientMeetingsMissingFromConsolidated = 0;
  for (const client of rows) {
    for (const meeting of client.meetings || []) {
      if (meeting.meetingDateStatus === "before_client_entry" || meeting.meetingDateStatus === "invalid") continue;
      if (meeting.source !== "manual") continue;
      const key = meetingStartCorrespondenceKey(client.clientId, meeting.startTime);
      if (key && calendlyKeys.has(key)) manualDuplicateIncluded += 1;
    }
  }
  for (const row of calendlyRows) {
    const key = meetingStartCorrespondenceKey(row.client_id, row.start_time);
    if (!key) continue;
    const found = rows.some((client) =>
      (client.meetings || []).some(
        (m) =>
          m.source === "calendly" &&
          meetingStartCorrespondenceKey(client.clientId, m.startTime) === key,
      ),
    );
    if (!found) rawClientMeetingsMissingFromConsolidated += 1;
  }
  return { manualDuplicateIncluded, rawClientMeetingsMissingFromConsolidated };
}

const { status } = parseArgs(process.argv.slice(2));
console.log(`Auditoria Total de Reuniões · status=${status} · force=1`);

const meetingsMod = await import(pathToFileURL(join(ROOT, "lib/analytics/meetings.mjs")).href);
const payload = await meetingsMod.computeMeetingsPayload({ includeMeetingTypes: false, force: true });

const calendlyRows = payload._auditSources?.calendlyRows || [];
const manualRows = payload._auditSources?.manualRows || [];

const filters = { ...defaultMeetingFilters(), status };
const filteredClients = applyMeetingFilters(payload.clients || [], filters);

const breakdownParts = [];
let naiveNoCrossDedup = 0;
for (const client of filteredClients) {
  const part = countTotalMeetingsForClient({
    clientId: client.clientId,
    calendlyRows,
    manualRows,
    entryDate: parseDate(client.entryDate),
  });
  breakdownParts.push(part);
  naiveNoCrossDedup += part.clientMeetingsValid + part.manualMeetingsValid;
}
const breakdown = aggregateTotalMeetingBreakdown(breakdownParts);
const summaryTotal = filteredClients.reduce((sum, c) => sum + (Number(c.totalMeetings) || 0), 0);

const expected = buildExpectedTotalMeetingSet({
  clients: filteredClients.map((c) => ({ id: c.clientId, entryDate: c.entryDate })),
  calendlyRows,
  manualRows,
  clientFilter: () => true,
});
const current = buildCurrentV2TotalMeetingSet(filteredClients);
const diff = compareTotalMeetingSets(expected.keys, current.keys, current.records, {
  calendlyRows,
  manualRows,
});

console.log("\n### REGRA OFICIAL (live)");
console.log(`client_meetings_valid: ${breakdown.clientMeetingsValid}`);
console.log(`manual_meetings_valid: ${breakdown.manualMeetingsValid}`);
console.log(`manual_duplicates: ${breakdown.manualDuplicates}`);
console.log(`manual_exclusive: ${breakdown.manualExclusive}`);
console.log(`total: ${breakdown.total}`);
console.log(`sum(client.totalMeetings): ${summaryTotal}`);
console.log(`naive_sem_dedup_entre_fontes (client+manual valid): ${naiveNoCrossDedup}`);
console.log(`inflacao_por_manual_duplicada: ${naiveNoCrossDedup - breakdown.total}`);

console.log("\n### LEGADO V2 (antes da regra — meetings[] por cliente)");
console.log(`legacy_per_client_sum: ${legacyTotalFromClientRows(filteredClients)}`);
console.log(`legacy_flatMap_sem_dedup: ${legacyFlatTotal(filteredClients)}`);
console.log(`legacy_summarize_dedup: ${legacyDedupedTotal(filteredClients)}`);
console.log(`delta_per_client_vs_oficial: ${legacyTotalFromClientRows(filteredClients) - breakdown.total}`);

const dupDiag = countManualDuplicatesInConsolidated(filteredClients, calendlyRows);
console.log("\n### DIAGNÓSTICO INCLUSÕES INDEVIDAS (legado consolidado)");
console.log(`manual_duplicada_incluida_indevidamente: ${dupDiag.manualDuplicateIncluded}`);
console.log(`client_meetings_raw_ausentes_no_consolidado: ${dupDiag.rawClientMeetingsMissingFromConsolidated}`);
console.log(
  `excesso_estimado_vs_oficial (per_client - oficial + manual_dup): ${
    legacyTotalFromClientRows(filteredClients) - breakdown.total + dupDiag.manualDuplicateIncluded
  }`,
);

console.log("\n### SET DIFF (oficial × meetings consolidados)");
console.log(
  `expected=${diff.expectedCount} current=${diff.currentCount} intersection=${diff.intersection} onlyExpected=${diff.onlyExpected} onlyCurrent=${diff.onlyCurrent}`,
);
console.log("onlyCurrent by cause:", diff.onlyCurrentByCause);

if (payload.summary?.totalMeetingsBreakdown) {
  console.log("\n### PAYLOAD SUMMARY (unfiltered portfolio)");
  console.log(JSON.stringify(payload.summary.totalMeetingsBreakdown));
}
