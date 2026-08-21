/**
 * Endpoint independente: catálogo e sugestões de mecanismos no App Pharus.
 * Fonte: PHARUS_SUPABASE_* (projeto qvtqufdivpbmubooawdm) — core.mechanisms / core.user_mechanisms.
 * Não mistura com BASE QV. Status `suggested` NÃO é implementação.
 */
import { dataConfigurationError } from "../env.mjs";
import {
  getPharusEnv,
  getPharusSupabaseClient,
  pharusConfigurationError,
} from "../env.mjs";
import {
  loadPharusUserDirectoryFromCsv,
  mergeUserDirectories,
} from "./pharus-user-directory.mjs";
import { fetchPharusDemoIdentities, filterPharusDemoRows, isPharusDemoEmail } from "./pharus-demo-filter.mjs";

const PHARUS_PROJECT_ID = "qvtqufdivpbmubooawdm";
const MECHANISM_SELECT = "id,data,created_at,updated_at";
const USER_MECH_SELECT = "id,user_id,mechanism_id,status,notes,created_at";

const USED_FIELDS = [
  { table: "user_mechanisms", column: "id", role: "suggestionId" },
  { table: "user_mechanisms", column: "user_id", role: "pharusUserId" },
  { table: "user_mechanisms", column: "mechanism_id", role: "mechanismId" },
  { table: "user_mechanisms", column: "status", role: "suggestionStatus" },
  { table: "user_mechanisms", column: "created_at", role: "suggestedAt" },
  { table: "mechanisms", column: "id", role: "catalogId" },
  { table: "mechanisms", column: "data", role: "mechanismJson" },
  { table: "mechanisms", column: "created_at", role: "catalogCreated" },
  { table: "mechanisms", column: "updated_at", role: "catalogUpdated" },
];

const IMPLEMENTATION_STATUS_TOKENS = new Set([
  "implemented",
  "completed",
  "concluded",
  "implementado",
  "concluido",
  "concluida",
]);

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

function foldToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeDisplayLabel(value, fallback = "Não informado") {
  const raw = blankToNull(value);
  if (raw == null) return fallback;
  const s = String(raw).trim().replace(/\s+/g, " ");
  if (!s) return fallback;
  return s;
}

function normalizeRiskLabel(value) {
  const raw = blankToNull(value);
  if (raw == null) return "Não informado";
  return String(raw).trim().replace(/\s+/g, " ");
}

function monthKey(date) {
  if (!date) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function isImplementationStatus(status) {
  return IMPLEMENTATION_STATUS_TOKENS.has(foldToken(status));
}

/** Normaliza mechanisms.data (objeto, string JSON ou inválido). */
export function normalizeMechanismData(raw, warnings, mechanismId) {
  if (raw == null) {
    warnings.push({
      code: "mechanism_data_missing",
      message: "mechanisms.data ausente",
      mechanismId: mechanismId || null,
    });
    return null;
  }
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      warnings.push({
        code: "mechanism_data_invalid_json",
        message: "mechanisms.data com JSON inválido",
        mechanismId: mechanismId || null,
      });
      return null;
    }
  }
  if (typeof obj !== "object" || Array.isArray(obj)) {
    warnings.push({
      code: "mechanism_data_invalid_shape",
      message: "mechanisms.data não é um objeto",
      mechanismId: mechanismId || null,
    });
    return null;
  }
  const pick = (...keys) => {
    for (const key of keys) {
      const v = blankToNull(obj[key]);
      if (v != null) return v;
    }
    return null;
  };
  const name = pick("name", "title", "label");
  if (!name) {
    warnings.push({
      code: "mechanism_name_missing",
      message: "mecanismo sem nome",
      mechanismId: mechanismId || null,
    });
  }
  return {
    name: name || mechanismId || "Não informado",
    risk: pick("risk", "risco"),
    engine: pick("engine", "motor"),
    market: pick("market", "mercado"),
    horizon: pick("horizon", "horizonte"),
    adminFee: pick("adminFee", "admin_fee", "taxaAdmin"),
    category: pick("category", "categoria"),
    strategy: pick("strategy", "estrategia"),
    description: pick("description", "descricao"),
    capitalization: pick("capitalization", "capitalizacao"),
    estimatedReturn: pick("estimatedReturn", "estimated_return", "retornoEstimado"),
    strategicWindows: obj.strategicWindows ?? obj.strategic_windows ?? null,
    secondaryCategory: pick("secondaryCategory", "secondary_category", "categoriaSecundaria"),
    raw: obj,
  };
}

