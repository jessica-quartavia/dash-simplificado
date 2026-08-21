import { dataConfigurationError } from "../env.mjs";
import {
  computeNpsBreakdown,
  dedupeNpsResponses,
  npsSampleBadge,
  NPS_MIN_COVERAGE_PCT,
  NPS_MIN_RESPONSES_PER_EP,
} from "./nps-metrics.mjs";
import {
  isConfirmedCancelledStatus,
  isEffectiveCancelledStatus,
  isMarkedCancelledNoEvidenceStatus,
  isEffectiveCancelledWithoutDateStatus,
} from "./analytical-cancellation.mjs";
import {
  computeGeneralDataPayload,
} from "./general-data.mjs";
import { robustStats } from "./general-metrics.mjs";
import { computeMeetingsPayload } from "./meetings.mjs";
import { computeMechanismsPayload } from "./mechanisms.mjs";
import {
  getAnalyticsDataContext,
  perfDebugFromOptions,
  runWithAnalyticsDataContext,
} from "./analytics-data-context.mjs";
import {
  parseCurrentCycle,
  renewalFromCycle,
  cycleDistributionLabel,
} from "./client-cycle-renewal.mjs";

/**
 * Performance do Engenheiro Patrimonial (BASE QV).
 *
 * Atribuição: EP atualmente vinculado ao cliente (clients.engenheiro_patrimonial).
 * Fontes: general-data, meetings, nps_responses, client_mecanismos, vw_clients_ciclo_churn (auditoria).
 */

const CYCLE_VIEW = "vw_clients_ciclo_churn";
const CYCLE_SELECT =
  "client_id,programa,status,data_inicio_ciclo,fl_churn,data_churn_consolidada";

function csatScoreOf(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value < 1) return null;
  return Math.min(value, 5);
}

