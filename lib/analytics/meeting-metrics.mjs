/**
 * Métricas e regras de presença/recência/primeira reunião (Reuniões).
 * Fórmulas alinhadas à V1. Módulos puros — sem HTTP.
 */
import { sortDistributionUnknownLast } from "./filters/sort-categories.mjs";

export const FREQ_BANDS = ["Nenhuma", "1 reunião", "2 a 3", "4 a 6", "7 a 12", "Mais de 12"];
export const DAYS_SINCE_BANDS = [
  "Até 30 dias",
  "31 a 60 dias",
  "61 a 90 dias",
  "91 a 180 dias",
  "Mais de 180 dias",
  "Nunca realizou reunião",
];
export const INTERVAL_BANDS = [
  "Até 30 dias",
  "31 a 60 dias",
  "61 a 90 dias",
  "Mais de 90 dias",
  "Sem intervalo calculável",
];
export const NO_SHOW_FREQUENCY_BANDS = [
  { key: "zero", label: "0 no-shows", minimum: 0, maximum: 0 },
  { key: "one_to_two", label: "1–2 no-shows", minimum: 1, maximum: 2 },
  { key: "three_to_four", label: "3–4 no-shows", minimum: 3, maximum: 4 },
  { key: "five_or_more", label: "5 ou mais no-shows", minimum: 5, maximum: null },
];

export function blankToNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