function distributionFromCounter(counter, total) {
  return [...counter.entries()]
    .map(([label, count]) => ({
      label,
      count,
      percent: total ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label), "pt-BR"));
}

function bump(map, key) {
  const label = key || "Não informado";
  map.set(label, (map.get(label) || 0) + 1);
}

function aggregateWarnings(rawWarnings) {
  const map = new Map();
  for (const w of rawWarnings || []) {
    if (!w) continue;
    const code = String(w.code || "warning").trim();
    const message = String(w.message || w.label || code).trim();
    const norm = foldToken(message);
    const key = `${code}|${norm}`;
    const cur = map.get(key) || { code, message, count: 0 };
    cur.count += Number(w.count) > 0 ? Number(w.count) : 1;
    map.set(key, cur);
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message, "pt-BR"))
    .slice(0, 40);
}

async function probeSchema(preferredSchema) {
  // Preferir core; não consultar public primeiro (gera 404 ruidoso).
  const candidates = [...new Set([
    preferredSchema === "public" ? null : preferredSchema,
    "core",
  ].filter(Boolean))];
  const warnings = [];
  for (const schema of candidates) {
    try {
      const client = getPharusSupabaseClient({ schema });
      const mech = await client.rest("mechanisms", { select: "id", limit: 1, countExact: true });
      const um = await client.rest("user_mechanisms", { select: "id", limit: 1, countExact: true });
      if (mech.ok && um.ok) {
        return { schema, client, warnings };
      }
      warnings.push({
        code: "schema_probe_denied",
        message: `Schema ${schema}: mechanisms HTTP ${mech.status}, user_mechanisms HTTP ${um.status}`,
      });
    } catch (err) {
      warnings.push({
        code: "schema_probe_error",
        message: `Schema ${schema}: ${err.message || "falha"}`,
      });
    }
  }
  return { schema: null, client: null, warnings };
}

function emptyPayload({ status, warnings, message, code, missing }) {
  const env = getPharusEnv();
  const urlConfigured = Boolean(env.url);
  const keyConfigured = Boolean(env.anonKey);
  const qualityWarnings = aggregateWarnings(warnings || []);
  return {
    generatedAt: new Date().toISOString(),
    success: false,
    available: false,
    code: code || (status === "failed" ? "pharus_unavailable" : null),
    missing: Array.isArray(missing) ? missing : [],
    config: {
      pharusUrlConfigured: urlConfigured,
      pharusKeyConfigured: keyConfigured,
    },
    source: {
      project: "App Pharus",
      projectId: env.projectId || PHARUS_PROJECT_ID,
      status: status || "failed",
      schema: env.schema || null,
      message: message || "Não foi possível consultar o App Pharus",
    },
    metadata: {
      source: "App Pharus",
      catalogTable: "core.mechanisms",
      relationTable: "core.user_mechanisms",
      projectId: env.projectId || PHARUS_PROJECT_ID,
    },
    summary: {
      catalogMechanisms: 0,
      engines: 0,
      categories: 0,
      suggestions: 0,
      totalSuggestions: 0,
      usersWithSuggestion: 0,
      usersWithSuggestions: 0,
      suggestedMechanismTypes: 0,
      distinctSuggestedTypes: 0,
      topSuggestedMechanism: null,
      recentSuggestions30d: 0,
      orphanMechanismIds: 0,
      duplicateSuggestionPairs: 0,
      invalidJsonRecords: 0,
      onlySuggestedStatus: null,
    },
    catalogByEngine: [],
    catalogByCategory: [],
    catalogByRisk: [],
    suggestionsByMechanism: [],
    statusDistribution: [],
    mechanismsPerUser: [],
    catalogRows: [],
    rows: [],
    distributions: {
      byMechanism: [],
      byStatus: [],
      byMarket: [],
      byCategory: [],
      byRisk: [],
      byMonth: [],
      mechanismsPerUser: [],
      catalogByEngine: [],
      catalogByCategory: [],
      catalogByRisk: [],
    },
    suggestions: [],
    catalog: [],
    qualityWarnings,
    quality: {
      fields: USED_FIELDS,
      fieldCoverage: [],
      limitations: [
        "user_mechanisms não possui implemented_at nesta fonte.",
        "Status suggested não é implementação.",
        "Não cruzar user_id do App Pharus com client_id da BASE QV sem chave confiável.",
        "Tempo de implementação no App Pharus indisponível: não há data/status de conclusão confiável.",
      ],
      implementationTiming: {
        status: "unavailable",
        reason:
          "Todos os vínculos auditados usam status suggested; não há implemented_at nem transição de status para conclusão.",
      },
      joinKeyAudit: {
        status: "pending",
        note: "Cruzamento App Pharus ↔ BASE QV ainda não confirmado (não usar nome).",
      },
    },
    warnings: qualityWarnings,
    usedFields: USED_FIELDS,
  };
}

