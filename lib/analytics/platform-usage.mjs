import { getPharusSupabaseClient, pharusConfigurationError } from "../env.mjs";
import { loadPharusUserDirectoryFromCsv, mergeUserDirectories } from "./pharus-user-directory.mjs";
import { fetchPharusDemoIdentities, shouldExcludePharusUser } from "./pharus-demo-filter.mjs";

const ACCESS_EVENT_TOKENS = [
  "login_succeeded",
  "login_success",
  "app_open",
  "app_opened",
  "access_succeeded",
  "page_view",
  "screen_view",
];

const LOGIN_EVENT_TOKENS = ["login_succeeded", "login_success"];
const PHARUS_EVENTS_SELECT = [
  "id",
  "origin",
  "event_name",
  "created_at",
  "metadata",
].join(",");

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

function firstValue(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function normalizeEventName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s.-]+/g, "_");
}

function objectValue(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim().startsWith("{")) {
      try {
        return JSON.parse(value);
      } catch {
        // ignore malformed JSON properties
      }
    }
  }
  return {};
}

function eventClientId(row) {
  const metadata = objectValue(row, ["metadata", "properties", "event_properties", "payload", "data"]);
  return String(
    firstValue(row, ["client_id", "cliente_id", "user_id", "userId", "distinct_id", "profile_id", "person_id"]) ||
      firstValue(metadata, ["client_id", "cliente_id", "user_id", "userId", "distinct_id", "profile_id", "person_id"]) ||
      "",
  );
}

function eventDate(row) {
  return parseDate(firstValue(row, ["created_at", "timestamp", "event_time", "occurred_at", "inserted_at", "sent_at"]));
}

function dayKey(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function dayKeyToDate(key) {
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
}

function eventName(row) {
  return normalizeEventName(firstValue(row, ["event_name", "name", "event"]) || "");
}

function eventSessionId(row) {
  const props = objectValue(row, ["metadata", "properties", "event_properties", "payload", "data"]);
  return String(
    firstValue(row, ["session_id", "sessionId", "sid", "anonymous_id", "device_id"]) ||
      firstValue(props, ["session_id", "sessionId", "sid", "anonymous_id", "device_id"]) ||
      "",
  );
}

function isAccessEvent(name) {
  return ACCESS_EVENT_TOKENS.some((token) => name === token || name.includes(token));
}

function isLoginEvent(name) {
  return LOGIN_EVENT_TOKENS.includes(name);
}

async function fetchPharusEvents(warnings) {
  try {
    const client = getPharusSupabaseClient({ schema: "metrics" });
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 200_000; offset += pageSize) {
      const page = await client.rest("events", {
        select: PHARUS_EVENTS_SELECT,
        filters: { event_name: "in.(login_succeeded,login_success)", order: "id.asc" },
        limit: pageSize,
        offset,
      });
      if (!page.ok) {
        const err = new Error(`metrics.events: HTTP ${page.status}`);
        err.status = page.status;
        err.raw = (page.raw || "").slice(0, 240);
        throw err;
      }
      rows.push(...page.data);
      if (page.data.length < pageSize) break;
    }
    return rows;
  } catch (error) {
    warnings.push({
      code: "PHARUS_METRICS_AUTH",
      label: "App Pharus metrics.events sem permissão",
      severity: "warning",
      message: error?.status === 401
        ? "O schema metrics exige política de leitura para anon ou credencial backend adequada."
        : `Não foi possível consultar metrics.events: ${error instanceof Error ? error.message : String(error)}`,
    });
    return [];
  }
}

