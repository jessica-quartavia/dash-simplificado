/**
 * Filtros — Gargalos da Jornada (Análises internas).
 */
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { programMatches } from "./filters/program.mjs";
import { defaultPeriodState, inPeriod, resolvePeriod } from "./filters/period.mjs";
import { DEFAULT_STATUS_FILTER, STATUS_FILTER_OPTIONS } from "./general-filters.mjs";

export { STATUS_FILTER_OPTIONS, DEFAULT_STATUS_FILTER };

export function defaultInternalJourneyBottlenecksFilters() {
  return {
    search: "",
    status: DEFAULT_STATUS_FILTER,
    segment: "all",
    engineer: "all",
    program: "all",
    completedOnboarding: "all",
    firstMeeting: "all",
    ...defaultPeriodState(),
  };
}

export function normalizeInternalJourneyBottlenecksFilters(raw = {}) {
  const f = { ...defaultInternalJourneyBottlenecksFilters(), ...raw };
  f.status = STATUS_FILTER_OPTIONS.some((o) => o.value === f.status) ? f.status : DEFAULT_STATUS_FILTER;
  f.segment = String(f.segment || "all");
  f.engineer = String(f.engineer || "all");
  f.program = String(f.program || "all");
  f.search = String(f.search || "").trim();
  f.completedOnboarding = ["all", "yes", "no", "unknown"].includes(f.completedOnboarding)
    ? f.completedOnboarding
    : "all";
  f.firstMeeting = ["all", "yes", "no"].includes(f.firstMeeting) ? f.firstMeeting : "all";
  return f;
}

export function parseInternalJourneyBottlenecksFilters(searchParams = new URLSearchParams()) {
  const p = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams);
  return normalizeInternalJourneyBottlenecksFilters({
    search: p.get("search") || "",
    status: p.get("status") || DEFAULT_STATUS_FILTER,
    segment: p.get("segment") || "all",
    engineer: p.get("engineer") || "all",
    program: p.get("program") || "all",
    periodPreset: p.get("periodPreset") || p.get("period") || undefined,
    periodStart: p.get("periodStart") || undefined,
    periodEnd: p.get("periodEnd") || undefined,
    completedOnboarding: p.get("completedOnboarding") || "all",
    firstMeeting: p.get("firstMeeting") || "all",
  });
}

export function internalJourneyBottlenecksFiltersToSearchParams(filters = {}) {
  const f = normalizeInternalJourneyBottlenecksFilters(filters);
  const params = new URLSearchParams();
  if (f.search) params.set("search", f.search);
  if (f.status && f.status !== DEFAULT_STATUS_FILTER) params.set("status", f.status);
  if (f.segment !== "all") params.set("segment", f.segment);
  if (f.engineer !== "all") params.set("engineer", f.engineer);
  if (f.program !== "all") params.set("program", f.program);
  if (f.periodPreset) params.set("periodPreset", f.periodPreset);
  if (f.periodStart) params.set("periodStart", f.periodStart);
  if (f.periodEnd) params.set("periodEnd", f.periodEnd);
  if (f.completedOnboarding !== "all") params.set("completedOnboarding", f.completedOnboarding);
  if (f.firstMeeting !== "all") params.set("firstMeeting", f.firstMeeting);
  return params;
}

export function filterJourneyBottleneckRows(rows, filters = {}, options = {}) {
  const f = normalizeInternalJourneyBottlenecksFilters(filters);
  const now = options.now || new Date();
  const period = resolvePeriod(f, now);

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!matchesAnalyticalStatusFilter(row.analyticalStatus, f.status)) return false;
    if (f.segment !== "all" && (row.segment || "Não informado") !== f.segment) return false;
    if (f.engineer !== "all" && (row.engineer || "Não informado") !== f.engineer) return false;
    if (!programMatches(row, f.program)) return false;
    if (f.completedOnboarding === "yes" && row.completedOnboarding !== true) return false;
    if (f.completedOnboarding === "no" && row.completedOnboarding !== false) return false;
    if (f.completedOnboarding === "unknown" && row.completedOnboarding != null) return false;
    if (f.firstMeeting === "yes" && row.firstMeetingCompleted !== true) return false;
    if (f.firstMeeting === "no" && row.firstMeetingCompleted !== false) return false;
    if (period?.active && row.contractDate && !inPeriod(row.contractDate, period)) return false;
    if (!matchesSearch(row, f.search)) return false;
    return true;
  });
}
