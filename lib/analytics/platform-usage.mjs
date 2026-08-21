import { getPharusSupabaseClient, pharusConfigurationError } from "../env.mjs";
import { loadPharusUserDirectoryFromCsv } from "./pharus-user-directory.mjs";
import { fetchPharusDemoIdentities, shouldExcludePharusUser } from "./pharus-demo-filter.mjs";

const PHARUS_LOGIN_EVENTS_SCHEMA = "analytics";
const PHARUS_LOGIN_EVENTS_TABLE = "platform_login_events";
const PHARUS_LOGIN_EVENTS_SELECT = "id,user_id,event_name,created_at";
const LOGIN_EVENT_TOKENS = ["login_succeeded", "login_success"];

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(start, end) {
  if (!start || !end) return null;
  return Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000);
}

function monthsBetween(start, end) {
  if (!start || !end) return 1;
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  return Math.max(1, months + 1);
}

function average(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round(((nums[mid - 1] + nums[mid]) / 2) * 100) / 100;
}

function quantile(values, q) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const position = (nums.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return nums[base + 1] !== undefined ? nums[base] + rest * (nums[base + 1] - nums[base]) : nums[base];
}

function withoutOutliers(values) {
  const nums = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (nums.length < 4) return nums;
  const q1 = quantile(nums, 0.25);
  const q3 = quantile(nums, 0.75);
  const iqr = q3 - q1;
  const min = Math.max(0, q1 - 1.5 * iqr);
  const max = q3 + 1.5 * iqr;
  return nums.filter((v) => v >= min && v <= max);
}

function pct(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function normalizeEventName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s.-]+/g, "_");
}

function eventUserId(row) {
  return String(row?.user_id || "").trim();
}

function eventDate(row, now = new Date()) {
  const date = parseDate(row?.created_at);
  if (!date) return null;
  if (date.getTime() > now.getTime() + 86_400_000) return null;
  return date;
}

function isLoginEventName(name) {
  return LOGIN_EVENT_TOKENS.includes(normalizeEventName(name));
}

