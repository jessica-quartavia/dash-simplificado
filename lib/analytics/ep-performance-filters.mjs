/**
 * Filtros — Performance do EP (V2).
 * Busca, Programa, Status analítico, Período (eventos temporais).
 */
import { computeNpsBreakdown, npsSampleBadge, NPS_MIN_RESPONSES_PER_EP } from "./nps-metrics.mjs";
import { foldSearchText } from "./filters/search.mjs";
import { programMatches } from "./filters/program.mjs";
import { normalizeMultiSelectFilter } from "./filters/multiselect.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { normalizeStatusFilter } from "./general-filters.mjs";
import { defaultPeriodState, inPeriod, resolvePeriod } from "./filters/period.mjs";

function pct(n, d) {
  if (d == null || d <= 0 || n == null) return null;
  return Math.round((n / d) * 1000) / 10;
}

function round1(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function sampleSizeBucket(n) {
  if (n == null || n <= 0) return { code: "empty", label: "Sem clientes" };
  if (n < 10) return { code: "very_small", label: "Amostra muito pequena" };
  if (n < 30) return { code: "small", label: "Amostra pequena" };
  return { code: "regular", label: "Amostra regular" };
}

function matchesEngineerSearch(name, query) {
  const needle = foldSearchText(query);
  if (!needle) return true;
  return foldSearchText(name).includes(needle);
}

function matchesEngineerFilter(rowEngineer, selectedEngineers) {
  const selected = normalizeMultiSelectFilter(selectedEngineers);
  if (!selected.length) return true;
  const engineer = rowEngineer || "Não informado";
  return selected.includes(String(engineer));
}

function clientLevelFilters(filters) {
  return filters.segment !== "all" || filters.program !== "all" || (filters.status && filters.status !== "all");
}

function applyPeriodScopeToClient(client, period) {
  if (!period?.active) return client;
  const meetingDates = (client.meetingDates || []).filter((iso) => inPeriod(iso, period));
  const totalMeetings = meetingDates.length;
  const npsScore =
    client.npsSubmittedAt && inPeriod(client.npsSubmittedAt, period) ? client.npsScore : null;
  const npsQuarterScore =
    client.npsQuarterSubmittedAt && inPeriod(client.npsQuarterSubmittedAt, period)
      ? client.npsQuarterScore
      : null;
  const csatScore =
    client.csatSubmittedAt && inPeriod(client.csatSubmittedAt, period) ? client.csatScore : null;
  return {
    ...client,
    meetingDates,
    totalMeetings,
    npsScore,
    npsQuarterScore,
    csatScore,
    npsSubmittedAt: npsScore != null ? client.npsSubmittedAt : null,
    csatSubmittedAt: csatScore != null ? client.csatSubmittedAt : null,
  };
}

function recomputeEngineerMetrics(engineer, clients, base = {}) {
  const totalClients = clients.length;
  const activeClients = clients.filter((c) => c.analyticalStatus === "Ativo").length;
  const frozenClients = clients.filter((c) => c.analyticalStatus === "Congelado").length;
  const confirmedCancelledClients = clients.filter((c) => c.cancelled).length;
  const cancelledShareOfPortfolio = pct(confirmedCancelledClients, totalClients);
  const renewedClients = clients.filter((c) => c.renewed).length;
  const renewedPortfolioPercentage = pct(renewedClients, totalClients);
  const clientsWithMeeting = clients.filter((c) => (c.totalMeetings || 0) > 0).length;
  const meetingCoverage = pct(clientsWithMeeting, totalClients);
  const totalMeetings = clients.reduce((sum, c) => sum + (c.totalMeetings || 0), 0);
  const averageMeetingsPerClient = totalClients > 0 ? round1(totalMeetings / totalClients) : null;
  const clientsWithImplementedMechanisms = clients.filter((c) => c.hasImplementedMechanism).length;
  const npsScores = clients.map((c) => c.npsScore).filter((n) => n != null && Number.isFinite(Number(n)));
  const npsBreakdown = computeNpsBreakdown(npsScores);
  const npsSample = npsSampleBadge(npsBreakdown.responses);
  const sample = sampleSizeBucket(totalClients);

  return {
    ...base,
    engineer,
    clients,
    totalClients,
    activeClients,
    frozenClients,
    confirmedCancelledClients,
    cancelledClients: confirmedCancelledClients,
    cancelledShareOfPortfolio,
    renewedClients,
    renewedPortfolioPercentage,
    clientsWithMeeting,
    clientsWithoutMeeting: totalClients - clientsWithMeeting,
    meetingCoverage,
    totalMeetings,
    averageMeetingsPerClient,
    clientsWithImplementedMechanisms,
    nps: npsBreakdown.responses > 0 ? npsBreakdown.nps : null,
    npsMeanScore: npsBreakdown.responses > 0 ? npsBreakdown.meanScore : null,
    npsRespondentClients: npsBreakdown.responses,
    npsResponses: npsBreakdown.responses,
    npsCoverage: pct(npsBreakdown.responses, totalClients),
    npsEligible: npsBreakdown.responses >= NPS_MIN_RESPONSES_PER_EP,
    npsSampleSize: npsSample.code,
    npsSampleSizeLabel: npsSample.label,
    sampleSize: sample.code,
    sampleSizeLabel: sample.label,
  };
}

export function defaultEpPerformanceFilters() {
  return {
    search: "",
    engineer: [],
    segment: "all",
    program: "all",
    status: "all",
    ...defaultPeriodState(),
  };
}

export function normalizeEpPerformanceFilters(raw = {}) {
  const f = { ...defaultEpPerformanceFilters(), ...raw };
  if (f.status !== "all") f.status = normalizeStatusFilter(f.status);
  return f;
}

export function filterEpClients(clients, filters = {}) {
  const f = normalizeEpPerformanceFilters(filters);
  const period = resolvePeriod(f);
  const statusFilter = f.status === "all" ? "all" : f.status;

  return (Array.isArray(clients) ? clients : [])
    .filter((row) => {
      const engineer = row.engineer || row.advisor;
      if (!matchesEngineerFilter(engineer, f.engineer)) return false;
      if (f.segment !== "all" && row.segment !== f.segment) return false;
      if (!programMatches(row, f.program)) return false;
      if (statusFilter !== "all" && !matchesAnalyticalStatusFilter(row.analyticalStatus, statusFilter)) {
        return false;
      }
      if (!matchesEngineerSearch(engineer, f.search)) return false;
      return true;
    })
    .map((row) => applyPeriodScopeToClient(row, period));
}

export function filterEpEngineers(engineers, filters = {}) {
  const f = normalizeEpPerformanceFilters(filters);
  const needClientFilter = clientLevelFilters(f) || resolvePeriod(f).active;

  return (Array.isArray(engineers) ? engineers : [])
    .filter((row) => {
      if (!matchesEngineerFilter(row.engineer, f.engineer)) return false;
      if (!matchesEngineerSearch(row.engineer, f.search)) return false;
      return true;
    })
    .map((row) => {
      if (!needClientFilter) return row;
      const clients = filterEpClients(row.clients || [], { ...f, search: "", engineer: [] });
      if (!clients.length) return null;
      return recomputeEngineerMetrics(row.engineer, clients, row);
    })
    .filter(Boolean);
}

export function sortEpEngineers(rows, sortKey = "totalClients", sortDir = "desc") {
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

export function summarizeFilteredEpEngineers(engineers) {
  const rows = (Array.isArray(engineers) ? engineers : []).filter((e) => e.engineer !== "Não informado");
  const advisorsWithPortfolio = rows.length;
  const totalClients = rows.reduce((sum, e) => sum + (e.totalClients || 0), 0);
  const activeClients = rows.reduce((sum, e) => sum + (e.activeClients || 0), 0);
  const confirmedCancelled = rows.reduce((sum, e) => sum + (e.confirmedCancelledClients || e.cancelledClients || 0), 0);
  const clientsWithMeeting = rows.reduce((sum, e) => sum + (e.clientsWithMeeting || 0), 0);
  const renewedClients = rows.reduce((sum, e) => sum + (e.renewedClients || 0), 0);

  return {
    advisorsWithPortfolio,
    totalClients,
    activeClients,
    meetingCoverage: pct(clientsWithMeeting, totalClients),
    clientsWithMeeting,
    cancelledShareOfPortfolio: pct(confirmedCancelled, totalClients),
    confirmedCancelledClients: confirmedCancelled,
    renewedPortfolioPercentage: pct(renewedClients, totalClients),
    renewedClients,
  };
}

export const EP_PERIOD_SEMANTICS = {
  portfolioSnapshot: "Carteira/status: snapshot do recorte filtrado (não recortado por período).",
  meetings: "Reuniões: data start_time da reunião.",
  npsCsat: "NPS/CSAT: data da resposta.",
  cancelledShare: "Taxa cancelada: composição da carteira filtrada (snapshot).",
};
