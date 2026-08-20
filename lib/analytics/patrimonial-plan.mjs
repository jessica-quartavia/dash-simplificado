/**
 * Plano Patrimonial V2 — somente o indicador aprovado: tempo médio até aprovação.
 * Fonte: BASE QV (clients + client_meetings). Sem QV360. Sem Netlify.
 */
import { dataConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import { isCentralIntelligenceMeeting } from "./onboarding.mjs";
import { coverageOf } from "./onboarding-metrics.mjs";
import { blankToNull, daysBetween, parseDate } from "./meeting-metrics.mjs";

const CLIENT_SELECT = "id,codigo,name,engenheiro_patrimonial,data_inicio_ciclo,created_at";
const MEETING_SELECT = "id,client_id,event_name,start_time,created_at";

function firstValue(row, names) {
  for (const name of names) {
    const value = blankToNull(row?.[name]);
    if (value != null) return value;
  }
  return null;
}

export function uniqueByClientId(clients) {
  const seen = new Set();
  const unique = [];
  for (const client of clients || []) {
    const clientId = String(firstValue(client, ["id", "client_id", "uuid"]) || "");
    if (!clientId || seen.has(clientId)) continue;
    seen.add(clientId);
    unique.push(client);
  }
  return unique;
}

export function contractDateFromClient(client) {
  return parseDate(firstValue(client, ["data_inicio_ciclo", "contract_date", "created_at"]));
}

export function lastCentralMeetingDate(meetings) {
  const dates = (meetings || [])
    .map((row) => parseDate(firstValue(row, ["start_time", "meeting_date", "scheduled_at", "created_at"])))
    .filter(Boolean)
    .sort((a, b) => a - b);
  return dates.at(-1) || null;
}

export function daysToApproval(contractDate, approvedAt, { now = new Date(), excludeFuture = true } = {}) {
  if (!contractDate || !approvedAt) return null;
  if (excludeFuture && approvedAt > now) return null;
  const days = daysBetween(contractDate, approvedAt);
  return days >= 0 ? days : null;
}

export function meanDays(values) {
  const nums = (values || []).filter((value) => value != null && Number.isFinite(value) && value >= 0);
  if (!nums.length) return null;
  return Math.round((nums.reduce((sum, value) => sum + value, 0) / nums.length) * 100) / 100;
}

export function summarizePlanRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const eligible = list.filter((row) => row.daysToApproval != null);
  const coverage = coverageOf(eligible.length, list.length);
  return {
    totalPopulation: list.length,
    withCentralMeeting: list.filter((row) => row.approvedAt).length,
    eligibleClients: eligible.length,
    value: meanDays(eligible.map((row) => row.daysToApproval)),
    calculation: "mean",
    coveragePercent: coverage.percent,
    coverage,
  };
}

export function buildPatrimonialPlanSummary({
  clients,
  meetings,
  now = new Date(),
  excludeFuture = true,
} = {}) {
  const list = uniqueByClientId(clients);
  const byClient = new Map();
  for (const row of meetings || []) {
    if (!isCentralIntelligenceMeeting(row)) continue;
    const clientId = String(firstValue(row, ["client_id", "cliente_id", "clientId"]) || "");
    if (!clientId) continue;
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId).push(row);
  }

  const eligibleDays = [];
  const clientRows = [];
  let withCentralMeeting = 0;
  for (const client of list) {
    const clientMeetings = byClient.get(String(client.id)) || [];
    const approvedAt = clientMeetings.length ? lastCentralMeetingDate(clientMeetings) : null;
    if (clientMeetings.length) withCentralMeeting += 1;
    const contractDate = contractDateFromClient(client);
    const days = daysToApproval(contractDate, approvedAt, { now, excludeFuture });
    if (days != null) eligibleDays.push(days);
    clientRows.push({
      clientId: String(client.id),
      clientCode: blankToNull(client.codigo),
      clientName: blankToNull(client.name) || "Não informado",
      engineer: blankToNull(client.engenheiro_patrimonial) || "Não informado",
      contractDate: contractDate ? contractDate.toISOString() : null,
      approvedAt: approvedAt ? approvedAt.toISOString() : null,
      daysToApproval: days,
    });
  }

  const coverage = coverageOf(eligibleDays.length, list.length);
  return {
    totalPopulation: list.length,
    withCentralMeeting,
    eligibleClients: eligibleDays.length,
    value: meanDays(eligibleDays),
    calculation: "mean",
    coveragePercent: coverage.percent,
    coverage,
    clients: clientRows,
  };
}

export function toPublicPatrimonialPlanPayload(payload) {
  const approval = payload?.approvalTime || {};
  return {
    generatedAt: payload?.generatedAt || new Date().toISOString(),
    scope: {
      population: "full_portfolio",
      populationLabel: "Carteira completa",
      activeFirstApplied: false,
    },
    approvalTime: {
      value: approval.value ?? null,
      unit: "days",
      calculation: "mean",
      calculationLabel: "média",
      eligibleClients: approval.eligibleClients || 0,
      totalPopulation: approval.totalPopulation || 0,
      coveragePercent: approval.coveragePercent || 0,
    },
    clients: (payload?.clients || approval.clients || []).map((row) => ({
      clientId: row.clientId,
      clientCode: row.clientCode,
      clientName: row.clientName,
      engineer: row.engineer,
      contractDate: row.contractDate,
      approvedAt: row.approvedAt,
      daysToApproval: row.daysToApproval,
    })),
  };
}

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

export async function computePatrimonialPlanPayload({
  now = new Date(),
  excludeFuture = true,
  applyExclusions = true,
} = {}) {
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }

  const totalStarted = Date.now();
  const [clientsTimed, meetingsTimed] = await Promise.all([
    timed(() => fetchAllRows({ table: "clients", select: CLIENT_SELECT })),
    timed(() => fetchAllRows({ table: "client_meetings", select: MEETING_SELECT })),
  ]);

  const clientsRaw = clientsTimed.value || [];
  const clients = applyExclusions ? filterExcludedClients(clientsRaw) : uniqueByClientId(clientsRaw);
  const removedIds = applyExclusions ? excludedClientIds(clientsRaw) : new Set();
  const meetings = (meetingsTimed.value || []).filter((row) => !removedIds.has(String(row?.client_id || "")));

  const transformStarted = Date.now();
  const summary = buildPatrimonialPlanSummary({ clients, meetings, now, excludeFuture });
  return {
    generatedAt: new Date().toISOString(),
    approvalTime: summary,
    clients: summary.clients || [],
    timing: {
      clientsMs: clientsTimed.ms,
      meetingsMs: meetingsTimed.ms,
      transformMs: Date.now() - transformStarted,
      totalMs: Date.now() - totalStarted,
    },
  };
}
