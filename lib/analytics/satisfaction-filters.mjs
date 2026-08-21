/**
 * Filtros — Pesquisa de Satisfação (V2).
 * Universo de respondentes; sem active-first forçado.
 */
import { buildSatisfactionQuarterView, resolveSatisfactionQuarter } from "./satisfaction.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { normalizeProgramFilter, programMatches } from "./filters/program.mjs";

export const SATISFACTION_QUARTER_OPTIONS = [
  { value: "latest", label: "Mais recente" },
];

export function satisfactionQuarterOptions(payload) {
  const quarters = (payload?.distributions?.npsQuarterly || payload?.scopeInputs?.npsQuarterly || []).map(
    (item) => item.quarter,
  );
  const unique = [...new Set(quarters.filter(Boolean))];
  return [{ value: "latest", label: "Mais recente" }, ...unique.map((quarter) => ({ value: quarter, label: quarter }))];
}

export const NPS_CLASSIFICATION_FILTER_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "promotor", label: "Promotor" },
  { value: "neutro", label: "Neutro" },
  { value: "detrator", label: "Detrator" },
];

export const HAS_CSAT_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "yes", label: "Sim" },
  { value: "no", label: "Não" },
];

export const LAST_NPS_BAND_OPTIONS = [
  { value: "all", label: "Todas as notas" },
  { value: "0-2", label: "0–2" },
  { value: "3-4", label: "3–4" },
  { value: "5-6", label: "5–6" },
  { value: "7-8", label: "7–8" },
  { value: "9-10", label: "9–10" },
];

export function npsClassificationFromScore(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const n = Number(score);
  if (n >= 9) return "promotor";
  if (n >= 7) return "neutro";
  return "detrator";
}

export function normalizeNpsClassificationFilter(value) {
  const raw = String(value || "all").trim().toLowerCase();
  if (["promotor", "neutro", "detrator"].includes(raw)) return raw;
  return "all";
}

export function normalizeHasCsatFilter(value) {
  const raw = String(value || "all").trim().toLowerCase();
  if (raw === "yes" || raw === "sim") return "yes";
  if (raw === "no" || raw === "nao" || raw === "não") return "no";
  return "all";
}

export function normalizeLastNpsBand(value) {
  const raw = String(value || "all").trim();
  return LAST_NPS_BAND_OPTIONS.some((item) => item.value === raw) ? raw : "all";
}

export function scoreInLastNpsBand(score, band) {
  if (band === "all") return true;
  if (score == null || !Number.isFinite(Number(score))) return false;
  const n = Number(score);
  if (band === "0-2") return n >= 0 && n <= 2;
  if (band === "3-4") return n >= 3 && n <= 4;
  if (band === "5-6") return n >= 5 && n <= 6;
  if (band === "7-8") return n >= 7 && n <= 8;
  if (band === "9-10") return n >= 9 && n <= 10;
  return true;
}

export function rowHasValidCsat(row) {
  return Number(row?.csatResponses || 0) > 0;
}

export function defaultSatisfactionFilters() {
  return {
    search: "",
    engineer: "all",
    program: "all",
    quarter: "latest",
    npsClassification: "all",
    hasCsat: "all",
    lastNpsBand: "all",
  };
}

export function buildScopedSatisfactionView(payload, filters = {}) {
  const f = { ...defaultSatisfactionFilters(), ...filters };
  const scopeInputs = payload?.scopeInputs;
  if (!scopeInputs) {
    return {
      clients: payload?.clients || [],
      summary: payload?.summary || {},
      distributions: payload?.distributions || {},
      selectedQuarter: payload?.filters?.quarter || null,
    };
  }
  const clientPrograms = new Map(scopeInputs.clientPrograms || []);
  const clientMap = new Map(scopeInputs.clientBasics || []);
  const selectedQuarter = resolveSatisfactionQuarter(scopeInputs.npsQuarterly, f.quarter);
  const scoped = buildSatisfactionQuarterView({
    allNpsRows: scopeInputs.allNpsRows,
    allCsatRows: scopeInputs.allCsatRows,
    npsSends: scopeInputs.npsSends,
    selectedQuarter,
    npsQuarterly: scopeInputs.npsQuarterly,
    totalClients: scopeInputs.totalClients,
    clientPrograms,
    clientMap,
  });
  return {
    clients: scoped.clients,
    summary: scoped.summary,
    distributions: {
      ...(payload?.distributions || {}),
      ...scoped.distributions,
    },
    selectedQuarter: scoped.selectedQuarter,
  };
}

export function filterSatisfactionClients(clients, filters = {}) {
  const f = { ...defaultSatisfactionFilters(), ...filters };
  const npsClass = normalizeNpsClassificationFilter(f.npsClassification);
  const hasCsat = normalizeHasCsatFilter(f.hasCsat);
  const lastNpsBand = normalizeLastNpsBand(f.lastNpsBand);

  return (Array.isArray(clients) ? clients : []).filter((row) => {
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (!programMatches({ program: row.program, programs: row.programs }, f.program)) return false;
    if (npsClass !== "all") {
      const cls = npsClassificationFromScore(row.latestNps);
      if (cls !== npsClass) return false;
    }
    if (hasCsat === "yes" && !rowHasValidCsat(row)) return false;
    if (hasCsat === "no" && rowHasValidCsat(row)) return false;
    if (!scoreInLastNpsBand(row.latestNps, lastNpsBand)) return false;
    if (!matchesSearch(row, f.search)) return false;
    return true;
  });
}

export function sortSatisfactionClients(rows, sortKey = "clientName", sortDir = "asc") {
  const list = [...(rows || [])];
  list.sort((a, b) => {
    const av = a?.[sortKey];
    const bv = b?.[sortKey];
    let cmp = 0;
    if (av == null && bv == null) cmp = 0;
    else if (av == null) cmp = 1;
    else if (bv == null) cmp = -1;
    else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv), "pt-BR", { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });
  return list;
}
