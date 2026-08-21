/**
 * Filtros — Análises Estatísticas (V2).
 * Mapeia controles da UI para query params de GET /api/statistical-crosses.
 */
import { normalizeProgramFilter } from "./filters/program.mjs";
import { resolvePeriod } from "./filters/period.mjs";

export const SC_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "active_cancelled", label: "Ativos e cancelados" },
  { value: "active", label: "Ativo" },
  { value: "frozen", label: "Congelado" },
  { value: "cancelled", label: "Cancelado confirmado" },
  { value: "inactive", label: "Outros/inativos" },
];

const ALLOWED_STATUS = new Set(SC_STATUS_FILTER_OPTIONS.map((o) => o.value));

export function defaultStatisticalCrossesFilters() {
  return {
    search: "",
    period: "all",
    from: "",
    to: "",
    program: "all",
    engineer: "all",
    status: "active_cancelled",
    minCoverage: 30,
    minSample: 5,
    cohortGranularity: "month",
    cohortPeriod: "since_2025_01",
    cohortCellMode: "percent",
    cohortMinN: 5,
  };
}

export function normalizeScStatusFilter(value) {
  return ALLOWED_STATUS.has(value) ? value : "active_cancelled";
}

export function normalizeMinCoverage(value, fallback = 30) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function normalizeMinSample(value, fallback = 5) {
  const n = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export function normalizeCohortGranularity(value) {
  return value === "quarter" ? "quarter" : "month";
}

export function normalizeCohortPeriod(value) {
  return value === "since_2026_01" ? "since_2026_01" : "since_2025_01";
}

export function normalizeCohortCellMode(value) {
  return value === "count" ? "count" : "percent";
}

/**
 * Normaliza filtros vindos do formulário ou da URL.
 */
export function normalizeStatisticalCrossesFilters(raw = {}) {
  const base = defaultStatisticalCrossesFilters();
  return {
    search: String(raw.search ?? base.search ?? "").trim(),
    period: raw.period ?? base.period,
    from: raw.from ?? base.from,
    to: raw.to ?? base.to,
    program: normalizeProgramFilter(raw.program ?? base.program),
    engineer: raw.engineer && raw.engineer !== "" ? raw.engineer : base.engineer,
    status: normalizeScStatusFilter(raw.status ?? base.status),
    minCoverage: normalizeMinCoverage(raw.minCoverage ?? base.minCoverage),
    minSample: normalizeMinSample(raw.minSample ?? base.minSample),
    cohortGranularity: normalizeCohortGranularity(raw.cohortGranularity ?? base.cohortGranularity),
    cohortPeriod: normalizeCohortPeriod(raw.cohortPeriod ?? base.cohortPeriod),
    cohortCellMode: normalizeCohortCellMode(raw.cohortCellMode ?? base.cohortCellMode),
    cohortMinN: normalizeMinSample(raw.cohortMinN ?? base.cohortMinN, 5),
  };
}

/** Regra V1 — elegibilidade por cobertura/amostra. */
export function scPassMin(row, minCov, minSample) {
  const cov = row.coveragePercent ?? row.coverage ?? (row.missingPercent != null ? 100 - row.missingPercent : 100);
  const nA = row.nActive ?? row.activeN ?? row.nRenewed ?? row.n0 ?? 0;
  const nC = row.nCancelled ?? row.cancelledN ?? row.nNotRenewed ?? row.n1 ?? 0;
  const n = row.n ?? row.sample ?? row.sampleSize ?? nA + nC;
  if (row.status === "constant" || row.status === "invalid" || row.status === "leakage") return false;
  if (cov != null && Number.isFinite(cov) && cov < minCov) return false;
  if (nA > 0 || nC > 0) {
    if (nA < minSample || nC < minSample) return false;
  } else if (n < minSample * 2) return false;
  return true;
}

/**
 * Período global → hireFrom/hireTo (data de contratação), conforme V1.
 */
export function statisticalCrossesHireRange(filters = {}) {
  const resolved = resolvePeriod({
    period: filters.period,
    from: filters.from,
    to: filters.to,
  });
  return {
    hireFrom: resolved.from || null,
    hireTo: resolved.to || null,
  };
}

/**
 * Converte filtros da UI em URLSearchParams para a API.
 */
export function statisticalCrossesFiltersToSearchParams(filters = {}) {
  const f = normalizeStatisticalCrossesFilters(filters);
  const params = new URLSearchParams();
  params.set("status", f.status);
  params.set("minCoverage", String(f.minCoverage));
  params.set("minSample", String(f.minSample));
  if (f.search) params.set("search", f.search);
  if (f.program !== "all") params.set("program", f.program);
  if (f.engineer !== "all") params.set("engineer", f.engineer);
  const { hireFrom, hireTo } = statisticalCrossesHireRange(f);
  if (hireFrom) params.set("hireFrom", hireFrom);
  if (hireTo) params.set("hireTo", hireTo);
  if (f.cohortGranularity !== "month") params.set("cohortGranularity", f.cohortGranularity);
  if (f.cohortPeriod !== "since_2025_01") params.set("cohortPeriod", f.cohortPeriod);
  return params;
}

/**
 * Monta URL completa do endpoint com filtros aplicados.
 */
export function buildStatisticalCrossesApiUrl(filters = {}, basePath = "/api/statistical-crosses") {
  const qs = statisticalCrossesFiltersToSearchParams(filters).toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
