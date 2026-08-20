/**
 * Filtros — Pesquisa de Satisfação (V2).
 * Universo de respondentes; sem active-first forçado.
 */
import { matchesSearch } from "./filters/search.mjs";
import { normalizeProgramFilter, programMatches } from "./filters/program.mjs";

export function defaultSatisfactionFilters() {
  return {
    search: "",
    engineer: "all",
    program: "all",
  };
}

export function filterSatisfactionClients(clients, filters = {}) {
  const f = { ...defaultSatisfactionFilters(), ...filters };
  return (Array.isArray(clients) ? clients : []).filter((row) => {
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (!programMatches({ program: row.program, programs: row.programs }, f.program)) return false;
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