function dayKey(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function dayKeyToDate(key) {
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

async function fetchPharusLoginEvents(warnings) {
  const started = Date.now();
  try {
    const client = getPharusSupabaseClient({ schema: PHARUS_LOGIN_EVENTS_SCHEMA });
    const rows = await client.fetchAll(PHARUS_LOGIN_EVENTS_TABLE, PHARUS_LOGIN_EVENTS_SELECT, {
      pageSize: 1000,
      maxRows: 500_000,
      filters: { order: "id.asc" },
    });
    return {
      rows,
      ms: Date.now() - started,
      requests: Math.ceil(rows.length / 1000) || (rows.length ? 1 : 0),
    };
  } catch (error) {
    const postgrestCode = error?.code || error?.postgrest?.code || null;
    const needsSchemaExposure = postgrestCode === "PGRST106"
      || /invalid schema:\s*analytics/i.test(String(error?.postgrest?.message || error?.message || ""));
    warnings.push({
      code: "PHARUS_LOGIN_EVENTS_AUTH",
      label: "App Pharus analytics.platform_login_events indisponível",
      severity: "warning",
      message: needsSchemaExposure
        ? "Schema analytics não exposto no PostgREST. App Pharus → Settings → API → Exposed schemas → incluir analytics."
        : error?.status === 401 || error?.status === 403
          ? "Fonte App Pharus indisponível para leitura (view analytics.platform_login_events)."
          : `Fonte App Pharus indisponível para leitura: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { rows: [], ms: Date.now() - started, requests: 0 };
  }
}

function loadUserDirectoryFromCsvOnly() {
  const csvDirectory = loadPharusUserDirectoryFromCsv();
  return csvDirectory.byId;
}

function unavailablePayload({ warnings = [], message = "Fonte ainda não disponível para leitura." } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    status: "unavailable",
    available: false,
    metricsSourceUnavailable: true,
    message,
    summary: null,
    clients: [],
    indicators: [],
    sources: {
      databases: [],
      warnings,
      limitations: [
        "Fonte oficial: analytics.platform_login_events (somente leitura anon).",
        "Exclusão @quartavia.com.br / demo depende de diretório ou CSV auxiliar.",
      ],
    },
  };
}

function ensureClient(byUser, id, seed = {}) {
  if (!id) return null;
  if (!byUser.has(id)) {
    byUser.set(id, {
      source: seed.source || "App Pharus",
      userId: id,
      userName: seed.userName || id,
      email: seed.email || "Sem e-mail",
      logins: [],
      accesses: [],
    });
  }
  return byUser.get(id);
}

function buildClientUsage(loginEvents, userDirectory = new Map(), now = new Date()) {
  const byUser = new Map();
  for (const event of loginEvents) {
    const id = eventUserId(event);
    const date = eventDate(event, now);
    const name = normalizeEventName(event?.event_name);
    if (!id || !date || !isLoginEventName(name)) continue;
    const profile = userDirectory.get(id) || {};
    const item = ensureClient(byUser, id, {
      source: "App Pharus",
      userName: profile.name || id,
      email: profile.email || "Sem e-mail",
    });
    if (profile.name && (!item.userName || item.userName === id)) item.userName = profile.name;
    if (profile.email && item.email === "Sem e-mail") item.email = profile.email;
    item.accesses.push({ timestamp: date.toISOString(), eventName: name });
    item.logins.push({ timestamp: date.toISOString() });
  }

  return [...byUser.values()].map((client) => {
    const accessDates = client.accesses
      .map((access) => parseDate(access.timestamp))
      .filter(Boolean)
      .sort((a, b) => a - b);
    const loginDates = client.logins
      .map((login) => parseDate(login.timestamp))
      .filter(Boolean)
      .sort((a, b) => a - b);
    const loginDays = [...new Set(loginDates.map(dayKey).filter(Boolean))].sort();
    const loginDayDates = loginDays.map(dayKeyToDate).filter(Boolean);
    const lastAccessDate = accessDates[accessDates.length - 1] || null;
    const firstAccessDate = accessDates[0] || null;
    const loginCount = loginDates.length;
    const lastSuccessfulLoginDay = loginDayDates[loginDayDates.length - 1] || null;
    const previousSuccessfulLoginDay = loginDayDates.length >= 2 ? loginDayDates[loginDayDates.length - 2] : null;
    const distinctLoginDayInterval = previousSuccessfulLoginDay && lastSuccessfulLoginDay
      ? daysBetween(previousSuccessfulLoginDay, lastSuccessfulLoginDay)
      : null;
    const monthSpan = monthsBetween(firstAccessDate, now);
    const weekSpan = Math.max(1, Math.ceil((daysBetween(firstAccessDate, now) || 1) / 7));
    const monthlyBuckets = new Set(accessDates.map((d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`));
    const weeklyBuckets = new Set(accessDates.map((d) => {
      const start = Date.UTC(d.getUTCFullYear(), 0, 1);
      return `${d.getUTCFullYear()}-${Math.ceil(((d.getTime() - start) / 86400000 + 1) / 7)}`;
    }));
    return {
      source: client.source,
      userId: client.userId,
      userName: client.userName || client.userId,
      email: client.email || "Sem e-mail",
      realizedLogin: loginCount > 0,
      totalLogins: loginCount,
      loginsPerMonth: Math.round((loginCount / monthSpan) * 100) / 100,
      daysSinceLastAccess: daysBetween(lastSuccessfulLoginDay, now),
      averageDaysBetweenAccesses: distinctLoginDayInterval,
      typicalDaysBetweenAccesses: distinctLoginDayInterval,
      averageSessionMinutes: null,
      weeklyAccessFrequency: Math.round((accessDates.length / weekSpan) * 100) / 100,
      monthlyAccessFrequency: Math.round((accessDates.length / monthSpan) * 100) / 100,
      activeWeeks: weeklyBuckets.size,
      activeMonths: monthlyBuckets.size,
      firstAccessAt: firstAccessDate ? firstAccessDate.toISOString() : null,
      lastAccessAt: lastAccessDate ? lastAccessDate.toISOString() : null,
      lastSuccessfulLoginDay: lastSuccessfulLoginDay ? lastSuccessfulLoginDay.toISOString() : null,
      previousSuccessfulLoginDay: previousSuccessfulLoginDay ? previousSuccessfulLoginDay.toISOString() : null,
    };
  });
}

function indicator(indicatorName, value, total, metric, viability = "Sim") {
  return {
    indicator: indicatorName,
    viability,
    value,
    total,
    coverage: pct(value, total),
    metric,
  };
}

export async function computePlatformUsagePayload() {
  const configError = pharusConfigurationError();
  if (configError) {
    return unavailablePayload({ warnings: [{ code: "pharus_config", message: configError }], message: configError });
  }

  const warnings = [];
  const now = new Date();
  const fetchResult = await fetchPharusLoginEvents(warnings);
  const rawEvents = fetchResult.rows || [];
  const userDirectory = loadUserDirectoryFromCsvOnly();
  await fetchPharusDemoIdentities(warnings);

  const excludedByDirectory = { corporate: 0, demo: 0, unknownEmail: 0 };
  const eligibleEvents = rawEvents.filter((event) => {
    if (!isLoginEventName(event?.event_name)) return false;
    const userId = eventUserId(event);
    if (!userId || !eventDate(event, now)) return false;
    const profile = userDirectory.get(userId);
    const decision = shouldExcludePharusUser(userId, profile);
    if (decision.exclude) {
      if (decision.reason === "corporate_email") excludedByDirectory.corporate += 1;
      if (decision.reason === "demo_email") excludedByDirectory.demo += 1;
      return false;
    }
    if (!profile?.email) excludedByDirectory.unknownEmail += 1;
    return true;
  });

  const sourceUnavailable = warnings.some((w) => w.code === "PHARUS_LOGIN_EVENTS_AUTH") || !eligibleEvents.length;
  if (sourceUnavailable) {
    return {
      generatedAt: now.toISOString(),
      status: "partial",
      available: true,
      metricsSourceUnavailable: true,
      message: "Fonte de uso ainda indisponível.",
      summary: {
        totalUsers: null,
        usersWithLogin: null,
        loginCoverage: null,
        totalLogins: null,
        typicalDaysSinceLastAccess: null,
        eventsLoaded: rawEvents.length || null,
        usersLabel: "Usuários com registro de acesso",
      },
      clients: [],
      indicators: [],
      sources: {
        databases: [],
        warnings,
        limitations: [
          "Fonte oficial: analytics.platform_login_events.",
          ...(rawEvents.length ? [] : ["Nenhum evento elegível após validação de user_id/created_at."]),
        ],
        timing: { fetchMs: fetchResult.ms, restRequests: fetchResult.requests },
      },
    };
  }

  const clients = buildClientUsage(eligibleEvents, userDirectory, now);
  const total = clients.length;
  const withLogin = clients.filter((c) => c.realizedLogin).length;
  const totalLogins = eligibleEvents.length;
  const daysSinceLastAccessValues = clients.map((c) => c.daysSinceLastAccess).filter((v) => v != null);
  const daysSinceLastAccessFiltered = withoutOutliers(daysSinceLastAccessValues);
  const intervals = clients.map((c) => c.averageDaysBetweenAccesses).filter((v) => v != null);
  const intervalsFiltered = withoutOutliers(intervals);

  const summary = {
    totalUsers: total,
    usersWithLogin: withLogin,
    loginCoverage: pct(withLogin, total),
    totalLogins,
    averageLoginsPerMonth: average(clients.map((c) => c.loginsPerMonth)),
    averageDaysSinceLastAccess: average(daysSinceLastAccessFiltered),
    typicalDaysSinceLastAccess: median(daysSinceLastAccessFiltered),
    daysSinceLastAccessSample: daysSinceLastAccessFiltered.length,
    daysSinceLastAccessOutliersRemoved: daysSinceLastAccessValues.length - daysSinceLastAccessFiltered.length,
    averageDaysBetweenAccesses: median(intervalsFiltered),
    typicalDaysBetweenAccesses: median(intervalsFiltered),
    daysBetweenAccessesSample: intervalsFiltered.length,
    daysBetweenAccessesOutliersRemoved: intervals.length - intervalsFiltered.length,
    averageSessionMinutes: null,
    averageWeeklyFrequency: average(clients.map((c) => c.weeklyAccessFrequency)),
    averageMonthlyFrequency: average(clients.map((c) => c.monthlyAccessFrequency)),
    appPharusEvents: eligibleEvents.length,
    appPharusLoginEvents: eligibleEvents.length,
    eventsLoaded: rawEvents.length,
    usersLabel: "Usuários com registro de acesso",
    excludedCorporateUsers: excludedByDirectory.corporate,
    excludedDemoUsers: excludedByDirectory.demo,
    usersWithoutEmailInDirectory: excludedByDirectory.unknownEmail,
  };

  return {
    generatedAt: now.toISOString(),
    status: "connected",
    available: true,
    metricsSourceUnavailable: false,
    message: null,
    summary,
    sources: {
      databases: [
        {
          source: "App Pharus",
          schema: PHARUS_LOGIN_EVENTS_SCHEMA,
          eventTable: PHARUS_LOGIN_EVENTS_TABLE,
          eventNameField: "event_name",
          userIdField: "user_id",
          userCount: total,
          eventCount: eligibleEvents.length,
          eventsLoaded: rawEvents.length,
          loginEventCount: eligibleEvents.length,
          directoryUsers: userDirectory.size,
          namedUsers: clients.filter((client) => client.userName && client.userName !== client.userId).length,
          emailedUsers: clients.filter((client) => client.email && client.email !== "Sem e-mail").length,
          excludedCorporateUsers: excludedByDirectory.corporate,
          excludedDemoUsers: excludedByDirectory.demo,
          authMode: "anon",
          note: "Eventos de login em analytics.platform_login_events via PHARUS_SUPABASE_ANON_KEY.",
        },
      ],
      warnings,
      limitations: excludedByDirectory.unknownEmail
        ? ["Exclusão @quartavia.com.br / demo limitada sem core.personal_info — usa CSV auxiliar quando presente."]
        : [],
      timing: {
        fetchMs: fetchResult.ms,
        restRequests: fetchResult.requests,
      },
    },
    indicators: [
      indicator("Realizou login? (Sim/Não)", withLogin, total, "Usuário com evento login_succeeded/login_success em analytics.platform_login_events.", "Sim"),
      indicator("Número total de logins", clients.filter((c) => c.totalLogins > 0).length, total, "Contagem de eventos de login por usuário em analytics.platform_login_events.", "Sim"),
      indicator("Média de logins por mês", clients.filter((c) => c.loginsPerMonth != null).length, total, "Total de logins dividido pelos meses entre o primeiro login e hoje.", "Sim"),
      indicator("Dias desde o último acesso", daysSinceLastAccessFiltered.length, total, "Mediana por usuário de hoje menos último dia com login; outliers removidos.", "Sim"),
      indicator("Tempo médio entre acessos", intervalsFiltered.length, total, "Mediana por usuário entre penúltimo e último dia com login; outliers removidos.", "Sim"),
      indicator("Tempo médio de sessão", 0, total, "Sem Dados.", "Sem dados"),
      indicator("Frequência semanal de acesso", clients.filter((c) => c.weeklyAccessFrequency != null).length, total, "Total de logins dividido pelas semanas desde o primeiro login.", "Sim"),
      indicator("Frequência mensal de acesso", clients.filter((c) => c.monthlyAccessFrequency != null).length, total, "Total de logins dividido pelos meses desde o primeiro login.", "Sim"),
    ],
    clients,
  };
}

export function toPublicPlatformUsagePayload(payload) {
  return {
    generatedAt: payload?.generatedAt || null,
    status: payload?.status || (payload?.available === false ? "unavailable" : "available"),
    available: payload?.available !== false,
    metricsSourceUnavailable: Boolean(payload?.metricsSourceUnavailable),
    message: payload?.message || null,
    summary: payload?.summary ?? {},
    sources: payload?.sources || {},
    indicators: payload?.indicators || [],
    clients: (payload?.clients || []).map((row) => ({
      userId: row.userId,
      userName: row.userName,
      email: row.email,
      realizedLogin: row.realizedLogin,
      totalLogins: row.totalLogins,
      loginsPerMonth: row.loginsPerMonth,
      daysSinceLastAccess: row.daysSinceLastAccess,
      averageDaysBetweenAccesses: row.averageDaysBetweenAccesses,
      weeklyAccessFrequency: row.weeklyAccessFrequency,
      monthlyAccessFrequency: row.monthlyAccessFrequency,
      lastAccessAt: row.lastAccessAt,
      firstAccessAt: row.firstAccessAt,
    })),
  };
}
