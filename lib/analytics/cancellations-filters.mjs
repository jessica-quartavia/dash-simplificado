/**
 * Filtros — Cancelamento (V2).
 * População de processo/cancelamento — sem active-first forçado.
 */
import {
  STATUS_FILTER_OPTIONS,
  normalizeStatusFilter,
} from "./general-filters.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { matchesSearch } from "./filters/search.mjs";
import { programMatches } from "./filters/program.mjs";
import { defaultPeriodState, inPeriod, resolvePeriod } from "./filters/period.mjs";
import { STAGE_KEYS } from "./cancellation-process.mjs";

export { STATUS_FILTER_OPTIONS, normalizeStatusFilter };

export const CANCELLATION_STAGE_FILTER_OPTIONS = [
  { value: "all", label: "Todas as etapas" },
  { value: "intencao_pedido", label: "Intenção/pedido" },
  { value: "intencao", label: "Intenção" },
  { value: "pedido", label: "Pedido" },
  { value: "efetivado", label: "Cancelamento efetivado" },
];

export const NO_RESPONSIBLE_LABEL = "Sem responsável";

export function normalizeCancellationStageFilter(value) {
  const raw = String(value || "all").trim();
  return CANCELLATION_STAGE_FILTER_OPTIONS.some((item) => item.value === raw) ? raw : "all";
}

export function normalizeReasonCategoryFilter(value) {
  const raw = String(value || "all").trim();
  return raw && raw !== "all" ? raw : "all";
}

export function normalizeResponsibleFilter(value) {
  const raw = String(value || "all").trim();
  return raw && raw !== "all" ? raw : "all";
}

export function foldCategoryKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export function matchesCancellationStage(row, stageFilter) {
  const stage = normalizeCancellationStageFilter(stageFilter);
  if (stage === "all") return true;
  if (stage === "efetivado") return Boolean(row?.hasEfetivado);
  if (stage === "intencao_pedido") {
    return Boolean(row?.hasIntentionOrPedido || row?.hasIntencao || row?.hasPedido);
  }
  if (stage === "intencao") return Boolean(row?.hasIntencao);
  if (stage === "pedido") return Boolean(row?.hasPedido);
  return true;
}

export function matchesReasonCategory(row, categoryFilter) {
  const category = normalizeReasonCategoryFilter(categoryFilter);
  if (category === "all") return true;
  const rowCategory = row?.reasonCategory || row?.category || "Não informado";
  return foldCategoryKey(rowCategory) === foldCategoryKey(category);
}

export function matchesResponsible(row, responsibleFilter) {
  const filter = normalizeResponsibleFilter(responsibleFilter);
  if (filter === "all") return true;
  const responsavel = row?.responsavel || "Não informado";
  if (filter === NO_RESPONSIBLE_LABEL) {
    return !responsavel || responsavel === "Não informado";
  }
  return responsavel === filter;
}

export function defaultCancellationFilters() {
  return {
    search: "",
    status: "all",
    engineer: "all",
    segment: "all",
    program: "all",
    cancellationStage: "all",
    reasonCategory: "all",
    responsible: "all",
    ...defaultPeriodState(),
  };
}

export function cancellationEffectiveDate(row) {
  if (!row?.hasEfetivado) return null;
  if (row.hasConfirmedDate === false || row.effectiveWithoutConfirmedDate) return null;
  return row.cancellationDate || null;
}

export function rowInCancellationPeriod(row, period, { includeInProcess = false } = {}) {
  if (!period?.active) return true;
  if (includeInProcess && row.inProcessCurrently) return true;
  const effective = cancellationEffectiveDate(row);
  if (effective && inPeriod(effective, period)) return true;
  const intencaoAt = row.intencaoAt || null;
  if (intencaoAt && inPeriod(intencaoAt, period)) return true;
  const pedidoAt = row.pedidoAt || null;
  if (pedidoAt && inPeriod(pedidoAt, period)) return true;
  return false;
}

export function filterCancellationClients(clients, filters = {}, options = {}) {
  const f = { ...defaultCancellationFilters(), ...filters };
  const statusFilter = normalizeStatusFilter(f.status);
  const period = resolvePeriod(f, options.now || new Date());
  const includeInProcess = options.includeInProcessDespitePeriod !== false;
  return (Array.isArray(clients) ? clients : []).filter((row) => {
    if (!matchesAnalyticalStatusFilter(row.analyticalStatus, statusFilter)) return false;
    if (f.engineer !== "all" && row.engineer !== f.engineer) return false;
    if (f.segment !== "all" && row.segment !== f.segment) return false;
    if (!programMatches(row, f.program)) return false;
    if (!matchesCancellationStage(row, f.cancellationStage)) return false;
    if (!matchesReasonCategory(row, f.reasonCategory)) return false;
    if (!matchesResponsible(row, f.responsible)) return false;
    if (period.active && !rowInCancellationPeriod(row, period, { includeInProcess })) return false;
    if (!matchesSearch(row, f.search)) return false;
    return true;
  });
}

export function filterCancellationEffectiveRows(clients, filters = {}, options = {}) {
  const base = filterCancellationClients(clients, filters, options);
  const period = resolvePeriod(filters, options.now || new Date());
  return base.filter((row) => {
    if (!row.hasEfetivado) return false;
    if (!period.active) return true;
    const effective = cancellationEffectiveDate(row);
    return Boolean(effective && inPeriod(effective, period));
  });
}

export function collectCancellationReasonCategories(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const label = row?.reasonCategory || row?.category;
    if (!label) continue;
    const key = foldCategoryKey(label);
    if (!map.has(key)) map.set(key, label);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function collectCancellationResponsibles(rows) {
  const set = new Set();
  let hasMissing = false;
  for (const row of rows || []) {
    const name = row?.responsavel;
    if (!name || name === "Não informado") {
      hasMissing = true;
      continue;
    }
    set.add(name);
  }
  const list = [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (hasMissing) list.unshift(NO_RESPONSIBLE_LABEL);
  return list;
}

export { STAGE_KEYS };

export function sortCancellationClients(rows, sortKey = "clientName", sortDir = "asc") {
  const list = [...(rows || [])];
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
