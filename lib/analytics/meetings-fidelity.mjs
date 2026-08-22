/**
 * Comparação V1 × V2 da página Reuniões (compute live + filtros UI equivalentes).
 */
import { applyMeetingFilters, defaultMeetingFilters, meetingTypeEventInPeriod, resolveMeetingPeriod } from "./meeting-filters.mjs";
import {
  clientHasMeeting,
  isAnalyticMeeting,
  summarizeMeetingRows,
} from "./meeting-metrics.mjs";
import { buildMeetingTypeDistributions } from "./meeting-event-type.mjs";

export const MEETINGS_FILTER_PRESETS = {
  /** Snapshot comparável pedido na auditoria (V1 referência com Ativos + 30 dias). */
  comparable_30d_active: {
    label: "Ativos · EP/Programa todos · Últimos 30 dias",
    filters: {
      ...defaultMeetingFilters(),
      status: "active",
      engineer: "all",
      program: "all",
      period: "30",
      attendance: "all",
      freq: "all",
      first: "all",
      absence: "all",
      reschedule: "all",
    },
  },
  /** Default HTML V1 (Todo o histórico + Todos status). */
  v1_html_default: {
    label: "V1 HTML default · Todo o histórico · Todos status",
    filters: {
      ...defaultMeetingFilters(),
      status: "all",
      period: "all",
    },
  },
  /** Default V2 UI (Ativos + Todo o período). */
  v2_ui_default: {
    label: "V2 UI default · Ativos · Todo o período",
    filters: defaultMeetingFilters(),
  },
  all_history_active: {
    label: "Ativos · Todo o histórico",
    filters: {
      ...defaultMeetingFilters(),
      period: "all",
    },
  },
  all_history_all_status: {
    label: "Todos status · Todo o histórico",
    filters: {
      ...defaultMeetingFilters(),
      status: "all",
      period: "all",
    },
  },
};

export function computeMeetingsUiSummary(clients, filters = {}, options = {}) {
  const f = { ...defaultMeetingFilters(), ...filters };
  const now = options.now || new Date();
  const period = resolveMeetingPeriod(f, now);
  const rows = applyMeetingFilters(clients, f, { now, ...options });
  const summary = summarizeMeetingRows(rows, {
    periodActive: period.active,
    periodDivisor: period.divisor,
    now,
  });
  return { rows, summary, period, filters: f };
}

export function meetingTypeEventsForChart(meetingTypes, period, mode = "family") {
  const src = meetingTypes || {};
  const events = Array.isArray(src.events) ? src.events : [];
  if (!src.available) return { available: false, totalEvents: 0, topLabel: null, topCount: null };
  if (!period?.active) {
    const preagg = mode === "raw" ? src.byRaw : src.byFamily;
    const top = preagg?.[0];
    return {
      available: true,
      totalEvents: (preagg || []).reduce((sum, row) => sum + (row.count || 0), 0),
      topLabel: top?.label || null,
      topCount: top?.count ?? null,
    };
  }
  const scoped = events.filter((e) => meetingTypeEventInPeriod(e, period));
  const dist = buildMeetingTypeDistributions(
    scoped.map((e) => ({
      title: e.rawEventType || e.title,
      rawEventType: e.rawEventType || e.title,
      startTime: e.startTime,
      canceled: e.canceled === true,
      attendanceStatus: e.canceled === true || e.attendanceStatus === "cancelada" ? "cancelada" : "desconhecido",
    })),
  );
  const list = mode === "raw" ? dist.byRaw : dist.byFamily;
  return {
    available: true,
    totalEvents: scoped.length,
    topLabel: list[0]?.label || null,
    topCount: list[0]?.count ?? null,
  };
}

function setDiff(rowsV1, rowsV2, pickId = (r) => String(r.clientId)) {
  const idsV1 = new Set((rowsV1 || []).map(pickId));
  const idsV2 = new Set((rowsV2 || []).map(pickId));
  const intersection = [...idsV1].filter((id) => idsV2.has(id));
  const onlyV1 = [...idsV1].filter((id) => !idsV2.has(id));
  const onlyV2 = [...idsV2].filter((id) => !idsV1.has(id));
  return {
    v1Count: idsV1.size,
    v2Count: idsV2.size,
    intersection: intersection.length,
    onlyV1: onlyV1.length,
    onlyV2: onlyV2.length,
    onlyV1Ids: onlyV1,
    onlyV2Ids: onlyV2,
  };
}

