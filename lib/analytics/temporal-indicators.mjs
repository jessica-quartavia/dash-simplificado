import { excludedClientIds, filterExcludedClients, isExcludedClient } from "./data-exclusions.mjs";
import { dataConfigurationError, getDataEnv, getPharusEnv, getPharusSupabaseClient } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import {
  getAnalyticsDataContext,
  perfDebugFromOptions,
  runWithAnalyticsDataContext,
} from "./analytics-data-context.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatusFromMaps,
} from "./analytical-cancellation.mjs";
import { fetchPharusDemoIdentities, filterPharusDemoRows, isPharusDemoEmail } from "./pharus-demo-filter.mjs";

const CLIENT_SELECT =
  "id,codigo,name,email,phone,cpf_digits,phone_digits,linked_user_id,status,engenheiro_patrimonial,programa,data_inicio_ciclo,created_at,data_churn";
const CANCEL_SELECT = ANALYTICAL_CANCEL_SELECT;
const MEETINGS_SELECT = "id,client_id,calendly_event_uri,event_name,start_time,end_time";
const MANUAL_MEETINGS_SELECT = "id,client_id,title,start_time,end_time,google_event_id";
const ATTENDANCE_SELECT = "calendly_event_uri,status,remarcado";
const MECHANISMS_SELECT = "id,client_id,status,implemented_at,created_at";
const FINANCIAL_SELECT =
  "id,client_id,reserva_liquidez,ultimo_aporte,ultima_renda_mensal,valor_imoveis_quitados,created_at,updated_at";
const NPS_SELECT = "id,client_id,client_name,client_email,score,created_at,tipo_de_forms";
const PHARUS_EVENTS_SELECT = "id,event_name,created_at,metadata";
const PHARUS_PLATFORM_LOGIN_SELECT = "id,user_id,event_name,created_at";
const PHARUS_PLATFORM_LOGIN_SCHEMA = "analytics";
const PHARUS_PLATFORM_LOGIN_TABLE = "platform_login_events";
const LOGIN_EVENTS = ["login_succeeded", "login_success"];

function blankToNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

function parseDate(value) {
  const raw = blankToNull(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value) {
  const raw = blankToNull(value);
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date, delta) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

function monthEnd(key) {
  const [year, month] = String(key).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function daysBetween(start, end) {
  const a = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const b = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.floor((b - a) / 86400000);
}

function average(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((sum, v) => sum + v, 0) / nums.length) * 10) / 10;
}

function pct(part, total) {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function normalizeToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeIdentityText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function identityDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function mergeSourceLabels(current, next) {
  const hasBase = String(current || "").includes("BASE QV") || String(next || "").includes("BASE QV");
  const hasPharus = String(current || "").includes("App Pharus") || String(next || "").includes("App Pharus");
  if (hasBase && hasPharus) return "BASE QV + App Pharus";
  if (hasBase) return "BASE QV";
  if (hasPharus) return "App Pharus";
  return next || current || "Nao informado";
}

function objectValue(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim().startsWith("{")) {
      try {
        return JSON.parse(value);
      } catch {
        // ignore malformed JSON
      }
    }
  }
  return {};
}

