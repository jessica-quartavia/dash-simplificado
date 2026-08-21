/**
 * Filtros — Acionamentos.
 */
import { matchesSearch } from "./filters/search.mjs";
import { defaultPeriodState, inPeriod, resolvePeriod } from "./filters/period.mjs";
import { PRIORITY_ORDER } from "./support-analytics.mjs";

function supportFold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function ticketSearchText(ticket) {
  return supportFold(`${ticket.type || ""} ${ticket.title || ""} ${ticket.description || ""}`);
}

function percentile(values, q) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const position = (nums.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return nums[base + 1] !== undefined
    ? Math.round((nums[base] + rest * (nums[base + 1] - nums[base])) * 10) / 10
    : nums[base];
}

export const IDENTIFIED_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "yes", label: "Sim" },
  { value: "no", label: "Não" },
];

export function defaultSupportFilters() {
  return {
    search: "",
    area: "all",
    type: "all",
    priority: "all",
    status: "all",
    requester: "all",
    identified: "all",
    ...defaultPeriodState(),
  };
}

export function filterSupportTickets(tickets, filters = {}, options = {}) {
  const f = { ...defaultSupportFilters(), ...filters };
  const period = resolvePeriod(f, options.now || new Date());
  return (Array.isArray(tickets) ? tickets : []).filter((row) => {
    if (f.area !== "all" && row.area !== f.area) return false;
    if (f.type !== "all" && row.type !== f.type) return false;
    if (f.priority !== "all" && row.priority !== f.priority) return false;
    if (f.status !== "all" && row.status !== f.status) return false;
    if (f.requester !== "all" && row.requester !== f.requester) return false;
    if (f.identified === "yes" && !row.clientIdentified) return false;
    if (f.identified === "no" && row.clientIdentified) return false;
    if (period.active) {
      const date = row.openedAt || row.createdAt || row.data_abertura;
      if (date && !inPeriod(date, period)) return false;
    }
    if (!matchesSearch(row, f.search, ["title", "clientName", "requester", "area", "type", "ticketId"])) return false;
    return true;
  });
}

export function summarizeFilteredSupport(tickets, baseSummary = {}) {
  const list = Array.isArray(tickets) ? tickets : [];
  const total = list.length;
  const urgent = list.filter((t) => t.priority === "Urgente").length;
  const withClient = list.filter((t) => t.clientIdentified).length;
  const identifiedClients = new Set(
    list.filter((t) => t.clientIdentified && t.primaryClientId).map((t) => String(t.primaryClientId)),
  ).size;
  const byArea = countBy(list, (t) => t.area);
  const byType = countBy(list, (t) => t.type);
  const byPriorityMap = countBy(list, (t) => t.priority);
  const topArea = topEntry(byArea);
  const topType = topEntry(byType);
  const complaints = list.filter((t) => ticketSearchText(t).includes("reclam")).length;
  const praiseTickets = list.filter((t) => ticketSearchText(t).includes("elog")).length;
  const escalatedTickets = list.filter((t) => ["Urgente", "Alta"].includes(t.priority)).length;
  const resolutionValues = list.map((t) => t.resolutionHours).filter((v) => v != null && Number.isFinite(v));
  const medianResolutionHours = resolutionValues.length ? percentile(resolutionValues, 0.5) : null;
  return {
    totalTickets: total,
    urgentTickets: urgent,
    ticketsWithClient: withClient,
    identifiedClients,
    identificationCoverage: total ? Math.round((withClient / total) * 1000) / 10 : 0,
    complaints,
    praiseTickets,
    escalatedTickets,
    medianResolutionHours,
    topArea: topArea?.label || baseSummary.topArea || null,
    topAreaCount: topArea?.count || 0,
    topType: topType?.label || baseSummary.topType || null,
    topTypeCount: topType?.count || 0,
    byArea: toDist(byArea, total),
    byType: toDist(byType, total),
    byPriority: toDistOrdered(byPriorityMap, total),
    byStatus: toDist(countBy(list, (t) => t.status), total),
  };
}

function countBy(list, keyFn) {
  const map = new Map();
  for (const row of list) {
    const key = keyFn(row) || "Não informado";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function topEntry(map) {
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return null;
  return { label: sorted[0][0], count: sorted[0][1] };
}

function toDist(map, total) {
  return [...map.entries()]
    .map(([label, count]) => ({
      label,
      count,
      percent: total ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

function toDistOrdered(map, total) {
  const order = new Map(PRIORITY_ORDER.map((label, index) => [label, index]));
  return PRIORITY_ORDER.map((label) => ({
    label,
    count: map.get(label) || 0,
    percent: total ? Math.round(((map.get(label) || 0) / total) * 1000) / 10 : 0,
  })).sort(
    (a, b) =>
      (order.get(a.label) ?? 999) - (order.get(b.label) ?? 999)
      || b.count - a.count,
  );
}