export function clientsWithMeetingSet(rows) {
  return new Set((rows || []).filter(clientHasMeeting).map((r) => String(r.clientId)));
}

export function clientsWithFirstMeetingSet(rows) {
  return new Set((rows || []).filter((r) => r.firstMeetingCompleted === true).map((r) => String(r.clientId)));
}

function metricRow(spec) {
  const delta =
    spec.v1 != null && spec.v2 != null && Number.isFinite(Number(spec.v1)) && Number.isFinite(Number(spec.v2))
      ? Math.round((Number(spec.v2) - Number(spec.v1)) * 1000) / 1000
      : null;
  const match =
    spec.v1 == null && spec.v2 == null
      ? true
      : spec.v1 != null &&
        spec.v2 != null &&
        (spec.tolerance != null
          ? Math.abs(Number(spec.v2) - Number(spec.v1)) <= spec.tolerance
          : String(spec.v1) === String(spec.v2));
  return {
    metric: spec.metric,
    v1: spec.v1,
    v2: spec.v2,
    delta,
    sourceV1: spec.sourceV1 || "BASE QV client_meetings+manual+attendance",
    sourceV2: spec.sourceV2 || "BASE QV client_meetings+manual+attendance",
    cause: spec.cause || (match ? "—" : spec.note || "Divergência"),
    status: match ? "OK" : spec.status || "DIVERGENT",
    note: spec.note || null,
  };
}

export function formatMeetingFiltersAudit(filters = {}) {
  const f = { ...filters };
  return {
    search: f.search ?? "",
    status: f.status ?? "all",
    engineer: f.engineer ?? "all",
    program: f.program ?? "all",
    period: f.period ?? "all",
    presence: f.attendance ?? f.presence ?? "all",
    frequency: f.freq ?? f.frequency ?? "all",
    noShow: f.absence ?? f.noShow ?? "all",
    reschedule: f.reschedule ?? "all",
    first: f.first ?? "all",
  };
}

