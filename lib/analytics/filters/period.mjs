/**
 * Período global do Analytics V2.
 * Autoridade única: timezone, presets, validação, calendário e resolução.
 */
import { parseDate } from "../meeting-metrics.mjs";

export const PORTAL_TIMEZONE = "America/Sao_Paulo";

export const PERIOD_PRESETS = [
  { value: "all", label: "Todo o período" },
  { value: "today", label: "Hoje" },
  { value: "last_30", label: "Últimos 30 dias" },
  { value: "last_90", label: "Últimos 90 dias" },
  { value: "last_6m", label: "Últimos 6 meses" },
  { value: "last_12m", label: "Últimos 12 meses" },
  { value: "this_year", label: "Este ano" },
  { value: "last_year", label: "Ano anterior" },
  { value: "custom", label: "Personalizado" },
];

/** Presets exibidos no popover do DateRangePicker. */
export const DATE_RANGE_PRESET_OPTIONS = PERIOD_PRESETS.filter((item) =>
  ["all", "today", "last_30", "last_90", "last_6m", "last_12m", "this_year"].includes(item.value),
);

const ALIASES = {
  "30": "last_30",
  "90": "last_90",
  "180": "last_6m",
  "365": "last_12m",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: PORTAL_TIMEZONE,
  month: "long",
  year: "numeric",
});

const brDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: PORTAL_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function partsInTimezone(date, timeZone = PORTAL_TIMEZONE) {
  const map = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

export function normalizePeriodMode(value) {
  const raw = String(value || "all").trim();
  if (ALIASES[raw]) return ALIASES[raw];
  return PERIOD_PRESETS.some((item) => item.value === raw) ? raw : "all";
}

export function periodPresetLabel(mode) {
  const key = normalizePeriodMode(mode);
  return PERIOD_PRESETS.find((item) => item.value === key)?.label || "Todo o período";
}

export function todayIso(now = new Date()) {
  const parts = partsInTimezone(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isIsoDateString(value) {
  return ISO_DATE.test(String(value || "").slice(0, 10));
}

export function compareIsoDates(a, b) {
  const left = String(a || "").slice(0, 10);
  const right = String(b || "").slice(0, 10);
  if (!ISO_DATE.test(left) || !ISO_DATE.test(right)) return 0;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function isFutureIso(iso, now = new Date()) {
  if (!isIsoDateString(iso)) return false;
  return compareIsoDates(iso, todayIso(now)) > 0;
}

export function formatIsoDateBr(iso) {
  if (!isIsoDateString(iso)) return "";
  const date = parseDate(`${iso}T12:00:00.000Z`);
  return date ? brDateFormatter.format(date) : "";
}

export function formatPeriodRangeLabel(fromIso, toIso) {
  const from = formatIsoDateBr(fromIso);
  const to = formatIsoDateBr(toIso);
  if (from && to) return `${from} — ${to}`;
  if (from) return from;
  if (to) return to;
  return "";
}

export function formatPeriodFieldLabel(filters = {}, now = new Date()) {
  const mode = normalizePeriodMode(filters.period);
  if (mode === "all") return "Todo o período";
  if (mode === "today") return formatIsoDateBr(todayIso(now));
  if (mode === "custom") {
    const normalized = normalizeCustomRange(filters.from, filters.to, now);
    if (normalized.ok) {
      const label = formatPeriodRangeLabel(normalized.from, normalized.to);
      if (label) return label;
    }
    return "Personalizado";
  }
  return periodPresetLabel(mode);
}

/**
 * Normaliza intervalo personalizado: bloqueia futuro e corrige start > end.
 */
export function normalizeCustomRange(fromRaw, toRaw, now = new Date()) {
  let from = String(fromRaw || "").slice(0, 10);
  let to = String(toRaw || "").slice(0, 10);
  if (!from && !to) return { ok: true, from: "", to: "", error: null };
  if (from && !isIsoDateString(from)) return { ok: false, from: "", to: "", error: "invalid_date" };
  if (to && !isIsoDateString(to)) return { ok: false, from: "", to: "", error: "invalid_date" };
  if (from && isFutureIso(from, now)) return { ok: false, from: "", to: "", error: "future_date" };
  if (to && isFutureIso(to, now)) return { ok: false, from: "", to: "", error: "future_date" };
  if (from && to && compareIsoDates(from, to) > 0) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (from && isFutureIso(from, now)) return { ok: false, from: "", to: "", error: "future_date" };
  if (to && isFutureIso(to, now)) return { ok: false, from: "", to: "", error: "future_date" };
  return { ok: true, from, to, error: null };
}

export function sanitizePeriodFilters(filters = {}, now = new Date()) {
  const mode = normalizePeriodMode(filters.period);
  if (mode === "all") return { period: "all", from: "", to: "" };
  if (mode === "today") {
    const today = todayIso(now);
    return { period: "today", from: today, to: today };
  }
  if (mode !== "custom") {
    return {
      period: mode,
      from: String(filters.from || "").slice(0, 10),
      to: String(filters.to || "").slice(0, 10),
    };
  }
  const normalized = normalizeCustomRange(filters.from, filters.to, now);
  if (!normalized.ok) {
    return { period: "all", from: "", to: "" };
  }
  if (!normalized.from && !normalized.to) {
    return { period: "all", from: "", to: "" };
  }
  return { period: "custom", from: normalized.from, to: normalized.to };
}

export function applyPeriodPreset(preset, now = new Date()) {
  const mode = normalizePeriodMode(preset);
  if (mode === "all") return { period: "all", from: "", to: "" };
  if (mode === "today") {
    const today = todayIso(now);
    return { period: "today", from: today, to: today };
  }
  if (mode === "custom") return { period: "custom", from: "", to: "" };
  return { period: mode, from: "", to: "" };
}

export function normalizeRangeSelection(startIso, endIso, now = new Date()) {
  const normalized = normalizeCustomRange(startIso, endIso, now);
  if (!normalized.ok) return { start: null, end: null, error: normalized.error };
  return { start: normalized.from || null, end: normalized.to || null, error: null };
}

function monthsAgo(n, now) {
  const parts = partsInTimezone(now);
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  date.setUTCMonth(date.getUTCMonth() - n);
  return date;
}

function startOfYear(now, offset = 0) {
  const parts = partsInTimezone(now);
  return new Date(Date.UTC(Number(parts.year) + offset, 0, 1, 0, 0, 0, 0));
}

function endOfYear(now, offset = 0) {
  const parts = partsInTimezone(now);
  return new Date(Date.UTC(Number(parts.year) + offset, 11, 31, 23, 59, 59, 999));
}

export function defaultPeriodState() {
  return { period: "all", from: "", to: "" };
}

export function resolvePeriod(filters = {}, now = new Date()) {
  const nested = filters?.period && typeof filters.period === "object" ? filters.period : null;
  const requestedMode = normalizePeriodMode(nested?.mode || filters.period || "all");
  const sanitized = sanitizePeriodFilters(filters, now);
  const fromRaw = nested?.start ?? nested?.from ?? filters.from ?? filters.start ?? sanitized.from ?? "";
  const toRaw = nested?.end ?? nested?.to ?? filters.to ?? filters.end ?? sanitized.to ?? "";

  if (requestedMode === "all" || sanitized.period === "all") {
    if (requestedMode === "custom" && (fromRaw || toRaw)) {
      const rejected = normalizeCustomRange(fromRaw, toRaw, now);
      if (!rejected.ok) {
        return { active: false, mode: "custom", from: null, to: null, invalid: true, error: rejected.error || "invalid_range" };
      }
    }
    return { active: false, mode: "all", from: null, to: null, invalid: false };
  }

  if (requestedMode === "today" || sanitized.period === "today") {
    const today = todayIso(now);
    return {
      active: true,
      mode: "today",
      from: parseDate(`${today}T00:00:00.000Z`),
      to: parseDate(`${today}T23:59:59.999Z`),
      invalid: false,
    };
  }

  if (requestedMode === "custom") {
    const normalized = normalizeCustomRange(fromRaw, toRaw, now);
    if (!normalized.ok) {
      return { active: false, mode: "custom", from: null, to: null, invalid: true, error: normalized.error || "invalid_range" };
    }
    if (!normalized.from && !normalized.to) {
      return { active: false, mode: "custom", from: null, to: null, invalid: false };
    }
    const from = normalized.from ? parseDate(`${normalized.from}T00:00:00.000Z`) : null;
    const to = normalized.to ? parseDate(`${normalized.to}T23:59:59.999Z`) : null;
    return { active: true, mode: "custom", from, to, invalid: false };
  }

  const mode = normalizePeriodMode(sanitized.period || requestedMode);
  if (mode === "last_30") {
    return { active: true, mode, from: new Date(now.getTime() - 30 * 86400000), to: null, invalid: false };
  }
  if (mode === "last_90") {
    return { active: true, mode, from: new Date(now.getTime() - 90 * 86400000), to: null, invalid: false };
  }
  if (mode === "last_6m") {
    return { active: true, mode, from: monthsAgo(6, now), to: null, invalid: false };
  }
  if (mode === "last_12m") {
    return { active: true, mode, from: monthsAgo(12, now), to: null, invalid: false };
  }
  if (mode === "this_year") {
    return { active: true, mode, from: startOfYear(now, 0), to: null, invalid: false };
  }
  if (mode === "last_year") {
    return { active: true, mode, from: startOfYear(now, -1), to: endOfYear(now, -1), invalid: false };
  }
  return { active: false, mode: "all", from: null, to: null, invalid: false };
}

export function inPeriod(value, period) {
  if (!period?.active) return true;
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return false;
  if (period.from && date < period.from) return false;
  if (period.to && date > period.to) return false;
  return true;
}

export function monthKeyInPeriod(monthKey, period) {
  if (!period?.active) return true;
  const raw = String(monthKey || "");
  if (!/^\d{4}-\d{2}$/.test(raw)) return false;
  const from = parseDate(`${raw}-01T00:00:00.000Z`);
  if (!from) return false;
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  if (period.from && to < period.from) return false;
  if (period.to && from > period.to) return false;
  return true;
}

export function formatPeriodSummary(filters = {}, now = new Date()) {
  const resolved = resolvePeriod(filters, now);
  if (resolved.invalid) return "Período inválido";
  if (!resolved.active) return periodPresetLabel("all");
  if (resolved.mode === "custom" || resolved.mode === "today") {
    const sanitized = sanitizePeriodFilters(filters, now);
    return formatPeriodFieldLabel(sanitized, now);
  }
  return periodPresetLabel(resolved.mode);
}

export function monthMatrix(year, month, now = new Date()) {
  const today = todayIso(now);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startWeekday = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];

  for (let i = 0; i < startWeekday; i += 1) {
    cells.push({ iso: "", day: "", inMonth: false, isToday: false, isFuture: false, disabled: true });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isFuture = isFutureIso(iso, now);
    cells.push({
      iso,
      day,
      inMonth: true,
      isToday: iso === today,
      isFuture,
      disabled: isFuture,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ iso: "", day: "", inMonth: false, isToday: false, isFuture: false, disabled: true });
  }

  return cells;
}

export function monthTitle(year, month) {
  const date = new Date(Date.UTC(year, month - 1, 1, 12));
  const label = monthFormatter.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function canNavigateToMonth(year, month, now = new Date()) {
  const today = todayIso(now);
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  if (year < currentYear - 20) return false;
  if (year > currentYear) return false;
  if (year === currentYear && month > currentMonth) return false;
  return true;
}

export function shiftMonth(year, month, delta) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function isRangeComplete(startIso, endIso) {
  return Boolean(startIso && endIso);
}

export function rangeIncludes(iso, startIso, endIso) {
  if (!iso || !startIso || !endIso) return false;
  return compareIsoDates(iso, startIso) >= 0 && compareIsoDates(iso, endIso) <= 0;
}

export function isRangeEdge(iso, startIso, endIso) {
  return iso && (iso === startIso || iso === endIso);
}
