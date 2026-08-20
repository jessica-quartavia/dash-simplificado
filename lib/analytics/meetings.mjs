/**
 * Payload de Reuniões — BASE QV (reuniões/clientes) + Calendly (tipos).
 * Somente leitura. Sem Netlify.
 */
import { dataConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  ANALYTICAL_CANCEL_FIELDS,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatusFromMaps,
} from "./analytical-cancellation.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import {
  applyFirstMeetingFallbackToClientRows,
  loadAirtableFirstMeetingIndex,
} from "./first-meeting-fallback.mjs";
import { normalizeMeetingEventType } from "./meeting-event-type.mjs";
import { loadMeetingTypesFromCalendly } from "./meeting-types-calendly.mjs";
import {
  average,
  blankToNull,
  buildNoShowFrequency,
  classifyMeetingDate,
  daysBetween,
  daysSinceBand,
  distributionFrom,
  freqBand,
  FREQ_BANDS,
  DAYS_SINCE_BANDS,
  INTERVAL_BANDS,
  intervalBand,
  isAnalyticMeeting,
  isCompletedPast,
  isConfirmedNoShow,
  isFutureMeeting,
  isPastMeeting,
  monthsBetween,
  normalizeAttendanceStatus,
  parseDate,
  percentile,
  resolveClientFirstMeeting,
  robustStats,
  toBool,
} from "./meeting-metrics.mjs";

const CLIENT_SELECT =
  "id,codigo,name,status,engenheiro_patrimonial,programa,data_inicio_ciclo,created_at,cpf,cpf_digits,email,phone,phone_digits,data_churn";
const CALENDLY_SELECT =
  "id,client_id,calendly_event_uri,event_name,start_time,end_time,host_email,manually_linked";
const MANUAL_SELECT =
  "id,client_id,title,start_time,end_time,google_event_id,recurrence_group_id";
const ATTENDANCE_SELECT =
  "calendly_event_uri,status,remarcado,link_gravacao,created_at,updated_at";
const IMPL_SELECT = "client_id,meeting_date,source";

const USED_FIELDS = [
  { table: "clients", column: "id", role: "clientId" },
  { table: "clients", column: "codigo", role: "clientCode" },
  { table: "clients", column: "name", role: "clientName" },
  { table: "clients", column: "status", role: "clientStatus" },
  { table: "clients", column: "engenheiro_patrimonial", role: "engineer" },
  { table: "clients", column: "data_inicio_ciclo", role: "entryDateCycleStart" },
  { table: "clients", column: "created_at", role: "entryDateFallback" },
  ...ANALYTICAL_CANCEL_FIELDS,
  { table: "client_meetings", column: "id", role: "meetingId" },
  { table: "client_meetings", column: "client_id", role: "meetingClient" },
  { table: "client_meetings", column: "calendly_event_uri", role: "externalUri" },
  { table: "client_meetings", column: "event_name", role: "title" },
  { table: "client_meetings", column: "start_time", role: "startTime" },
  { table: "meeting_attendance", column: "status", role: "attendanceStatus" },
  { table: "meeting_attendance", column: "remarcado", role: "rescheduled" },
  { table: "client_implementation_meeting_date", column: "meeting_date", role: "implDate" },
];

function labelOrUnknown(value) {
  return blankToNull(value) ?? "Não informado";
}

