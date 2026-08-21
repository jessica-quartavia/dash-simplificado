#!/usr/bin/env node
/**
 * Diagnóstico completo: clientes divergentes em onboarding completion.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuditEnv, computePagePair } from "../lib/analytics/fidelity-audit.mjs";
import { compareSets } from "../lib/analytics/fidelity-populations.mjs";
import { fetchAllRows } from "../lib/data/supabase-rest.mjs";
import { excludedClientIds, filterExcludedClients } from "../lib/analytics/data-exclusions.mjs";
import {
  buildClientFirstMeetingMap,
} from "../lib/analytics/first-meeting-index.mjs";
import {
  classifyMeetingDate,
  isCompletedPast,
  normalizeAttendanceStatus,
  parseDate,
} from "../lib/analytics/meeting-metrics.mjs";
import {
  classifyOnboardingCompletion,
  OPEN_ONBOARDING_STAGE_IDS,
} from "../lib/analytics/onboarding-completion.mjs";
import { loadAirtableFirstMeetingIndex } from "../lib/analytics/first-meeting-fallback.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function nonNegativeDays(start, end) {
  if (!start || !end) return null;
  const days = Math.floor(
    (Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
      - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
    / 86400000,
  );
  return days >= 0 ? days : null;
}

function v1StyleFirstMeeting(meetings, contractDate) {
  const dates = (meetings || [])
    .map((row) => parseDate(row.start_time || row.started_at))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const min = dates[0] || null;
  return {
    minStart: min ? min.toISOString() : null,
    daysToFirstMeeting: nonNegativeDays(contractDate, min),
  };
}

function meetingFlags(meetings, contractDate, attendanceByUri, now) {
  const flags = {
    count: meetings.length,
    hasFuture: false,
    hasPreEntry: false,
    hasNoShow: false,
    hasCompareceu: false,
    hasUnknownAttendance: false,
    hasCancelled: false,
  };
  for (const row of meetings) {
    const start = parseDate(row.start_time);
    const uri = row.calendly_event_uri;
    const att = attendanceByUri.get(uri) || {};
    const status = normalizeAttendanceStatus(att.status || row.status);
    const dateStatus = classifyMeetingDate(start, contractDate, now);
    if (dateStatus === "future") flags.hasFuture = true;
    if (dateStatus === "before_client_entry") flags.hasPreEntry = true;
    if (status === "compareceu") flags.hasCompareceu = true;
    if (status === "nao_compareceu") flags.hasNoShow = true;
    if (status === "cancelada") flags.hasCancelled = true;
    if (status === "desconhecido") flags.hasUnknownAttendance = true;
  }
  return flags;
}

function classifyRow({ bucket, v1Row, v2Row, v1Style, v2First, flags }) {
  const v1Reasons = [];
  const v2Reasons = [];
  if (v1Row?.completedByJourney === true) v1Reasons.push("journey");
  if (v1Row?.daysToFirstMeeting != null) v1Reasons.push("first_meeting");
  if (v1Row?.hasFinancialData) v1Reasons.push("financial");
  if (v2Row?.completedByJourney === true) v2Reasons.push("journey");
  if (v2Row?.daysToFirstMeeting != null) v2Reasons.push("first_meeting");
  if (v2Row?.hasFinancialData) v2Reasons.push("financial");

  if (bucket === "only_v1") {
    if (v1Style.daysToFirstMeeting != null && v2Row?.daysToFirstMeeting == null) {
      if (flags.hasCompareceu && v2First?.firstMeetingCompleted) return "IMPLEMENTATION_BUG:attendance_present_v2_miss";
      if (!flags.hasCompareceu && v1Style.daysToFirstMeeting != null) {
        if (flags.hasNoShow) return "EXPECTED_DIFFERENCE:v1_minDate_no_show";
        if (flags.hasUnknownAttendance) return "EXPECTED_DIFFERENCE:v1_minDate_no_attendance";
        if (flags.hasFuture && !flags.hasCompareceu) return "EXPECTED_DIFFERENCE:v1_minDate_future";
      }
      if (v1Row?.firstMeetingSource === "airtable" && v2First?.firstMeetingSource !== "airtable") {
        return "IMPLEMENTATION_BUG:airtable_fallback";
      }
    }
    if (v1Row?.completedByJourney && !v2Row?.completedByJourney) return "IMPLEMENTATION_BUG:journey_stage";
    if (v1Row?.hasFinancialData && !v2Row?.hasFinancialData) return "IMPLEMENTATION_BUG:financial";
    return "UNKNOWN:only_v1";
  }

  if (v2First?.firstMeetingCompleted && v1Style.daysToFirstMeeting == null) {
    if (flags.hasCompareceu) return "INTENTIONAL_V2_METHOD_CHANGE:attendance_required";
  }
  if (v2Row?.completedByJourney && v1Row?.completedByJourney !== true) return "IMPLEMENTATION_BUG:journey_v2_only";
  return "UNKNOWN:only_v2";
}

async function main() {
  loadAuditEnv();
  const now = new Date();
  const pair = await computePagePair("journey");
  const v1Set = new Set(pair.v1.clients.filter((r) => r.completedOnboarding === true).map((r) => String(r.clientId)));
  const v2Set = new Set(pair.v2.clients.filter((r) => r.completedOnboarding === true).map((r) => String(r.clientId)));
  const diff = compareSets(v1Set, v2Set);
  const v1ById = new Map(pair.v1.clients.map((r) => [String(r.clientId), r]));
  const v2ById = new Map(pair.v2.clients.map((r) => [String(r.clientId), r]));
  const targetIds = [...diff.only_v1, ...diff.only_v2];

  const [clientsRaw, calendly, manual, attendance, journeys, financial, mechanisms, airtableIndex] = await Promise.all([
    fetchAllRows({ table: "clients", select: "id,codigo,name,status,data_inicio_ciclo,created_at" }),
    fetchAllRows({ table: "client_meetings", select: "id,client_id,calendly_event_uri,event_name,start_time" }),
    fetchAllRows({ table: "manual_meetings", select: "id,client_id,title,start_time,google_event_id" }),
    fetchAllRows({ table: "meeting_attendance", select: "calendly_event_uri,status,remarcado,updated_at,created_at" }),
    fetchAllRows({ table: "client_journeys", select: "id,client_id,current_stage_id,started_at,created_at" }),
    fetchAllRows({ table: "client_financial_data", select: "id,client_id,created_at" }),
    fetchAllRows({ table: "client_mecanismos", select: "id,client_id,status,implemented_at,created_at" }),
    loadAirtableFirstMeetingIndex().catch(() => ({ available: false })),
  ]);
  const removed = excludedClientIds(clientsRaw);
  const clients = filterExcludedClients(clientsRaw);
  const firstMap = buildClientFirstMeetingMap({
    clients,
    calendlyRows: calendly.filter((r) => !removed.has(String(r.client_id))),
    manualRows: manual.filter((r) => !removed.has(String(r.client_id))),
    attendanceRows: attendance,
    implRows: [],
    airtableIndex,
    now,
  });

  const attendanceByUri = new Map();
  for (const row of attendance) {
    const uri = row.calendly_event_uri;
    if (!uri) continue;
    attendanceByUri.set(uri, row);
  }

  const calendlyByClient = new Map();
  for (const row of calendly) {
    const id = String(row.client_id || "");
    if (!id) continue;
    if (!calendlyByClient.has(id)) calendlyByClient.set(id, []);
    calendlyByClient.get(id).push(row);
  }

  const journeysByClient = new Map();
  for (const row of journeys) {
    const id = String(row.client_id || "");
    if (!id) continue;
    if (!journeysByClient.has(id)) journeysByClient.set(id, []);
    journeysByClient.get(id).push(row);
  }

  const rows = [];
  for (const clientId of targetIds) {
    const v1Row = v1ById.get(clientId);
    const v2Row = v2ById.get(clientId);
    const client = clients.find((c) => String(c.id) === clientId);
    const contractDate = parseDate(client?.data_inicio_ciclo || client?.created_at || v2Row?.contractDate);
    const meetings = calendlyByClient.get(clientId) || [];
    const v1Style = v1StyleFirstMeeting(meetings, contractDate);
    const v2First = firstMap.get(clientId) || {};
    const flags = meetingFlags(meetings, contractDate, attendanceByUri, now);
    const latestJourney = [...(journeysByClient.get(clientId) || [])]
      .map((j) => ({ j, d: parseDate(j.started_at || j.created_at) }))
      .filter((x) => x.d)
      .sort((a, b) => b.d - a.d)[0]?.j;
    const stageId = latestJourney ? String(latestJourney.current_stage_id || "") : null;

    rows.push({
      client_id: clientId,
      bucket: diff.only_v1.includes(clientId) ? "only_v1" : "only_v2",
      current_stage_id: stageId,
      stage_is_open: stageId ? OPEN_ONBOARDING_STAGE_IDS.has(stageId) : null,
      contract_date: contractDate ? contractDate.toISOString() : null,
      meetings_available: meetings.length,
      ...flags,
      v1_min_start: v1Style.minStart,
      v1_days_to_first_meeting: v1Style.daysToFirstMeeting,
      v2_first_meeting_date: v2First.firstMeetingDate || v2Row?.firstMeetingDate || null,
      v2_first_meeting_source: v2First.firstMeetingSource || null,
      v2_days_to_first_meeting: v2Row?.daysToFirstMeeting ?? null,
      v2_first_meeting_status: v2First.firstMeetingStatus || null,
      has_financial_v1: v1Row?.hasFinancialData ?? null,
      has_financial_v2: v2Row?.hasFinancialData ?? null,
      v1_result: v1Row?.completedOnboarding ?? null,
      v2_result: v2Row?.completedOnboarding ?? null,
      v1_completion_source: v1Row?.completedOnboardingSource || null,
      v2_completion_source: v2Row?.completedOnboardingSource || null,
      classification: classifyRow({
        bucket: diff.only_v1.includes(clientId) ? "only_v1" : "only_v2",
        v1Row,
        v2Row,
        v1Style,
        v2First,
        flags,
      }),
    });
  }

  const byClass = {};
  for (const row of rows) {
    const root = row.classification.split(":")[0];
    byClass[root] = (byClass[root] || 0) + 1;
    byClass[row.classification] = (byClass[row.classification] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      v1_completed: v1Set.size,
      v2_completed: v2Set.size,
      only_v1: diff.only_v1_count,
      only_v2: diff.only_v2_count,
      net_delta: v2Set.size - v1Set.size,
    },
    v1_rule: {
      tables: ["client_meetings", "client_journeys", "client_financial_data", "airtable bkp_reunioes"],
      firstMeeting: "min(start_time) em client_meetings; completion final exige daysToFirstMeeting != null (nonNegativeDays)",
      attendance: "não exigida",
      manual_meetings: false,
      airtable_fallback: true,
    },
    v2_rule: {
      tables: ["client_meetings", "manual_meetings", "meeting_attendance", "impl_date", "airtable"],
      firstMeeting: "resolveClientFirstMeeting — compareceu + após entrada + não futura",
      attendance: "obrigatória (compareceu)",
      airtable_fallback: Boolean(airtableIndex?.available),
    },
    classification_summary: byClass,
    rows,
  };

  const out = join(ROOT, "docs/journey-divergence-diagnosis.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log("Top classifications:");
  for (const [k, v] of Object.entries(byClass).filter(([k]) => k.includes(":")).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log("Written:", out);
}

main().catch((e) => { console.error(e); process.exit(1); });
