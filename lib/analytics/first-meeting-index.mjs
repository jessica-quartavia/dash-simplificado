/**
 * Índice de primeira reunião para Jornada — reutiliza resolveClientFirstMeeting.
 * Não redefine a regra de Reuniões. Sem HTTP.
 */
import {
  blankToNull,
  classifyMeetingDate,
  daysBetween,
  normalizeAttendanceStatus,
  parseDate,
  resolveClientFirstMeeting,
  toBool,
} from "./meeting-metrics.mjs";
import { applyFirstMeetingFallbackToClientRows } from "./first-meeting-fallback.mjs";

function startBucket(date) {
  if (!date) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function normalizeTitle(value) {
  return String(blankToNull(value) || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compositeKey(clientId, start, title) {
  return `${clientId || ""}|${startBucket(start)}|${normalizeTitle(title)}`;
}

function buildAttendanceMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const uri = blankToNull(row.calendly_event_uri);
    if (!uri) continue;
    const updated = parseDate(row.updated_at) || parseDate(row.created_at) || new Date(0);
    const current = map.get(uri);
    if (!current || updated > current.updated) {
      map.set(uri, {
        updated,
        status: normalizeAttendanceStatus(row.status),
        rescheduled: toBool(row.remarcado) === true,
      });
    }
  }
  return map;
}

function consolidateMeetings(calendlyRows, manualRows, attendanceMap) {
  const meetings = [];
  const seenUris = new Set();
  const seenGoogle = new Set();
  const seenComposite = new Set();

  for (const row of calendlyRows || []) {
    const start = parseDate(row.start_time);
    const clientId = blankToNull(row.client_id);
    const uri = blankToNull(row.calendly_event_uri);
    const title = blankToNull(row.event_name) || "Reunião";
    const dedupeUri = uri || `cm:${row.id}`;
    if (seenUris.has(dedupeUri)) continue;
    seenUris.add(dedupeUri);
    if (uri) seenUris.add(uri);
    const comp = compositeKey(clientId, start, title);
    if (comp) seenComposite.add(comp);
    const attendance = uri ? attendanceMap.get(uri) : null;
    meetings.push({
      clientId: clientId ? String(clientId) : null,
      title,
      startTime: start ? start.toISOString() : null,
      attendanceStatus: attendance?.status || "desconhecido",
    });
  }

  for (const row of manualRows || []) {
    const start = parseDate(row.start_time);
    const clientId = blankToNull(row.client_id);
    const title = blankToNull(row.title) || "Reunião manual";
    const manualUri = `manual:${row.id}`;
    const googleId = blankToNull(row.google_event_id);
    const comp = compositeKey(clientId, start, title);
    if (seenUris.has(manualUri) || (googleId && seenGoogle.has(googleId)) || (comp && seenComposite.has(comp))) {
      continue;
    }
    seenUris.add(manualUri);
    if (googleId) seenGoogle.add(googleId);
    if (comp) seenComposite.add(comp);
    const attendance = attendanceMap.get(manualUri) || null;
    meetings.push({
      clientId: clientId ? String(clientId) : null,
      title,
      startTime: start ? start.toISOString() : null,
      attendanceStatus: attendance?.status || "desconhecido",
    });
  }

  return meetings;
}

function resolveEntryDate(client) {
  const cycle = parseDate(client?.data_inicio_ciclo);
  if (cycle) return cycle;
  return parseDate(client?.created_at);
}

/**
 * @returns {Map<string, { firstMeetingDate: string|null, daysFromEntryToFirstMeeting: number|null, firstMeetingCompleted: boolean, firstMeetingSource: string|null, firstMeetingStatus: string }>}
 */
export function buildClientFirstMeetingMap({
  clients,
  calendlyRows,
  manualRows,
  attendanceRows,
  implRows,
  airtableIndex = null,
  now = new Date(),
} = {}) {
  const attendanceMap = buildAttendanceMap(attendanceRows);
  const meetings = consolidateMeetings(calendlyRows, manualRows, attendanceMap);
  const byClient = new Map();
  for (const meeting of meetings) {
    if (!meeting.clientId) continue;
    if (!byClient.has(meeting.clientId)) byClient.set(meeting.clientId, []);
    byClient.get(meeting.clientId).push(meeting);
  }

  const implByClient = new Map();
  for (const row of implRows || []) {
    const clientId = blankToNull(row.client_id);
    const meetingDate = parseDate(row.meeting_date);
    if (!clientId || !meetingDate) continue;
    const current = implByClient.get(String(clientId));
    if (!current || meetingDate < current) implByClient.set(String(clientId), meetingDate);
  }

  const rows = [];
  for (const client of clients || []) {
    const clientId = String(client.id);
    const entryDate = resolveEntryDate(client);
    const rawMeetings = (byClient.get(clientId) || [])
      .slice()
      .sort((a, b) => (parseDate(a.startTime)?.getTime() || 0) - (parseDate(b.startTime)?.getTime() || 0));
    const annotatedMeetings = rawMeetings.map((meeting) => ({
      ...meeting,
      meetingDateStatus: classifyMeetingDate(parseDate(meeting.startTime), entryDate, now),
    }));
    const first = resolveClientFirstMeeting({
      annotatedMeetings,
      entryDate,
      implDate: implByClient.get(clientId) || null,
      now,
    });
    rows.push({
      clientId,
      clientName: blankToNull(client.name) || "Não informado",
      firstMeetingDate: first.firstMeetingDate,
      firstMeetingCompleted: first.firstMeetingCompleted,
      firstMeetingStatus: first.firstMeetingStatus,
      daysFromEntryToFirstMeeting: first.daysFromEntryToFirstMeeting,
      firstMeetingSource: first.firstMeetingCompleted ? "base_qv" : null,
    });
  }

  if (airtableIndex) {
    applyFirstMeetingFallbackToClientRows(rows, clients, airtableIndex);
    for (const row of rows) {
      if (row.firstMeetingSource !== "airtable" || !row.firstMeetingDate) continue;
      const client = (clients || []).find((item) => String(item.id) === row.clientId);
      const entryDate = resolveEntryDate(client || {});
      const meetingDate = parseDate(row.firstMeetingDate);
      if (entryDate && meetingDate) {
        const days = daysBetween(entryDate, meetingDate);
        row.daysFromEntryToFirstMeeting = days >= 0 ? days : null;
      }
    }
  }

  return new Map(rows.map((row) => [row.clientId, row]));
}