function normalizeTitle(value) {
  return String(blankToNull(value) || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function startBucket(date) {
  if (!date) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function compositeKey(clientId, start, title) {
  return `${clientId || ""}|${startBucket(start)}|${normalizeTitle(title)}`;
}

function resolveClientEntry(client) {
  const cycle = parseDate(client.data_inicio_ciclo);
  const created = parseDate(client.created_at);
  if (cycle) return { date: cycle, source: "cycle_start" };
  if (created) return { date: created, source: "created_at_fallback" };
  return { date: null, source: "unavailable" };
}

function buildAttendanceMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const uri = blankToNull(row.calendly_event_uri);
    if (!uri) continue;
    const updated = parseDate(row.updated_at) || parseDate(row.created_at) || new Date(0);
    const current = map.get(uri);
    if (!current || updated > current.updated) {
      map.set(uri, {
        updated,
        status: normalizeAttendanceStatus(row.status),
        rawStatus: blankToNull(row.status),
        rescheduled: toBool(row.remarcado) === true,
        recordingUrl: blankToNull(row.link_gravacao),
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
  const warnings = [];
  let duplicateSkips = 0;

  for (const row of calendlyRows) {
    const start = parseDate(row.start_time);
    const end = parseDate(row.end_time);
    const clientId = blankToNull(row.client_id);
    const uri = blankToNull(row.calendly_event_uri);
    const title = blankToNull(row.event_name) || "Reunião";
    if (!clientId) warnings.push("Reunião Calendly sem client_id");
    if (!start) warnings.push("Reunião Calendly sem start_time");
    const dedupeUri = uri || `cm:${row.id}`;
    if (seenUris.has(dedupeUri)) {
      duplicateSkips += 1;
      continue;
    }
    seenUris.add(dedupeUri);
    if (uri) seenUris.add(uri);
    const comp = compositeKey(clientId, start, title);
    if (comp) seenComposite.add(comp);
    const attendance = uri ? attendanceMap.get(uri) : null;
    meetings.push({
      meetingId: String(row.id),
      clientId: clientId ? String(clientId) : null,
      source: "calendly",
      title,
      startTime: start ? start.toISOString() : null,
      endTime: end ? end.toISOString() : null,
      attendanceStatus: attendance?.status || "desconhecido",
      rescheduled: attendance?.rescheduled === true,
      hostEmail: blankToNull(row.host_email),
      recordingUrl: attendance?.recordingUrl || null,
      externalUri: uri,
      manuallyLinked: Boolean(row.manually_linked),
    });
  }

  for (const row of manualRows) {
    const start = parseDate(row.start_time);
    const end = parseDate(row.end_time);
    const clientId = blankToNull(row.client_id);
    const title = blankToNull(row.title) || "Reunião manual";
    const manualUri = `manual:${row.id}`;
    const googleId = blankToNull(row.google_event_id);
    const comp = compositeKey(clientId, start, title);
    if (seenUris.has(manualUri) || (googleId && seenGoogle.has(googleId)) || (comp && seenComposite.has(comp))) {
      duplicateSkips += 1;
      continue;
    }
    seenUris.add(manualUri);
    if (googleId) seenGoogle.add(googleId);
    if (comp) seenComposite.add(comp);
    const attendance = attendanceMap.get(manualUri) || null;
    meetings.push({
      meetingId: `manual:${row.id}`,
      clientId: clientId ? String(clientId) : null,
      source: "manual",
      title,
      startTime: start ? start.toISOString() : null,
      endTime: end ? end.toISOString() : null,
      attendanceStatus: attendance?.status || "desconhecido",
      rescheduled: attendance?.rescheduled === true,
      hostEmail: null,
      recordingUrl: attendance?.recordingUrl || null,
      externalUri: manualUri,
      manuallyLinked: false,
    });
  }

  return { meetings, duplicateSkips, warnings };
}

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

function sanitizeClientRow(row) {
  const {
    matchCandidates,
    firstMeetingMatchKey,
    ...safe
  } = row;
  return safe;
}

export function buildMeetingsPayload({
  clients,
  calendlyRows,
  manualRows,
  attendanceRows,
  implRows,
  cancellations = [],
  airtableIndex = null,
  meetingTypes = null,
  now = new Date(),
} = {}) {
  const qualityWarnings = [
    "crm_meetings excluído da consolidação (somente lead_id, sem vínculo confiável com clients.id).",
    "Status observados em meeting_attendance.status: compareceu, nao_compareceu, pendente, remarcado. Nenhuma categoria de cancelamento encontrada; cancelamentos não entram na taxa de comparecimento.",
    "Os dados estruturados de remarcações possuem cobertura parcial.",
  ];
  const attendanceMap = buildAttendanceMap(attendanceRows || []);
  const { meetings, duplicateSkips } = consolidateMeetings(calendlyRows || [], manualRows || [], attendanceMap);
  if (duplicateSkips) qualityWarnings.push(`${duplicateSkips} reuniões potencialmente duplicadas foram deduplicadas.`);
  const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations, clients);

  const meetingUris = new Set(meetings.map((m) => m.externalUri).filter(Boolean));
  let orphanAttendance = 0;
  for (const row of attendanceRows || []) {
    const uri = blankToNull(row.calendly_event_uri);
    if (uri && !meetingUris.has(uri)) orphanAttendance += 1;
  }
  if (orphanAttendance) {
    qualityWarnings.push(`${orphanAttendance} registros de presença sem reunião correspondente.`);
  }

  const implByClient = new Map();
  for (const row of implRows || []) {
    const clientId = blankToNull(row.client_id);
    const meetingDate = parseDate(row.meeting_date);
    if (!clientId || !meetingDate) continue;
    const current = implByClient.get(String(clientId));
    if (!current || meetingDate < current) implByClient.set(String(clientId), meetingDate);
  }

  const byClient = new Map();
  for (const meeting of meetings) {
    if (!meeting.clientId) continue;
    if (!byClient.has(meeting.clientId)) byClient.set(meeting.clientId, []);
    byClient.get(meeting.clientId).push(meeting);
  }

  const clientRows = [];
  let preEntryMeetingsCount = 0;
  const clientsWithPreEntry = new Set();
  let preEntryExcludedFromFirst = 0;

  for (const client of clients || []) {
    const clientId = String(client.id);
    const entry = resolveClientEntry(client);
    const entryDate = entry.date;
    const cancelInfo = cancelMap.get(clientId) || null;
    const analyticalStatus = resolveAnalyticalStatusFromMaps(client?.status, cancelInfo);
    const rawMeetings = (byClient.get(clientId) || [])
      .slice()
      .sort((a, b) => (parseDate(a.startTime)?.getTime() || 0) - (parseDate(b.startTime)?.getTime() || 0));

    const dataWarnings = [];
    const annotatedMeetings = rawMeetings.map((m) => {
      const start = parseDate(m.startTime);
      const meetingDateStatus = classifyMeetingDate(start, entryDate, now);
      if (meetingDateStatus === "before_client_entry") {
        preEntryMeetingsCount += 1;
        clientsWithPreEntry.add(clientId);
      }
      return { ...m, meetingDateStatus };
    });

    const journeyMeetings = annotatedMeetings.filter((m) => m.meetingDateStatus === "valid");
    const completedPast = journeyMeetings.filter((m) => isCompletedPast(m, now));
    const pastAny = journeyMeetings.filter((m) => isPastMeeting(m, now) && m.attendanceStatus !== "cancelada");
    const absences = journeyMeetings.filter((m) => m.attendanceStatus === "nao_compareceu").length;
    const reschedules = journeyMeetings.filter((m) => m.rescheduled).length;

    const completedPastRaw = annotatedMeetings.filter((m) => isCompletedPast(m, now));
    const rawFirstBeforeEntry = completedPastRaw.find((m) => m.meetingDateStatus === "before_client_entry");
    const first = resolveClientFirstMeeting({
      annotatedMeetings,
      entryDate,
      implDate: implByClient.get(clientId) || null,
      now,
    });
    if (rawFirstBeforeEntry && first.firstMeetingStatus === "calculated") {
      preEntryExcludedFromFirst += 1;
      first.warnings.push("Reunião registrada antes da data de entrada do cliente");
    }
    dataWarnings.push(...first.warnings);

    let lastMeetingDate = null;
    let daysSinceLastMeeting = null;
    let lastMeetingStatusConfirmed = true;
    if (completedPast.length) {
      lastMeetingDate = completedPast[completedPast.length - 1].startTime;
      const lastDate = parseDate(lastMeetingDate);
      if (lastDate && lastDate <= now) {
        const days = daysBetween(lastDate, now);
        if (days >= 0) daysSinceLastMeeting = days;
      }
    } else if (pastAny.length) {
      lastMeetingDate = pastAny[pastAny.length - 1].startTime;
      const lastDate = parseDate(lastMeetingDate);
      if (lastDate && lastDate <= now) {
        const days = daysBetween(lastDate, now);
        if (days >= 0) daysSinceLastMeeting = days;
      }
      lastMeetingStatusConfirmed = false;
      dataWarnings.push("Última reunião considerada com status não confirmado.");
    }

    const intervals = [];
    const dedupedCompleted = [];
    const seen = new Set();
    for (const m of completedPast) {
      const curr = parseDate(m.startTime);
      if (!curr) continue;
      const key = String(curr.getTime());
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedCompleted.push(m);
    }
    for (let i = 1; i < dedupedCompleted.length; i += 1) {
      const prev = parseDate(dedupedCompleted[i - 1].startTime);
      const curr = parseDate(dedupedCompleted[i].startTime);
      if (!prev || !curr) continue;
      const diff = daysBetween(prev, curr);
      if (diff > 0) intervals.push(diff);
      else if (diff < 0) dataWarnings.push("Intervalo negativo detectado e ignorado.");
    }
    const averageIntervalDays = intervals.length ? average(intervals) : null;
    const typicalIntervalDays = intervals.length
      ? Math.round(percentile([...intervals].sort((a, b) => a - b), 50) * 10) / 10
      : null;

    let meetingsPerMonth = null;
    if (journeyMeetings.length) {
      const dated = journeyMeetings.map((m) => parseDate(m.startTime)).filter(Boolean).sort((a, b) => a - b);
      if (dated.length) {
        meetingsPerMonth =
          Math.round((journeyMeetings.length / monthsBetween(dated[0], dated[dated.length - 1])) * 10) / 10;
      }
    }

    if (annotatedMeetings.some((m) => m.attendanceStatus === "desconhecido")) {
      dataWarnings.push("Há reunião sem status de presença confirmado.");
    }
    if (first.firstMeetingCompleted === false && first.firstMeetingStatus !== "only_pre_entry_meetings") {
      dataWarnings.push("Cliente ainda não realizou a primeira reunião.");
    }
    if (absences) dataWarnings.push("Cliente possui falta(s) registrada(s).");
    if (entry.source === "created_at_fallback") {
      dataWarnings.push("Entrada calculada com created_at por ausência de data_inicio_ciclo.");
    }

    clientRows.push({
      clientId,
      clientCode: blankToNull(client.codigo),
      clientName: blankToNull(client.name) || "Não informado",
      engineer: labelOrUnknown(client.engenheiro_patrimonial),
      program: blankToNull(client.programa),
      rawStatus: blankToNull(client.status),
      analyticalStatus,
      clientStatus: analyticalStatus,
      entryDate: entryDate ? entryDate.toISOString() : null,
      entryDateSource: entry.source,
      totalMeetings: annotatedMeetings.filter(
        (m) => m.meetingDateStatus !== "before_client_entry" && m.meetingDateStatus !== "invalid",
      ).length,
      journeyMeetingsCount: journeyMeetings.length,
      hasValidMeeting: journeyMeetings.length > 0,
      preEntryMeetingsCount: annotatedMeetings.filter((m) => m.meetingDateStatus === "before_client_entry").length,
      meetingsPerMonth,
      lastMeetingDate,
      daysSinceLastMeeting,
      lastMeetingStatusConfirmed,
      averageIntervalDays,
      typicalIntervalDays,
      daysFromEntryToFirstMeeting: first.daysFromEntryToFirstMeeting,
      absences,
      reschedules,
      cancelledMeetings: null,
      firstMeetingCompleted: first.firstMeetingCompleted,
      firstMeetingDate: first.firstMeetingDate,
      firstMeetingStatus: first.firstMeetingStatus,
      frequencyBand: freqBand(journeyMeetings.length),
      daysSinceBand: daysSinceBand(daysSinceLastMeeting),
      intervalBand: intervalBand(averageIntervalDays),
      dataWarnings: [...new Set(dataWarnings)],
      meetings: annotatedMeetings.map((m) => {
        const typeInfo = normalizeMeetingEventType(m.title);
        return {
          meetingId: m.meetingId,
          source: m.source,
          title: m.title,
          rawEventType: typeInfo.rawEventType,
          meetingFamily: typeInfo.meetingFamily,
          productContext: typeInfo.productContext,
          normalizedLabel: typeInfo.normalizedLabel,
          startTime: m.startTime,
          endTime: m.endTime,
          hostEmail: m.hostEmail,
          attendanceStatus: m.attendanceStatus,
          rescheduled: m.rescheduled,
          recordingUrl: m.recordingUrl,
          meetingDateStatus: m.meetingDateStatus,
        };
      }),
    });
  }

  if (preEntryMeetingsCount) {
    qualityWarnings.push(
      `${preEntryMeetingsCount} reuniões anteriores à entrada do cliente (${clientsWithPreEntry.size} clientes). Excluídas de primeira reunião, intervalo e dias desde a última.`,
    );
  }

  let fallbackMeta = null;
  if (airtableIndex) {
    const { resolutions, warnings: fallbackWarnings, coverage } = applyFirstMeetingFallbackToClientRows(
      clientRows,
      clients,
      airtableIndex,
    );
    for (const row of clientRows) {
      if (row.firstMeetingSource !== "airtable" || !row.firstMeetingDate) continue;
      const entryDate = parseDate(row.entryDate);
      const meetingDate = parseDate(row.firstMeetingDate);
      if (entryDate && meetingDate) {
        const days = daysBetween(entryDate, meetingDate);
        if (days >= 0) row.daysFromEntryToFirstMeeting = days;
        else row.daysFromEntryToFirstMeeting = null;
      }
    }
    if (fallbackWarnings?.length) qualityWarnings.push(...fallbackWarnings);
    fallbackMeta = {
      available: airtableIndex.available === true,
      reason: airtableIndex.reason || null,
      coverage,
      resolutionsCount: resolutions.length,
    };
  }

  const analyticMeetings = [];
  for (const client of clientRows) {
    for (const meeting of client.meetings || []) {
      if (!isAnalyticMeeting(meeting)) continue;
      analyticMeetings.push(meeting);
    }
  }

  const datedMeetings = analyticMeetings.map((m) => parseDate(m.startTime)).filter(Boolean).sort((a, b) => a - b);
  const averageMeetingsPerMonth = datedMeetings.length
    ? Math.round((analyticMeetings.length / monthsBetween(datedMeetings[0], datedMeetings[datedMeetings.length - 1])) * 10) / 10
    : null;

  const withFirst = clientRows.filter((c) => c.firstMeetingCompleted === true).length;
  const withoutFirst = clientRows.filter((c) => c.firstMeetingCompleted === false).length;
  const portfolio = clientRows.length || 1;
  const relatedMeetings = meetings.length || 1;
  const preEntryPercent = Math.round((preEntryMeetingsCount / relatedMeetings) * 1000) / 10;

  const monthMap = new Map();
  let monthInconsistencies = 0;
  for (const meeting of analyticMeetings) {
    const start = parseDate(meeting.startTime);
    if (!start) continue;
    const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!monthMap.has(key)) monthMap.set(key, { month: key, scheduled: 0, completed: 0, noShows: 0 });
    const item = monthMap.get(key);
    item.scheduled += 1;
    if (meeting.attendanceStatus === "compareceu") item.completed += 1;
    if (meeting.attendanceStatus === "nao_compareceu") item.noShows += 1;
  }
  const meetingsByMonth = [...monthMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => {
      if (item.completed > item.scheduled) monthInconsistencies += 1;
      return {
        month: item.month,
        scheduled: item.scheduled,
        completed: item.completed,
        noShows: item.noShows,
        completionRate: item.scheduled > 0 ? Math.round((item.completed / item.scheduled) * 1000) / 10 : null,
        label: item.month,
        count: item.scheduled,
        percent: item.scheduled > 0 ? Math.round((item.completed / item.scheduled) * 1000) / 10 : 0,
      };
    });
  if (monthInconsistencies) {
    qualityWarnings.push(
      `${monthInconsistencies} mês(es) com realizadas > agendadas; barras limitadas a 100% e números reais mantidos.`,
    );
  }

  const classifiablePast = analyticMeetings.filter((m) => {
    const start = parseDate(m.startTime);
    if (!start || start > now) return false;
    return m.attendanceStatus === "compareceu" || m.attendanceStatus === "nao_compareceu";
  });
  const attendedClassifiable = classifiablePast.filter((m) => m.attendanceStatus === "compareceu").length;
  const futureMeetings = analyticMeetings.filter((m) => isFutureMeeting(m, now)).length;
  const cancelledMeetingsCount = analyticMeetings.filter((m) => m.attendanceStatus === "cancelada").length;
  const eligibleMeetings = Math.max(0, analyticMeetings.length - futureMeetings - cancelledMeetingsCount);
  const noShowsEligible = analyticMeetings.filter((m) => isConfirmedNoShow(m, now)).length;
  const attendedConfirmed = analyticMeetings.filter((m) => {
    const start = parseDate(m.startTime);
    if (!start || start > now) return false;
    if (m.attendanceStatus === "cancelada") return false;
    return m.attendanceStatus === "compareceu";
  }).length;
  const attendedMeetings = eligibleMeetings > 0 ? Math.max(0, eligibleMeetings - noShowsEligible) : 0;
  const noShowRate = eligibleMeetings > 0 ? Math.round((noShowsEligible / eligibleMeetings) * 1000) / 10 : null;
  const attendanceRate = eligibleMeetings > 0 ? Math.round((1 - noShowsEligible / eligibleMeetings) * 1000) / 10 : null;
  const attendanceRateConfirmed = classifiablePast.length > 0
    ? Math.round((attendedClassifiable / classifiablePast.length) * 1000) / 10
    : null;

  const meetingTypesPayload = meetingTypes || {
    available: false,
    byFamily: [],
    byRaw: [],
    events: [],
    original: [],
    consolidated: [],
    totalEvents: 0,
    excludedCommercial: 0,
    missingGroup: 0,
    source: "Calendly",
    metadata: { source: "Calendly", message: "Tipos de reunião não carregados." },
  };

  const daysSinceValues = clientRows.map((c) => c.daysSinceLastMeeting).filter((v) => v != null && v >= 0);
  const intervalValues = clientRows.map((c) => c.averageIntervalDays).filter((v) => v != null && v >= 0);
  const daysSinceStats = robustStats(daysSinceValues);
  const intervalStats = robustStats(intervalValues);
  const latestMeetingDate =
    clientRows
      .map((client) => parseDate(client.lastMeetingDate))
      .filter((date) => date && date <= now)
      .sort((a, b) => b - a)[0] || null;
  const daysSinceLatestMeeting = latestMeetingDate ? Math.max(0, daysBetween(latestMeetingDate, now)) : null;
  const clientsWithMeeting = clientRows.filter((c) => c.hasValidMeeting === true).length;
  const noShowFrequency = buildNoShowFrequency(clientRows);
  const safeClients = clientRows.map(sanitizeClientRow);

  const summary = {
    totalMeetings: analyticMeetings.length,
    futureMeetings,
    cancelledMeetings: cancelledMeetingsCount,
    eligibleMeetings,
    attendedMeetings,
    comparecimentos: attendedMeetings,
    attendedConfirmed,
    averageMeetingsPerMonth,
    averageDaysSinceLastMeeting: daysSinceStats.mean,
    typicalDaysSinceLastMeeting: daysSinceStats.median,
    latestMeetingDate: latestMeetingDate?.toISOString() || null,
    daysSinceLatestMeeting,
    daysSinceLastMeetingStats: daysSinceStats,
    averageIntervalDays: intervalStats.mean,
    typicalIntervalDays: intervalStats.median,
    intervalDaysStats: intervalStats,
    totalAbsences: clientRows.reduce((a, c) => a + c.absences, 0),
    totalNoShows: clientRows.reduce((a, c) => a + c.absences, 0),
    noShowsEligible,
    noShowRate,
    totalReschedules: clientRows.reduce((a, c) => a + c.reschedules, 0),
    attendanceRate,
    attendanceRateConfirmed,
    attendanceInsufficientData: eligibleMeetings <= 0,
    clientsWithMeeting,
    clientsWithoutMeeting: Math.max(0, clientRows.length - clientsWithMeeting),
    clientsWithFirstMeeting: withFirst,
    clientsWithoutFirstMeeting: withoutFirst,
    firstMeetingCompletionRate: Math.round((withFirst / portfolio) * 1000) / 10,
    meetingCoverageRate: Math.round((clientsWithMeeting / portfolio) * 1000) / 10,
    preEntryMeetingsExcluded: preEntryMeetingsCount,
    clientsWithPreEntryMeetings: clientsWithPreEntry.size,
    firstMeetingSources: fallbackMeta
      ? {
          base_qv: fallbackMeta.coverage?.primary || 0,
          airtable: fallbackMeta.coverage?.airtable || 0,
          unavailable: fallbackMeta.coverage?.unavailable || 0,
        }
      : null,
    airtableFallback: fallbackMeta,
    filteredClients: clientRows.length,
  };

  const distributions = {
    meetingsByMonth,
    attendanceStatus: distributionFrom(
      analyticMeetings,
      (m) => {
        if (m.attendanceStatus === "compareceu") return "Compareceu";
        if (m.attendanceStatus === "nao_compareceu") return "No-show";
        if (m.attendanceStatus === "cancelada") return "Cancelada";
        return "Sem confirmação";
      },
      ["Compareceu", "No-show", "Cancelada", "Sem confirmação"],
    ),
    meetingFrequency: distributionFrom(clientRows, (c) => c.frequencyBand, FREQ_BANDS),
    daysSinceLastMeeting: distributionFrom(clientRows, (c) => c.daysSinceBand, DAYS_SINCE_BANDS),
    intervalRanges: distributionFrom(clientRows, (c) => c.intervalBand, INTERVAL_BANDS),
    noShowFrequency,
    meetingsByEngineer: (() => {
      const counts = new Map();
      for (const client of clientRows) {
        if (!client.totalMeetings) continue;
        counts.set(client.engineer, (counts.get(client.engineer) || 0) + client.totalMeetings);
      }
      const engTotal = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
      return [...counts.entries()]
        .map(([label, count]) => ({
          label,
          count,
          percent: Math.round((count / engTotal) * 1000) / 10,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
    })(),
  };

  return {
    generatedAt: new Date().toISOString(),
    summary,
    distributions,
    noShowFrequency,
    meetingTypes: meetingTypesPayload,
    clients: safeClients,
    metadata: {
      source: "BASE QV",
      rescheduleCoverage: "partial",
      rescheduleCoverageNote:
        "Cobertura parcial: este valor considera apenas remarcações registradas de forma estruturada e pode não representar o total real.",
      noShowFrequencyUniverse: clientRows.length,
      intervalPrimaryMetric: "averageIntervalDays",
      intervalPrimaryDefinition: "Média aritmética dos intervalos positivos entre reuniões válidas consecutivas (compareceu).",
      meetingTypesChartSource: "Calendly",
      meetingTypesChartNote:
        "O gráfico Reuniões por tipo usa exclusivamente o Calendly; os demais indicadores usam a BASE QV.",
      meetingTypesTransport: meetingTypesPayload?.metadata?.transport || null,
      attendanceRateFormula: "1 - (noShows / (totalMeetings - futureMeetings - cancelledMeetings))",
      defaultStatusFilter: "active",
      denominatorNote: "Cobertura, recência e frequência usam a população filtrada como denominador.",
      typesChartScopeNote:
        "Tipos de reunião vêm do Calendly e respeitam apenas o filtro de período, não o recorte de clientes.",
    },
    quality: {
      usedFields: USED_FIELDS,
      warnings: qualityWarnings,
      preEntryMeetings: {
        count: preEntryMeetingsCount,
        percentOfRelated: preEntryPercent,
        clientsImpacted: clientsWithPreEntry.size,
        excludedFromFirstMeetingCandidates: preEntryExcludedFromFirst,
        impact:
          "Excluídas de primeira reunião, intervalo médio, dias desde a última, médias/medianas e faixas de distribuição.",
      },
    },
  };
}

export async function computeMeetingsPayload(options = {}) {
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }

  const totalStarted = Date.now();
  const [
    clientsTimed,
    calendlyTimed,
    manualTimed,
    attendanceTimed,
    implTimed,
    cancellationsTimed,
    airtableTimed,
    meetingTypesTimed,
  ] = await Promise.all([
    timed(() => fetchAllRows({ table: "clients", select: CLIENT_SELECT })),
    timed(() => fetchAllRows({ table: "client_meetings", select: CALENDLY_SELECT })),
    timed(() => fetchAllRows({ table: "manual_meetings", select: MANUAL_SELECT })),
    timed(() => fetchAllRows({ table: "meeting_attendance", select: ATTENDANCE_SELECT })),
    timed(() => fetchAllRows({ table: "client_implementation_meeting_date", select: IMPL_SELECT, order: "client_id.asc" })),
    timed(() => fetchAllRows({ table: "cancellations", select: ANALYTICAL_CANCEL_SELECT })),
    timed(() =>
      loadAirtableFirstMeetingIndex().catch((err) => ({
        available: false,
        reason: err?.message || "Falha ao carregar índice Airtable.",
        clientsByKey: null,
        meetingsByBackupId: null,
        statusValues: [],
        warnings: [],
        meta: null,
      })),
    ),
    timed(() =>
      options.includeMeetingTypes === false ? Promise.resolve(null) : loadMeetingTypesFromCalendly(),
    ),
  ]);

  const clientsRaw = clientsTimed.value;
  const clients = filterExcludedClients(clientsRaw);
  const removedIds = excludedClientIds(clientsRaw);
  const keepClient = (row) => !removedIds.has(String(row?.client_id || ""));
  const transformStarted = Date.now();
  const payload = buildMeetingsPayload({
    clients,
    calendlyRows: calendlyTimed.value.filter(keepClient),
    manualRows: manualTimed.value.filter(keepClient),
    attendanceRows: attendanceTimed.value,
    implRows: implTimed.value.filter(keepClient),
    cancellations: cancellationsTimed.value.filter(keepClient),
    airtableIndex: airtableTimed.value,
    meetingTypes: meetingTypesTimed.value,
  });
  const transformMs = Date.now() - transformStarted;
  const baseQvMs = Math.max(
    clientsTimed.ms,
    calendlyTimed.ms,
    manualTimed.ms,
    attendanceTimed.ms,
    implTimed.ms,
    cancellationsTimed.ms,
  );
  payload.timing = {
    clientsMs: clientsTimed.ms,
    clientMeetingsMs: calendlyTimed.ms,
    manualMeetingsMs: manualTimed.ms,
    attendanceMs: attendanceTimed.ms,
    implementationMs: implTimed.ms,
    cancellationsMs: cancellationsTimed.ms,
    airtableMs: airtableTimed.ms,
    calendlyTypesMs: meetingTypesTimed.ms,
    baseQvMs,
    transformMs,
    totalMs: Date.now() - totalStarted,
  };
  return payload;
}

export function sanitizeMeetingsClientId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  return id;
}

function slimChartRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    label: row.label,
    count: row.count,
    percent: row.percent,
  }));
}