export async function computePharusMechanismsPayload() {
  const configError = pharusConfigurationError();
  if (configError) {
    const env = getPharusEnv();
    const missing = [];
    if (!env.url) missing.push("PHARUS_SUPABASE_URL");
    if (!env.anonKey) missing.push("PHARUS_SUPABASE_ANON_KEY");
    return emptyPayload({
      status: "failed",
      code: "pharus_env_missing",
      missing,
      message: "Não foi possível consultar o App Pharus",
      warnings: [{ code: "pharus_env_missing", message: configError, missing }],
    });
  }

  const preferred = getPharusEnv().schema;
  const probe = await probeSchema(preferred);
  if (!probe.client) {
    const rlsHint = {
      code: "rls_or_schema",
      message:
        "Leitura bloqueada ou tabelas não encontradas. Verifique política SELECT para anon no schema core (mechanisms, user_mechanisms) — RLS não foi alterada por este portal.",
    };
    return emptyPayload({
      status: "failed",
      message: "Não foi possível consultar o App Pharus",
      warnings: [...probe.warnings, rlsHint],
    });
  }

  const rawWarnings = [...probe.warnings];
  const schema = probe.schema;
  const client = probe.client;

  let mechanismsRows = [];
  let userMechRows = [];
  try {
    mechanismsRows = await client.fetchAll("mechanisms", MECHANISM_SELECT);
    userMechRows = await client.fetchAll("user_mechanisms", USER_MECH_SELECT);
  } catch (err) {
    const status = err.status || 0;
    rawWarnings.push({
      code: status === 401 || status === 403 ? "rls_denied" : "fetch_failed",
      message:
        status === 401 || status === 403
          ? "Acesso negado pelo App Pharus (anon key / RLS). Verifique política SELECT para anon — sem desativar RLS."
          : (err.message || "Falha ao ler tabelas do App Pharus"),
    });
    return emptyPayload({
      status: "failed",
      message: "Não foi possível consultar o App Pharus",
      warnings: rawWarnings,
    });
  }

  if (!mechanismsRows.length && !userMechRows.length) {
    rawWarnings.push({
      code: "pharus_empty_visible",
      message:
        "App Pharus respondeu HTTP 200, mas anon não enxerga linhas em core.mechanisms/core.user_mechanisms. Verifique políticas RLS — não reportar zero como carteira vazia.",
    });
    return emptyPayload({
      status: "failed",
      code: "pharus_empty_read",
      message: "Fonte App Pharus indisponível para leitura.",
      warnings: rawWarnings,
    });
  }

  // Diretório de usuários: CSV auxiliares (se existirem) + core.personal_info + core.pre_registrations.
  // core.accounts NÃO é diretório de usuários (contas financeiras / Open Finance).
  const csvDirectory = loadPharusUserDirectoryFromCsv();
  const liveDirectory = new Map();

  try {
    const personalRows = await client.fetchAll(
      "personal_info",
      "user_id,name,alternative_email",
    );
    for (const row of personalRows) {
      const id = blankToNull(row.user_id);
      if (!id) continue;
      const key = String(id);
      const cur = liveDirectory.get(key) || { id: key, name: null, email: null, sources: [] };
      liveDirectory.set(key, {
        ...cur,
        name: blankToNull(row.name) || cur.name,
        email: blankToNull(row.alternative_email) || cur.email,
        sources: cur.sources.includes("core.personal_info")
          ? cur.sources
          : [...cur.sources, "core.personal_info"],
      });
    }
  } catch (err) {
    rawWarnings.push({
      code: "personal_info_unavailable",
      message: `core.personal_info indisponível (${err.message || "erro"}).`,
    });
  }

  try {
    const preRows = await client.fetchAll("pre_registrations", "user_id,email,name");
    for (const row of preRows) {
      const id = blankToNull(row.user_id);
      if (!id) continue;
      const key = String(id);
      const cur = liveDirectory.get(key) || { id: key, name: null, email: null, sources: [] };
      liveDirectory.set(key, {
        ...cur,
        email: blankToNull(row.email) || cur.email,
        name: blankToNull(row.name) || cur.name,
        sources: cur.sources.includes("core.pre_registrations")
          ? cur.sources
          : [...cur.sources, "core.pre_registrations"],
      });
    }
  } catch (err) {
    rawWarnings.push({
      code: "pre_registrations_unavailable",
      message: `core.pre_registrations indisponível (${err.message || "erro"}).`,
    });
  }

  // CSV primeiro, live depois → live preenche/sobrescreve campos ausentes no merge.
  const accountsById = mergeUserDirectories(csvDirectory.byId, liveDirectory);
  const demoIdentities = await fetchPharusDemoIdentities(rawWarnings);
  for (const [userId, account] of accountsById.entries()) {
    if (isPharusDemoEmail(account?.email)) demoIdentities.userIds.add(String(userId));
  }
  userMechRows = filterPharusDemoRows(userMechRows, demoIdentities);
  if (!csvDirectory.metadata.preRegistrationsCsv.available) {
    rawWarnings.push({
      code: "csv_pre_registrations_missing",
      message: "pre_registrations_rows.csv ausente na raiz; usando core.pre_registrations.",
    });
  }
  if (!csvDirectory.metadata.personalInfoCsv.available) {
    rawWarnings.push({
      code: "csv_personal_info_missing",
      message: "personal_info_rows.csv ausente na raiz; usando core.personal_info.",
    });
  }
  if (!accountsById.size) {
    rawWarnings.push({
      code: "user_directory_empty",
      message: "Diretório de usuários vazio; detalhamento usará fallback de nome/e-mail.",
    });
  }

  let invalidJsonRecords = 0;
  const catalogById = new Map();
  const catalogRows = [];
  const engineCounter = new Map();
  const categoryCounter = new Map();
  const riskCounter = new Map();
  const enginesSet = new Set();
  const categoriesSet = new Set();

  for (const row of mechanismsRows) {
    const id = blankToNull(row.id);
    if (!id) continue;
    const dataWarnings = [];
    const mechanism = normalizeMechanismData(row.data, dataWarnings, id);
    for (const w of dataWarnings) {
      if (w.code === "mechanism_data_invalid_json" || w.code === "mechanism_data_invalid_shape") {
        invalidJsonRecords += 1;
      }
      rawWarnings.push(w);
    }
    const engine = normalizeDisplayLabel(mechanism?.engine);
    const category = normalizeDisplayLabel(mechanism?.category);
    const risk = normalizeRiskLabel(mechanism?.risk);
    const market = normalizeDisplayLabel(mechanism?.market);
    let emptyCategory = 0;
    let emptyRisk = 0;
    let emptyMarket = 0;
    if (!mechanism?.category) emptyCategory = 1;
    if (!mechanism?.risk) emptyRisk = 1;
    if (!mechanism?.market) emptyMarket = 1;
    // counters accumulated below
    if (emptyCategory) {
      rawWarnings.push({ code: "category_empty", message: "categoria vazia no catálogo", count: 1 });
    }
    if (emptyRisk) {
      rawWarnings.push({ code: "risk_empty", message: "risco vazio no catálogo", count: 1 });
    }
    if (emptyMarket) {
      rawWarnings.push({ code: "market_empty", message: "mercado vazio no catálogo", count: 1 });
    }
    if (engine !== "Não informado") enginesSet.add(engine);
    if (category !== "Não informado") categoriesSet.add(category);
    bump(engineCounter, engine);
    bump(categoryCounter, category);
    bump(riskCounter, risk);

    const item = {
      id: String(id),
      name: mechanism?.name || String(id),
      engine,
      category,
      secondaryCategory: normalizeDisplayLabel(mechanism?.secondaryCategory),
      market,
      risk,
      horizon: normalizeDisplayLabel(mechanism?.horizon),
      estimatedReturn: mechanism?.estimatedReturn != null ? String(mechanism.estimatedReturn) : "Não informado",
      capitalization: mechanism?.capitalization != null ? String(mechanism.capitalization) : null,
      adminFee: mechanism?.adminFee != null ? String(mechanism.adminFee) : null,
      description: mechanism?.description || null,
      strategy: mechanism?.strategy || null,
      strategicWindows: mechanism?.strategicWindows ?? null,
      createdAt: parseDate(row.created_at)?.toISOString() || null,
      updatedAt: parseDate(row.updated_at)?.toISOString() || null,
      suggestionUsers: 0,
      suggestionRows: 0,
      suggestionStatuses: {},
      source: "app_pharus",
    };
    catalogById.set(String(id), item);
    catalogRows.push(item);
  }

  const catalogTotal = catalogRows.length;
  const catalogByEngine = distributionFromCounter(engineCounter, catalogTotal);
  const catalogByCategory = distributionFromCounter(categoryCounter, catalogTotal);
  const catalogByRisk = distributionFromCounter(riskCounter, catalogTotal);

  const userIds = new Set();
  const statusCounter = new Map();
  const monthCounter = new Map();
  const suggestionPairKeys = new Set();
  let orphanMechanismIds = 0;
  let missingUserId = 0;
  let missingStatus = 0;
  let duplicateSuggestionPairs = 0;
  let recentSuggestions30d = 0;
  let unknownStatusCount = 0;
  const now = Date.now();
  const day30 = 30 * 86400000;

  // Dedup map: user_id|mechanism_id → best row
  const dedupedSuggestions = new Map();
  const suggestionsSample = [];

  for (const row of userMechRows) {
    const id = blankToNull(row.id);
    const userId = blankToNull(row.user_id);
    const mechanismId = blankToNull(row.mechanism_id);
    const status = blankToNull(row.status);
    const createdAt = parseDate(row.created_at);
    const updatedAt = parseDate(row.updated_at);

    if (!userId) {
      missingUserId += 1;
      rawWarnings.push({ code: "user_id_missing", message: "user_id vazio" });
    }
    if (!status) {
      missingStatus += 1;
      rawWarnings.push({ code: "status_missing", message: "status vazio" });
    } else if (foldToken(status) !== "suggested" && !isImplementationStatus(status)) {
      unknownStatusCount += 1;
      rawWarnings.push({
        code: "status_unknown",
        message: `status desconhecido: ${status}`,
      });
    }

    const catalogItem = mechanismId ? catalogById.get(String(mechanismId)) : null;
    if (mechanismId && !catalogItem) {
      orphanMechanismIds += 1;
      rawWarnings.push({
        code: "mechanism_orphan",
        message: "vínculo para mechanism_id inexistente",
        mechanismId: String(mechanismId),
      });
    }

    bump(statusCounter, status ? String(status) : "Não informado");
    const mk = monthKey(createdAt);
    if (mk) bump(monthCounter, mk);
    if (createdAt && now - createdAt.getTime() <= day30) recentSuggestions30d += 1;

    if (userId) userIds.add(String(userId));

    const pairKey = `${userId || ""}|${mechanismId || ""}`;
    if (userId && mechanismId) {
      if (suggestionPairKeys.has(pairKey)) {
        duplicateSuggestionPairs += 1;
        rawWarnings.push({
          code: "suggestion_duplicate",
          message: "vínculo duplicado user_id + mechanism_id",
        });
      } else {
        suggestionPairKeys.add(pairKey);
      }
      const prev = dedupedSuggestions.get(pairKey);
      const candidate = {
        id: id != null ? String(id) : null,
        userId: String(userId),
        mechanismId: String(mechanismId),
        status: status != null ? String(status) : null,
        notes: blankToNull(row.notes),
        createdAt: createdAt?.toISOString() || null,
        updatedAt: updatedAt?.toISOString() || null,
        mechanismName: catalogItem?.name || String(mechanismId),
        isSuggested: foldToken(status) === "suggested",
        isImplementation: isImplementationStatus(status),
      };
      if (!prev || (createdAt && (!prev._ts || createdAt > prev._ts))) {
        dedupedSuggestions.set(pairKey, { ...candidate, _ts: createdAt || null });
      }
    }

    if (suggestionsSample.length < 200) {
      suggestionsSample.push({
        id: id != null ? String(id) : null,
        userId: userId != null ? String(userId) : null,
        mechanismId: mechanismId != null ? String(mechanismId) : null,
        status: status != null ? String(status) : null,
        notes: blankToNull(row.notes),
        createdAt: createdAt?.toISOString() || null,
        mechanism: catalogItem
          ? {
            name: catalogItem.name,
            risk: catalogItem.risk,
            market: catalogItem.market,
            category: catalogItem.category,
            engine: catalogItem.engine,
          }
          : null,
        source: "app_pharus",
      });
    }
  }

  const suggestedRowCount = userMechRows.filter((r) => foldToken(r.status) === "suggested").length;
  const mechUserSets = new Map();
  const mechSuggestionCounts = new Map();
  let suggestedDeduped = 0;
  for (const item of dedupedSuggestions.values()) {
    if (!item.isSuggested) continue;
    suggestedDeduped += 1;
    const mid = item.mechanismId;
    if (!mechUserSets.has(mid)) mechUserSets.set(mid, new Set());
    mechUserSets.get(mid).add(item.userId);
    mechSuggestionCounts.set(mid, (mechSuggestionCounts.get(mid) || 0) + 1);
    const cat = catalogById.get(mid);
    if (cat) {
      cat.suggestionUsers = mechUserSets.get(mid).size;
      cat.suggestionRows = (cat.suggestionRows || 0) + 1;
      const st = item.status || "Não informado";
      cat.suggestionStatuses[st] = (cat.suggestionStatuses[st] || 0) + 1;
    }
  }

  const usersWithSuggestion = new Set(
    [...dedupedSuggestions.values()].filter((s) => s.isSuggested).map((s) => s.userId),
  ).size;
  const suggestedMechanismTypes = mechUserSets.size;
  const usersDenom = usersWithSuggestion || 1;

  const mechCountByUser = new Map();
  for (const item of dedupedSuggestions.values()) {
    if (!item.isSuggested || !item.userId) continue;
    mechCountByUser.set(item.userId, (mechCountByUser.get(item.userId) || 0) + 1);
  }
  const MECH_PER_USER_BANDS = [
    { label: "1 mecanismo", test: (n) => n === 1 },
    { label: "2 mecanismos", test: (n) => n === 2 },
    { label: "3 a 4 mecanismos", test: (n) => n >= 3 && n <= 4 },
    { label: "5 ou mais mecanismos", test: (n) => n >= 5 },
  ];
  const bandCounts = Object.fromEntries(MECH_PER_USER_BANDS.map((b) => [b.label, 0]));
  for (const n of mechCountByUser.values()) {
    const band = MECH_PER_USER_BANDS.find((b) => b.test(n));
    if (band) bandCounts[band.label] += 1;
  }
  const mechanismsPerUserUniverse = mechCountByUser.size || 0;
  const mechanismsPerUser = MECH_PER_USER_BANDS.map((b) => {
    const count = bandCounts[b.label] || 0;
    return {
      label: b.label,
      count,
      percent: mechanismsPerUserUniverse
        ? Math.round((count / mechanismsPerUserUniverse) * 1000) / 10
        : 0,
    };
  });

  let identifiedUsers = 0;
  let usersWithEmail = 0;
  for (const userId of mechCountByUser.keys()) {
    const u = accountsById.get(String(userId));
    if (u?.name) identifiedUsers += 1;
    if (u?.email) usersWithEmail += 1;
  }

  const suggestionsByMechanism = [...mechUserSets.entries()]
    .map(([mechanismId, users]) => {
      const cat = catalogById.get(mechanismId);
      const usersCount = users.size;
      return {
        mechanismId,
        label: cat?.name || mechanismId,
        name: cat?.name || mechanismId,
        users: usersCount,
        count: usersCount,
        suggestions: mechSuggestionCounts.get(mechanismId) || usersCount,
        percent: Math.round((usersCount / usersDenom) * 1000) / 10,
        engine: cat?.engine || "Não informado",
        category: cat?.category || "Não informado",
      };
    })
    .sort((a, b) => b.users - a.users || a.label.localeCompare(b.label, "pt-BR"));

  const statusKeys = [...statusCounter.keys()].filter((k) => k && k !== "Não informado");
  const onlySuggestedStatus = statusKeys.length === 1 && foldToken(statusKeys[0]) === "suggested";
  const statusDistribution = distributionFromCounter(statusCounter, userMechRows.length);

  if (orphanMechanismIds) {
    rawWarnings.unshift({
      code: "orphan_mechanism_summary",
      message: `${orphanMechanismIds} vínculos com mechanism_id inexistente no catálogo`,
      count: orphanMechanismIds,
    });
  }
  if (duplicateSuggestionPairs) {
    rawWarnings.unshift({
      code: "suggestion_duplicate_summary",
      message: `${duplicateSuggestionPairs} vínculos duplicados user_id + mechanism_id`,
      count: duplicateSuggestionPairs,
    });
  }
  if (invalidJsonRecords) {
    rawWarnings.unshift({
      code: "invalid_json_summary",
      message: `${invalidJsonRecords} registros com JSON inválido em mechanisms.data`,
      count: invalidJsonRecords,
    });
  }
  if (unknownStatusCount) {
    rawWarnings.unshift({
      code: "unknown_status_summary",
      message: `${unknownStatusCount} vínculos com status desconhecido`,
      count: unknownStatusCount,
    });
  }
  rawWarnings.push({
    code: "suggested_counts_as_link",
    message:
      "Vínculos com status suggested são tratados como mecanismos associados ao usuário no App Pharus (não como implementação BASE QV).",
  });

  const qualityWarnings = aggregateWarnings(rawWarnings);
  const topSuggested = suggestionsByMechanism[0]
    ? {
      name: suggestionsByMechanism[0].label,
      count: suggestionsByMechanism[0].users,
      percent: suggestionsByMechanism[0].percent,
    }
    : null;

  const fieldCoverage = [
    { table: "user_mechanisms", column: "id", totalRows: userMechRows.length, filled: userMechRows.filter((r) => blankToNull(r.id) != null).length },
    { table: "user_mechanisms", column: "user_id", totalRows: userMechRows.length, filled: userMechRows.length - missingUserId },
    { table: "user_mechanisms", column: "mechanism_id", totalRows: userMechRows.length, filled: userMechRows.filter((r) => blankToNull(r.mechanism_id) != null).length },
    { table: "user_mechanisms", column: "status", totalRows: userMechRows.length, filled: userMechRows.length - missingStatus },
    { table: "mechanisms", column: "id", totalRows: mechanismsRows.length, filled: mechanismsRows.filter((r) => blankToNull(r.id) != null).length },
    { table: "mechanisms", column: "data", totalRows: mechanismsRows.length, filled: mechanismsRows.length - invalidJsonRecords },
  ].map((f) => ({
    ...f,
    schema,
    source: "App Pharus",
    percent: f.totalRows ? Math.round((f.filled / f.totalRows) * 1000) / 10 : 0,
  }));

  const statusConnected = qualityWarnings.some((w) =>
    ["orphan_mechanism_summary", "invalid_json_summary", "rls_denied", "fetch_failed"].includes(w.code)
  )
    ? "connected_with_warnings"
    : "connected";

  return {
    generatedAt: new Date().toISOString(),
    success: true,
    available: true,
    code: null,
    missing: [],
    config: {
      pharusUrlConfigured: true,
      pharusKeyConfigured: true,
    },
    source: {
      project: "App Pharus",
      projectId: client.projectId || PHARUS_PROJECT_ID,
      status: statusConnected,
      schema,
      message:
        statusConnected === "connected"
          ? "App Pharus conectado"
          : "App Pharus conectado com alertas",
    },
    metadata: {
      source: "App Pharus",
      catalogTable: `${schema || "core"}.mechanisms`,
      relationTable: `${schema || "core"}.user_mechanisms`,
      projectId: client.projectId || PHARUS_PROJECT_ID,
      onlySuggestedStatus,
      suggestionDedup: "user_id + mechanism_id",
      includedStatuses: ["suggested"],
      epAggregation: false,
      coverageUnavailable: true,
      coverageNote: "Cobertura % não exibida: denominador de usuários ativos da plataforma não definido.",
      userDirectory: accountsById.size
        ? "core.personal_info + core.pre_registrations (+ CSV auxiliar quando presente)"
        : null,
      userDirectoryCsv: csvDirectory.metadata,
      userDirectoryCoverage: {
        usersWithMechanisms: mechanismsPerUserUniverse,
        identifiedUsers,
        usersWithEmail,
        directorySize: accountsById.size,
      },
      implementationTiming: {
        status: "unavailable",
        reason:
          "Sem implemented_at e sem status de conclusão no App Pharus; created_at do vínculo suggested não representa implementação.",
      },
    },
    summary: {
      catalogMechanisms: catalogTotal,
      engines: enginesSet.size,
      categories: categoriesSet.size,
      linkedMechanisms: suggestedDeduped,
      suggestions: suggestedRowCount,
      totalSuggestions: suggestedRowCount,
      suggestionRowsRaw: userMechRows.length,
      suggestionsDeduped: suggestedDeduped,
      usersWithMechanisms: usersWithSuggestion,
      usersWithSuggestion,
      usersWithSuggestions: usersWithSuggestion,
      linkedMechanismTypes: suggestedMechanismTypes,
      suggestedMechanismTypes,
      distinctSuggestedTypes: suggestedMechanismTypes,
      topSuggestedMechanism: topSuggested,
      recentSuggestions30d,
      orphanMechanismIds,
      duplicateSuggestionPairs,
      invalidJsonRecords,
      onlySuggestedStatus,
      identifiedUsers,
      usersWithEmail,
    },
    catalogByEngine,
    catalogByCategory,
    catalogByRisk,
    suggestionsByMechanism,
    byMechanism: suggestionsByMechanism,
    statusDistribution,
    mechanismsPerUser,
    catalogRows: catalogRows
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    rows: [...dedupedSuggestions.values()]
      .filter((s) => s.isSuggested)
      .map((s) => {
        const cat = catalogById.get(s.mechanismId) || null;
        const user = accountsById.get(String(s.userId)) || null;
        return {
          userId: s.userId,
          userName: user?.name || "Usuário não identificado",
          userEmail: user?.email || null,
          userIdentitySource: user?.sources?.join("+") || null,
          userCreatedAt: user?.createdAt || null,
          mechanismId: s.mechanismId,
          mechanismName: s.mechanismName,
          engine: cat?.engine || "Não informado",
          category: cat?.category || "Não informado",
          secondaryCategory: cat?.secondaryCategory || "Não informado",
          market: cat?.market || "Não informado",
          risk: cat?.risk || "Não informado",
          horizon: cat?.horizon || "Não informado",
          estimatedReturn: cat?.estimatedReturn || "Não informado",
          description: cat?.description || null,
          strategy: cat?.strategy || null,
          status: s.status,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt || null,
          linkId: s.id,
          source: "app_pharus",
        };
      })
      .sort((a, b) =>
        String(a.mechanismName).localeCompare(String(b.mechanismName), "pt-BR")
        || String(a.userName).localeCompare(String(b.userName), "pt-BR")
      ),
    distributions: {
      byMechanism: suggestionsByMechanism.map((r) => ({
        label: r.label,
        count: r.users,
        percent: r.percent,
      })),
      byStatus: statusDistribution,
      byMarket: distributionFromCounter(
        catalogRows.reduce((m, r) => {
          bump(m, r.market);
          return m;
        }, new Map()),
        catalogTotal,
      ),
      byCategory: catalogByCategory,
      byRisk: catalogByRisk,
      mechanismsPerUser,
      byMonth: [...monthCounter.entries()]
        .map(([label, count]) => ({
          label,
          month: label,
          count,
          percent: userMechRows.length
            ? Math.round((count / userMechRows.length) * 1000) / 10
            : 0,
        }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label))),
      catalogByEngine,
      catalogByCategory,
      catalogByRisk,
    },
    suggestions: suggestionsSample,
    catalog: catalogRows.map((r) => ({
      id: r.id,
      name: r.name,
      risk: r.risk,
      market: r.market,
      category: r.category,
      engine: r.engine,
      horizon: r.horizon,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      source: "app_pharus",
    })),
    qualityWarnings,
    quality: {
      fields: USED_FIELDS,
      fieldCoverage,
      limitations: [
        "user_mechanisms não possui implemented_at nesta fonte.",
        "Não chamar suggested de implemented.",
        "Não usar created_at da sugestão como data de implementação.",
        "Não combinar totais App Pharus com BASE QV.",
        "Sem agregação por EP sem mapeamento user_id → cliente → EP.",
        "Tempo de implementação no App Pharus indisponível com os dados atuais.",
      ],
      implementationTiming: {
        status: "unavailable",
        reason: onlySuggestedStatus
          ? "Somente status suggested; sem data/status de conclusão no App Pharus."
          : "Sem implemented_at nem par início→conclusão defensável no App Pharus.",
      },
      joinKeyAudit: {
        status: "not_confirmed",
        note: "user_id do App Pharus ≠ client_id da BASE QV.",
      },
      userDirectory: {
        csv: csvDirectory.metadata,
        liveSources: ["core.personal_info", "core.pre_registrations"],
        directorySize: accountsById.size,
        identifiedUsers,
        usersWithEmail,
      },
    },
    warnings: qualityWarnings,
    usedFields: USED_FIELDS,
  };
}

export default async function handler(request) {
  const authError = await requireCorporateAuth(request);
  if (authError) return authError;

  try {
    const payload = await computePharusMechanismsPayload();
    return Response.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[pharus-mechanisms]", err?.message || err);
    return Response.json(
      emptyPayload({
        status: "failed",
        message: "Não foi possível consultar o App Pharus",
        warnings: [{ code: "unexpected", message: "Falha inesperada ao consolidar App Pharus" }],
      }),
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