export function parseDate(value) {
  const raw = blankToNull(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toBool(value) {
  const raw = blankToNull(value);
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw).trim().toLowerCase();
  if (["true", "t", "1", "sim", "yes", "y"].includes(s)) return true;
  if (["false", "f", "0", "nao", "não", "no", "n"].includes(s)) return false;
  return null;
}

export function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function daysBetween(a, b) {
  const ms =
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
    Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  return Math.floor(ms / 86400000);
}

export function monthsBetween(a, b) {
  if (!a || !b) return 1;
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
  return Math.max(1, months);
}

export function average(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

export function robustStats(values) {
  const sorted = values.filter((v) => v != null && Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return {
      mean: null,
      median: null,
      trimmedMean: null,
      p5: null,
      p95: null,
      trimmedExcludedCount: 0,
      extremeImpact: false,
      validCount: 0,
    };
  }
  const mean = average(sorted);
  const median = Math.round(percentile(sorted, 50) * 10) / 10;
  const p5 = Math.round(percentile(sorted, 5) * 10) / 10;
  const p95 = Math.round(percentile(sorted, 95) * 10) / 10;
  let trimmed = sorted;
  let trimmedExcludedCount = 0;
  if (sorted.length >= 20) {
    const low = percentile(sorted, 5);
    const high = percentile(sorted, 95);
    trimmed = sorted.filter((v) => v >= low && v <= high);
    trimmedExcludedCount = sorted.length - trimmed.length;
  }
  const trimmedMean = average(trimmed);
  const extremeImpact =
    median != null && median !== 0 && mean != null && Math.abs(mean - median) / Math.abs(median) >= 0.3;
  return { mean, median, trimmedMean, p5, p95, trimmedExcludedCount, extremeImpact, validCount: sorted.length };
}

/**
 * Presença da V1: cancelada ≠ no-show. "faltou" / "no show" / "ausente" = falta.
 * Pendente/remarcado (texto) = desconhecido.
 */
export function normalizeAttendanceStatus(status) {
  const s = String(status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!s) return "desconhecido";
  if (["compareceu", "realizado", "realizada", "concluido", "concluida", "presente"].includes(s)) {
    return "compareceu";
  }
  if (["nao compareceu", "faltou", "no show", "noshow", "ausente"].includes(s)) {
    return "nao_compareceu";
  }
  if (["cancelada", "cancelado", "canceled", "cancelled"].includes(s)) return "cancelada";
  if (s === "pendente" || s === "remarcado") return "desconhecido";
  return "desconhecido";
}

export function classifyMeetingDate(meetingDate, entryDate, now = new Date()) {
  if (!meetingDate) return "invalid";
  if (meetingDate > now) return "future";
  if (entryDate && startOfUtcDay(meetingDate) < startOfUtcDay(entryDate)) return "before_client_entry";
  return "valid";
}

export function isAnalyticMeeting(meeting) {
  return meeting && meeting.meetingDateStatus !== "before_client_entry" && meeting.meetingDateStatus !== "invalid";
}

export function isCompletedPast(meeting, now = new Date()) {
  const start = parseDate(meeting?.startTime);
  if (!start || start > now) return false;
  return meeting.attendanceStatus === "compareceu";
}

export function isPastMeeting(meeting, now = new Date()) {
  const start = parseDate(meeting?.startTime);
  return Boolean(start && start <= now);
}

export function isFutureMeeting(meeting, now = new Date()) {
  const start = parseDate(meeting?.startTime);
  return Boolean(start && start > now);
}

/** Elegível no denominador de no-show: não futura e não cancelada. */
export function isNoShowEligible(meeting, now = new Date()) {
  if (!meeting) return false;
  if (isFutureMeeting(meeting, now)) return false;
  if (meeting.attendanceStatus === "cancelada") return false;
  return true;
}

export function isConfirmedNoShow(meeting, now = new Date()) {
  if (!isNoShowEligible(meeting, now)) return false;
  return meeting.attendanceStatus === "nao_compareceu";
}

export function freqBand(total) {
  if (!total) return "Nenhuma";
  if (total === 1) return "1 reunião";
  if (total <= 3) return "2 a 3";
  if (total <= 6) return "4 a 6";
  if (total <= 12) return "7 a 12";
  return "Mais de 12";
}

export function daysSinceBand(days) {
  if (days == null) return "Nunca realizou reunião";
  if (days <= 30) return "Até 30 dias";
  if (days <= 60) return "31 a 60 dias";
  if (days <= 90) return "61 a 90 dias";
  if (days <= 180) return "91 a 180 dias";
  return "Mais de 180 dias";
}

export function intervalBand(days) {
  if (days == null) return "Sem intervalo calculável";
  if (days <= 30) return "Até 30 dias";
  if (days <= 60) return "31 a 60 dias";
  if (days <= 90) return "61 a 90 dias";
  return "Mais de 90 dias";
}

export function distributionFrom(items, keyFn, orderedLabels) {
  const counts = new Map();
  if (orderedLabels) orderedLabels.forEach((label) => counts.set(label, 0));
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = items.length || 1;
  const entries = orderedLabels
    ? orderedLabels.map((label) => [label, counts.get(label) || 0])
    : [...counts.entries()];
  const mapped = entries.map(([label, count]) => ({
    label,
    count,
    percent: Math.round((count / total) * 1000) / 10,
  }));
  if (orderedLabels) return mapped;
  return sortDistributionUnknownLast(mapped);
}

export function buildNoShowFrequency(clientRows) {
  const universe = Array.isArray(clientRows) ? clientRows.length : 0;
  const counts = Object.fromEntries(NO_SHOW_FREQUENCY_BANDS.map((b) => [b.key, 0]));
  for (const client of clientRows || []) {
    const n = Number(client.absences) || 0;
    let key = "five_or_more";
    if (n <= 0) key = "zero";
    else if (n <= 2) key = "one_to_two";
    else if (n <= 4) key = "three_to_four";
    counts[key] += 1;
  }
  return NO_SHOW_FREQUENCY_BANDS.map((band) => {
    const clients = counts[band.key] || 0;
    return {
      ...band,
      clients,
      percentage: universe > 0 ? Math.round((clients / universe) * 1000) / 10 : 0,
    };
  });
}

export function periodMonthDivisor(period, fromDate, toDate) {
  if (!period || period === "all") return null;
  if (period === "30" || period === "last_30") return 1;
  if (period === "90" || period === "last_90") return 3;
  if (period === "180" || period === "last_6m") return 6;
  if (period === "365" || period === "last_12m") return 12;
  if (period === "this_year" || period === "last_year" || period === "custom") {
    if (!fromDate) return null;
    return monthsBetween(fromDate, toDate || new Date());
  }
  const days = Number(period);
  if (!Number.isFinite(days) || days <= 0) return null;
  return Math.max(1, Math.round(days / 30));
}

export function enrichMeetingClientMetrics(client, meetings, { periodActive = false, periodDivisor = null, now = new Date() } = {}) {
  const completed = meetings
    .filter((m) => isCompletedPast(m, now))
    .sort((a, b) => (parseDate(a.startTime)?.getTime() || 0) - (parseDate(b.startTime)?.getTime() || 0));
  const pastAny = meetings
    .filter((m) => isPastMeeting(m, now) && m.attendanceStatus !== "cancelada")
    .sort((a, b) => (parseDate(a.startTime)?.getTime() || 0) - (parseDate(b.startTime)?.getTime() || 0));

  let lastMeetingDate = null;
  let daysSinceLastMeeting = null;
  const lastSrc = completed.length ? completed : pastAny;
  if (lastSrc.length) {
    lastMeetingDate = lastSrc[lastSrc.length - 1].startTime;
    const lastDate = parseDate(lastMeetingDate);
    if (lastDate && lastDate <= now) {
      const days = daysBetween(lastDate, now);
      if (days >= 0) daysSinceLastMeeting = days;
    }
  }

  const intervals = [];
  const seen = new Set();
  const deduped = [];
  for (const m of completed) {
    const t = parseDate(m.startTime)?.getTime();
    if (t == null || seen.has(t)) continue;
    seen.add(t);
    deduped.push(m);
  }
  for (let i = 1; i < deduped.length; i += 1) {
    const diff = daysBetween(parseDate(deduped[i - 1].startTime), parseDate(deduped[i].startTime));
    if (diff > 0) intervals.push(diff);
  }
  const intervalStats = robustStats(intervals);
  const absences = meetings.filter((m) => m.attendanceStatus === "nao_compareceu").length;
  const reschedules = meetings.filter((m) => m.rescheduled).length;
  let meetingsPerMonth = null;
  if (meetings.length) {
    if (periodActive) {
      if (periodDivisor) meetingsPerMonth = Math.round((meetings.length / periodDivisor) * 10) / 10;
    } else {
      const dated = meetings.map((m) => parseDate(m.startTime)).filter(Boolean).sort((a, b) => a - b);
      if (dated.length) {
        meetingsPerMonth = Math.round((meetings.length / monthsBetween(dated[0], dated[dated.length - 1])) * 10) / 10;
      }
    }
  }
  return {
    ...client,
    meetings,
    totalMeetings: meetings.length,
    hasValidMeeting: meetings.some((m) => m.meetingDateStatus === "valid") || meetings.length > 0,
    absences,
    reschedules,
    lastMeetingDate,
    daysSinceLastMeeting,
    averageIntervalDays: intervalStats.mean,
    typicalIntervalDays: intervalStats.mean,
    meetingsPerMonth,
    frequencyBand: freqBand(meetings.length),
    daysSinceBand: daysSinceBand(daysSinceLastMeeting),
    intervalBand: intervalBand(intervalStats.mean ?? intervalStats.median),
    _periodScoped: periodActive,
  };
}

/**
 * Primeira reunião: presença confirmada no passado, após a entrada.
 * Sem futura. Datas negativas/pré-entrada são nulas.
 */
export function resolveClientFirstMeeting({ annotatedMeetings = [], entryDate = null, implDate = null, now = new Date() } = {}) {
  const journeyMeetings = annotatedMeetings.filter((m) => m.meetingDateStatus === "valid");
  const completedPast = journeyMeetings.filter((m) => isCompletedPast(m, now));
  const preEntryOnly =
    annotatedMeetings.length > 0 &&
    journeyMeetings.length === 0 &&
    annotatedMeetings.every((m) => m.meetingDateStatus === "before_client_entry" || m.meetingDateStatus === "future") &&
    annotatedMeetings.some((m) => m.meetingDateStatus === "before_client_entry");

  const result = {
    firstMeetingCompleted: false,
    firstMeetingDate: null,
    firstMeetingStatus: "no_meetings",
    daysFromEntryToFirstMeeting: null,
    warnings: [],
  };

  if (completedPast.length) {
    const firstDate = parseDate(completedPast[0].startTime);
    result.firstMeetingCompleted = true;
    result.firstMeetingDate = completedPast[0].startTime;
    result.firstMeetingStatus = "calculated";
    if (entryDate && firstDate) {
      const days = daysBetween(entryDate, firstDate);
      if (days >= 0) result.daysFromEntryToFirstMeeting = days;
      else {
        result.daysFromEntryToFirstMeeting = null;
        result.warnings.push("Reunião registrada antes da data de entrada do cliente");
      }
    }
    return result;
  }

  if (implDate) {
    if (!entryDate || startOfUtcDay(implDate) >= startOfUtcDay(entryDate)) {
      if (implDate > now) {
        result.firstMeetingStatus = "no_confirmed_attendance";
        result.warnings.push("Cliente com reuniões, mas sem presença confirmada (compareceu).");
        return result;
      }
      result.firstMeetingCompleted = true;
      result.firstMeetingDate = implDate.toISOString();
      result.firstMeetingStatus = "inferred_implementation_date";
      result.warnings.push(
        "Primeira reunião inferida via client_implementation_meeting_date sem presença confirmada em meeting_attendance.",
      );
      if (entryDate) result.daysFromEntryToFirstMeeting = daysBetween(entryDate, implDate);
      return result;
    }
    result.firstMeetingStatus = "only_pre_entry_meetings";
    result.warnings.push("Reunião registrada antes da data de entrada do cliente");
    result.warnings.push("Cliente possui reuniões registradas somente antes da entrada na jornada.");
    return result;
  }

  if (preEntryOnly) {
    result.firstMeetingStatus = "only_pre_entry_meetings";
    result.warnings.push("Cliente possui reuniões registradas somente antes da entrada na jornada.");
    return result;
  }

  if (annotatedMeetings.length) {
    result.firstMeetingStatus = "no_confirmed_attendance";
    result.warnings.push("Cliente com reuniões, mas sem presença confirmada (compareceu).");
    return result;
  }

  return result;
}

export function summarizeMeetingRows(rows, { periodActive = false, periodDivisor = null, now = new Date() } = {}) {
  const meetings = rows.flatMap((c) => (c.meetings || []).filter(isAnalyticMeeting));
  const uniqueIds = new Set();
  const deduped = [];
  for (const m of meetings) {
    const key = m.meetingId || `${m.source}|${m.startTime}|${m.title || ""}`;
    if (uniqueIds.has(key)) continue;
    uniqueIds.add(key);
    deduped.push(m);
  }
  const totalMeetings = deduped.length;
  let averageMeetingsPerMonth = null;
  if (totalMeetings) {
    if (periodActive) {
      if (periodDivisor) averageMeetingsPerMonth = Math.round((totalMeetings / periodDivisor) * 10) / 10;
    } else {
      const dated = deduped.map((m) => parseDate(m.startTime)).filter(Boolean).sort((a, b) => a - b);
      if (dated.length) {
        averageMeetingsPerMonth = Math.round((totalMeetings / monthsBetween(dated[0], dated[dated.length - 1])) * 10) / 10;
      }
    }
  }

  const daysSinceStats = robustStats(rows.map((c) => c.daysSinceLastMeeting).filter((v) => v != null));
  const intervalStats = robustStats(rows.map((c) => c.averageIntervalDays).filter((v) => v != null && v >= 0));
  const totalNoShows = rows.reduce((a, c) => a + (c.absences || 0), 0);
  const totalReschedules = rows.reduce((a, c) => a + (c.reschedules || 0), 0);
  const latestMeetingDate =
    rows
      .map((client) => parseDate(client.lastMeetingDate))
      .filter((date) => date && date <= now)
      .sort((a, b) => b - a)[0] || null;
  const daysSinceLatestMeeting = latestMeetingDate ? Math.max(0, daysBetween(latestMeetingDate, now)) : null;

  const futureMeetings = deduped.filter((m) => isFutureMeeting(m, now)).length;
  const cancelledMeetings = deduped.filter((m) => m.attendanceStatus === "cancelada").length;
  const eligibleMeetings = Math.max(0, deduped.length - futureMeetings - cancelledMeetings);
  const noShowsEligible = deduped.filter((m) => isConfirmedNoShow(m, now)).length;
  const attendedConfirmed = deduped.filter((m) => {
    if (!isNoShowEligible(m, now)) return false;
    return m.attendanceStatus === "compareceu";
  }).length;
  const attendedMeetings = eligibleMeetings > 0 ? Math.max(0, eligibleMeetings - noShowsEligible) : 0;
  const noShowRate = eligibleMeetings > 0 ? Math.round((noShowsEligible / eligibleMeetings) * 1000) / 10 : null;
  const attendanceRate = eligibleMeetings > 0 ? Math.round((1 - noShowsEligible / eligibleMeetings) * 1000) / 10 : null;

  const withFirst = rows.filter((c) => c.firstMeetingCompleted === true).length;
  const clientsWithMeeting = rows.filter((c) => c.hasValidMeeting === true).length;
  const portfolio = rows.length || 1;
  const clientsWithoutMeeting = Math.max(0, rows.length - clientsWithMeeting);

  return {
    totalMeetings,
    futureMeetings,
    cancelledMeetings,
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
    typicalIntervalDays: intervalStats.mean,
    intervalDaysStats: intervalStats,
    totalAbsences: totalNoShows,
    totalNoShows,
    noShowsEligible,
    noShowRate,
    totalReschedules,
    attendanceRate,
    attendanceInsufficientData: eligibleMeetings <= 0,
    clientsWithMeeting,
    clientsWithoutMeeting,
    clientsWithFirstMeeting: withFirst,
    clientsWithoutFirstMeeting: rows.filter((c) => c.firstMeetingCompleted === false).length,
    firstMeetingCompletionRate: Math.round((withFirst / portfolio) * 1000) / 10,
    meetingCoverageRate: Math.round((clientsWithMeeting / portfolio) * 1000) / 10,
    filteredClients: rows.length,
    periodScoped: periodActive,
  };
}

export function distributionsFromMeetingRows(rows) {
  const meetings = rows.flatMap((c) => (c.meetings || []).filter(isAnalyticMeeting));
  const noShowFrequency = buildNoShowFrequency(rows);
  const engCounts = new Map();
  for (const c of rows) {
    if (!c.totalMeetings) continue;
    engCounts.set(c.engineer, (engCounts.get(c.engineer) || 0) + c.totalMeetings);
  }
  const engTotal = [...engCounts.values()].reduce((a, b) => a + b, 0) || 1;
  const monthMap = new Map();
  const nowLocal = new Date();
  const currentMonth = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, "0")}`;
  for (const meeting of meetings) {
    const start = parseDate(meeting.startTime);
    if (!start) continue;
    const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    if (key > currentMonth) continue;
    if (!monthMap.has(key)) monthMap.set(key, { month: key, scheduled: 0, completed: 0, noShows: 0 });
    const item = monthMap.get(key);
    item.scheduled += 1;
    if (meeting.attendanceStatus === "compareceu") item.completed += 1;
    if (meeting.attendanceStatus === "nao_compareceu") item.noShows += 1;
  }
  const meetingsByMonth = [...monthMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => ({
      month: item.month,
      scheduled: item.scheduled,
      completed: item.completed,
      noShows: item.noShows,
      completionRate: item.scheduled > 0 ? Math.round((item.completed / item.scheduled) * 1000) / 10 : null,
      label: item.month,
      count: item.scheduled,
      percent: item.scheduled > 0 ? Math.round((item.completed / item.scheduled) * 1000) / 10 : 0,
    }));

  return {
    meetingsByMonth,
    attendanceStatus: distributionFrom(
      meetings,
      (m) => {
        if (m.attendanceStatus === "compareceu") return "Compareceu";
        if (m.attendanceStatus === "nao_compareceu") return "No-show";
        if (m.attendanceStatus === "cancelada") return "Cancelada";
        return "Sem confirmação";
      },
      ["Compareceu", "No-show", "Cancelada", "Sem confirmação"],
    ),
    meetingFrequency: distributionFrom(rows, (c) => c.frequencyBand, FREQ_BANDS),
    daysSinceLastMeeting: distributionFrom(rows, (c) => c.daysSinceBand, DAYS_SINCE_BANDS),
    intervalRanges: distributionFrom(rows, (c) => c.intervalBand, INTERVAL_BANDS),
    noShowFrequency,
    meetingsByEngineer: [...engCounts.entries()]
      .map(([label, count]) => ({
        label,
        count,
        percent: Math.round((count / engTotal) * 1000) / 10,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")),
  };
}

export function recencySecondaryNote(latestMeetingDate, daysSinceLatestMeeting, formatDate) {
  if (!latestMeetingDate) return "Sem reunião registrada";
  if (daysSinceLatestMeeting === 0) return "Última reunião registrada hoje";
  return `Última reunião registrada em ${formatDate(latestMeetingDate)}`;
}

export function resolveMeetingsViewKind(state) {
  const code = state?.errorCode;
  if (code === "AUTH_REQUIRED" || code === "unauthenticated") return "unauthorized";
  if (code === "AUTH_FORBIDDEN" || code === "invalid_domain") return "unauthorized";
  if (state?.error && !state?.payload) return "error";
  if (state?.loading && !state?.payload) return "loading";
  if (state?.payload && !(state.payload.clients || []).length) return "empty";
  return "success";
}