export function toPublicListClient(row) {
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    clientCode: row.clientCode ?? null,
    engineer: row.engineer,
    analyticalStatus: row.analyticalStatus,
    totalMeetings: row.totalMeetings || 0,
    meetingsPerMonth: row.meetingsPerMonth ?? null,
    lastMeetingDate: row.lastMeetingDate ?? null,
    daysSinceLastMeeting: row.daysSinceLastMeeting ?? null,
    averageIntervalDays: row.averageIntervalDays ?? null,
    typicalIntervalDays: row.typicalIntervalDays ?? null,
    absences: row.absences || 0,
    reschedules: row.reschedules || 0,
    firstMeetingCompleted: row.firstMeetingCompleted,
    firstMeetingDate: row.firstMeetingDate ?? null,
    daysFromEntryToFirstMeeting: row.daysFromEntryToFirstMeeting ?? null,
    hasValidMeeting: row.hasValidMeeting === true,
    journeyMeetingsCount: row.journeyMeetingsCount || 0,
    frequencyBand: row.frequencyBand,
    daysSinceBand: row.daysSinceBand,
    intervalBand: row.intervalBand,
    meetings: (row.meetings || [])
      .filter(isAnalyticMeeting)
      .map((m) => ({
        meetingId: m.meetingId,
        startTime: m.startTime,
        attendanceStatus: m.attendanceStatus,
        rescheduled: Boolean(m.rescheduled),
        meetingDateStatus: m.meetingDateStatus || null,
      })),
  };
}