function isCsatFormRow(row) {
  return String(row?.tipo_de_forms || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .includes("csat");
}

function dedupeCsatResponses(rows) {
  const best = new Map();
  for (const row of rows || []) {
    if (!isCsatFormRow(row)) continue;
    const clientId = row?.client_id != null ? String(row.client_id) : "";
    if (!clientId) continue;
    const score = csatScoreOf(row.score);
    if (score == null) continue;
    const submittedMs = row.submitted_at ? new Date(row.submitted_at).getTime() : NaN;
    const createdMs = row.created_at ? new Date(row.created_at).getTime() : NaN;
    const sortSubmitted = Number.isFinite(submittedMs) ? submittedMs : -1;
    const sortCreated = Number.isFinite(createdMs) ? createdMs : -1;
    const cur = best.get(clientId);
    const better =
      !cur
      || sortSubmitted > cur.submittedMs
      || (sortSubmitted === cur.submittedMs && sortCreated >= cur.createdMs);
    if (better) {
      best.set(clientId, {
        clientId,
        score,
        submittedAt: row.submitted_at || null,
        createdAt: row.created_at || null,
        submittedMs: sortSubmitted,
        createdMs: sortCreated,
      });
    }
  }
  return [...best.values()];
}

function pct(n, d) {
  if (d == null || d <= 0 || n == null) return null;
  return Math.round((n / d) * 1000) / 10;
}

function round1(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function blankToNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseDate(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const brazilianDate = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (brazilianDate) {
      const [, day, month, year] = brazilianDate;
      const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function quarterKey(value) {
  const date = parseDate(value);
  return date ? `${date.getUTCFullYear()} T${Math.floor(date.getUTCMonth() / 3) + 1}` : null;
}

function saoPauloDayKey(value) {
  const date = parseDate(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function csatScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0) return null;
  return Math.min(5, score);
}

function isCsatRow(row) {
  return normalizeIdentity(row?.tipo_de_forms).includes("csat") && csatScore(row?.score) != null;
}

function dedupeCsatRows(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!isCsatRow(row)) return false;
    const key = String(row.typeform_response_id || row.form_response_id || row.id || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function engineerResolver(engineers) {
  const candidates = [...new Set(engineers.filter((name) => !engineerIsBlank(name)))].map((name) => {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    return {
      name,
      full: normalizeIdentity(name),
      firstLast: normalizeIdentity(words.length > 1 ? `${words[0]}${words.at(-1)}` : words[0]),
    };
  });
  return (email) => {
    const local = normalizeIdentity(String(email || "").split("@")[0]);
    if (!local) return null;
    const matches = candidates.filter((candidate) => candidate.full === local || candidate.firstLast === local);
    return matches.length === 1 ? matches[0].name : null;
  };
}

function buildMeetingsCsatQuarter(generalClients, meetingsPayload, rawCsatRows) {
  const currentEngineerByClient = new Map();
  const engineerNames = [];
  for (const client of generalClients) {
    const clientId = String(client.clientId || client.id || "");
    const engineer = blankToNull(client.engineer) || "Não informado";
    if (clientId) currentEngineerByClient.set(clientId, engineer);
    engineerNames.push(engineer);
  }
  const resolveHostEngineer = engineerResolver(engineerNames);
  const meetings = [];
  for (const client of Array.isArray(meetingsPayload?.clients) ? meetingsPayload.clients : []) {
    const clientId = String(client.clientId || "");
    for (const meeting of Array.isArray(client.meetings) ? client.meetings : []) {
      if (!meeting?.startTime || meeting.meetingDateStatus === "before_client_entry" || meeting.meetingDateStatus === "invalid") continue;
      const hostEngineer = resolveHostEngineer(meeting.hostEmail);
      meetings.push({
        clientId,
        meetingId: meeting.meetingId || null,
        startTime: meeting.startTime,
        quarter: quarterKey(meeting.startTime),
        day: saoPauloDayKey(meeting.startTime),
        engineer: hostEngineer || currentEngineerByClient.get(clientId) || "Não informado",
        attribution: hostEngineer ? "meeting_host" : "current_client_engineer",
      });
    }
  }

  const csatRows = dedupeCsatRows(rawCsatRows);
  const currentQuarter = quarterKey(new Date());
  const latestQuarter = csatRows
    .map((row) => quarterKey(row.created_at || row.meeting_date))
    .filter((quarter) => quarter && (!currentQuarter || quarter <= currentQuarter))
    .sort()
    .at(-1)
    || meetings.map((meeting) => meeting.quarter).filter((quarter) => quarter && (!currentQuarter || quarter <= currentQuarter)).sort().at(-1)
    || null;
  const quarterMeetings = meetings.filter((meeting) => meeting.quarter === latestQuarter);
  const meetingsByClientDay = new Map();
  for (const meeting of quarterMeetings) {
    const key = `${meeting.clientId}|${meeting.day}`;
    if (!meetingsByClientDay.has(key)) meetingsByClientDay.set(key, []);
    meetingsByClientDay.get(key).push(meeting);
  }

  const byEngineer = new Map();
  const bucketFor = (engineer) => {
    const key = engineer || "Não informado";
    if (!byEngineer.has(key)) {
      byEngineer.set(key, {
        engineer: key,
        meetings: 0,
        meetingsAttributedByHost: 0,
        meetingsAttributedByCurrentEngineer: 0,
        scores: [],
        directResponses: 0,
        fallbackResponses: 0,
        ambiguousResponses: 0,
      });
    }
    return byEngineer.get(key);
  };

  for (const meeting of quarterMeetings) {
    const bucket = bucketFor(meeting.engineer);
    bucket.meetings += 1;
    if (meeting.attribution === "meeting_host") bucket.meetingsAttributedByHost += 1;
    else bucket.meetingsAttributedByCurrentEngineer += 1;
  }

  for (const row of csatRows) {
    const responseDate = row.meeting_date || row.created_at;
    if (quarterKey(row.created_at || row.meeting_date) !== latestQuarter) continue;
    const clientId = String(row.client_id || "");
    const candidates = meetingsByClientDay.get(`${clientId}|${saoPauloDayKey(responseDate)}`) || [];
    const hostEngineers = [...new Set(candidates.filter((m) => m.attribution === "meeting_host").map((m) => m.engineer))];
    const directEngineer = hostEngineers.length === 1 ? hostEngineers[0] : null;
    const engineer = directEngineer || currentEngineerByClient.get(clientId) || "Não informado";
    const bucket = bucketFor(engineer);
    bucket.scores.push(csatScore(row.score));
    if (directEngineer && candidates.length === 1) bucket.directResponses += 1;
    else {
      bucket.fallbackResponses += 1;
      if (candidates.length > 1 || hostEngineers.length > 1) bucket.ambiguousResponses += 1;
    }
  }

  const rows = [...byEngineer.values()]
    .map((bucket) => ({
      engineer: bucket.engineer,
      meetingsQuarter: bucket.meetings,
      meetingsAttributedByHost: bucket.meetingsAttributedByHost,
      meetingsAttributedByCurrentEngineer: bucket.meetingsAttributedByCurrentEngineer,
      csatAverage: bucket.scores.length ? round1(bucket.scores.reduce((sum, value) => sum + value, 0) / bucket.scores.length) : null,
      csatResponses: bucket.scores.length,
      csatDirectResponses: bucket.directResponses,
      csatFallbackResponses: bucket.fallbackResponses,
      csatAmbiguousResponses: bucket.ambiguousResponses,
      csatCoverage: bucket.meetings ? Math.min(100, pct(bucket.scores.length, bucket.meetings)) : null,
    }))
    .sort((a, b) => b.meetingsQuarter - a.meetingsQuarter || a.engineer.localeCompare(b.engineer, "pt-BR"));
  return {
    quarter: latestQuarter,
    rows,
    methodology: {
      meetingKey: "client_meetings.id",
      csatKeyAvailable: false,
      csatJoin: "client_id + data da reunião em America/Sao_Paulo",
      directAttribution: "client_meetings.host_email associado ao nome do EP",
      fallbackAttribution: "clients.engenheiro_patrimonial atual",
    },
  };
}

function inPeriod(iso, from, to) {
  if (!from && !to) return true;
  const d = parseDate(iso);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function sampleSizeBucket(n) {
  if (n == null || n <= 0) return { code: "empty", label: "Sem clientes" };
  if (n < 10) return { code: "very_small", label: "Amostra muito pequena" };
  if (n < 30) return { code: "small", label: "Amostra pequena" };
  return { code: "regular", label: "Amostra regular" };
}

function engineerIsBlank(name) {
  return !name || name === "Não informado";
}

function toIsoDate(value) {
  const d = parseDate(value);
  return d ? d.toISOString() : null;
}

function parseCycleStart(client) {
  return toIsoDate(client?.data_inicio_ciclo ?? client?.cycleStart ?? client?.contractDate);
}

function parseCycleEnd(client) {
  return toIsoDate(client?.data_fim_ciclo ?? client?.cycleEnd);
}

function implementedMechanismDetails(mechClient) {
  return (Array.isArray(mechClient?.mechanisms) ? mechClient.mechanisms : [])
    .filter((m) => m.status === "Implementado")
    .map((m) => ({
      mechanismId: String(m.mechanismId || ""),
      name: m.name || m.mechanismName || "Não informado",
    }))
    .filter((m) => m.mechanismId);
}

function aggregateMechanismsForClients(clients) {
  const clientsWithImplementedMechanisms = clients.filter((c) => c.hasImplementedMechanism).length;
  const byMech = new Map();
  for (const c of clients) {
    for (const m of c.implementedMechanismDetails || []) {
      const id = m.mechanismId;
      const cur = byMech.get(id) || {
        mechanismId: id,
        mechanismName: m.name,
        clients: 0,
        implementations: 0,
        clientIds: new Set(),
      };
      cur.implementations += 1;
      if (!cur.clientIds.has(c.clientId)) {
        cur.clientIds.add(c.clientId);
        cur.clients += 1;
      }
      byMech.set(id, cur);
    }
  }
  const mechanisms = [...byMech.values()]
    .map(({ clientIds, ...rest }) => ({
      mechanismId: rest.mechanismId,
      mechanismName: rest.mechanismName,
      clients: rest.clients,
      implementations: rest.implementations,
      percentage: pct(rest.clients, clientsWithImplementedMechanisms),
    }))
    .sort(
      (a, b) =>
        b.clients - a.clients
        || String(a.mechanismName).localeCompare(String(b.mechanismName), "pt-BR"),
    );
  const implementedMechanisms = clients.reduce((a, c) => a + (c.implementedMechanisms || 0), 0);
  const mechanismTypesUsed = mechanisms.length;
  const avgImplementedAmongWithMechanism =
    clientsWithImplementedMechanisms > 0
      ? round1(implementedMechanisms / clientsWithImplementedMechanisms)
      : null;
  return {
    mechanisms,
    mechanismTypesUsed,
    avgImplementedAmongWithMechanism,
    clientsWithImplementedMechanisms,
    implementedMechanisms,
  };
}

function pushThemeWarnings(warnings, code, label, messages, max = 5) {
  if (!messages.length) return;
  const sample = messages.slice(0, max);
  const extra = messages.length > max ? messages.length - max : 0;
  warnings.push({
    code,
    severity: "warning",
    label,
    count: messages.length,
    message: sample.join(" "),
    samples: sample,
    ...(extra > 0 ? { truncated: extra } : {}),
  });
}

function isConfirmedCancelled(status) {
  return isConfirmedCancelledStatus(status);
}

function isCancelledWithoutConfirmedDate(status) {
  return isMarkedCancelledNoEvidenceStatus(status);
}

function isEffectiveCancelled(status) {
  return isEffectiveCancelledStatus(status);
}

function confirmedCancelledClientIds(generalPayload) {
  const ids = new Set();
  for (const client of generalPayload?.clients || []) {
    const status = client.analyticalStatus || client.status || "";
    if (isConfirmedCancelled(status)) {
      const id = String(client.clientId || client.id || "");
      if (id) ids.add(id);
    }
  }
  return ids;
}

function enrichCycleAuditChurnDivergence(cycleAudit, generalPayload) {
  const confirmedIds = confirmedCancelledClientIds(generalPayload);
  const flChurnTrue = new Set(cycleAudit?.flChurnClientIds || []);
  const onlyInView = [...flChurnTrue].filter((id) => !confirmedIds.has(id));
  const onlyInGeneral = [...confirmedIds].filter((id) => !flChurnTrue.has(id));
  const match = [...confirmedIds].filter((id) => flChurnTrue.has(id)).length;

  return {
    ...cycleAudit,
    churnDivergence: {
      confirmedCancelledInGeneral: confirmedIds.size,
      flChurnTrueInView: flChurnTrue.size,
      match,
      onlyInView: onlyInView.length,
      onlyInGeneral: onlyInGeneral.length,
      sampleOnlyInView: onlyInView.slice(0, 5),
      sampleOnlyInGeneral: onlyInGeneral.slice(0, 5),
    },
  };
}

async function fetchAllCycleViewRows() {
  const pageSize = 1000;
  let offset = 0;
  const rows = [];
  const key = process.env.DATA_SUPABASE_SERVICE_ROLE_KEY;
  const base = process.env.DATA_SUPABASE_URL;
  while (true) {
    const url = new URL(`/rest/v1/${CYCLE_VIEW}`, base);
    url.searchParams.set("select", CYCLE_SELECT);
    url.searchParams.set("order", "client_id.asc");
    const response = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": "public",
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${CYCLE_VIEW}: HTTP ${response.status} ${text.slice(0, 160)}`);
    }
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (offset > 200000) break;
  }
  return rows;
}

/** Audita vw_clients_ciclo_churn (paginado). Divergência fl_churn vs cancelados confirmados é enriquecida depois. */
export async function fetchCycleViewAudit() {
  const rows = await fetchAllCycleViewRows();
  const columns = rows[0] ? Object.keys(rows[0]) : CYCLE_SELECT.split(",");
  const byClient = new Map();
  const programsByClientId = {};
  const flChurnClientIds = [];

  for (const row of rows) {
    const clientId = String(row.client_id || "");
    if (!clientId) continue;
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId).push(row);
    if (row.programa != null && programsByClientId[clientId] == null) {
      programsByClientId[clientId] = String(row.programa);
    }
    if (Number(row.fl_churn) === 1) flChurnClientIds.push(clientId);
  }

  const lines = rows.length;
  const distinctClients = byClient.size;
  const multiRowClientIds = [...byClient.entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([id]) => id);

  return {
    view: CYCLE_VIEW,
    columns,
    lines,
    distinctClients,
    clientsWithMultipleRows: multiRowClientIds.length,
    multiRowClientIds,
    excessLines: Math.max(0, lines - distinctClients),
    granularity: lines === distinctClients ? "one_row_per_client" : "multiple_rows_per_client",
    cycleIdentifier: "clients.ciclo",
    renewalRuleConfirmed: true,
    renewalSource: "public.clients.ciclo",
    programsByClientId,
    flChurnClientIds,
    note:
      "Renovação = max(ciclo-1,0); cliente renovado quando ciclo>1. View vw_clients_ciclo_churn permanece complementar (programa/churn), sem histórico multi-ciclo.",
  };
}

async function fetchClientsCycleMap() {
  const pageSize = 1000;
  let offset = 0;
  const map = new Map();
  const key = process.env.DATA_SUPABASE_SERVICE_ROLE_KEY;
  const base = process.env.DATA_SUPABASE_URL;
  const select = "id,ciclo,data_inicio_ciclo,data_fim_ciclo,programa";
  while (true) {
    const url = new URL("/rest/v1/clients", base);
    url.searchParams.set("select", select);
    url.searchParams.set("order", "id.asc");
    const response = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": "public",
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`clients cycle fields: HTTP ${response.status} ${text.slice(0, 160)}`);
    }
    const batch = await response.json();
    for (const row of batch) {
      const id = String(row.id || "");
      if (id) map.set(id, row);
    }
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (offset > 200000) break;
  }
  return map;
}

function enrichGeneralClientsWithCycle(generalPayload, cycleMap) {
  if (!cycleMap?.size || !Array.isArray(generalPayload?.clients)) return generalPayload;
  const clients = generalPayload.clients.map((c) => {
    const raw = cycleMap.get(String(c.clientId || c.id || ""));
    if (!raw) return c;
    return {
      ...c,
      ciclo: c.ciclo ?? c.currentCycle ?? raw.ciclo,
      currentCycle: c.currentCycle ?? c.ciclo ?? raw.ciclo,
      data_inicio_ciclo: c.data_inicio_ciclo ?? raw.data_inicio_ciclo,
      data_fim_ciclo: c.data_fim_ciclo ?? raw.data_fim_ciclo,
      programa: c.programa ?? raw.programa,
    };
  });
  return { ...generalPayload, clients };
}

/**
 * @param {{
 *   periodFrom?: Date|null,
 *   periodTo?: Date|null,
 *   npsRows?: Array,
 *   mechanismsPayload?: object,
 *   cycleAudit?: object,
 * }} [options]
 */
export function buildEpPerformanceFromPayloads(generalPayload, meetingsPayload, options = {}) {
  const periodFrom = options.periodFrom || null;
  const periodTo = options.periodTo || null;
  const periodActive = Boolean(periodFrom || periodTo);
  const cycleAudit = options.cycleAudit || null;
  const programsByClientId = cycleAudit?.programsByClientId || {};

  const { rows: npsConsolidated, meta: npsMeta } = dedupeNpsResponses(options.npsRows || []);
  const npsQuarterKey = (value) => {
    const date = parseDate(value);
    return date ? `${date.getUTCFullYear()} T${Math.floor(date.getUTCMonth() / 3) + 1}` : null;
  };
  const latestNpsQuarter = npsConsolidated
    .map((row) => npsQuarterKey(row.submittedAt || row.createdAt))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const npsQuarterRows = latestNpsQuarter
    ? npsConsolidated.filter((row) => npsQuarterKey(row.submittedAt || row.createdAt) === latestNpsQuarter)
    : [];
  const npsByClient = new Map(npsConsolidated.map((r) => [r.clientId, r]));
  const npsQuarterByClient = new Map(npsQuarterRows.map((r) => [r.clientId, r]));
  const csatByClient = new Map(dedupeCsatResponses(options.csatRows || []).map((r) => [r.clientId, r]));

  const mechanismsByClient = new Map(
    (Array.isArray(options.mechanismsPayload?.clients) ? options.mechanismsPayload.clients : []).map((c) => [
      String(c.clientId),
      c,
    ]),
  );

  const generalClients = Array.isArray(generalPayload?.clients) ? generalPayload.clients : [];
  const meetingsCsatQuarter = buildMeetingsCsatQuarter(generalClients, meetingsPayload, options.csatRows || []);
  const meetingsCsatByEngineer = new Map(meetingsCsatQuarter.rows.map((row) => [row.engineer, row]));
  const meetingByClient = new Map(
    (Array.isArray(meetingsPayload?.clients) ? meetingsPayload.clients : []).map((c) => [
      String(c.clientId),
      c,
    ]),
  );

  const renewalThemeMessages = [];
  const npsThemeMessages = [];
  const mechanismThemeMessages = [];
  let cycleZeroCount = 0;
  let cycleNegativeCount = 0;
  let cycleMissingCount = 0;
  let cycleDateRangeCount = 0;

  const warnings = [
    {
      code: "ep_assignment_current_only",
      severity: "warning",
      label: "EP atualmente vinculado ao cliente",
      message:
        "Os indicadores utilizam o EP atualmente vinculado ao cliente e podem não representar o responsável histórico no momento do cancelamento ou da implementação.",
    },
  ];

  if (cycleAudit?.churnDivergence) {
    const d = cycleAudit.churnDivergence;
    if (d.onlyInView > 0 || d.onlyInGeneral > 0) {
      warnings.push({
        code: "cycle_churn_divergence",
        severity: "warning",
        label: "Divergência fl_churn × cancelamento confirmado",
        message: `View fl_churn=1: ${d.flChurnTrueInView}; cancelados confirmados (geral): ${d.confirmedCancelledInGeneral}; coincidem: ${d.match}; só na view: ${d.onlyInView}; só no geral: ${d.onlyInGeneral}.`,
        counts: d,
      });
    }
  }

  const pending = {
    temporalCancellationRate: {
      status: "unavailable",
      available: false,
      sourceFound: false,
      note:
        "Taxa temporal (cancelamentos no período ÷ expostos) não implementada: não há forma segura de identificar clientes expostos no período.",
    },
    nps: {
      status: "available_with_caveats",
      available: true,
      sourceFound: true,
      tables: ["nps_responses"],
      note:
        "NPS oficial (% Promotores − % Detratores) via nps_responses.score 0–10, join por client_id ao EP atual. Cobertura da carteira tipicamente baixa; mínimo de respostas por EP aplicável.",
    },
    responseTime: {
      status: "unavailable",
      available: false,
      sourceFound: false,
      note:
        "Tempo de resposta: sem timestamp de solicitação + primeira resposta humana do EP na BASE QV. Não usar updated_at − created_at.",
    },
    renewal: {
      status: "available",
      available: true,
      sourceFound: true,
      renewalRuleConfirmed: true,
      source: "public.clients.ciclo",
      tables: ["clients"],
      columns: ["ciclo", "data_inicio_ciclo", "data_fim_ciclo"],
      note:
        "Renovação via clients.ciclo (número do ciclo atual): renewalCount = max(ciclo-1, 0); renewed = ciclo>1. View vw_clients_ciclo_churn é complementar (programa/churn), sem histórico multi-ciclo.",
    },
    mechanismsPerEp: {
      status: "available",
      available: true,
      sourceFound: true,
      source: "base_qv client_mecanismos",
      tables: ["client_mecanismos"],
      note:
        "Mecanismos implementados atribuídos via EP atual do cliente (client_mecanismos), não pelo implementador registrado no vínculo.",
    },
  };

  if (periodActive) {
    warnings.push({
      code: "period_applies_to_meetings",
      severity: "info",
      label: "Período nas reuniões",
      message:
        "O período filtra reuniões pela data do evento. O percentual cancelado da carteira permanece composição da carteira registrada (não é taxa temporal).",
    });
  }

  const byEngineer = new Map();

  for (const client of generalClients) {
    const engineer = blankToNull(client.engineer) || "Não informado";
    const clientId = String(client.clientId || client.id || "");
    if (!clientId) continue;

    if (!byEngineer.has(engineer)) {
      byEngineer.set(engineer, { engineer, clients: [] });
    }

    const analyticalStatus = client.analyticalStatus || client.status || "Não informado";
    const cancelled = isEffectiveCancelled(analyticalStatus);
    const cancelledWithoutConfirmedDate = isCancelledWithoutConfirmedDate(analyticalStatus);
    const cancelledEffectiveWithoutDate = isEffectiveCancelledWithoutDateStatus(analyticalStatus);

    const meetingClient = meetingByClient.get(clientId);
    const validMeetingStarts = (Array.isArray(meetingClient?.meetings) ? meetingClient.meetings : [])
      .filter((m) => m && m.meetingDateStatus !== "before_client_entry" && m.meetingDateStatus !== "invalid")
      .map((m) => m.startTime)
      .filter(Boolean);

    let meetingsInScope = validMeetingStarts;
    if (periodActive) {
      meetingsInScope = validMeetingStarts.filter((iso) => inPeriod(iso, periodFrom, periodTo));
    }

    const cancelledInPeriod =
      cancelled && (!periodActive || inPeriod(client.cancellationDate, periodFrom, periodTo));

    const mechClient = mechanismsByClient.get(clientId);
    const implDetails = implementedMechanismDetails(mechClient);
    const implementedMechanisms = implDetails.length;

    const currentCycle = parseCurrentCycle(client);
    const cycleStart = parseCycleStart(client);
    const cycleEnd = parseCycleEnd(client);
    const renewal = renewalFromCycle(currentCycle);

    if (renewal.invalidReason === "zero") {
      cycleZeroCount += 1;
    } else if (renewal.invalidReason === "negative") {
      cycleNegativeCount += 1;
    } else if (renewal.invalidReason === "missing") {
      cycleMissingCount += 1;
    }
    if (cycleStart && cycleEnd && parseDate(cycleStart) > parseDate(cycleEnd)) {
      cycleDateRangeCount += 1;
    }

    const npsRow = npsByClient.get(clientId);
    const npsQuarterRow = npsQuarterByClient.get(clientId);
    const csatRow = csatByClient.get(clientId);
    if (npsRow && engineerIsBlank(engineer)) {
      npsThemeMessages.push(`Cliente ${clientId} com NPS sem EP informado.`);
    }

    byEngineer.get(engineer).clients.push({
      clientId,
      clientName: client.clientName || client.name || "Não informado",
      clientCode: client.clientCode || client.codigo || null,
      analyticalStatus,
      segment: client.segmentLabel || client.segment || "Dados insuficientes",
      cancellationDate: client.cancellationDate || null,
      cancelled,
      cancelledWithoutConfirmedDate,
      cancelledInPeriod,
      program: client.programa || programsByClientId[clientId] || null,
      currentCycle,
      cycleStart,
      cycleEnd,
      renewalCount: renewal.renewalCount,
      renewed: renewal.renewed,
      totalMeetings: meetingsInScope.length,
      meetingDates: validMeetingStarts,
      hireDate: client.acquisitionDate || client.hireDate || client.contractDate || cycleStart,
      npsScore: npsRow?.score ?? null,
      npsSubmittedAt: npsRow?.submittedAt ?? null,
      npsQuarterScore: npsQuarterRow?.score ?? null,
      npsQuarterSubmittedAt: npsQuarterRow?.submittedAt ?? null,
      csatScore: csatRow?.score ?? null,
      csatSubmittedAt: csatRow?.submittedAt ?? csatRow?.createdAt ?? null,
      implementedMechanisms,
      implementedMechanismDetails: implDetails,
      hasImplementedMechanism: implementedMechanisms > 0,
      hasMultipleCycles: renewal.renewed,
    });
  }

  if (cycleZeroCount) {
    renewalThemeMessages.push(`${cycleZeroCount} cliente(s) com ciclo=0 (inválido para renovação).`);
  }
  if (cycleNegativeCount) {
    renewalThemeMessages.push(`${cycleNegativeCount} cliente(s) com ciclo negativo.`);
  }
  if (cycleMissingCount) {
    renewalThemeMessages.push(`${cycleMissingCount} cliente(s) sem ciclo informado.`);
  }
  if (cycleDateRangeCount) {
    renewalThemeMessages.push(
      `${cycleDateRangeCount} cliente(s) com data_inicio_ciclo posterior a data_fim_ciclo.`,
    );
  }

  const engineers = [...byEngineer.values()]
    .map((bucket) => {
      const clients = bucket.clients;
      const totalClients = clients.length;
      const activeClients = clients.filter((c) => c.analyticalStatus === "Ativo").length;
      const frozenClients = clients.filter((c) => c.analyticalStatus === "Congelado").length;
      const confirmedCancelledClients = clients.filter((c) => c.cancelled).length;
      const cancelledWithoutConfirmedDate = clients.filter((c) => c.cancelledWithoutConfirmedDate).length;
      const unknownStatusClients = clients.filter((c) => c.analyticalStatus === "Não informado").length;
      const activeOrFrozenClients = activeClients + frozenClients;
      const cancelledInPeriod = clients.filter((c) => c.cancelledInPeriod).length;
      const renewedClients = clients.filter((c) => c.renewed).length;
      const totalRenewals = clients.reduce((a, c) => a + (c.renewalCount || 0), 0);
      const renewedPortfolioPercentage = pct(renewedClients, totalClients);
      const averageRenewalsPerRenewedClient =
        renewedClients > 0 ? round1(totalRenewals / renewedClients) : null;
      const validCycleValues = clients
        .map((c) => c.currentCycle)
        .filter((n) => n != null && Number.isFinite(n) && n > 0);
      const medianCurrentCycle = round1(robustStats(validCycleValues).median);
      const averageCurrentCycle =
        validCycleValues.length > 0
          ? round1(validCycleValues.reduce((a, b) => a + b, 0) / validCycleValues.length)
          : null;
      const clientsWithMultipleCycles = renewedClients;

      const cancelledShareOfPortfolio = pct(confirmedCancelledClients, totalClients);

      const meetingCounts = clients.map((c) => c.totalMeetings);
      const totalMeetings = meetingCounts.reduce((a, b) => a + b, 0);
      const clientsWithMeeting = meetingCounts.filter((n) => n > 0).length;
      const clientsWithoutMeeting = totalClients - clientsWithMeeting;
      const meetingCoverage = pct(clientsWithMeeting, totalClients);
      const averageMeetingsPerClient =
        totalClients > 0 ? round1(totalMeetings / totalClients) : null;
      const countsWithMeeting = meetingCounts.filter((n) => n > 0);
      const medianMeetingsAmongWithMeetings = round1(robustStats(countsWithMeeting).median);
      const medianMeetingsAllClients = round1(robustStats(meetingCounts).median);

      const nowMs = Date.now();
      const daysSinceLast = clients
        .map((c) => {
          if (!c.meetingDates?.length) return null;
          const last = Math.max(...c.meetingDates.map((iso) => parseDate(iso)?.getTime()).filter(Boolean));
          if (!Number.isFinite(last)) return null;
          return Math.floor((nowMs - last) / 86400000);
        })
        .filter((d) => d != null && d >= 0);
      const medianDaysSinceLastMeeting = round1(robustStats(daysSinceLast).median);

      const npsScores = clients.map((c) => c.npsScore).filter((n) => n != null && Number.isFinite(Number(n)));
      const npsBreakdown = computeNpsBreakdown(npsScores);
      const npsQuarterScores = clients.map((c) => c.npsQuarterScore).filter((n) => n != null && Number.isFinite(Number(n)));
      const npsQuarterBreakdown = computeNpsBreakdown(npsQuarterScores);
      const npsSample = npsSampleBadge(npsBreakdown.responses);
      const npsEligible = npsBreakdown.responses >= NPS_MIN_RESPONSES_PER_EP;
      const npsRespondentClients = npsBreakdown.responses;
      const npsCoverage = pct(npsRespondentClients, totalClients);

      const csatScores = clients.map((c) => c.csatScore).filter((n) => n != null && Number.isFinite(Number(n)));
      const csatResponses = csatScores.length;
      const csatAverage = csatResponses
        ? round1(csatScores.reduce((a, b) => a + b, 0) / csatResponses)
        : null;
      const csatCoverage = pct(csatResponses, totalClients);

      const mechAgg = aggregateMechanismsForClients(clients);
      const {
        mechanisms,
        mechanismTypesUsed,
        avgImplementedAmongWithMechanism,
        clientsWithImplementedMechanisms,
        implementedMechanisms,
      } = mechAgg;
      const avgImplementedPerPortfolioClient =
        totalClients > 0 ? round1(implementedMechanisms / totalClients) : null;

      if (clientsWithoutMeeting === totalClients && totalClients > 0) {
        mechanismThemeMessages.push(`${bucket.engineer}: carteira sem reuniões (${totalClients} clientes).`);
      }
      if (totalClients > 0 && clientsWithImplementedMechanisms === 0) {
        mechanismThemeMessages.push(`${bucket.engineer}: nenhum mecanismo implementado na carteira.`);
      }

      const sample = sampleSizeBucket(totalClients);
      const qualityAlerts = [];
      if (engineerIsBlank(bucket.engineer)) qualityAlerts.push("EP não informado");
      if (sample.code === "very_small") qualityAlerts.push("Amostra muito pequena");
      else if (sample.code === "small") qualityAlerts.push("Amostra pequena");
      if (clientsWithoutMeeting === totalClients && totalClients > 0) {
        qualityAlerts.push("Nenhuma reunião na carteira");
      }
      if (cancelledShareOfPortfolio === 100 && totalClients < 10) {
        qualityAlerts.push("100% cancelado em amostra pequena — interpretação limitada");
      }
      if (npsBreakdown.responses > 0 && !npsEligible) {
        npsThemeMessages.push(
          `${bucket.engineer}: NPS com amostra pequena (${npsBreakdown.responses} resposta(s), mínimo ${NPS_MIN_RESPONSES_PER_EP}).`,
        );
      }

      const statusSum =
        activeClients + frozenClients + confirmedCancelledClients + cancelledWithoutConfirmedDate + unknownStatusClients;
      if (statusSum !== totalClients) {
        qualityAlerts.push("Soma de status diverge do total de clientes");
      }

      return {
        engineer: bucket.engineer,
        totalClients,
        activeClients,
        frozenClients,
        activeOrFrozenClients,
        confirmedCancelledClients,
        cancelledClients: confirmedCancelledClients,
        cancelledWithoutConfirmedDate,
        unknownStatusClients,
        clientsWithMultipleCycles,
        renewedClients,
        totalRenewals,
        renewedPortfolioPercentage,
        averageRenewalsPerRenewedClient,
        medianCurrentCycle,
        averageCurrentCycle,
        cancelledInPeriod,
        cancelledShareOfPortfolio,
        /** @deprecated use cancelledShareOfPortfolio */
        cancellationRate: cancelledShareOfPortfolio,
        meetingCoverage,
        clientsWithMeeting,
        clientsWithoutMeeting,
        totalMeetings,
        averageMeetingsPerClient,
        medianMeetingsAmongWithMeetings,
        medianMeetingsAllClients,
        medianDaysSinceLastMeeting,
        nps: npsBreakdown.responses > 0 ? npsBreakdown.nps : null,
        npsMeanScore: npsBreakdown.responses > 0 ? npsBreakdown.meanScore : null,
        npsRespondentClients,
        npsResponses: npsRespondentClients,
        npsQuarter: npsQuarterBreakdown.responses > 0 ? npsQuarterBreakdown.nps : null,
        npsQuarterResponses: npsQuarterBreakdown.responses,
        ...(meetingsCsatByEngineer.get(bucket.engineer) || {
          meetingsQuarter: 0,
          csatAverage: null,
          csatResponses: 0,
          csatDirectResponses: 0,
          csatFallbackResponses: 0,
          csatAmbiguousResponses: 0,
          csatCoverage: null,
        }),
        npsCoverage,
        npsPortfolioCoverage: npsCoverage,
        npsPromoters: npsBreakdown.promoters,
        npsPassives: npsBreakdown.passives,
        npsDetractors: npsBreakdown.detractors,
        npsSampleSize: npsSample.code,
        npsSampleSizeLabel: npsSample.label,
        npsSampleStatus: npsSample.code,
        npsEligible,
        npsSampleSmall: npsBreakdown.responses > 0 && !npsEligible,
        csatAverage,
        csatResponses,
        csatCoverage,
        implementedMechanisms,
        clientsWithImplementedMechanisms,
        avgImplementedPerPortfolioClient,
        avgImplementedAmongWithMechanism,
        mechanismTypesUsed,
        mechanisms,
        sampleSize: sample.code,
        sampleSizeLabel: sample.label,
        qualityAlerts,
        methodology: {
          engineerAssignment:
            "Os indicadores utilizam o EP atualmente vinculado ao cliente (clients.engenheiro_patrimonial). Histórico parcial em engenheiros_anteriores não usado para atribuição de eventos.",
          cancelledShareOfPortfolio:
            "clientes com status analítico Cancelado ÷ total de clientes atribuídos ao EP",
          meetings:
            "Reuniões válidas da consolidação da página Reuniões; período filtra pela data da reunião",
          meetingCoverage: "clientes com ≥1 reunião válida ÷ clientes do EP",
          averageMeetingsPerClient: "total de reuniões válidas ÷ clientes do EP",
          medianMeetingsAmongWithMeetings:
            "mediana da quantidade de reuniões entre clientes com ≥1 reunião",
          nps:
            "Índice NPS = % Promotores (9–10) − % Detratores (0–6); última resposta por cliente; EP atual no join",
          mechanisms:
            "Vínculos implementados (client_mecanismos status=Implementado) dos clientes do EP; atribuição pelo EP atual",
          renewal:
            "renewalCount = max(ciclo-1, 0); renewed = ciclo>1; fonte clients.ciclo (ciclo atual, não multi-linha da view)",
        },
        clients,
      };
    })
    .sort((a, b) => b.totalClients - a.totalClients || a.engineer.localeCompare(b.engineer, "pt-BR"));

  const withEp = engineers.filter((e) => e.engineer !== "Não informado");
  const clientsWithEp = withEp.reduce((a, e) => a + e.totalClients, 0);
  const clientsWithoutEp = engineers.find((e) => e.engineer === "Não informado")?.totalClients || 0;
  const portfolioStats = robustStats(withEp.map((e) => e.totalClients));

  const overallConfirmedCancelled = withEp.reduce((a, e) => a + e.confirmedCancelledClients, 0);
  const overallCancelledWithoutDate = withEp.reduce((a, e) => a + e.cancelledWithoutConfirmedDate, 0);
  const overallCancelledShare = pct(overallConfirmedCancelled, clientsWithEp);
  const overallWithMeeting = withEp.reduce((a, e) => a + e.clientsWithMeeting, 0);
  const overallMeetingCoverage = pct(overallWithMeeting, clientsWithEp);
  const overallMeetings = withEp.reduce((a, e) => a + e.totalMeetings, 0);
  const overallAvgMeetings =
    clientsWithEp > 0 ? round1(overallMeetings / clientsWithEp) : null;
  const overallImplementedMechanisms = withEp.reduce((a, e) => a + e.implementedMechanisms, 0);
  const overallClientsWithImplemented = withEp.reduce((a, e) => a + e.clientsWithImplementedMechanisms, 0);
  const overallClientsWithMultipleCycles = withEp.reduce((a, e) => a + e.clientsWithMultipleCycles, 0);
  const overallRenewedClients = withEp.reduce((a, e) => a + e.renewedClients, 0);
  const overallTotalRenewals = withEp.reduce((a, e) => a + e.totalRenewals, 0);
  const overallRenewedPortfolioPercentage = pct(overallRenewedClients, clientsWithEp);
  const overallValidCycles = withEp.flatMap((e) =>
    (e.clients || [])
      .map((c) => c.currentCycle)
      .filter((n) => n != null && Number.isFinite(n) && n > 0),
  );
  const overallMedianCurrentCycle = round1(robustStats(overallValidCycles).median);

  const overallNpsScores = withEp.flatMap((e) =>
    (e.clients || []).map((c) => c.npsScore).filter((n) => n != null && Number.isFinite(Number(n))),
  );
  const overallNps = computeNpsBreakdown(overallNpsScores);
  const npsPortfolioCoverage = pct(overallNps.responses, clientsWithEp);
  const npsCoverageOk = (npsPortfolioCoverage || 0) >= NPS_MIN_COVERAGE_PCT;
  const npsDisplay = overallNps.responses > 0
    ? {
        available: true,
        insufficientCoverage: !npsCoverageOk,
        ...overallNps,
        portfolioCoverage: npsPortfolioCoverage,
        minCoveragePct: NPS_MIN_COVERAGE_PCT,
        minResponsesPerEp: NPS_MIN_RESPONSES_PER_EP,
        attribution: "EP atualmente vinculado ao cliente",
        definition: "NPS = % Promotores (9–10) − % Detratores (0–6); média da nota é indicador secundário",
        meta: npsMeta,
      }
    : {
        available: false,
        responses: 0,
        nps: null,
        note: "Sem respostas NPS válidas no recorte",
        meta: npsMeta,
      };

  if (clientsWithoutEp) {
    warnings.push({
      code: "clients_without_engineer",
      severity: "warning",
      label: "Clientes sem EP",
      count: clientsWithoutEp,
      message: `${clientsWithoutEp} cliente(s) sem Engenheiro Patrimonial informado.`,
    });
  }

  const verySmall = withEp.filter((e) => e.sampleSize === "very_small").length;
  if (verySmall) {
    warnings.push({
      code: "small_samples",
      severity: "warning",
      label: "Amostras muito pequenas",
      count: verySmall,
      message: `${verySmall} EP(s) com menos de 10 clientes — percentuais extremos (ex.: 100%) têm interpretação limitada.`,
    });
  }

  if (overallNps.responses > 0 && !npsCoverageOk) {
    npsThemeMessages.push(
      `Cobertura NPS da carteira ${npsPortfolioCoverage}% (mínimo sugerido ${NPS_MIN_COVERAGE_PCT}%).`,
    );
  }

  pushThemeWarnings(warnings, "renewal_quality", "Renovação / ciclo", renewalThemeMessages);
  pushThemeWarnings(warnings, "nps_quality", "NPS", npsThemeMessages);
  pushThemeWarnings(warnings, "mechanism_quality", "Mecanismos", mechanismThemeMessages);

  const metricAvailability = [
    {
      id: "ep_responsible",
      label: "EP responsável",
      status: "partial",
      available: true,
      source: "BASE QV",
      table: "clients",
      columns: ["engenheiro_patrimonial", "engenheiros_anteriores"],
      coverage: pct(clientsWithEp, generalClients.length),
      reason: "Campo atual confiável; histórico parcial em engenheiros_anteriores (não usado para evento histórico).",
    },
    {
      id: "cancelled_share",
      label: "Percentual cancelado da carteira por EP",
      status: "partial",
      available: true,
      source: "BASE QV",
      table: "clients + cancellations",
      coverage: 100,
      reason: "Composição com EP atual; não é taxa temporal nem EP histórico no cancelamento.",
    },
    {
      id: "nps",
      label: "NPS por EP",
      status: overallNps.responses ? (npsCoverageOk ? "available" : "partial") : "unavailable",
      available: Boolean(overallNps.responses),
      source: "BASE QV",
      table: "nps_responses",
      columns: ["score", "client_id", "submitted_at", "tipo_de_forms"],
      coverage: npsPortfolioCoverage,
      reason: overallNps.responses
        ? "NPS oficial 0–10; join ao EP atual; média da nota não é NPS."
        : "Sem respostas válidas",
    },
    {
      id: "csat_meetings_ep",
      label: "CSAT trimestral das reuniões por EP",
      status: meetingsCsatQuarter.rows.some((row) => row.csatResponses > 0) ? "partial" : "unavailable",
      available: meetingsCsatQuarter.rows.some((row) => row.csatResponses > 0),
      source: "BASE QV",
      table: "csat_responses + client_meetings + clients",
      columns: ["client_id", "meeting_date", "score", "created_at", "start_time", "host_email", "engenheiro_patrimonial"],
      coverage: pct(
        meetingsCsatQuarter.rows.reduce((sum, row) => sum + row.csatResponses, 0),
        meetingsCsatQuarter.rows.reduce((sum, row) => sum + row.meetingsQuarter, 0),
      ),
      reason: "Vínculo direto por client_id + data e host_email; fallback identificado pelo EP atual quando não há reunião única associável.",
    },
    {
      id: "meetings_qv",
      label: "Reuniões BASE QV",
      status: "available",
      available: true,
      source: "BASE QV",
      table: "client_meetings / manual_meetings / meeting_attendance",
      coverage: overallMeetingCoverage,
      reason: "Mesma lógica de reunião válida do dashboard Reuniões.",
    },
    {
      id: "mechanisms_ep",
      label: "Mecanismos implementados por EP",
      status: "available",
      available: true,
      source: "BASE QV",
      table: "client_mecanismos",
      reason: "Atribuição via EP atual do cliente; implementador do vínculo não usado.",
    },
    {
      id: "response_time",
      label: "Tempo de resposta por EP",
      status: "unavailable",
      available: false,
      source: "BASE QV",
      reason: "Sem primeira resposta humana timestampada vinculada ao EP.",
    },
    {
      id: "renewal",
      label: "Renovação por EP",
      status: "available",
      available: true,
      source: "BASE QV",
      table: "clients",
      columns: ["ciclo", "data_inicio_ciclo", "data_fim_ciclo"],
      coverage: pct(
        withEp.flatMap((e) => e.clients).filter((c) => c.currentCycle != null && c.currentCycle > 0).length,
        clientsWithEp,
      ),
      reason:
        "renewalCount = max(ciclo-1, 0); renewed = ciclo>1. View vw_clients_ciclo_churn complementar (programa/churn).",
    },
  ];

  const npsByAdvisor = withEp.map((e) => ({
    advisor: e.engineer,
    averageScore: e.npsMeanScore,
    npsIndex: e.nps,
    respondentClients: e.npsRespondentClients,
    portfolioClients: e.totalClients,
    coverage: e.npsCoverage,
    promoters: e.npsPromoters,
    neutrals: e.npsPassives,
    passives: e.npsPassives,
    detractors: e.npsDetractors,
    sampleStatus: e.npsSampleStatus,
    /** aliases legados */
    label: e.engineer,
    nps: e.nps,
    npsMeanScore: e.npsMeanScore,
    respondents: e.npsRespondentClients,
    sampleSize: e.npsSampleSize,
    total: e.totalClients,
  }));

  const mechanismsByAdvisor = withEp.map((e) => ({
    advisor: e.engineer,
    portfolioClients: e.totalClients,
    clientsWithMechanism: e.clientsWithImplementedMechanisms,
    implementedMechanisms: e.implementedMechanisms,
    coverage: pct(e.clientsWithImplementedMechanisms, e.totalClients),
    avgPerPortfolioClient: e.avgImplementedPerPortfolioClient,
    avgAmongWithMechanism: e.avgImplementedAmongWithMechanism,
    mechanismTypesUsed: e.mechanismTypesUsed,
    mechanisms: e.mechanisms,
    /** aliases legados */
    label: e.engineer,
    clientsWithImplementedMechanisms: e.clientsWithImplementedMechanisms,
    avgImplementedPerPortfolioClient: e.avgImplementedPerPortfolioClient,
    total: e.totalClients,
    sampleSize: e.sampleSize,
  }));

  const renewalsByAdvisor = withEp.map((e) => ({
    advisor: e.engineer,
    portfolioClients: e.totalClients,
    renewedClients: e.renewedClients,
    totalRenewals: e.totalRenewals,
    renewedPortfolioPercentage: e.renewedPortfolioPercentage,
    averageRenewalsPerRenewedClient: e.averageRenewalsPerRenewedClient,
    medianCurrentCycle: e.medianCurrentCycle,
    /** aliases legados */
    label: e.engineer,
    total: e.totalClients,
  }));

  const mechanismsMatrix = withEp.flatMap((e) =>
    (e.mechanisms || []).map((m) => ({
      advisor: e.engineer,
      mechanismId: m.mechanismId,
      mechanismName: m.mechanismName,
      clients: m.clients,
      implementations: m.implementations,
      percentageOfClientsWithMechanism: m.percentage,
      percentageOfPortfolio: pct(m.clients, e.totalClients),
    })),
  );

  const renewalClients = withEp.flatMap((e) =>
    (e.clients || []).map((c) => ({
      advisor: e.engineer,
      clientId: c.clientId,
      clientName: c.clientName,
      clientCode: c.clientCode,
      currentCycle: c.currentCycle,
      cycleStart: c.cycleStart,
      cycleEnd: c.cycleEnd,
      renewalCount: c.renewalCount,
      renewed: c.renewed,
      program: c.program,
      analyticalStatus: c.analyticalStatus,
    })),
  );

  const cycleDistMap = new Map();
  for (const e of withEp) {
    for (const c of e.clients || []) {
      const label = cycleDistributionLabel(c.currentCycle);
      const cur = cycleDistMap.get(label) || { label, clients: 0, totalRenewals: 0 };
      cur.clients += 1;
      cur.totalRenewals += c.renewalCount || 0;
      cycleDistMap.set(label, cur);
    }
  }
  const cycleLabelOrder = ["Ciclo 1", "Ciclo 2", "Ciclo 3", "Ciclo 4", "Ciclo 5+", "Não informado"];
  const cycleDistribution = cycleLabelOrder
    .filter((label) => cycleDistMap.has(label))
    .map((label) => {
      const row = cycleDistMap.get(label);
      return {
        label,
        clients: row.clients,
        percent: pct(row.clients, clientsWithEp),
        totalRenewals: row.totalRenewals,
      };
    });

  const qualityWarnings = [...warnings];
  for (const e of withEp) {
    for (const alert of e.qualityAlerts || []) {
      qualityWarnings.push({
        code: "advisor_quality",
        severity: "info",
        label: e.engineer,
        message: alert,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    latestNpsQuarter,
    latestCsatQuarter: meetingsCsatQuarter.quarter,
    source: "BASE QV",
    attribution: "current_engineer_only",
    attributionNote:
      "Os indicadores utilizam o EP atualmente vinculado ao cliente. O cálculo pode não representar o responsável histórico no momento do cancelamento.",
    periodAppliedByEvent: true,
    periodNote:
      "Período aplica-se às reuniões (data do evento). Percentual cancelado da carteira é composição, não taxa temporal.",
    metadata: {
      source: "BASE QV",
      renewalFormula: "max(currentCycle - 1, 0)",
      cycleSource: "public.clients.ciclo",
      cycleView: "public.vw_clients_ciclo_churn (complementary churn/program only)",
      npsSource: "nps_responses",
      mechanismSource: "client_mecanismos",
      meetingsCsatQuarter: meetingsCsatQuarter.methodology,
    },
    cancellationMetric: {
      id: "cancelled_share_of_portfolio",
      label: "Percentual cancelado da carteira por EP",
      numerator: "clientes com status analítico Cancelado",
      denominator: "total de clientes atribuídos ao EP no recorte",
      isTemporalRate: false,
      periodFilter: "não altera o denominador; cancelamentos no período ficam só como contagem auxiliar",
      tooltip:
        "Os indicadores utilizam o EP atualmente vinculado ao cliente e podem não representar o responsável histórico no momento do cancelamento.",
    },
    summary: {
      advisorsWithPortfolio: withEp.length,
      totalEngineers: withEp.length,
      totalClients: generalClients.length,
      clientsWithEngineer: clientsWithEp,
      clientsWithoutEngineer: clientsWithoutEp,
      active: withEp.reduce((a, e) => a + e.activeClients, 0),
      activeClients: withEp.reduce((a, e) => a + e.activeClients, 0),
      frozen: withEp.reduce((a, e) => a + e.frozenClients, 0),
      frozenClients: withEp.reduce((a, e) => a + e.frozenClients, 0),
      confirmedCancelled: overallConfirmedCancelled,
      confirmedCancelledClients: overallConfirmedCancelled,
      cancelledWithoutConfirmedDate: overallCancelledWithoutDate,
      clientsWithMultipleCycles: overallRenewedClients,
      renewedClients: overallRenewedClients,
      totalRenewals: overallTotalRenewals,
      renewedPortfolioPercentage: overallRenewedPortfolioPercentage,
      medianCurrentCycle: overallMedianCurrentCycle,
      medianClientsPerEngineer:
        portfolioStats.median == null ? null : round1(portfolioStats.median),
      averageClientsPerEngineer:
        portfolioStats.mean == null ? null : round1(portfolioStats.mean),
      cancelledShareOfPortfolio: overallCancelledShare,
      cancelledClients: overallConfirmedCancelled,
      meetingCoverage: overallMeetingCoverage,
      clientsWithMeeting: overallWithMeeting,
      clientsWithoutMeeting: withEp.reduce((a, e) => a + e.clientsWithoutMeeting, 0),
      averageMeetingsPerClient: overallAvgMeetings,
      totalMeetings: overallMeetings,
      averageNpsScore: npsDisplay.meanScore ?? null,
      npsIndex: npsDisplay.responses ? npsDisplay.nps : null,
      nps: npsDisplay.responses ? npsDisplay.nps : null,
      npsRaw: npsDisplay.nps,
      npsMeanScore: npsDisplay.meanScore ?? null,
      npsRespondentClients: npsDisplay.responses || 0,
      npsResponses: npsDisplay.responses || 0,
      npsCoverage: npsPortfolioCoverage,
      npsPortfolioCoverage,
      npsPromoters: npsDisplay.promoters ?? 0,
      npsPassives: npsDisplay.passives ?? 0,
      npsDetractors: npsDisplay.detractors ?? 0,
      npsInsufficientCoverage: Boolean(npsDisplay.insufficientCoverage),
      npsSampleSmall: (npsDisplay.responses || 0) > 0 && (npsDisplay.responses || 0) < NPS_MIN_RESPONSES_PER_EP,
      clientsWithImplementedMechanisms: overallClientsWithImplemented,
      implementedMechanisms: overallImplementedMechanisms,
      /** aliases legados */
      overallCancellationRate: overallCancelledShare,
      medianMeetingsPerClient: null,
    },
    nps: npsDisplay,
    metricAvailability,
    byAdvisor: engineers,
    engineers,
    npsByAdvisor,
    meetingsCsatByAdvisor: meetingsCsatQuarter.rows,
    mechanismsByAdvisor,
    mechanismsMatrix,
    renewalsByAdvisor,
    renewalClients,
    cycleDistribution,
    cycleAudit: cycleAudit
      ? {
          view: cycleAudit.view,
          columns: cycleAudit.columns,
          lines: cycleAudit.lines,
          distinctClients: cycleAudit.distinctClients,
          clientsWithMultipleRows: cycleAudit.clientsWithMultipleRows,
          excessLines: cycleAudit.excessLines,
          granularity: "clients.ciclo current cycle number",
          cycleIdentifier: "clients.ciclo",
          renewalRuleConfirmed: true,
          renewalSource: "public.clients.ciclo",
          note:
            "Renovação = max(ciclo-1,0); cliente renovado quando ciclo>1. View vw_clients_ciclo_churn permanece complementar (programa/churn), sem histórico multi-ciclo.",
          churnDivergence: cycleAudit.churnDivergence || null,
        }
      : {
          renewalRuleConfirmed: true,
          cycleIdentifier: "clients.ciclo",
          granularity: "clients.ciclo current cycle number",
          renewalSource: "public.clients.ciclo",
          note:
            "Renovação = max(ciclo-1,0); cliente renovado quando ciclo>1. View vw_clients_ciclo_churn permanece complementar (programa/churn), sem histórico multi-ciclo.",
        },
    portfolioDistribution: withEp.map((e) => ({
      label: e.engineer,
      count: e.totalClients,
      active: e.activeClients,
      frozen: e.frozenClients,
      cancelled: e.confirmedCancelledClients,
      sampleSize: e.sampleSize,
      percent: pct(e.totalClients, clientsWithEp) || 0,
    })),
    meetingCoverageByAdvisor: withEp.map((e) => ({
      label: e.engineer,
      coverage: e.meetingCoverage,
      withMeeting: e.clientsWithMeeting,
      total: e.totalClients,
      sampleSize: e.sampleSize,
    })),
    meetingFrequencyByAdvisor: withEp.map((e) => ({
      label: e.engineer,
      average: e.averageMeetingsPerClient,
      medianAmongWithMeetings: e.medianMeetingsAmongWithMeetings,
      totalMeetings: e.totalMeetings,
      withMeeting: e.clientsWithMeeting,
      total: e.totalClients,
      sampleSize: e.sampleSize,
    })),
    clientsWithoutMeetingsByAdvisor: withEp.map((e) => ({
      label: e.engineer,
      count: e.clientsWithoutMeeting,
      percent: pct(e.clientsWithoutMeeting, e.totalClients),
      total: e.totalClients,
      sampleSize: e.sampleSize,
    })),
    rows: engineers,
    distributions: {
      byPortfolioSize: withEp.map((e) => ({
        label: e.engineer,
        count: e.totalClients,
        active: e.activeClients,
        frozen: e.frozenClients,
        cancelled: e.confirmedCancelledClients,
        sampleSize: e.sampleSize,
        percent: pct(e.totalClients, clientsWithEp) || 0,
      })),
      byCancelledShare: withEp.map((e) => ({
        label: e.engineer,
        rate: e.cancelledShareOfPortfolio,
        cancelled: e.confirmedCancelledClients,
        total: e.totalClients,
        sampleSize: e.sampleSize,
        sampleSizeLabel: e.sampleSizeLabel,
      })),
      byMeetingCoverage: withEp.map((e) => ({
        label: e.engineer,
        coverage: e.meetingCoverage,
        withMeeting: e.clientsWithMeeting,
        total: e.totalClients,
        sampleSize: e.sampleSize,
      })),
      byMeetingFrequency: withEp.map((e) => ({
        label: e.engineer,
        average: e.averageMeetingsPerClient,
        medianAmongWithMeetings: e.medianMeetingsAmongWithMeetings,
        totalMeetings: e.totalMeetings,
        withMeeting: e.clientsWithMeeting,
        total: e.totalClients,
        sampleSize: e.sampleSize,
      })),
      byActive: withEp.map((e) => ({
        label: e.engineer,
        count: e.activeClients,
        percent: pct(e.activeClients, clientsWithEp) || 0,
        sampleSize: e.sampleSize,
      })),
    },
    pending,
    warnings,
    qualityWarnings,
    quality: {
      usedFields: [
        { schema: "public", table: "clients", column: "engenheiro_patrimonial" },
        { schema: "public", table: "clients", column: "engenheiros_anteriores" },
        { schema: "public", table: "clients", column: "status" },
        { schema: "public", table: "cancellations", column: "churn_efetivado_at" },
        { schema: "public", table: "cancellations", column: "distrato_assinado_at" },
        { schema: "public", table: "client_meetings", column: "client_id" },
        { schema: "public", table: "manual_meetings", column: "client_id" },
        { schema: "public", table: "meeting_attendance", column: "status" },
        { schema: "public", table: "nps_responses", column: "score" },
        { schema: "public", table: "nps_responses", column: "client_id" },
        { schema: "public", table: "nps_responses", column: "submitted_at" },
        { schema: "public", table: "csat_responses", column: "client_id" },
        { schema: "public", table: "csat_responses", column: "meeting_date" },
        { schema: "public", table: "csat_responses", column: "score" },
        { schema: "public", table: "csat_responses", column: "created_at" },
        { schema: "public", table: "client_meetings", column: "host_email" },
        { schema: "public", table: "client_mecanismos", column: "status" },
        { schema: "public", table: "client_mecanismos", column: "implemented_at" },
        { schema: "public", table: "clients", column: "ciclo" },
        { schema: "public", table: "clients", column: "data_inicio_ciclo" },
        { schema: "public", table: "clients", column: "data_fim_ciclo" },
        { schema: "public", table: "clients", column: "programa" },
        { schema: "public", table: CYCLE_VIEW, column: "client_id" },
        { schema: "public", table: CYCLE_VIEW, column: "fl_churn" },
      ],
      notes: [
        "Percentual cancelado = composição da carteira registrada (EP atualmente vinculado).",
        "NPS principal = média das notas (última resposta válida por cliente → EP atual). Índice oficial (% Promotores − % Detratores) é complementar no drawer/tooltip.",
        "Mecanismos por EP: status Implementado em client_mecanismos; atribuição via EP atual.",
        "Renovação: renewalCount = max(ciclo-1, 0); renewed = ciclo>1; fonte clients.ciclo.",
      ],
    },
  };
}

async function fetchSurveyTable(table, select) {
  const pageSize = 1000;
  let offset = 0;
  const rows = [];
  const key = process.env.DATA_SUPABASE_SERVICE_ROLE_KEY;
  const base = process.env.DATA_SUPABASE_URL;
  while (true) {
    const url = new URL(`/rest/v1/${table}`, base);
    url.searchParams.set("select", select);
    url.searchParams.set("order", "created_at.desc");
    const response = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": "public",
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${table}: HTTP ${response.status} ${text.slice(0, 160)}`);
    }
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (offset > 200000) break;
  }
  return rows;
}

async function fetchNpsResponses() {
  return fetchSurveyTable("nps_responses", "id,client_id,score,submitted_at,tipo_de_forms,created_at");
}

async function fetchCsatResponses() {
  return fetchSurveyTable(
    "csat_responses",
    "id,typeform_response_id,form_response_id,client_id,tipo_de_forms,score,created_at,meeting_date",
  );
}

export async function computeEpPerformancePayload(options = {}) {
  return runWithAnalyticsDataContext(async () => {
  const startedAt = Date.now();
  const cfg = dataConfigurationError();
  if (cfg) {
    const err = new Error(cfg);
    err.code = "config";
    throw err;
  }

  const [generalPayloadRaw, meetingsPayload, npsRows, csatRows, mechanismsPayload, cycleAuditRaw, cycleMap] =
    await Promise.all([
    computeGeneralDataPayload(),
    computeMeetingsPayload(),
    fetchNpsResponses().catch((error) => {
      console.warn("[EP Performance] NPS fetch failed:", error instanceof Error ? error.message : error);
      return [];
    }),
    fetchCsatResponses().catch((error) => {
      console.warn("[EP Performance] CSAT fetch failed:", error instanceof Error ? error.message : error);
      return [];
    }),
    computeMechanismsPayload().catch((error) => {
      console.warn("[EP Performance] Mechanisms fetch failed:", error instanceof Error ? error.message : error);
      return null;
    }),
    fetchCycleViewAudit().catch((error) => {
      console.warn("[EP Performance] Cycle audit failed:", error instanceof Error ? error.message : error);
      return null;
    }),
    fetchClientsCycleMap().catch((error) => {
      console.warn("[EP Performance] clients.ciclo fetch failed:", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);

  const generalPayload = enrichGeneralClientsWithCycle(generalPayloadRaw, cycleMap);

  const cycleAudit = cycleAuditRaw
    ? enrichCycleAuditChurnDivergence(cycleAuditRaw, generalPayload)
    : null;

  const payload = buildEpPerformanceFromPayloads(generalPayload, meetingsPayload, {
    ...options,
    npsRows,
    csatRows,
    mechanismsPayload,
    cycleAudit,
  });

  if (!npsRows?.length) {
    payload.pending = {
      ...payload.pending,
      nps: {
        ...(payload.pending?.nps || {}),
        status: "unavailable",
        available: false,
        note: "Falha ou ausência ao carregar nps_responses nesta execução.",
      },
    };
  }

  if (!csatRows?.length) {
    payload.warnings = [
      ...(payload.warnings || []),
      {
        code: "csat_fetch_failed",
        severity: "warning",
        label: "CSAT trimestral indisponível",
        message: "Não foi possível carregar csat_responses nesta execução.",
      },
    ];
    payload.qualityWarnings = payload.warnings;
  }

  if (!mechanismsPayload) {
    payload.pending = {
      ...payload.pending,
      mechanismsPerEp: {
        ...(payload.pending?.mechanismsPerEp || {}),
        status: "unavailable",
        available: false,
        note: "Falha ao carregar client_mecanismos nesta execução.",
      },
    };
    payload.warnings = [
      ...(payload.warnings || []),
      {
        code: "mechanisms_fetch_failed",
        severity: "warning",
        label: "Mecanismos indisponíveis",
        message: "Não foi possível carregar client_mecanismos; métricas de mecanismos por EP zeradas.",
      },
    ];
    payload.qualityWarnings = payload.warnings;
  }

  if (!cycleAudit) {
    payload.warnings = [
      ...(payload.warnings || []),
      {
        code: "cycle_audit_failed",
        severity: "warning",
        label: "Auditoria de ciclo/churn indisponível",
        message:
          "Não foi possível auditar public.vw_clients_ciclo_churn; renovação segue via clients.ciclo.",
      },
    ];
    payload.qualityWarnings = payload.warnings;
  }

  if (!cycleMap?.size) {
    payload.warnings = [
      ...(payload.warnings || []),
      {
        code: "cycle_fields_fetch_failed",
        severity: "warning",
        label: "Campos de ciclo indisponíveis",
        message: "Não foi possível carregar clients.ciclo; métricas de renovação podem estar incompletas.",
      },
    ];
    payload.qualityWarnings = payload.warnings;
  }

  payload._fetchStats = getAnalyticsDataContext()?.snapshot() || [];
  getAnalyticsDataContext()?.logPerf({
    total_ms: Date.now() - startedAt,
    payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
  });
  return payload;
  }, { perfDebug: perfDebugFromOptions(options), page: "ep_performance" });
}

export function toPublicEpPerformancePayload(payload) {
  return payload;
}