export function summarizeMeetingSetDiffCauses(records = []) {
  const counts = {};
  for (const record of records) {
    const diag = diagnoseMeetingRecord(record, record?.side || "unknown");
    const key = (diag.reasons || ["other"])[0] || "other";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function compareMeetingsPayloads(v1Payload, v2Payload, presetKey = "comparable_30d_active", options = {}) {
  const preset = MEETINGS_FILTER_PRESETS[presetKey] || MEETINGS_FILTER_PRESETS.comparable_30d_active;
  const now = options.now || new Date();
  const v1Clients = v1Payload?.clients || [];
  const v2Clients = v2Payload?.clients || [];
  const v1 = computeMeetingsUiSummary(v1Clients, preset.filters, { now });
  const v2 = computeMeetingsUiSummary(v2Clients, preset.filters, { now });
  const s1 = v1.summary;
  const s2 = v2.summary;

  const coverageOk =
    s2.filteredClients > 0
      ? Math.abs(s2.meetingCoverageRate - (s2.clientsWithMeeting / s2.filteredClients) * 100) < 0.05
      : true;
  const neverOk = s2.clientsWithoutMeeting === Math.max(0, s2.filteredClients - s2.clientsWithMeeting);

  const meetingSetV1 = clientsWithMeetingSet(v1.rows);
  const meetingSetV2 = clientsWithMeetingSet(v2.rows);
  const firstSetV1 = clientsWithFirstMeetingSet(v1.rows);
  const firstSetV2 = clientsWithFirstMeetingSet(v2.rows);

  const metrics = [
    metricRow({ metric: "População filtrada", v1: s1.filteredClients, v2: s2.filteredClients }),
    metricRow({ metric: "Total de reuniões", v1: s1.totalMeetings, v2: s2.totalMeetings }),
    metricRow({ metric: "Clientes com reunião", v1: s1.clientsWithMeeting, v2: s2.clientsWithMeeting }),
    metricRow({ metric: "Cobertura %", v1: s1.meetingCoverageRate, v2: s2.meetingCoverageRate, tolerance: 0.1 }),
    metricRow({ metric: "Nunca reunidos", v1: s1.filteredClients - s1.clientsWithMeeting, v2: s2.clientsWithoutMeeting }),
    metricRow({
      metric: "Recência (MAX portfolio)",
      v1: s1.daysSinceLatestMeeting,
      v2: s2.daysSinceLatestMeeting,
    }),
    metricRow({
      metric: "Recência mediana por cliente",
      v1: s1.typicalDaysSinceLastMeeting,
      v2: s2.typicalDaysSinceLastMeeting,
    }),
    metricRow({ metric: "Intervalo médio", v1: s1.averageIntervalDays, v2: s2.averageIntervalDays, tolerance: 0.1 }),
    metricRow({ metric: "Intervalo mediano", v1: s1.typicalIntervalDays, v2: s2.typicalIntervalDays, tolerance: 0.1 }),
    metricRow({
      metric: "Primeira reunião %",
      v1: s1.firstMeetingCompletionRate,
      v2: s2.firstMeetingCompletionRate,
      tolerance: 0.1,
    }),
    metricRow({
      metric: "Média reuniões/mês",
      v1: s1.averageMeetingsPerMonth,
      v2: s2.averageMeetingsPerMonth,
      tolerance: 0.1,
    }),
    metricRow({ metric: "Taxa comparecimento", v1: s1.attendanceRate, v2: s2.attendanceRate, tolerance: 0.1 }),
    metricRow({ metric: "No-shows", v1: s1.totalNoShows, v2: s2.totalNoShows }),
    metricRow({ metric: "Remarcações", v1: s1.totalReschedules, v2: s2.totalReschedules }),
    metricRow({ metric: "Futuras", v1: s1.futureMeetings, v2: s2.futureMeetings }),
    metricRow({ metric: "Canceladas", v1: s1.cancelledMeetings, v2: s2.cancelledMeetings }),
  ];

  const typeV1 = meetingTypeEventsForChart(v1Payload?.meetingTypes || v1Payload?.meetingTypesFromCsv, v1.period);
  const typeV2 = meetingTypeEventsForChart(v2Payload?.meetingTypes || v2Payload?.meetingTypesFromCsv, v2.period);
  metrics.push(
    metricRow({
      metric: "Reuniões por tipo (eventos Calendly)",
      v1: typeV1.totalEvents,
      v2: typeV2.totalEvents,
      sourceV1: "Business Data Agendamentos.calendly_eventos",
      sourceV2: "Business Data Agendamentos.calendly_eventos",
    }),
  );

  const meetingRecords = compareMeetingRecordSets(v1.rows, v2.rows);

  return {
    preset: presetKey,
    presetLabel: preset.label,
    filters: preset.filters,
    filtersAudit: formatMeetingFiltersAudit(preset.filters),
    metrics,
    assertions: {
      coverageIdentity: coverageOk,
      neverMetIdentity: neverOk,
    },
    sets: {
      clientsWithMeeting: {
        ...setDiff([...meetingSetV1].map((id) => ({ clientId: id })), [...meetingSetV2].map((id) => ({ clientId: id }))),
      },
      firstMeeting: {
        ...setDiff([...firstSetV1].map((id) => ({ clientId: id })), [...firstSetV2].map((id) => ({ clientId: id }))),
      },
      meetings: meetingRecords,
      meetingDiffCauses: {
        onlyV1: summarizeMeetingSetDiffCauses(meetingRecords.onlyV1Records),
        onlyV2: summarizeMeetingSetDiffCauses(meetingRecords.onlyV2Records),
      },
    },
    unfiltered: {
      v1Clients: v1Clients.length,
      v2Clients: v2Clients.length,
    },
  };
}

export function diagnoseClientMeetingDiff(clientV1, clientV2) {
  if (!clientV1 && !clientV2) return "missing_both";
  if (!clientV1) return "only_v2";
  if (!clientV2) return "only_v1";
  const v1Has = clientHasMeeting(clientV1);
  const v2Has = clientHasMeeting(clientV2);
  if (v1Has === v2Has) {
    if (clientV1.firstMeetingCompleted !== clientV2.firstMeetingCompleted) return "first_meeting_flag";
    return "same_meeting_flag";
  }
  const v1Meetings = (clientV1.meetings || []).filter(isAnalyticMeeting).length;
  const v2Meetings = (clientV2.meetings || []).filter(isAnalyticMeeting).length;
  if (v1Meetings !== v2Meetings) return "meeting_count";
  if (clientV1.hasValidMeeting !== clientV2.hasValidMeeting) return "hasValidMeeting";
  return "attendance_or_date";
}

export function meetingDedupeKey(meeting) {
  return meeting?.meetingId || `${meeting?.source}|${meeting?.startTime}|${meeting?.title || ""}`;
}

export function extractAnalyticMeetingsFromRows(rows) {
  const map = new Map();
  for (const client of rows || []) {
    for (const meeting of (client.meetings || []).filter(isAnalyticMeeting)) {
      const key = meetingDedupeKey(meeting);
      if (!key || map.has(key)) continue;
      map.set(key, {
        key,
        meetingId: meeting.meetingId || null,
        clientId: client.clientId || meeting.clientId || null,
        source: meeting.source || null,
        startTime: meeting.startTime || null,
        meetingDateStatus: meeting.meetingDateStatus || null,
        attendanceStatus: meeting.attendanceStatus || null,
        title: meeting.title || null,
        rescheduled: meeting.rescheduled === true,
        manuallyLinked: meeting.manuallyLinked === true,
      });
    }
  }
  return map;
}

export function compareMeetingRecordSets(v1Rows, v2Rows) {
  const v1Map = extractAnalyticMeetingsFromRows(v1Rows);
  const v2Map = extractAnalyticMeetingsFromRows(v2Rows);
  const onlyV1 = [...v1Map.keys()].filter((k) => !v2Map.has(k));
  const onlyV2 = [...v2Map.keys()].filter((k) => !v1Map.has(k));
  const intersection = [...v1Map.keys()].filter((k) => v2Map.has(k));
  return {
    v1Count: v1Map.size,
    v2Count: v2Map.size,
    intersection: intersection.length,
    onlyV1: onlyV1.length,
    onlyV2: onlyV2.length,
    onlyV1Records: onlyV1.map((k) => v1Map.get(k)),
    onlyV2Records: onlyV2.map((k) => v2Map.get(k)),
  };
}

export function compareDistributionCounts(v1Dist, v2Dist, labelKey = "label", countKey = "count") {
  const v1Map = new Map((v1Dist || []).map((r) => [r[labelKey], r[countKey] || 0]));
  const v2Map = new Map((v2Dist || []).map((r) => [r[labelKey], r[countKey] || 0]));
  const labels = [...new Set([...v1Map.keys(), ...v2Map.keys()])].sort();
  return labels.map((label) => ({
    bucket: label,
    v1: v1Map.get(label) || 0,
    v2: v2Map.get(label) || 0,
    delta: (v2Map.get(label) || 0) - (v1Map.get(label) || 0),
  }));
}

export function diagnoseMeetingRecord(record, side) {
  if (!record) return { side, reason: "missing" };
  const reasons = [];
  if (record.meetingDateStatus === "before_client_entry") reasons.push("before_client_entry");
  if (record.meetingDateStatus === "invalid") reasons.push("invalid_date");
  if (record.meetingDateStatus === "future") reasons.push("future");
  if (record.source === "manual") reasons.push("manual");
  if (record.attendanceStatus === "cancelada") reasons.push("cancelada");
  if (record.attendanceStatus === "desconhecido") reasons.push("no_attendance");
  if (record.rescheduled) reasons.push("rescheduled");
  return { side, ...record, reasons: reasons.length ? reasons : ["included_in_" + side] };
}