export function toPublicClientDetail(row) {
  if (!row) return null;
  return {
    clientId: row.clientId,
    meetings: (row.meetings || []).map((m) => ({
      title: m.title || "Reunião",
      startTime: m.startTime,
      source: m.source || null,
      attendanceStatus: m.attendanceStatus,
      rescheduled: Boolean(m.rescheduled),
      meetingDateStatus: m.meetingDateStatus || null,
    })),
  };
}

export function toPublicMeetingTypes(meetingTypes) {
  const src = meetingTypes || {};
  return {
    available: src.available === true,
    byFamily: slimChartRows(src.byFamily),
    byRaw: slimChartRows(src.byRaw),
    events: (Array.isArray(src.events) ? src.events : []).map((event) => ({
      startTime: event.startTime || null,
      rawEventType: event.rawEventType || event.title || "Não informado",
      canceled: event.canceled === true,
    })),
  };
}

export function toPublicMeetingsPayload(payload) {
  return {
    generatedAt: payload?.generatedAt || new Date().toISOString(),
    clients: (payload?.clients || []).map(toPublicListClient),
    meetingTypes: toPublicMeetingTypes(payload?.meetingTypes),
  };
}

function postgrestIn(values) {
  return `in.(${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(",")})`;
}

export async function computeMeetingClientDetail(clientId) {
  const id = sanitizeMeetingsClientId(clientId);
  if (!id) return null;
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }

  const [clientsRaw, calendlyRows, manualRows, implRows, cancellations] = await Promise.all([
    fetchAllRows({ table: "clients", select: CLIENT_SELECT, filters: { id: `eq.${id}` } }),
    fetchAllRows({ table: "client_meetings", select: CALENDLY_SELECT, filters: { client_id: `eq.${id}` } }),
    fetchAllRows({ table: "manual_meetings", select: MANUAL_SELECT, filters: { client_id: `eq.${id}` } }),
    fetchAllRows({
      table: "client_implementation_meeting_date",
      select: IMPL_SELECT,
      order: "client_id.asc",
      filters: { client_id: `eq.${id}` },
    }),
    fetchAllRows({ table: "cancellations", select: ANALYTICAL_CANCEL_SELECT, filters: { client_id: `eq.${id}` } }),
  ]);

  const clients = filterExcludedClients(clientsRaw);
  if (!clients.length) return null;

  const uris = [
    ...calendlyRows.map((row) => blankToNull(row.calendly_event_uri)),
    ...manualRows.map((row) => `manual:${row.id}`),
  ].filter(Boolean);

  let attendanceRows = [];
  if (uris.length) {
    attendanceRows = await fetchAllRows({
      table: "meeting_attendance",
      select: ATTENDANCE_SELECT,
      filters: { calendly_event_uri: postgrestIn(uris) },
    });
  }

  const payload = buildMeetingsPayload({
    clients,
    calendlyRows,
    manualRows,
    attendanceRows,
    implRows,
    cancellations,
    airtableIndex: null,
    meetingTypes: null,
  });
  return toPublicClientDetail(payload.clients[0]);
}
