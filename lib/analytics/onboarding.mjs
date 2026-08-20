/**
 * Payload de Jornada e Onboarding — BASE QV somente leitura.
 * Sem Netlify. Sem histórico completo de reuniões/mecanismos no JSON público.
 */
import { dataConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatusFromMaps,
} from "./analytical-cancellation.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import { loadAirtableFirstMeetingIndex } from "./first-meeting-fallback.mjs";
import { buildClientFirstMeetingMap } from "./first-meeting-index.mjs";
import { classifyOnboardingCompletion } from "./onboarding-completion.mjs";
import { isComparableOnboardingRow } from "./onboarding-metrics.mjs";
import { blankToNull, parseDate } from "./meeting-metrics.mjs";

const CLIENT_SELECT =
  "id,codigo,name,data_inicio_ciclo,created_at,status,engenheiro_patrimonial,programa,cpf,cpf_digits,email,phone,phone_digits,data_churn";
const CALENDLY_SELECT =
  "id,client_id,calendly_event_uri,event_name,start_time,end_time,host_email,manually_linked";
const MANUAL_SELECT =
  "id,client_id,title,start_time,end_time,google_event_id,recurrence_group_id";
const ATTENDANCE_SELECT =
  "calendly_event_uri,status,remarcado,link_gravacao,created_at,updated_at";
const IMPL_SELECT = "client_id,meeting_date,source";
const JOURNEY_SELECT = "id,client_id,current_stage_id,started_at,created_at";
const FINANCIAL_SELECT = "id,client_id,created_at";
const MECHANISM_SELECT = "id,client_id,status,implemented_at,created_at";

function labelOrUnknown(value) {
  return blankToNull(value) ?? "Não informado";
}

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export function isCentralIntelligenceMeeting(row) {
  return fold(row?.event_name || row?.title || row?.name || row?.meeting_type)
    .includes("central de inteligencia");
}

function firstValue(row, ...names) {
  for (const name of names) {
    const value = blankToNull(row?.[name]);
    if (value != null) return value;
  }
  return null;
}