async function loadUserDirectory(warnings) {
  const csvDirectory = loadPharusUserDirectoryFromCsv();
  const liveDirectory = new Map();

  try {
    const client = getPharusSupabaseClient({ schema: "core" });
    const personalRows = await client.fetchAll("personal_info", "user_id,name,alternative_email,phone", {
      pageSize: 1000,
      maxRows: 200_000,
    });
    for (const row of personalRows) {
      const id = String(row?.user_id || "").trim();
      if (!id) continue;
      const cur = liveDirectory.get(id) || { id, name: null, email: null, sources: [] };
      liveDirectory.set(id, {
        ...cur,
        name: String(row?.name || "").trim() || cur.name,
        email: String(row?.alternative_email || "").trim() || cur.email,
        sources: cur.sources.includes("core.personal_info") ? cur.sources : [...cur.sources, "core.personal_info"],
      });
    }
  } catch (error) {
    warnings.push({
      code: "PHARUS_PERSONAL_INFO",
      label: "App Pharus core.personal_info indisponível",
      severity: "warning",
      message: `Não foi possível consultar core.personal_info: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  try {
    const client = getPharusSupabaseClient({ schema: "core" });
    const preRows = await client.fetchAll("pre_registrations", "user_id,email,name", {
      pageSize: 1000,
      maxRows: 200_000,
    });
    for (const row of preRows) {
      const id = String(row?.user_id || "").trim();
      if (!id) continue;
      const cur = liveDirectory.get(id) || { id, name: null, email: null, sources: [] };
      liveDirectory.set(id, {
        ...cur,
        email: String(row?.email || "").trim() || cur.email,
        name: String(row?.name || "").trim() || cur.name,
        sources: cur.sources.includes("core.pre_registrations") ? cur.sources : [...cur.sources, "core.pre_registrations"],
      });
    }
  } catch (error) {
    warnings.push({
      code: "PHARUS_PRE_REGISTRATIONS",
      label: "App Pharus core.pre_registrations indisponível",
      severity: "warning",
      message: `Não foi possível consultar core.pre_registrations: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return mergeUserDirectories(csvDirectory.byId, liveDirectory);
}

function unavailablePayload({ warnings = [], probe = null, message = "Fonte ainda não disponível para leitura." } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    status: "unavailable",
    available: false,
    message,
    summary: null,
    clients: [],
    indicators: [],
    sources: {
      databases: [],
      warnings,
      probe,
      limitations: [
        "metrics.events exige política SELECT para anon ou tabela exposta.",
        "auth.users não é consultado (somente anon key).",
        "Exclusão @quartavia.com.br / demo só quando e-mail está em core.personal_info ou core.pre_registrations.",
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
      userName: seed.userName || "Não informado",
      email: seed.email || "Não informado",
      joinedAt: seed.joinedAt || null,
      lastLoginFromUser: seed.lastLoginFromUser || null,
      logins: [],
      accesses: [],
    });
  }
  return byUser.get(id);
}

function buildClientUsage(pharusEvents, userDirectory = new Map()) {
  const byUser = new Map();
  for (const event of pharusEvents) {
    const id = eventClientId(event);
    const date = eventDate(event);
    const name = eventName(event);
    if (!id) continue;
    const profile = userDirectory.get(id) || {};
    const item = ensureClient(byUser, id, {
      source: "App Pharus",
      userName: profile.name || id,
      email: profile.email || "",
    });
    if (profile.name && (!item.userName || item.userName === id)) item.userName = profile.name;
    if (profile.email && (!item.email || item.email === "Não informado")) item.email = profile.email;
    if (!date || !isAccessEvent(name)) continue;
    item.accesses.push({ timestamp: date.toISOString(), eventName: name, sessionId: eventSessionId(event) });
    if (isLoginEvent(name)) item.logins.push({ timestamp: date.toISOString(), sessionId: eventSessionId(event) });
  }

  const now = new Date();
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
    const loginCount = accessDates.length;
    const successfulLoginCount = loginDates.length;
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
      joinedAt: client.joinedAt,
      realizedLogin: Boolean(accessDates.length),
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

function indicator(indicator, value, total, metric, viability = "Sim") {
  return {
    indicator,
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
  const pharusEvents = await fetchPharusEvents(warnings);
  const userDirectory = await loadUserDirectory(warnings);
  await fetchPharusDemoIdentities(warnings);

  const excludedByDirectory = { corporate: 0, demo: 0, unknownEmail: 0 };
  const eligibleEvents = pharusEvents.filter((event) => {
    const userId = eventClientId(event);
    if (!userId) return true;
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

  const accessEventCount = eligibleEvents.filter((event) => isAccessEvent(eventName(event))).length;
  const loginEventCount = eligibleEvents.filter((event) => isLoginEvent(eventName(event))).length;
  const clients = buildClientUsage(eligibleEvents, userDirectory);
  const total = clients.length;
  const withLogin = clients.filter((c) => c.realizedLogin).length;
  const totalLogins = clients.reduce((sum, c) => sum + c.totalLogins, 0);
  const daysSinceLastAccessValues = clients.map((c) => c.daysSinceLastAccess).filter((v) => v != null);
  const daysSinceLastAccessFiltered = withoutOutliers(daysSinceLastAccessValues);
  const intervals = clients.map((c) => c.averageDaysBetweenAccesses).filter((v) => v != null);
  const intervalsFiltered = withoutOutliers(intervals);
  const emailCoverageNote = userDirectory.size
    ? `${clients.filter((c) => c.email && c.email !== "Sem e-mail").length} usuários com e-mail no diretório core.`
    : "Diretório de usuários indisponível; exclusão corporativa/demo não aplicada.";

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
    appPharusAccessEvents: accessEventCount,
    appPharusLoginEvents: loginEventCount,
    excludedCorporateUsers: excludedByDirectory.corporate,
    excludedDemoUsers: excludedByDirectory.demo,
    usersWithoutEmailInDirectory: excludedByDirectory.unknownEmail,
  };

  const metricsUnavailable = warnings.some((w) => w.code === "PHARUS_METRICS_AUTH");
  const status = metricsUnavailable && !eligibleEvents.length ? "partial" : "available";

  return {
    generatedAt: new Date().toISOString(),
    status,
    available: true,
    message: metricsUnavailable
      ? "metrics.events indisponível — indicadores de login podem estar incompletos."
      : null,
    summary,
    sources: {
      databases: [
        {
          source: "App Pharus",
          schema: "metrics",
          eventTable: "events",
          eventNameField: "event_name",
          userCount: total,
          eventCount: eligibleEvents.length,
          accessEventCount,
          loginEventCount,
          directoryUsers: userDirectory.size,
          namedUsers: clients.filter((client) => client.userName && client.userName !== client.userId).length,
          emailedUsers: clients.filter((client) => client.email && client.email !== "Sem e-mail").length,
          excludedCorporateUsers: excludedByDirectory.corporate,
          excludedDemoUsers: excludedByDirectory.demo,
          authMode: "anon",
          note: `Eventos em metrics.events via PHARUS_SUPABASE_ANON_KEY. ${emailCoverageNote}`,
        },
      ],
      warnings,
      limitations: [
        ...(metricsUnavailable ? ["metrics.events bloqueado para anon — mesma limitação observada no caminho V1."] : []),
        ...(excludedByDirectory.unknownEmail
          ? ["Exclusão @quartavia.com.br não aplicada a usuários sem e-mail no diretório core."]
          : []),
      ],
    },
    indicators: [
      indicator("Realizou login? (Sim/Não)", withLogin, total, "Cliente/usuário com pelo menos um evento de acesso/login em App Pharus metrics.events.event_name.", "Sim"),
      indicator("Número total de logins", clients.filter((c) => c.totalLogins > 0).length, total, "Contagem de eventos de login/acesso por usuário em App Pharus metrics.events.event_name.", "Sim"),
      indicator("Média de logins por mês", clients.filter((c) => c.loginsPerMonth != null).length, total, "Total de logins/acessos dividido pelos meses entre o primeiro acesso e a data atual.", "Sim"),
      indicator("Dias desde o último acesso", daysSinceLastAccessFiltered.length, total, "Mediana por usuário de hoje menos último dia distinto com login de sucesso; datas negativas e outliers removidos.", "Sim"),
      indicator("Tempo médio entre acessos", intervalsFiltered.length, total, "Mediana por usuário entre penúltimo e último dia distinto com login de sucesso; datas negativas e outliers removidos.", "Sim"),
      indicator("Tempo médio de sessão", 0, total, "Sem Dados.", "Sem dados"),
      indicator("Frequência semanal de acesso", clients.filter((c) => c.weeklyAccessFrequency != null).length, total, "Total de acessos dividido pelas semanas desde o primeiro acesso.", "Sim"),
      indicator("Frequência mensal de acesso", clients.filter((c) => c.monthlyAccessFrequency != null).length, total, "Total de acessos dividido pelos meses desde o primeiro acesso.", "Sim"),
    ],
    clients,
  };
}

export function toPublicPlatformUsagePayload(payload) {
  return {
    generatedAt: payload?.generatedAt || null,
    status: payload?.status || (payload?.available === false ? "unavailable" : "available"),
    available: payload?.available !== false,
    message: payload?.message || null,
    summary: payload?.summary || {},
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