function firstValue(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function eventSubjectId(row) {
  const metadata = objectValue(row, ["metadata", "properties", "event_properties", "payload", "data"]);
  return String(
    firstValue(row, ["client_id", "cliente_id", "user_id", "userId", "distinct_id", "profile_id", "person_id"]) ||
      firstValue(metadata, ["client_id", "cliente_id", "user_id", "userId", "distinct_id", "profile_id", "person_id"]) ||
      "",
  ).trim();
}

function eventDate(row) {
  return parseDate(firstValue(row, ["created_at", "timestamp", "event_time", "occurred_at", "inserted_at", "sent_at"]));
}

function eventName(row) {
  return normalizeToken(row?.event_name).replace(/\s+/g, "_");
}

function normalizeMeetingStatus(status) {
  const token = normalizeToken(status);
  if (!token) return "unknown";
  if (["cancelada", "cancelado", "canceled", "cancelled"].includes(token)) return "cancelled";
  if (["nao compareceu", "faltou", "no show", "noshow", "ausente"].includes(token)) return "no_show";
  if (["compareceu", "realizado", "realizada", "concluido", "concluida", "presente"].includes(token)) return "completed";
  return "unknown";
}

function mechanismImplemented(row) {
  const date = parseDate(row.implemented_at);
  if (date) return date;
  const status = normalizeToken(row.status);
  if (["concluido", "concluida", "implementado", "completed"].includes(status)) return parseDate(row.created_at);
  return null;
}

function npsScore(score) {
  const value = Number(score);
  return Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function financialSnapshotValue(row) {
  const values = [
    toNumber(row.reserva_liquidez),
    toNumber(row.ultimo_aporte),
    toNumber(row.valor_imoveis_quitados),
  ].filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function ensureSubject(subjects, id, seed = {}) {
  const subjectId = String(id || "").trim();
  if (!subjectId) return null;
  if (!subjects.has(subjectId)) {
    subjects.set(subjectId, {
      subjectId,
      clientId: seed.clientId || subjectId,
      code: seed.code || "",
      name: seed.name || seed.email || subjectId,
      email: seed.email || "",
      engineer: seed.engineer || "Nao informado",
      program: seed.program || null,
      status: seed.status || "Nao informado",
      source: seed.source || "BASE QV",
      cancellationDate: seed.cancellationDate || null,
      activityDates: [],
      lastLoginAt: null,
      lastMeetingAt: null,
      lastImplementationAt: null,
      lastFinancialUpdateAt: null,
      lastNpsAt: null,
      monthly: new Map(),
    });
  } else {
    const item = subjects.get(subjectId);
    item.source = mergeSourceLabels(item.source, seed.source);
    for (const key of ["code", "name", "email", "engineer", "program", "status", "cancellationDate"]) {
      if ((!item[key] || item[key] === "Nao informado" || item[key] === item.subjectId) && seed[key]) item[key] = seed[key];
    }
  }
  return subjects.get(subjectId);
}

function ensureMonth(subject, key) {
  if (!subject.monthly.has(key)) {
    subject.monthly.set(key, {
      subjectId: subject.subjectId,
      clientId: subject.clientId,
      code: subject.code,
      name: subject.name,
      email: subject.email,
      engineer: subject.engineer,
      program: subject.program,
      status: subject.status,
      source: subject.source,
      month: key,
      logins: 0,
      meetings: 0,
      implementations: 0,
      financialUpdates: 0,
      npsResponses: 0,
      npsAverage: null,
      interactions: null,
      patrimony: null,
      daysWithoutActivity: null,
      cancellationDate: subject.cancellationDate,
      monthsToCancellation: null,
    });
  }
  return subject.monthly.get(key);
}

function addActivity(subject, date) {
  if (date) subject.activityDates.push(date);
}

function setLatestPastActivity(subject, field, date, now) {
  if (!subject || !date || date > now) return;
  if (!subject[field] || date > subject[field]) subject[field] = date;
}

async function fetchDataAll(table, select, order = "id.asc", options = {}) {
  return fetchAllRows({ table, select, order: order || "id.asc", ...options });
}

async function fetchDataAllSafe(table, select, order, warnings, options = {}) {
  try {
    return await fetchDataAll(table, select, order, options);
  } catch (error) {
    warnings.push({
      code: `BASE_QV_${table.toUpperCase()}`,
      label: `BASE QV public.${table}`,
      severity: "warning",
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function fetchPharusLoginEventsFromMetrics(warnings) {
  const client = getPharusSupabaseClient({ schema: "metrics" });
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 200000; offset += pageSize) {
    const page = await client.rest("events", {
      select: PHARUS_EVENTS_SELECT,
      filters: { event_name: "in.(login_succeeded,login_success)", order: "id.asc" },
      limit: pageSize,
      offset,
    });
    if (!page.ok) {
      const err = new Error(`metrics.events: HTTP ${page.status}`);
      err.status = page.status;
      throw err;
    }
    rows.push(...page.data);
    if (page.data.length < pageSize) break;
  }
  return rows;
}

async function fetchPharusLoginEventsFromPlatformView(warnings) {
  const client = getPharusSupabaseClient({ schema: PHARUS_PLATFORM_LOGIN_SCHEMA });
  const rows = await client.fetchAll(PHARUS_PLATFORM_LOGIN_TABLE, PHARUS_PLATFORM_LOGIN_SELECT, {
    pageSize: 1000,
    maxRows: 500_000,
    filters: { order: "id.asc" },
  });
  return rows.filter((row) => LOGIN_EVENTS.includes(eventName(row)));
}

async function fetchPharusLoginEvents(warnings) {
  try {
    const rows = await fetchPharusLoginEventsFromMetrics(warnings);
    return { rows, source: "metrics.events" };
  } catch (error) {
    warnings.push({
      code: "PHARUS_METRICS_EVENTS",
      label: "App Pharus metrics.events",
      severity: "warning",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const rows = await fetchPharusLoginEventsFromPlatformView(warnings);
    if (rows.length) {
      warnings.push({
        code: "PHARUS_LOGIN_SOURCE_FALLBACK",
        label: "Fonte de logins alternativa",
        severity: "info",
        message: "metrics.events indisponível; usando analytics.platform_login_events com event_name login_succeeded/login_success.",
      });
    }
    return { rows, source: "analytics.platform_login_events" };
  } catch (error) {
    warnings.push({
      code: "PHARUS_LOGIN_EVENTS_AUTH",
      label: "App Pharus analytics.platform_login_events",
      severity: "warning",
      message: error instanceof Error ? error.message : String(error),
    });
    return { rows: [], source: "none" };
  }
}

async function fetchPharusPersonalInfo(warnings) {
  try {
    const client = getPharusSupabaseClient({ schema: "core" });
    return await client.fetchAll("personal_info", "user_id,name,alternative_email,cpf,phone", { pageSize: 1000, maxRows: 200000 });
  } catch (error) {
    warnings.push({
      code: "PHARUS_PERSONAL_INFO",
      label: "App Pharus core.personal_info",
      severity: "warning",
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function fetchPharusAuthUsers(warnings) {
  const env = getPharusEnv();
  if (!env.serviceRoleKey) return [];
  try {
    const users = [];
    const perPage = 1000;
    for (let page = 1; page <= 200; page += 1) {
      const endpoint = new URL("/auth/v1/admin/users", env.url);
      endpoint.searchParams.set("page", String(page));
      endpoint.searchParams.set("per_page", String(perPage));
      const response = await fetch(endpoint, {
        headers: {
          apikey: env.serviceRoleKey,
          Authorization: `Bearer ${env.serviceRoleKey}`,
          Accept: "application/json",
        },
      });
      if (!response.ok) throw new Error(`auth.users: HTTP ${response.status}`);
      const payload = await response.json().catch(() => ({}));
      const batch = Array.isArray(payload.users) ? payload.users : [];
      users.push(...batch);
      if (batch.length < perPage) break;
    }
    return users;
  } catch (error) {
    warnings.push({
      code: "PHARUS_AUTH_USERS",
      label: "App Pharus auth.users",
      severity: "warning",
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function buildPharusProfileMap(personalRows, authRows) {
  const map = new Map();
  for (const row of authRows || []) {
    const id = String(row?.id || "").trim();
    if (!id) continue;
    const metadata = row.user_metadata && typeof row.user_metadata === "object" ? row.user_metadata : {};
    map.set(id, {
      name: String(metadata.name || metadata.full_name || row.email || "").trim(),
      email: String(row.email || "").trim(),
      cpf: "",
      phone: "",
    });
  }
  for (const row of personalRows || []) {
    const id = String(row?.user_id || "").trim();
    if (!id) continue;
    const current = map.get(id) || {};
    map.set(id, {
      name: String(row?.name || current.name || "").trim(),
      email: String(current.email || row?.alternative_email || "").trim(),
      cpf: String(row?.cpf || current.cpf || "").trim(),
      phone: String(row?.phone || current.phone || "").trim(),
    });
  }
  return map;
}

function uniqueClientIndex(clients, valueOf) {
  const index = new Map();
  for (const client of clients || []) {
    const value = valueOf(client);
    if (!value) continue;
    if (!index.has(value)) index.set(value, []);
    index.get(value).push(String(client.id));
  }
  return index;
}

function buildPharusClientCrosswalk(clients, profiles) {
  const indexes = [
    ["linked_user_id", uniqueClientIndex(clients, (client) => String(client.linked_user_id || "").trim())],
    ["cpf", uniqueClientIndex(clients, (client) => identityDigits(client.cpf_digits))],
    ["email", uniqueClientIndex(clients, (client) => normalizeIdentityText(client.email))],
    ["phone", uniqueClientIndex(clients, (client) => identityDigits(client.phone_digits || client.phone))],
  ];
  const byUserId = new Map();
  const reasonByUserId = new Map();
  for (const [userId, profile] of profiles.entries()) {
    const values = {
      linked_user_id: String(userId || "").trim(),
      cpf: identityDigits(profile.cpf),
      email: normalizeIdentityText(profile.email),
      phone: identityDigits(profile.phone),
    };
    for (const [reason, index] of indexes) {
      const value = values[reason];
      if (!value) continue;
      const candidates = index.get(value) || [];
      if (candidates.length !== 1) continue;
      byUserId.set(String(userId), candidates[0]);
      reasonByUserId.set(String(userId), reason);
      break;
    }
  }
  return { byUserId, reasonByUserId };
}

function buildMonthWindow(monthsBack = 12) {
  const now = new Date();
  const start = addMonths(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), -(monthsBack - 1));
  return Array.from({ length: monthsBack }, (_, index) => monthKey(addMonths(start, index)));
}

function formatMonthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function meetingCompositeKey(clientId, date, title) {
  const minute = date ? `${date.toISOString().slice(0, 16)}` : "";
  return `${clientId}|${minute}|${normalizeToken(title)}`;
}

function rowsInCancelWindow(rows, minMonth, maxMonth) {
  return rows.filter((row) => row.monthsToCancellation != null && row.monthsToCancellation >= minMonth && row.monthsToCancellation <= maxMonth);
}

function sumRows(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

function avgPerMonth(rows, key, monthCount) {
  return monthCount ? sumRows(rows, key) / monthCount : 0;
}

function buildPreCancellationAnalysis(rows, subjects) {
  const cancelledSubjects = [...subjects.values()].filter((subject) => subject.cancellationDate);
  const subjectRows = new Map();
  for (const row of rows) {
    if (!row.cancellationDate) continue;
    if (!subjectRows.has(row.subjectId)) subjectRows.set(row.subjectId, []);
    subjectRows.get(row.subjectId).push(row);
  }

  const signals = [
    { key: "login_drop", label: "Queda de logins", description: "Logins dos últimos 30 dias caíram 50%+ contra a média de 91-180 dias." },
    { key: "no_meeting_60", label: "Sem reunião em 60 dias", description: "Nenhuma reunião nos 60 dias antes do cancelamento." },
    { key: "no_implementation_90", label: "Sem implementação em 90 dias", description: "Nenhuma implementação nos 90 dias antes do cancelamento." },
    { key: "no_financial_60", label: "Sem atualização financeira em 60 dias", description: "Nenhuma atualização financeira nos 60 dias antes do cancelamento." },
    { key: "nps_detractor", label: "NPS detrator recente", description: "Último NPS até 90 dias antes do cancelamento foi 0-6." },
    { key: "inactive_30", label: "30+ dias sem atividade", description: "Último mês antes do cancelamento com 30 ou mais dias sem atividade." },
  ];
  const signalCounts = new Map(signals.map((signal) => [signal.key, 0]));
  const details = [];
  const windowRows = {
    last30: [],
    d31_60: [],
    d61_90: [],
    baseline: [],
  };

  for (const subject of cancelledSubjects) {
    const rowsForSubject = subjectRows.get(subject.subjectId) || [];
    if (!rowsForSubject.length) continue;
    const last30 = rowsInCancelWindow(rowsForSubject, 0, 0);
    const d31_60 = rowsInCancelWindow(rowsForSubject, 1, 1);
    const d61_90 = rowsInCancelWindow(rowsForSubject, 2, 2);
    const pre60 = rowsInCancelWindow(rowsForSubject, 0, 1);
    const pre90 = rowsInCancelWindow(rowsForSubject, 0, 2);
    const baseline = rowsInCancelWindow(rowsForSubject, 3, 6);
    windowRows.last30.push(...last30);
    windowRows.d31_60.push(...d31_60);
    windowRows.d61_90.push(...d61_90);
    windowRows.baseline.push(...baseline);

    const last30Logins = sumRows(last30, "logins");
    const baselineLoginsAvg = avgPerMonth(baseline, "logins", 4);
    const latestNpsRow = [...pre90].filter((row) => row.npsAverage != null).sort((a, b) => String(b.month).localeCompare(String(a.month)))[0] || null;
    const subjectSignals = [];

    if (baselineLoginsAvg > 0 && last30Logins <= baselineLoginsAvg * 0.5) subjectSignals.push("login_drop");
    if (sumRows(pre60, "meetings") === 0) subjectSignals.push("no_meeting_60");
    if (sumRows(pre90, "implementations") === 0) subjectSignals.push("no_implementation_90");
    if (sumRows(pre60, "financialUpdates") === 0) subjectSignals.push("no_financial_60");
    if (latestNpsRow && latestNpsRow.npsAverage <= 6) subjectSignals.push("nps_detractor");
    if (Math.max(...last30.map((row) => row.daysWithoutActivity || 0), 0) >= 30) subjectSignals.push("inactive_30");

    for (const signal of subjectSignals) signalCounts.set(signal, (signalCounts.get(signal) || 0) + 1);
    if (subjectSignals.length) {
      details.push({
        subjectId: subject.subjectId,
        clientId: subject.clientId,
        code: subject.code,
        name: subject.name,
        email: subject.email,
        engineer: subject.engineer,
        program: subject.program,
        cancellationDate: subject.cancellationDate,
        signalCount: subjectSignals.length,
        signals: subjectSignals.map((key) => signals.find((signal) => signal.key === key)?.label || key),
        last30: {
          logins: last30Logins,
          meetings: sumRows(last30, "meetings"),
          implementations: sumRows(last30, "implementations"),
          financialUpdates: sumRows(last30, "financialUpdates"),
          npsResponses: sumRows(last30, "npsResponses"),
          daysWithoutActivity: Math.max(...last30.map((row) => row.daysWithoutActivity || 0), 0),
        },
        baseline: {
          loginsAvg: Math.round(baselineLoginsAvg * 10) / 10,
          meetingsAvg: Math.round(avgPerMonth(baseline, "meetings", 4) * 10) / 10,
          implementationsAvg: Math.round(avgPerMonth(baseline, "implementations", 4) * 10) / 10,
          financialUpdatesAvg: Math.round(avgPerMonth(baseline, "financialUpdates", 4) * 10) / 10,
        },
      });
    }
  }

  const analyzed = cancelledSubjects.length;
  const withSignals = details.length;
  const windowSummary = [
    { key: "last30", label: "0-30 dias", monthsToCancellation: "0", rows: windowRows.last30 },
    { key: "d31_60", label: "31-60 dias", monthsToCancellation: "1", rows: windowRows.d31_60 },
    { key: "d61_90", label: "61-90 dias", monthsToCancellation: "2", rows: windowRows.d61_90 },
    { key: "baseline", label: "91-180 dias", monthsToCancellation: "3-6", rows: windowRows.baseline },
  ].map((window) => ({
    key: window.key,
    label: window.label,
    monthsToCancellation: window.monthsToCancellation,
    logins: sumRows(window.rows, "logins"),
    meetings: sumRows(window.rows, "meetings"),
    implementations: sumRows(window.rows, "implementations"),
    financialUpdates: sumRows(window.rows, "financialUpdates"),
    npsResponses: sumRows(window.rows, "npsResponses"),
    averageDaysWithoutActivity: average(window.rows.map((row) => row.daysWithoutActivity)),
  }));

  return {
    analyzedCancelledClients: analyzed,
    clientsWithSignals: withSignals,
    clientsWithSignalsPercent: pct(withSignals, analyzed),
    averageSignalsPerClient: withSignals ? Math.round((details.reduce((sum, row) => sum + row.signalCount, 0) / withSignals) * 10) / 10 : 0,
    signals: signals.map((signal) => ({
      ...signal,
      count: signalCounts.get(signal.key) || 0,
      percent: pct(signalCounts.get(signal.key) || 0, analyzed),
    })),
    windowSummary,
    clients: details.sort((a, b) => b.signalCount - a.signalCount || String(a.name).localeCompare(String(b.name), "pt-BR")),
  };
}

function buildActiveRiskAnalysis(rows, subjects, months) {
  const latestMonths = months.slice(-6);
  const currentMonth = latestMonths.at(-1);
  const previousThree = latestMonths.slice(-4, -1);
  const lastTwo = latestMonths.slice(-2);
  const lastThree = latestMonths.slice(-3);
  const definitions = [
    { key: "login_drop", label: "Queda de logins", description: "Logins do mês atual 50% ou mais abaixo da média dos três meses anteriores." },
    { key: "no_meeting_60", label: "Sem reunião em 60 dias", description: "Nenhuma reunião nos dois meses mais recentes." },
    { key: "no_implementation_90", label: "Sem implementação em 90 dias", description: "Nenhuma implementação nos três meses mais recentes." },
    { key: "no_financial_60", label: "Sem atualização financeira em 60 dias", description: "Nenhuma atualização financeira nos dois meses mais recentes." },
    { key: "nps_detractor", label: "NPS detrator recente", description: "Último NPS conhecido nos três meses mais recentes entre 0 e 6." },
    { key: "inactive_30", label: "30+ dias sem atividade", description: "Mês mais recente com 30 dias ou mais sem atividade conhecida." },
  ];
  const counts = new Map(definitions.map((item) => [item.key, 0]));
  const rowsBySubject = new Map();
  for (const row of rows) {
    if (!latestMonths.includes(row.month)) continue;
    if (!rowsBySubject.has(row.subjectId)) rowsBySubject.set(row.subjectId, []);
    rowsBySubject.get(row.subjectId).push(row);
  }
  const details = [];
  const activeSubjects = [...subjects.values()].filter((subject) => {
    const status = normalizeToken(subject.status);
    return !subject.cancellationDate && status === "ativo";
  });
  for (const subject of activeSubjects) {
    const subjectRows = rowsBySubject.get(subject.subjectId) || [];
    const byMonth = new Map(subjectRows.map((row) => [row.month, row]));
    const current = byMonth.get(currentMonth) || {};
    const baselineLogins = average(previousThree.map((month) => Number(byMonth.get(month)?.logins || 0))) || 0;
    const currentLogins = Number(current.logins || 0);
    const recentNps = lastThree
      .map((month) => byMonth.get(month))
      .filter((row) => row?.npsAverage != null)
      .sort((a, b) => String(b.month).localeCompare(String(a.month)))[0];
    const keys = [];
    if (baselineLogins > 0 && currentLogins <= baselineLogins * 0.5) keys.push("login_drop");
    if (sumRows(lastTwo.map((month) => byMonth.get(month)).filter(Boolean), "meetings") === 0) keys.push("no_meeting_60");
    if (sumRows(lastThree.map((month) => byMonth.get(month)).filter(Boolean), "implementations") === 0) keys.push("no_implementation_90");
    if (sumRows(lastTwo.map((month) => byMonth.get(month)).filter(Boolean), "financialUpdates") === 0) keys.push("no_financial_60");
    if (recentNps && recentNps.npsAverage <= 6) keys.push("nps_detractor");
    if (Number(current.daysWithoutActivity || 0) >= 30) keys.push("inactive_30");
    for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
    if (!keys.length) continue;
    details.push({
      subjectId: subject.subjectId,
      clientId: subject.clientId,
      code: subject.code,
      name: subject.name,
      email: subject.email,
      engineer: subject.engineer,
      program: subject.program,
      status: subject.status,
      signalCount: keys.length,
      signals: keys.map((key) => definitions.find((item) => item.key === key)?.label || key),
      lastActivityAt: subject.lastActivityAt || null,
      daysWithoutActivity: current.daysWithoutActivity ?? null,
      currentMonthLogins: currentLogins,
    });
  }
  details.sort((a, b) => b.signalCount - a.signalCount || String(a.name).localeCompare(String(b.name), "pt-BR"));
  const signals = definitions
    .map((item) => ({ ...item, count: counts.get(item.key) || 0, percent: pct(counts.get(item.key) || 0, activeSubjects.length) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
  return {
    analyzedActiveClients: activeSubjects.length,
    clientsWithSignals: details.length,
    clientsWithSignalsPercent: pct(details.length, activeSubjects.length),
    averageSignalsPerClient: details.length ? Math.round((details.reduce((sum, row) => sum + row.signalCount, 0) / details.length) * 10) / 10 : 0,
    topSignal: signals[0] || null,
    signals,
    clients: details,
  };
}

export async function computeTemporalIndicatorsPayload(options = {}) {
  const run = async () => {
  const startedAt = Date.now();
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }

  const warnings = [];
  const now = new Date();
  const months = buildMonthWindow(12);
  const monthSet = new Set(months);
  const bundle = options.sharedBundle || null;
  let clientsRaw;
  let cancellationsRaw;
  let clientMeetingsRaw;
  let manualMeetingsRaw;
  let attendanceRows;
  let mechanismsRaw;
  let financialRowsRaw;
  let npsRowsRaw;

  if (bundle) {
    clientsRaw = bundle.clientsRaw || bundle.clients;
    cancellationsRaw = bundle.cancellations;
    clientMeetingsRaw = bundle.calendlyRows;
    manualMeetingsRaw = bundle.manualRows;
    attendanceRows = bundle.attendanceRows;
    mechanismsRaw = bundle.mechanismsRaw;
    financialRowsRaw = bundle.financialRows;
    npsRowsRaw = bundle.npsRows;
  } else {
    [
      clientsRaw,
      cancellationsRaw,
      clientMeetingsRaw,
      manualMeetingsRaw,
      attendanceRows,
      mechanismsRaw,
      financialRowsRaw,
      npsRowsRaw,
    ] = await Promise.all([
      fetchDataAll("clients", CLIENT_SELECT),
      fetchDataAllSafe("cancellations", CANCEL_SELECT, "updated_at.asc", warnings),
      fetchDataAllSafe("client_meetings", MEETINGS_SELECT, "start_time.asc", warnings, { canonical: false }),
      fetchDataAllSafe("manual_meetings", MANUAL_MEETINGS_SELECT, "start_time.asc", warnings, { canonical: false }),
      fetchDataAllSafe("meeting_attendance", ATTENDANCE_SELECT, "created_at.asc", warnings),
      fetchDataAllSafe("client_mecanismos", MECHANISMS_SELECT, "implemented_at.asc", warnings),
      fetchDataAllSafe("client_financial_data", FINANCIAL_SELECT, "updated_at.asc", warnings),
      fetchDataAllSafe("nps_responses", NPS_SELECT, "created_at.asc", warnings),
    ]);
  }

  const [pharusLoginFetch, pharusPersonalRows, pharusAuthRows] = await Promise.all([
    fetchPharusLoginEvents(warnings),
    fetchPharusPersonalInfo(warnings),
    fetchPharusAuthUsers(warnings),
  ]);
  const pharusEvents = pharusLoginFetch.rows || [];
  const loginEventsSource = pharusLoginFetch.source || "none";

  const clients = filterExcludedClients(clientsRaw);
  const removedIds = excludedClientIds(clientsRaw);
  const keepClient = (row) => !removedIds.has(String(row?.client_id || ""));
  const cancellations = cancellationsRaw.filter(keepClient);
  const clientMeetings = clientMeetingsRaw.filter(keepClient);
  const manualMeetings = manualMeetingsRaw.filter(keepClient);
  const mechanisms = mechanismsRaw.filter(keepClient);
  const financialRows = financialRowsRaw.filter(keepClient);
  const npsRows = npsRowsRaw.filter((row) => keepClient(row) && !isExcludedClient(row));

  const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations, clients);

  const subjects = new Map();
  for (const client of clients) {
    const cancelInfo = cancelMap.get(String(client.id)) || null;
    const analyticalStatus = resolveAnalyticalStatusFromMaps(client.status, cancelInfo);
    ensureSubject(subjects, client.id, {
      clientId: String(client.id),
      code: blankToNull(client.codigo) || "",
      name: blankToNull(client.name) || String(client.id),
      engineer: blankToNull(client.engenheiro_patrimonial) || "Nao informado",
      program: blankToNull(client.programa),
      status: analyticalStatus,
      rawStatus: blankToNull(client.status) || "Nao informado",
      source: "BASE QV",
      cancellationDate: cancelInfo?.date ? cancelInfo.date.toISOString() : null,
      cancellationSource: cancelInfo?.source || null,
      hasConfirmedCancellationDate: Boolean(cancelInfo?.hasConfirmedDate && cancelInfo?.date),
    });
  }

  const pharusDemoIdentities = await fetchPharusDemoIdentities(warnings);
  const eligiblePharusEvents = filterPharusDemoRows(pharusEvents, pharusDemoIdentities, ["user_id", "userId", "client_id", "distinct_id", "profile_id", "person_id"]);
  const eligiblePharusPersonalRows = filterExcludedClients(filterPharusDemoRows(pharusPersonalRows, pharusDemoIdentities));
  const eligiblePharusAuthRows = (pharusAuthRows || []).filter((row) => !isPharusDemoEmail(row?.email));
  const pharusProfiles = buildPharusProfileMap(eligiblePharusPersonalRows, eligiblePharusAuthRows);
  const pharusCrosswalk = buildPharusClientCrosswalk(clients, pharusProfiles);
  const attendanceByUri = new Map();
  for (const row of attendanceRows) {
    const uri = blankToNull(row.calendly_event_uri);
    if (!uri) continue;
    attendanceByUri.set(String(uri), normalizeMeetingStatus(row.status));
  }

  for (const event of eligiblePharusEvents) {
    if (!LOGIN_EVENTS.includes(eventName(event))) continue;
    const pharusUserId = eventSubjectId(event);
    const date = eventDate(event);
    if (!pharusUserId || !date) continue;
    const canonicalClientId = pharusCrosswalk.byUserId.get(pharusUserId) || pharusUserId;
    const profile = pharusProfiles.get(pharusUserId) || {};
    const subject = ensureSubject(subjects, canonicalClientId, {
      clientId: canonicalClientId,
      source: pharusCrosswalk.byUserId.has(pharusUserId) ? "BASE QV + App Pharus" : "App Pharus",
      program: pharusCrosswalk.byUserId.has(pharusUserId) ? null : "Pharus",
      name: profile.name || profile.email || pharusUserId,
      email: profile.email || "",
    });
    if (!subject) continue;
    const key = monthKey(date);
    if (monthSet.has(key)) ensureMonth(subject, key).logins += 1;
    setLatestPastActivity(subject, "lastLoginAt", date, now);
    addActivity(subject, date);
  }

  const seenMeetings = new Set();
  for (const row of clientMeetings) {
    const id = String(blankToNull(row.client_id) || "");
    const date = parseDate(row.start_time);
    if (!id || !date) continue;
    const status = attendanceByUri.get(String(row.calendly_event_uri || "")) || "unknown";
    if (status === "cancelled") continue;
    const dedupeKey = meetingCompositeKey(id, date, row.event_name);
    if (seenMeetings.has(dedupeKey)) continue;
    seenMeetings.add(dedupeKey);
    const subject = ensureSubject(subjects, id, { source: "BASE QV" });
    const key = monthKey(date);
    if (monthSet.has(key)) ensureMonth(subject, key).meetings += 1;
    setLatestPastActivity(subject, "lastMeetingAt", date, now);
    addActivity(subject, date);
  }
  for (const row of manualMeetings) {
    const id = String(blankToNull(row.client_id) || "");
    const date = parseDate(row.start_time);
    if (!id || !date) continue;
    const dedupeKey = meetingCompositeKey(id, date, row.title || row.google_event_id);
    if (seenMeetings.has(dedupeKey)) continue;
    seenMeetings.add(dedupeKey);
    const subject = ensureSubject(subjects, id, { source: "BASE QV" });
    const key = monthKey(date);
    if (monthSet.has(key)) ensureMonth(subject, key).meetings += 1;
    setLatestPastActivity(subject, "lastMeetingAt", date, now);
    addActivity(subject, date);
  }

  for (const row of mechanisms) {
    const id = String(blankToNull(row.client_id) || "");
    const date = mechanismImplemented(row);
    if (!id || !date) continue;
    const subject = ensureSubject(subjects, id, { source: "BASE QV" });
    const key = monthKey(date);
    if (monthSet.has(key)) ensureMonth(subject, key).implementations += 1;
    setLatestPastActivity(subject, "lastImplementationAt", date, now);
    addActivity(subject, date);
  }

  for (const row of financialRows) {
    const id = String(blankToNull(row.client_id) || "");
    const date = parseDate(row.updated_at) || parseDate(row.created_at);
    if (!id || !date) continue;
    const subject = ensureSubject(subjects, id, { source: "BASE QV" });
    const key = monthKey(date);
    const value = financialSnapshotValue(row);
    if (monthSet.has(key)) {
      const record = ensureMonth(subject, key);
      record.financialUpdates += 1;
      if (value != null) record.patrimony = value;
    }
    setLatestPastActivity(subject, "lastFinancialUpdateAt", date, now);
    addActivity(subject, date);
  }

  const npsScoresBySubjectMonth = new Map();
  for (const row of npsRows) {
    const id = String(blankToNull(row.client_id) || "");
    const date = parseDate(row.created_at);
    const score = npsScore(row.score);
    if (!id || !date || score == null) continue;
    const subject = ensureSubject(subjects, id, {
      source: "BASE QV",
      name: blankToNull(row.client_name) || undefined,
      email: blankToNull(row.client_email) || undefined,
    });
    const key = monthKey(date);
    if (monthSet.has(key)) {
      const record = ensureMonth(subject, key);
      record.npsResponses += 1;
      const scoreKey = `${id}|${key}`;
      if (!npsScoresBySubjectMonth.has(scoreKey)) npsScoresBySubjectMonth.set(scoreKey, []);
      npsScoresBySubjectMonth.get(scoreKey).push(score);
    }
    setLatestPastActivity(subject, "lastNpsAt", date, now);
    addActivity(subject, date);
  }

  for (const [scoreKey, scores] of npsScoresBySubjectMonth.entries()) {
    const [id, key] = scoreKey.split("|");
    const subject = subjects.get(id);
    if (!subject) continue;
    const record = ensureMonth(subject, key);
    record.npsAverage = average(scores);
  }

  const activityRecency = [...subjects.values()].map((subject) => ({
    subjectId: subject.subjectId,
    clientId: subject.clientId,
    code: subject.code,
    name: subject.name,
    email: subject.email,
    engineer: subject.engineer,
    program: subject.program,
    status: subject.status,
    source: subject.source,
    cancellationDate: subject.cancellationDate,
    lastLoginAt: subject.lastLoginAt?.toISOString() || null,
    lastMeetingAt: subject.lastMeetingAt?.toISOString() || null,
    lastImplementationAt: subject.lastImplementationAt?.toISOString() || null,
    lastFinancialUpdateAt: subject.lastFinancialUpdateAt?.toISOString() || null,
    lastNpsAt: subject.lastNpsAt?.toISOString() || null,
    daysSinceLastLogin: subject.lastLoginAt ? Math.max(0, daysBetween(subject.lastLoginAt, now)) : null,
    daysSinceLastMeeting: subject.lastMeetingAt ? Math.max(0, daysBetween(subject.lastMeetingAt, now)) : null,
    daysSinceLastImplementation: subject.lastImplementationAt ? Math.max(0, daysBetween(subject.lastImplementationAt, now)) : null,
    daysSinceLastFinancialUpdate: subject.lastFinancialUpdateAt ? Math.max(0, daysBetween(subject.lastFinancialUpdateAt, now)) : null,
    daysSinceLastNps: subject.lastNpsAt ? Math.max(0, daysBetween(subject.lastNpsAt, now)) : null,
  }));

  const rows = [];
  for (const subject of subjects.values()) {
    subject.activityDates.sort((a, b) => a - b);
    for (const key of months) {
      const record = ensureMonth(subject, key);
      const end = monthEnd(key);
      // No mês corrente, não projeta inatividade até uma data futura. Como a
      // atividade mais recente é escolhida entre todas as fontes, esta regra é
      // equivalente ao menor número de dias sem atividade entre os cenários.
      const referenceDate = end > now ? now : end;
      const lastActivity = [...subject.activityDates].reverse().find((date) => date <= referenceDate);
      if (lastActivity) record.daysWithoutActivity = Math.max(0, daysBetween(lastActivity, referenceDate));
      if (subject.cancellationDate) {
        const cancel = parseDate(subject.cancellationDate);
        if (cancel) {
          const [year, month] = key.split("-").map(Number);
          record.monthsToCancellation = (cancel.getUTCFullYear() - year) * 12 + (cancel.getUTCMonth() - (month - 1));
        }
      }
      rows.push(record);
    }
  }

  const monthly = months.map((key) => {
    const monthRows = rows.filter((row) => row.month === key);
    return {
      month: key,
      label: formatMonthLabel(key),
      logins: monthRows.reduce((sum, row) => sum + row.logins, 0),
      meetings: monthRows.reduce((sum, row) => sum + row.meetings, 0),
      implementations: monthRows.reduce((sum, row) => sum + row.implementations, 0),
      financialUpdates: monthRows.reduce((sum, row) => sum + row.financialUpdates, 0),
      npsResponses: monthRows.reduce((sum, row) => sum + row.npsResponses, 0),
      interactions: null,
      patrimony: average(monthRows.map((row) => row.patrimony)),
      averageDaysWithoutActivity: average(monthRows.map((row) => row.daysWithoutActivity)),
    };
  });

  const activeRows = rows.filter((row) =>
    row.logins || row.meetings || row.implementations || row.financialUpdates || row.npsResponses || row.patrimony != null || row.daysWithoutActivity != null,
  );
  const lastMonth = monthly[monthly.length - 1] || {};
  const highRisk = rows.filter((row) => row.monthsToCancellation != null && row.monthsToCancellation >= 0 && row.monthsToCancellation <= 3 && (row.daysWithoutActivity || 0) >= 30).length;
  const preCancellation = buildPreCancellationAnalysis(rows, subjects);
  const activeRisk = buildActiveRiskAnalysis(rows, subjects, months);
  const pharusLoginUserIds = new Set(eligiblePharusEvents.map(eventSubjectId).filter(Boolean));
  const matchedPharusUserIds = [...pharusLoginUserIds].filter((userId) => pharusCrosswalk.byUserId.has(userId));
  const identityMatchesByRule = matchedPharusUserIds.reduce((acc, userId) => {
    const reason = pharusCrosswalk.reasonByUserId.get(userId) || "unknown";
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    totalSubjects: subjects.size,
    baseClients: clients.length,
    appPharusUsers: pharusLoginUserIds.size,
    matchedPharusUsers: matchedPharusUserIds.length,
    unmatchedPharusUsers: pharusLoginUserIds.size - matchedPharusUserIds.length,
    identityMatchesByRule,
    crossSource: {
      baseClients: clients.length,
      appPharusUsers: pharusLoginUserIds.size,
      matchedIntoBase: matchedPharusUserIds.length,
      appOnlySubjects: pharusLoginUserIds.size - matchedPharusUserIds.length,
      unionTotal: subjects.size,
      overlapInUnion: matchedPharusUserIds.length,
    },
    loginEventsSource,
    months: months.length,
    activeMonthlyRows: activeRows.length,
    totalLogins: monthly.reduce((sum, row) => sum + row.logins, 0),
    totalMeetings: monthly.reduce((sum, row) => sum + row.meetings, 0),
    totalImplementations: monthly.reduce((sum, row) => sum + row.implementations, 0),
    totalFinancialUpdates: monthly.reduce((sum, row) => sum + row.financialUpdates, 0),
    totalNpsResponses: monthly.reduce((sum, row) => sum + row.npsResponses, 0),
    lastMonthDaysWithoutActivity: lastMonth.averageDaysWithoutActivity ?? null,
    cancellationWindowInactiveRows: highRisk,
    preCancellationClientsWithSignals: preCancellation.clientsWithSignals,
    preCancellationClientsWithSignalsPercent: preCancellation.clientsWithSignalsPercent,
    activeClientsWithSignals: activeRisk.clientsWithSignals,
    activeClientsWithSignalsPercent: activeRisk.clientsWithSignalsPercent,
  };

  const indicators = [
    { indicator: "Sinais antes do cancelamento", viability: "Sim", metric: "Compara 0-30, 31-60 e 61-90 dias antes do cancelamento contra baseline de 91-180 dias e identifica queda de atividade, ausencia de reunioes/implementacoes/atualizacoes, NPS detrator e 30+ dias sem atividade.", coverage: { value: preCancellation.clientsWithSignals, total: preCancellation.analyzedCancelledClients, percent: preCancellation.clientsWithSignalsPercent }, base: "App Pharus + BASE QV" },
    { indicator: "Logins", viability: loginEventsSource === "none" ? "Sem dados" : "Sim", metric: `count(*) por user_id e mês em App Pharus ${loginEventsSource}, event_name login_succeeded/login_success; e-mails @demo.com excluídos.`, coverage: { value: summary.totalLogins, total: eligiblePharusEvents.length, percent: pct(summary.totalLogins, eligiblePharusEvents.length) }, base: "App Pharus" },
    { indicator: "Reuniões", viability: "Sim", metric: "count(distinct reunião deduplicada) por client_id e mês em client_meetings/manual_meetings; canceladas excluídas quando status disponível.", coverage: { value: summary.totalMeetings, total: clientMeetings.length + manualMeetings.length, percent: pct(summary.totalMeetings, clientMeetings.length + manualMeetings.length) }, base: "BASE QV" },
    { indicator: "Implementações", viability: "Sim", metric: "count(*) por client_id e mês usando client_mecanismos.implemented_at ou status concluído com created_at.", coverage: { value: summary.totalImplementations, total: mechanisms.length, percent: pct(summary.totalImplementations, mechanisms.length) }, base: "BASE QV" },
    { indicator: "Atualizações financeiras", viability: "Sim", metric: "count(*) por client_id e mês usando client_financial_data.updated_at; fallback created_at.", coverage: { value: summary.totalFinancialUpdates, total: financialRows.length, percent: pct(summary.totalFinancialUpdates, financialRows.length) }, base: "BASE QV" },
    { indicator: "NPS", viability: "Parcial", metric: "nps_responses.score por client_id e mês quando houver client_id e nota válida.", coverage: { value: summary.totalNpsResponses, total: npsRows.length, percent: pct(summary.totalNpsResponses, npsRows.length) }, base: "BASE QV" },
    { indicator: "Interações", viability: "Sem dados", metric: "Sem tabela confiável de interação cliente ↔ EP com remetente, destinatário, status e data.", coverage: { value: 0, total: summary.totalSubjects, percent: 0 }, base: "Sem dado" },
    { indicator: "Patrimônio", viability: "Parcial", metric: "Snapshot mensal aproximado a partir de client_financial_data: reserva_liquidez + ultimo_aporte + valor_imoveis_quitados.", coverage: { value: rows.filter((row) => row.patrimony != null).length, total: rows.length, percent: pct(rows.filter((row) => row.patrimony != null).length, rows.length) }, base: "BASE QV" },
    { indicator: "Dias sem atividade", viability: "Sim", metric: "Fim do mês menos última atividade conhecida até o mês: login, reunião, implementação, atualização financeira ou NPS.", coverage: { value: rows.filter((row) => row.daysWithoutActivity != null).length, total: rows.length, percent: pct(rows.filter((row) => row.daysWithoutActivity != null).length, rows.length) }, base: "App Pharus + BASE QV" },
  ];

  const payload = {
    generatedAt: new Date().toISOString(),
    months,
    summary,
    monthly,
    preCancellation,
    activeRisk,
    activityRecency,
    clients: rows,
    indicators,
    sources: {
      warnings,
      databases: [
        { source: "App Pharus", schema: loginEventsSource.includes(".") ? "analytics" : "metrics", table: loginEventsSource, rows: eligiblePharusEvents.length, excludedDemoUsers: pharusDemoIdentities.userIds.size },
        { source: "BASE QV", schema: "public", table: "client_meetings/manual_meetings", rows: clientMeetings.length + manualMeetings.length },
        { source: "BASE QV", schema: "public", table: "client_mecanismos", rows: mechanisms.length },
        { source: "BASE QV", schema: "public", table: "client_financial_data", rows: financialRows.length },
        { source: "BASE QV", schema: "public", table: "nps_responses", rows: npsRows.length },
      ],
    },
  };

  if (options.executiveSlim) {
    return {
      preCancellation,
      activeRisk,
      activityRecency,
      clients: rows,
      monthly,
      months,
    };
  }

  payload._fetchStats = getAnalyticsDataContext()?.snapshot() || [];
  getAnalyticsDataContext()?.logPerf({
    total_ms: Date.now() - startedAt,
    payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
  });
  return payload;
  };

  if (options.reuseContext && getAnalyticsDataContext()) {
    return run();
  }
  return runWithAnalyticsDataContext(run, { perfDebug: perfDebugFromOptions(options), page: "temporal_indicators" });
}

const TEMPORAL_MONTHLY_PUBLIC_FIELDS = [
  "subjectId",
  "month",
  "source",
  "program",
  "cancellationDate",
  "monthsToCancellation",
  "logins",
  "meetings",
  "implementations",
  "financialUpdates",
  "npsResponses",
  "npsAverage",
  "daysWithoutActivity",
  "patrimony",
];

function slimTemporalMonthlyRow(row) {
  if (!row || typeof row !== "object") return row;
  const slim = {};
  for (const key of TEMPORAL_MONTHLY_PUBLIC_FIELDS) {
    if (row[key] !== undefined) slim[key] = row[key];
  }
  return slim;
}

export function toPublicTemporalIndicatorsPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const { _fetchStats, clients, activityRecency, preCancellation, activeRisk, ...rest } = payload;
  return {
    ...rest,
    activityRecency: (activityRecency || []).map((row) => {
      const { email, ...publicRow } = row;
      return publicRow;
    }),
    preCancellation: preCancellation
      ? {
          ...preCancellation,
          clients: (preCancellation.clients || []).map((row) => ({
            subjectId: row.subjectId,
            clientId: row.clientId,
            code: row.code,
            name: row.name,
            engineer: row.engineer,
            program: row.program,
            segment: row.segment,
            status: row.status,
            source: row.source,
            cancellationDate: row.cancellationDate,
            signals: row.signals,
            signalCount: row.signalCount,
          })),
        }
      : preCancellation,
    activeRisk: activeRisk
      ? {
          ...activeRisk,
          clients: (activeRisk.clients || []).map((row) => ({
            subjectId: row.subjectId,
            clientId: row.clientId,
            code: row.code,
            name: row.name,
            engineer: row.engineer,
            program: row.program,
            segment: row.segment,
            status: row.status,
            source: row.source,
            signals: row.signals,
            signalCount: row.signalCount,
          })),
        }
      : activeRisk,
    detailsEndpoint: "/api/temporal-indicators/details",
  };
}

export {
  meetingCompositeKey,
  buildMonthWindow,
  mechanismImplemented,
  buildPharusClientCrosswalk,
  eventName,
  eventSubjectId,
  LOGIN_EVENTS,
};

/**
 * Coleta chaves de reuniões contadas (12 meses) para auditoria V1×V2.
 */
export function collectTemporalMeetingKeys({
  clientMeetings = [],
  manualMeetings = [],
  attendanceByUri = new Map(),
  months = buildMonthWindow(12),
} = {}) {
  const monthSet = new Set(months);
  const seenMeetings = new Set();
  const counted = [];
  const skipped = [];

  const consider = (row, source, titleField) => {
    const id = String(row?.client_id || "").trim();
    const date = parseDate(row?.start_time);
    if (!id || !date) {
      skipped.push({ source, client_id: id || null, start_time: row?.start_time || null, reason: "missing_client_or_date" });
      return;
    }
    const status = attendanceByUri.get(String(row.calendly_event_uri || "")) || "unknown";
    if (status === "cancelled") {
      skipped.push({ source, client_id: id, start_time: date.toISOString(), reason: "cancelled" });
      return;
    }
    const key = meetingCompositeKey(id, date, row[titleField]);
    const month = monthKey(date);
    if (!monthSet.has(month)) {
      skipped.push({ source, client_id: id, start_time: date.toISOString(), reason: "outside_12_month_window", dedupeKey: key });
      return;
    }
    if (seenMeetings.has(key)) {
      skipped.push({ source, client_id: id, start_time: date.toISOString(), reason: "duplicate", dedupeKey: key });
      return;
    }
    seenMeetings.add(key);
    counted.push({ source, client_id: id, start_time: date.toISOString(), dedupeKey: key, month });
  };

  for (const row of clientMeetings) consider(row, "client_meetings", "event_name");
  for (const row of manualMeetings) {
    consider(
      { ...row, title: row.title || row.google_event_id },
      "manual_meetings",
      "title",
    );
  }

  return { counted, skipped, total: counted.length };
}
