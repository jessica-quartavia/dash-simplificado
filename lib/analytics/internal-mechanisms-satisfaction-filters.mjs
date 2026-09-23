/**
 * Filtros — Análise interna Mecanismos × Satisfação.
 * Default status: Ativo (alinhado à página de Mecanismos).
 */
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { DEFAULT_STATUS_FILTER, normalizeStatusFilter } from "./general-filters.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { normalizeProgramFilter, programMatches } from "./filters/program.mjs";
import { mechanismSlugFromName } from "./mechanisms-satisfaction-dataset.mjs";

export const IMS_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Ativo" },
  { value: "active_cancelled", label: "Ativos e cancelados" },
  { value: "cancelled", label: "Cancelados" },
];

export const IMS_NPS_SCORE_OPTIONS = [
  { value: "all", label: "Todas" },
  ...Array.from({ length: 11 }, (_, i) => ({ value: String(i), label: String(i) })),
];

export const IMS_HAS_MECHANISM_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "yes", label: "Com mecanismo implementado" },
  { value: "no", label: "Sem mecanismo implementado" },
];

export const IMS_NPS_CLASS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "promotor", label: "Promotor" },
  { value: "neutro", label: "Neutro" },
  { value: "detrator", label: "Detrator" },
  { value: "none", label: "Sem NPS" },
];

export const IMS_RENEWED_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "yes", label: "Renovou" },
  { value: "no", label: "Não renovou" },
  { value: "invalid", label: "Ciclo inválido" },
];

export function defaultInternalMechanismsSatisfactionFilters() {
  return {
    search: "",
    program: "all",
    engineer: "all",
    segment: "all",
    status: DEFAULT_STATUS_FILTER,
    mechanism: "all",
    hasMechanism: "all",
    npsClass: "all",
    npsScore: "all",
    renewed: "all",
    minSample: 5,
    minMechanismSample: 30,
  };
}

export function normalizeInternalMechanismsSatisfactionFilters(raw = {}) {
  const base = defaultInternalMechanismsSatisfactionFilters();
  return {
    ...base,
    search: String(raw.search || "").trim(),
    program: normalizeProgramFilter(raw.program || base.program),
    engineer: raw.engineer || "all",
    segment: raw.segment || "all",
    status: normalizeStatusFilter(raw.status || base.status),
    mechanism: raw.mechanism || "all",
    hasMechanism: raw.hasMechanism || "all",
    npsClass: raw.npsClass || "all",
    npsScore: raw.npsScore != null && raw.npsScore !== "" ? String(raw.npsScore) : "all",
    renewed: raw.renewed || "all",
    minSample: Math.max(1, Number(raw.minSample) || base.minSample),
    minMechanismSample: Math.max(1, Number(raw.minMechanismSample) || base.minMechanismSample),
  };
}

export function parseInternalMechanismsSatisfactionFilters(searchParams = new URLSearchParams()) {
  return normalizeInternalMechanismsSatisfactionFilters({
    search: searchParams.get("search") || "",
    program: searchParams.get("program") || "all",
    engineer: searchParams.get("engineer") || "all",
    segment: searchParams.get("segment") || "all",
    status: searchParams.get("status") || DEFAULT_STATUS_FILTER,
    mechanism: searchParams.get("mechanism") || "all",
    hasMechanism: searchParams.get("hasMechanism") || "all",
    npsClass: searchParams.get("npsClass") || "all",
    npsScore: searchParams.get("npsScore") || "all",
    renewed: searchParams.get("renewed") || "all",
    minSample: searchParams.get("minSample") || 5,
    minMechanismSample: searchParams.get("minMechanismSample") || 30,
  });
}

export function filterWideClients(rows, filters = {}) {
  const f = normalizeInternalMechanismsSatisfactionFilters(filters);
  const statusFilter = normalizeStatusFilter(f.status);
  return (rows || []).filter((row) => {
    if (!matchesSearch(row, f.search, ["clientName", "clientCode", "clientId"])) return false;
    if (!matchesAnalyticalStatusFilter(row.analyticalStatus, statusFilter)) return false;
    if (f.engineer !== "all" && row.ep !== f.engineer) return false;
    if (f.segment !== "all" && row.segment !== f.segment) return false;
    if (!programMatches({ program: row.program, programa: row.program }, f.program)) return false;
    if (f.hasMechanism === "yes" && !(row.totalImplementedMechanisms > 0)) return false;
    if (f.hasMechanism === "no" && row.totalImplementedMechanisms > 0) return false;
    if (f.npsScore !== "all") {
      const target = Number(f.npsScore);
      if (!Number.isFinite(target) || Number(row.latestNps) !== target) return false;
    }
    if (f.npsClass === "none" && row.latestNps != null) return false;
    if (f.npsClass !== "all" && f.npsClass !== "none" && row.latestNpsClass !== f.npsClass) return false;
    if (f.renewed === "yes" && !(row.cycleValid && row.renewed)) return false;
    if (f.renewed === "no" && !(row.cycleValid && !row.renewed)) return false;
    if (f.renewed === "invalid" && row.cycleValid) return false;
    if (f.mechanism !== "all") {
      const slug = String(f.mechanism);
      const key = slug.startsWith("implemented_") ? slug : `implemented_${slug}`;
      if (!row[key]) return false;
    }
    return true;
  });
}

export function filterLongRows(longRows, wideClients, filters = {}) {
  const ids = new Set(filterWideClients(wideClients, filters).map((r) => r.clientId));
  const f = normalizeInternalMechanismsSatisfactionFilters(filters);
  return (longRows || []).filter((row) => {
    if (!ids.has(row.clientId)) return false;
    if (f.mechanism !== "all") {
      if (!row.mechanismId) return false;
      const slug = String(f.mechanism);
      const key = slug.startsWith("implemented_") ? slug : `implemented_${slug}`;
      const rowSlug = `implemented_${mechanismSlugFromName(row.mechanismName)}`;
      if (f.mechanism !== row.mechanismId && key !== rowSlug && slug !== row.mechanismId) return false;
    }
    return true;
  });
}

function mechanismSlugFromFilter(slug) {
  return String(slug || "").replace(/^implemented_/, "");
}

export function internalMechanismsSatisfactionFiltersToSearchParams(filters = {}) {
  const f = normalizeInternalMechanismsSatisfactionFilters(filters);
  const params = new URLSearchParams();
  if (f.search) params.set("search", f.search);
  if (f.program !== "all") params.set("program", f.program);
  if (f.engineer !== "all") params.set("engineer", f.engineer);
  if (f.segment !== "all") params.set("segment", f.segment);
  if (f.status !== DEFAULT_STATUS_FILTER) params.set("status", f.status);
  if (f.mechanism !== "all") params.set("mechanism", f.mechanism);
  if (f.hasMechanism !== "all") params.set("hasMechanism", f.hasMechanism);
  if (f.npsClass !== "all") params.set("npsClass", f.npsClass);
  if (f.npsScore !== "all") params.set("npsScore", f.npsScore);
  if (f.renewed !== "all") params.set("renewed", f.renewed);
  return params;
}
