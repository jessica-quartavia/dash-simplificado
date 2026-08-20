/**
 * Filtros da página Reuniões.
 * Default V2: Ativos (analyticalStatus === "Ativo"). Congelado não entra.
 */
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { DEFAULT_STATUS_FILTER, STATUS_FILTER_OPTIONS, normalizeStatusFilter } from "./general-filters.mjs";
import { PERIOD_PRESETS as PERIOD_FILTER_OPTIONS, resolvePeriod } from "./filters/period.mjs";
import { matchesSearch } from "./filters/search.mjs";
import {
  enrichMeetingClientMetrics,
  freqBand,
  isAnalyticMeeting,
  parseDate,
  periodMonthDivisor,
} from "./meeting-metrics.mjs";

export { DEFAULT_STATUS_FILTER, STATUS_FILTER_OPTIONS, normalizeStatusFilter, PERIOD_FILTER_OPTIONS };

export function defaultMeetingFilters() {
  return {
    search: "",
    status: DEFAULT_STATUS_FILTER,
    engineer: "all",
    period: "all",
    from: "",
    to: "",
    attendance: "all",
    freq: "all",
    first: "all",
    absence: "all",
    reschedule: "all",
  };
}

export function resolveMeetingPeriod(filters = {}, now = new Date()) {
  const period = resolvePeriod(filters, now);
  if (!period.active) {
    return { active: false, from: null, to: null, divisor: null, invalid: period.invalid };
  }
  return {
    active: true,
    from: period.from,
    to: period.to,
    divisor: periodMonthDivisor(period.mode, period.from, period.to || now),
    invalid: false,
  };
}

export function meetingInPeriod(meeting, period) {
  const start = parseDate(meeting?.startTime);
  if (!start) return false;
  if (period.from && start < period.from) return false;
  if (period.to && start > period.to) return false;
  return true;
}

export function clientMeetingsInPeriod(client, period) {
  const all = (client.meetings || []).filter(isAnalyticMeeting);
  if (!period?.active) return all;
  return all.filter((m) => meetingInPeriod(m, period));
}

export function meetingTypeEventInPeriod(event, period) {
  const start = parseDate(event?.startTime);
  if (!start) return false;
  if (!period?.active) return true;
  if (period.from && start < period.from) return false;
  if (period.to && start > period.to) return false;
  return true;
}

export function sortMeetingClients(rows, sortKey = "totalMeetings", sortDir = "desc") {
  const list = [...rows];
  list.sort((a, b) => {
    const av = a?.[sortKey];
    const bv = b?.[sortKey];
    let cmp = 0;
    if (av == null && bv == null) cmp = 0;
    else if (av == null) cmp = 1;
    else if (bv == null) cmp = -1;
    else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else if (typeof av === "boolean" && typeof bv === "boolean") cmp = Number(av) - Number(bv);
    else cmp = String(av).localeCompare(String(bv), "pt-BR", { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });
  return list;
}

/**
 * Recorta clientes e, se houver período, reenriquece métricas no recorte.
 * Denominadores posteriores devem usar `rows.length` (população filtrada).
 */
export function applyMeetingFilters(clients, filters = {}, options = {}) {
  const f = { ...defaultMeetingFilters(), ...filters };
  const now = options.now || new Date();
  const period = resolveMeetingPeriod(f, now);
  const statusFilter = normalizeStatusFilter(f.status);
  const q = f.search;
  const source = Array.isArray(clients) ? clients : [];

  const filtered = source.filter((c) => {
    if (!matchesAnalyticalStatusFilter(c.analyticalStatus || c.clientStatus, statusFilter)) return false;
    if (f.engineer !== "all" && c.engineer !== f.engineer) return false;
    if (f.first === "yes" && c.firstMeetingCompleted !== true) return false;
    if (f.first === "no" && c.firstMeetingCompleted !== false) return false;
    const meetings = clientMeetingsInPeriod(c, period);
    if (f.attendance !== "all" && !meetings.some((m) => m.attendanceStatus === f.attendance)) return false;
    if (period.active && !meetings.length) return false;
    const scopedAbsences = period.active
      ? meetings.filter((m) => m.attendanceStatus === "nao_compareceu").length
      : c.absences;
    const scopedReschedules = period.active ? meetings.filter((m) => m.rescheduled).length : c.reschedules;
    const scopedFreq = period.active ? freqBand(meetings.length) : c.frequencyBand;
    if (f.freq !== "all" && scopedFreq !== f.freq) return false;
    if (f.absence === "yes" && !(scopedAbsences > 0)) return false;
    if (f.absence === "no" && scopedAbsences > 0) return false;
    if (f.reschedule === "yes" && !(scopedReschedules > 0)) return false;
    if (f.reschedule === "no" && scopedReschedules > 0) return false;
    if (!matchesSearch(c, q)) return false;
    return true;
  });

  const mapped = filtered.map((c) => {
    const meetings = clientMeetingsInPeriod(c, period);
    if (!period.active) {
      return {
        ...c,
        meetings: (c.meetings || []).filter(isAnalyticMeeting),
        _periodScoped: false,
      };
    }
    return enrichMeetingClientMetrics(c, meetings, {
      periodActive: true,
      periodDivisor: period.divisor,
      now,
    });
  });

  return sortMeetingClients(mapped, options.sortKey || "totalMeetings", options.sortDir || "desc");
}