function groupByClient(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const clientId = firstValue(row, "client_id", "cliente_id", "clientId");
    if (!clientId) continue;
    const key = String(clientId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function latestByDate(rows) {
  return [...(rows || [])]
    .map((row) => ({
      row,
      date: parseDate(firstValue(row, "started_at", "created_at", "updated_at")),
    }))
    .filter((item) => item.date)
    .sort((a, b) => b.date - a.date)[0]?.row || null;
}

function minDate(values) {
  const dates = values.map(parseDate).filter(Boolean).sort((a, b) => a - b);
  return dates[0] || null;
}

function positiveStatus(value, tokens) {
  const text = String(value || "").toLowerCase();
  return tokens.some((token) => text.includes(token));
}

export function validOnboardingDays(start, end, now = new Date()) {
  if (!start || !end) return null;
  if (end > now) return null;
  const days = Math.floor(
    (Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
      - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
    / 86400000,
  );
  return days >= 0 ? days : null;
}

function resolveContractDate(client) {
  return parseDate(client.data_inicio_ciclo) || parseDate(client.created_at);
}

async function fetchAllSafe(table, select, extra = {}) {
  try {
    const rows = await fetchAllRows({ table, select, ...extra });
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

export function buildOnboardingPayload({
  clients,
  calendlyRows,
  manualRows,
  attendanceRows,
  implRows,
  cancellations,
  journeys,
  financialRows,
  mechanisms,
  airtableIndex = null,
  now = new Date(),
} = {}) {
  const warnings = [];
  const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations || [], clients || []);
  const firstByClient = buildClientFirstMeetingMap({
    clients,
    calendlyRows,
    manualRows,
    attendanceRows,
    implRows,
    airtableIndex,
    now,
  });
  const journeysByClient = groupByClient(journeys);
  const financialByClient = groupByClient(financialRows);
  const mechanismsByClient = groupByClient(mechanisms);
  const meetingsByClient = groupByClient(calendlyRows);

  const rows = [];
  for (const client of clients || []) {
    const clientId = String(client.id);
    const contractDate = resolveContractDate(client);
    const cancelInfo = cancelMap.get(clientId) || null;
    const analyticalStatus = resolveAnalyticalStatusFromMaps(client?.status, cancelInfo);
    const first = firstByClient.get(clientId) || {};
    const clientJourneys = journeysByClient.get(clientId) || [];
    const financialRecords = financialByClient.get(clientId) || [];
    const clientMechanisms = mechanismsByClient.get(clientId) || [];
    const clientMeetings = meetingsByClient.get(clientId) || [];

    const firstMeetingDate = parseDate(first.firstMeetingDate);
    const daysToFirstMeeting = first.daysFromEntryToFirstMeeting != null
      ? first.daysFromEntryToFirstMeeting
      : validOnboardingDays(contractDate, firstMeetingDate, now);

    const firstFinancialDate = minDate(financialRecords.map((row) => firstValue(row, "created_at")));
    const daysToFirstFinancialData = validOnboardingDays(contractDate, firstFinancialDate, now);

    const planDelivered = minDate(
      clientMeetings
        .filter(isCentralIntelligenceMeeting)
        .map((row) => firstValue(row, "start_time", "meeting_date", "scheduled_at", "created_at")),
    );
    const daysToPlanDelivery = validOnboardingDays(contractDate, planDelivered, now);

    const firstImplementation = minDate(
      clientMechanisms
        .filter((row) =>
          positiveStatus(firstValue(row, "status", "state"), ["implement", "implant", "conclu", "feito"])
          || firstValue(row, "implemented_at", "implantado_at", "data_implementacao"),
        )
        .map((row) => firstValue(row, "implemented_at", "implantado_at", "data_implementacao", "updated_at", "created_at")),
    );
    const daysToFirstImplementation = validOnboardingDays(contractDate, firstImplementation, now);

    const milestones = [
      { source: "base_qv_client_meetings", days: daysToFirstMeeting },
      { source: "base_qv_client_financial_data", days: daysToFirstFinancialData },
    ].filter((item) => item.days != null).sort((a, b) => a.days - b.days);
    const totalOnboardingDays = milestones[0]?.days ?? null;

    const latestJourney = latestByDate(clientJourneys);
    const latestStageId = latestJourney
      ? String(firstValue(latestJourney, "current_stage_id", "stage_id") || "")
      : null;
    const hasFirstMeeting = daysToFirstMeeting != null;
    const hasFinancialData = financialRecords.length > 0;
    const completion = classifyOnboardingCompletion({
      latestStageId,
      hasFirstMeeting,
      hasFinancialData,
    });

    const row = {
      clientId,
      clientCode: blankToNull(client.codigo),
      clientName: blankToNull(client.name) || "Não informado",
      engineer: labelOrUnknown(client.engenheiro_patrimonial),
      program: blankToNull(client.programa),
      rawStatus: blankToNull(client.status),
      analyticalStatus,
      contractDate: contractDate ? contractDate.toISOString() : null,
      firstMeetingDate: firstMeetingDate ? firstMeetingDate.toISOString() : null,
      planDeliveredDate: planDelivered ? planDelivered.toISOString() : null,
      firstImplementationDate: firstImplementation ? firstImplementation.toISOString() : null,
      daysToFirstMeeting,
      daysToPlanDelivery,
      daysToFirstImplementation,
      daysToFirstFinancialData,
      totalOnboardingDays,
      totalOnboardingDaysSource: milestones[0]?.source || null,
      completedOnboarding: completion.completedOnboarding,
      completedOnboardingSource: completion.completedOnboardingSource,
      completedByJourney: completion.completedByJourney,
      hasFinancialData,
    };
    row.inComparableCohort = isComparableOnboardingRow(row);
    rows.push(row);
  }

  if (airtableIndex && airtableIndex.available === false && airtableIndex.reason) {
    warnings.push(`airtable_fallback: ${airtableIndex.reason}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    defaultStatusFilter: "active",
    clients: rows,
    metadata: {
      completionRule:
        "Concluiu se o estágio atual não é aberto, ou se há primeira reunião válida, ou se há client_financial_data. Não avaliável só quando falta jornada, reunião e financeiro.",
      firstMeetingRule:
        "Primeira reunião = helper de Reuniões (presença confirmada no passado, após a entrada; sem futura; dias negativos inválidos; fallback Airtable).",
      planRule:
        "Entrega do plano = primeira client_meetings com título/evento contendo 'central de inteligencia'.",
      mechanismRule:
        "Primeiro mecanismo = primeira implementação válida em client_mecanismos (status implementado/concluído ou implemented_at).",
      comparableCohortRule:
        "Tempo total e medianas de reunião/plano usam a coorte com os três marcos, intervalos não negativos e ordem cronológica.",
      activeFirstNote:
        "O compute devolve a carteira completa. O default da página é Ativos. Métricas de tempo são recalculadas no recorte filtrado.",
      hiddenCharts: ["firstImplementation"],
      warnings,
    },
  };
}

export function toPublicOnboardingPayload(payload) {
  return {
    generatedAt: payload?.generatedAt || new Date().toISOString(),
    defaultStatusFilter: "active",
    metadata: payload?.metadata || {},
    clients: (payload?.clients || []).map((row) => ({
      clientId: row.clientId,
      clientCode: row.clientCode,
      clientName: row.clientName,
      engineer: row.engineer,
      analyticalStatus: row.analyticalStatus,
      contractDate: row.contractDate,
      daysToFirstMeeting: row.daysToFirstMeeting,
      daysToPlanDelivery: row.daysToPlanDelivery,
      daysToFirstImplementation: row.daysToFirstImplementation,
      totalOnboardingDays: row.totalOnboardingDays,
      completedOnboarding: row.completedOnboarding,
    })),
  };
}

export async function computeOnboardingPayload() {
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }

  const totalStarted = Date.now();
  const [
    clientsTimed,
    calendlyTimed,
    manualTimed,
    attendanceTimed,
    implTimed,
    cancellationsTimed,
    journeysTimed,
    financialTimed,
    mechanismsTimed,
    airtableTimed,
  ] = await Promise.all([
    timed(() => fetchAllRows({ table: "clients", select: CLIENT_SELECT })),
    timed(() => fetchAllSafe("client_meetings", CALENDLY_SELECT)),
    timed(() => fetchAllSafe("manual_meetings", MANUAL_SELECT)),
    timed(() => fetchAllSafe("meeting_attendance", ATTENDANCE_SELECT)),
    timed(() => fetchAllSafe("client_implementation_meeting_date", IMPL_SELECT, { order: "client_id.asc" })),
    timed(() => fetchAllRows({ table: "cancellations", select: ANALYTICAL_CANCEL_SELECT })),
    timed(() => fetchAllSafe("client_journeys", JOURNEY_SELECT, { order: "id.asc" })),
    timed(() => fetchAllSafe("client_financial_data", FINANCIAL_SELECT, { order: "id.asc" })),
    timed(() => fetchAllSafe("client_mecanismos", MECHANISM_SELECT, { order: "id.asc" })),
    timed(() =>
      loadAirtableFirstMeetingIndex().catch((err) => ({
        available: false,
        reason: err?.message || "Falha ao carregar índice Airtable.",
        warnings: [],
      })),
    ),
  ]);

  const unwrap = (timedSafe) => {
    const value = timedSafe.value;
    if (value && Array.isArray(value.rows)) return value.rows;
    return Array.isArray(value) ? value : [];
  };

  const warnings = [];
  for (const [label, timedSafe] of [
    ["client_meetings", calendlyTimed],
    ["manual_meetings", manualTimed],
    ["meeting_attendance", attendanceTimed],
    ["client_implementation_meeting_date", implTimed],
    ["client_journeys", journeysTimed],
    ["client_financial_data", financialTimed],
    ["client_mecanismos", mechanismsTimed],
  ]) {
    if (timedSafe.value?.error) warnings.push(`${label}: ${timedSafe.value.error}`);
  }

  const clientsRaw = clientsTimed.value;
  const clients = filterExcludedClients(clientsRaw);
  const removedIds = excludedClientIds(clientsRaw);
  const keepClient = (row) => !removedIds.has(String(row?.client_id || ""));

  const transformStarted = Date.now();
  const payload = buildOnboardingPayload({
    clients,
    calendlyRows: unwrap(calendlyTimed).filter(keepClient),
    manualRows: unwrap(manualTimed).filter(keepClient),
    attendanceRows: unwrap(attendanceTimed),
    implRows: unwrap(implTimed).filter(keepClient),
    cancellations: cancellationsTimed.value.filter(keepClient),
    journeys: unwrap(journeysTimed).filter(keepClient),
    financialRows: unwrap(financialTimed).filter(keepClient),
    mechanisms: unwrap(mechanismsTimed).filter(keepClient),
    airtableIndex: airtableTimed.value,
  });
  if (warnings.length) {
    payload.metadata.warnings = [...(payload.metadata.warnings || []), ...warnings];
  }
  payload.timing = {
    clientsMs: clientsTimed.ms,
    meetingsMs: calendlyTimed.ms,
    journeysMs: journeysTimed.ms,
    financialMs: financialTimed.ms,
    mechanismsMs: mechanismsTimed.ms,
    cancellationsMs: cancellationsTimed.ms,
    airtableMs: airtableTimed.ms,
    transformMs: Date.now() - transformStarted,
    totalMs: Date.now() - totalStarted,
  };
  return payload;
}
