/**
 * Fallback de primeira reunião via backup Airtable (Business Data / bkp_airtable).
 * GET/somente leitura. Colunas descobertas em runtime (select=*).
 */

const CLIENTS_TABLE = "bkp_clientes_id";
const MEETINGS_TABLE = "bkp_reunioes";
const PAGE_SIZE = 1000;
const MAX_ROWS = 200000;

const COMPLETED_STATUS_TOKENS = [
  "realizada",
  "realizado",
  "concluida",
  "concluido",
  "completed",
  "complete",
  "compareceu",
  "presente",
  "done",
  "finalizada",
  "finalizado",
];

const CANCELLED_STATUS_TOKENS = [
  "cancelada",
  "cancelado",
  "canceled",
  "cancelled",
];

const NO_SHOW_STATUS_TOKENS = ["no show", "noshow", "faltou", "nao compareceu", "ausente"];

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

function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeStatusToken(value) {
  return foldText(value).replace(/[_-]+/g, " ");
}

function pickCol(cols, patterns, { exclude = [] } = {}) {
  const list = (cols || []).filter((c) => !exclude.some((re) => re.test(c)));
  for (const pattern of patterns) {
    const hit = list.find((c) => pattern.test(c));
    if (hit) return hit;
  }
  return null;
}

function resolveBusinessDataEnv() {
  const url = (process.env.BUSINESS_DATA_SUPABASE_URL || process.env.AUTH_SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const anonKey = (
    process.env.BUSINESS_DATA_SUPABASE_SERVICE_ROLE_KEY
    || process.env.BUSINESS_DATA_SUPABASE_ANON_KEY
    || process.env.AUTH_SUPABASE_ANON_KEY
    || ""
  ).trim();
  return { url, anonKey };
}

function resolveSchemaCandidates() {
  const configured = (
    process.env.AIRTABLE_BKP_SCHEMA
    || process.env.BUSINESS_DATA_SUPABASE_SCHEMA
    || "bkp_airtable"
  ).trim();
  const candidates = [configured || "bkp_airtable"];
  if (configured !== "bkp_airtable") candidates.push("bkp_airtable");
  return [...new Set(candidates.filter(Boolean))];
}

function parsePgRestError(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed?.code || parsed?.message || null;
  } catch {
    return null;
  }
}

function isSchemaOrTableUnavailable(status, raw) {
  const code = parsePgRestError(raw);
  return status === 404 || status === 406 || code === "PGRST106" || code === "PGRST205";
}

async function fetchPage({ url, anonKey, schema, table, offset }) {
  const endpoint = new URL(`/rest/v1/${table}`, url);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("order", "id.asc");
  const response = await fetch(endpoint, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: "application/json",
      "Accept-Profile": schema,
      "Content-Profile": schema,
      Range: `${offset}-${offset + PAGE_SIZE - 1}`,
    },
  });
  const text = await response.text();
  let data = [];
  try {
    data = text ? JSON.parse(text) : [];
  } catch {
    data = [];
  }
  if (!Array.isArray(data)) data = data == null ? [] : [data];
  return { ok: response.ok, status: response.status, data, raw: text };
}

async function fetchAllTable({ url, anonKey, schema, table }) {
  const rows = [];
  let offset = 0;
  while (offset < MAX_ROWS) {
    const page = await fetchPage({ url, anonKey, schema, table, offset });
    if (!page.ok) {
      return { ok: false, status: page.status, rows, error: page.raw?.slice(0, 320) || `HTTP ${page.status}` };
    }
    rows.push(...page.data);
    if (page.data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { ok: true, status: 200, rows, error: null };
}

function resolveClientColumns(cols) {
  return {
    backupId: pickCol(cols, [/^id$/i, /^record_id$/i, /^airtable_id$/i, /^rec_id$/i]),
    cpf: pickCol(cols, [/cpf/i]),
    email: pickCol(cols, [/email/i, /e_mail/i]),
    phone: pickCol(cols, [/telefone/i, /^phone/i, /celular/i, /whatsapp/i, /fone/i]),
    name: pickCol(cols, [/^nome$/i, /^name$/i, /cliente_nome/i, /nome_cliente/i]),
  };
}

function resolveMeetingColumns(cols) {
  return {
    clientRef: pickCol(cols, [/cliente_id/i, /client_id/i, /id_cliente/i, /bkp_cliente/i], {
      exclude: [/nome/i, /name/i, /email/i, /cpf/i],
    }),
    scheduledDate: pickCol(cols, [
      /data_agend/i,
      /data_reuniao/i,
      /scheduled/i,
      /start_time/i,
      /data_hora/i,
      /^data$/i,
      /meeting_date/i,
      /inicio/i,
    ]),
    status: pickCol(cols, [/status/i, /situacao/i, /situação/i, /state/i]),
  };
}

function normalizeCpf(value) {
  const digits = String(blankToNull(value) || "").replace(/\D/g, "");
  if (digits.length !== 11) return null;
  return digits;
}

function normalizeEmail(value) {
  const email = String(blankToNull(value) || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
}

function phoneVariants(value) {
  const digits = String(blankToNull(value) || "").replace(/\D/g, "");
  if (digits.length < 10) return [];
  const variants = new Set([digits]);
  if (digits.startsWith("55") && digits.length >= 12) variants.add(digits.slice(2));
  else if (digits.length >= 10) variants.add(`55${digits}`);
  return [...variants];
}

function normalizeName(value) {
  const folded = foldText(value).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return folded || null;
}

function classifyMeetingStatus(rawStatus) {
  const token = normalizeStatusToken(rawStatus);
  if (!token) return "unknown";
  if (CANCELLED_STATUS_TOKENS.some((t) => token.includes(t))) return "cancelled";
  if (NO_SHOW_STATUS_TOKENS.some((t) => token.includes(t))) return "no_show";
  if (COMPLETED_STATUS_TOKENS.some((t) => token.includes(t))) return "completed";
  if (token.includes("agendad") || token.includes("confirmad") || token.includes("scheduled")) {
    return "scheduled";
  }
  if (token.includes("remarcad") || token.includes("reschedul")) return "rescheduled";
  return "unknown";
}

function buildStatusMap(statusValues) {
  const map = new Map();
  for (const raw of statusValues) {
    map.set(raw, classifyMeetingStatus(raw));
  }
  return map;
}

function pushToKeyMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function buildClientsByKey(clientRows, columns) {
  const clientsByKey = {
    cpf: new Map(),
    email: new Map(),
    phone: new Map(),
    name: new Map(),
  };
  const warnings = [];
  let missingKeys = 0;

  for (const row of clientRows) {
    const backupId = blankToNull(row[columns.backupId]);
    if (!backupId) {
      missingKeys += 1;
      continue;
    }
    const record = {
      backupId: String(backupId),
      cpf: columns.cpf ? normalizeCpf(row[columns.cpf]) : null,
      email: columns.email ? normalizeEmail(row[columns.email]) : null,
      phone: columns.phone ? phoneVariants(row[columns.phone]) : [],
      name: columns.name ? normalizeName(row[columns.name]) : null,
      raw: row,
    };

    if (record.cpf) pushToKeyMap(clientsByKey.cpf, record.cpf, record);
    if (record.email) pushToKeyMap(clientsByKey.email, record.email, record);
    for (const variant of record.phone) pushToKeyMap(clientsByKey.phone, variant, record);
    if (record.name) pushToKeyMap(clientsByKey.name, record.name, record);
  }

  if (missingKeys) warnings.push(`${missingKeys} registros em ${CLIENTS_TABLE} sem identificador de backup.`);

  for (const [keyType, map] of Object.entries(clientsByKey)) {
    let dupes = 0;
    for (const [, list] of map) {
      const uniqueIds = new Set(list.map((r) => r.backupId));
      if (uniqueIds.size > 1) dupes += 1;
    }
    if (dupes) warnings.push(`${dupes} chaves ${keyType} duplicadas em ${CLIENTS_TABLE}.`);
  }

  return { clientsByKey, warnings };
}

function buildMeetingsByBackupId(meetingRows, meetingColumns, statusMap) {
  const meetingsByBackupId = new Map();
  const warnings = [];
  let missingClient = 0;
  let missingDate = 0;
  let unknownStatus = 0;

  for (const row of meetingRows) {
    const clientRef = blankToNull(row[meetingColumns.clientRef]);
    if (!clientRef) {
      missingClient += 1;
      continue;
    }
    const scheduledRaw = meetingColumns.scheduledDate ? row[meetingColumns.scheduledDate] : null;
    const scheduledDate = parseDate(scheduledRaw);
    if (!scheduledDate) {
      missingDate += 1;
      continue;
    }
    const rawStatus = meetingColumns.status ? row[meetingColumns.status] : null;
    const statusClass = classifyMeetingStatus(rawStatus);
    if (statusClass === "unknown" && blankToNull(rawStatus)) unknownStatus += 1;

    const backupId = String(clientRef);
    if (!meetingsByBackupId.has(backupId)) meetingsByBackupId.set(backupId, []);
    meetingsByBackupId.get(backupId).push({
      scheduledDate,
      scheduledIso: scheduledDate.toISOString(),
      rawStatus: blankToNull(rawStatus),
      statusClass,
    });
  }

  if (missingClient) warnings.push(`${missingClient} reuniões em ${MEETINGS_TABLE} sem referência de cliente.`);
  if (missingDate) warnings.push(`${missingDate} reuniões em ${MEETINGS_TABLE} sem data agendada válida.`);
  if (unknownStatus) warnings.push(`${unknownStatus} reuniões em ${MEETINGS_TABLE} com status não mapeado.`);

  return { meetingsByBackupId, statusMap, warnings };
}

function pickEarliestCompletedMeeting(meetings) {
  const completed = (meetings || []).filter((m) => m.statusClass === "completed");
  if (!completed.length) return null;
  completed.sort((a, b) => a.scheduledDate - b.scheduledDate);
  return completed[0];
}

function matchCandidatesForKey(clientsByKey, keyType, normalizedValue) {
  if (!normalizedValue) return [];
  const list = clientsByKey[keyType]?.get(normalizedValue) || [];
  const byId = new Map();
  for (const item of list) byId.set(item.backupId, item);
  return [...byId.values()];
}

const MATCH_CONFIDENCE = {
  cpf: 0.95,
  email: 0.85,
  phone: 0.75,
  name: 0.5,
};

/**
 * @returns {Promise<{
 *   available: boolean,
 *   reason: string|null,
 *   clientsByKey: object|null,
 *   meetingsByBackupId: Map|null,
 *   statusValues: string[],
 *   warnings: string[],
 *   meta: object,
 * }>}
 */
export async function loadAirtableFirstMeetingIndex(options = {}) {
  const warnings = [];
  const { url, anonKey } = resolveBusinessDataEnv();
  if (!url || !anonKey) {
    return {
      available: false,
      reason: "Configure BUSINESS_DATA_SUPABASE_URL/AUTH_SUPABASE_URL e AUTH_SUPABASE_ANON_KEY.",
      clientsByKey: null,
      meetingsByBackupId: null,
      statusValues: [],
      warnings,
      meta: { schema: null, clientsTable: CLIENTS_TABLE, meetingsTable: MEETINGS_TABLE },
    };
  }

  const schemaCandidates = options.schemas || resolveSchemaCandidates();
  let lastError = "Schema/tabelas Airtable indisponíveis.";
  let usedSchema = null;
  let clientRows = [];
  let meetingRows = [];

  for (const schema of schemaCandidates) {
    const clientsFetch = await fetchAllTable({ url, anonKey, schema, table: CLIENTS_TABLE });
    if (!clientsFetch.ok) {
      lastError = isSchemaOrTableUnavailable(clientsFetch.status, clientsFetch.error)
        ? `Schema ${schema} ou tabela ${CLIENTS_TABLE} indisponível (HTTP ${clientsFetch.status}).`
        : `Falha ao ler ${schema}.${CLIENTS_TABLE}: HTTP ${clientsFetch.status}.`;
      continue;
    }
    const meetingsFetch = await fetchAllTable({ url, anonKey, schema, table: MEETINGS_TABLE });
    if (!meetingsFetch.ok) {
      lastError = isSchemaOrTableUnavailable(meetingsFetch.status, meetingsFetch.error)
        ? `Schema ${schema} ou tabela ${MEETINGS_TABLE} indisponível (HTTP ${meetingsFetch.status}).`
        : `Falha ao ler ${schema}.${MEETINGS_TABLE}: HTTP ${meetingsFetch.status}.`;
      continue;
    }
    usedSchema = schema;
    clientRows = clientsFetch.rows;
    meetingRows = meetingsFetch.rows;
    break;
  }

  if (!usedSchema) {
    return {
      available: false,
      reason: lastError,
      clientsByKey: null,
      meetingsByBackupId: null,
      statusValues: [],
      warnings,
      meta: {
        schema: null,
        schemasTried: schemaCandidates,
        clientsTable: CLIENTS_TABLE,
        meetingsTable: MEETINGS_TABLE,
      },
    };
  }

  const clientCols = clientRows[0] ? Object.keys(clientRows[0]) : [];
  const meetingCols = meetingRows[0] ? Object.keys(meetingRows[0]) : [];
  const clientColumns = resolveClientColumns(clientCols);
  const meetingColumns = resolveMeetingColumns(meetingCols);

  if (!clientColumns.backupId) {
    return {
      available: false,
      reason: `Coluna identificadora não encontrada em ${usedSchema}.${CLIENTS_TABLE}.`,
      clientsByKey: null,
      meetingsByBackupId: null,
      statusValues: [],
      warnings,
      meta: { schema: usedSchema, clientCols, meetingCols, clientColumns, meetingColumns },
    };
  }
  if (!meetingColumns.clientRef || !meetingColumns.scheduledDate) {
    return {
      available: false,
      reason: `Colunas de vínculo/data não encontradas em ${usedSchema}.${MEETINGS_TABLE}.`,
      clientsByKey: null,
      meetingsByBackupId: null,
      statusValues: [],
      warnings,
      meta: { schema: usedSchema, clientCols, meetingCols, clientColumns, meetingColumns },
    };
  }

  const statusValues = [
    ...new Set(
      meetingRows
        .map((row) => blankToNull(meetingColumns.status ? row[meetingColumns.status] : null))
        .filter(Boolean),
    ),
  ].sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
  const statusMap = buildStatusMap(statusValues);

  const { clientsByKey, warnings: clientWarnings } = buildClientsByKey(clientRows, clientColumns);
  const { meetingsByBackupId, warnings: meetingWarnings } = buildMeetingsByBackupId(
    meetingRows,
    meetingColumns,
    statusMap,
  );
  warnings.push(...clientWarnings, ...meetingWarnings);

  return {
    available: true,
    reason: null,
    clientsByKey,
    meetingsByBackupId,
    statusValues,
    statusMap,
    warnings,
    meta: {
      schema: usedSchema,
      schemasTried: schemaCandidates,
      clientsTable: CLIENTS_TABLE,
      meetingsTable: MEETINGS_TABLE,
      clientCols,
      meetingCols,
      clientColumns,
      meetingColumns,
      clientCount: clientRows.length,
      meetingCount: meetingRows.length,
      completedStatuses: statusValues.filter((s) => statusMap.get(s) === "completed"),
    },
  };
}

function resolveMatch(client, airtableIndex) {
  const { clientsByKey } = airtableIndex;
  const attempts = [
    {
      key: "cpf",
      value: normalizeCpf(client.cpf_digits ?? client.cpf),
    },
    {
      key: "email",
      value: normalizeEmail(client.email),
    },
    {
      key: "phone",
      value: phoneVariants(client.phone_digits ?? client.phone ?? client.telefone)[0] || null,
      lookupVariants: phoneVariants(client.phone_digits ?? client.phone ?? client.telefone),
    },
    {
      key: "name",
      value: normalizeName(client.name),
    },
  ];

  for (const attempt of attempts) {
    let candidates = [];
    if (attempt.key === "phone") {
      const seen = new Set();
      for (const variant of attempt.lookupVariants || []) {
        for (const c of matchCandidatesForKey(clientsByKey, "phone", variant)) {
          if (!seen.has(c.backupId)) {
            seen.add(c.backupId);
            candidates.push(c);
          }
        }
      }
    } else {
      candidates = matchCandidatesForKey(clientsByKey, attempt.key, attempt.value);
    }

    if (!attempt.value && attempt.key !== "phone") {
      continue;
    }
    if (attempt.key === "phone" && !(attempt.lookupVariants || []).length) {
      continue;
    }

    if (candidates.length === 1) {
      return {
        matchKey: attempt.key,
        matchStatus: "matched",
        confidence: MATCH_CONFIDENCE[attempt.key],
        normalizedValue: attempt.value,
        backupClient: candidates[0],
        matchCandidates: candidates.map((c) => ({ backupId: c.backupId, matchKey: attempt.key })),
      };
    }
    if (candidates.length > 1) {
      return {
        matchKey: attempt.key,
        matchStatus: "ambiguous",
        confidence: 0,
        normalizedValue: attempt.value,
        backupClient: null,
        matchCandidates: candidates.map((c) => ({ backupId: c.backupId, matchKey: attempt.key })),
      };
    }
  }

  const hasAnyKey = attempts.some((a) => {
    if (a.key === "phone") return (a.lookupVariants || []).length > 0;
    return Boolean(a.value);
  });

  return {
    matchKey: null,
    matchStatus: hasAnyKey ? "not_found" : "no_match_keys",
    confidence: 0,
    normalizedValue: null,
    backupClient: null,
    matchCandidates: [],
  };
}

/**
 * @param {{
 *   client: object,
 *   primaryFirstMeetingDate: string|Date|null,
 *   primarySourceLabel?: string,
 *   airtableIndex: object,
 * }} params
 */
export function resolveFirstMeetingWithFallback({
  client,
  primaryFirstMeetingDate,
  primarySourceLabel = "base_qv",
  airtableIndex,
}) {
  const primaryDate = parseDate(primaryFirstMeetingDate);
  const base = {
    firstMeetingDate: primaryDate ? primaryDate.toISOString() : null,
    firstMeetingSource: primaryDate ? primarySourceLabel : "unavailable",
    firstMeetingMatchKey: null,
    firstMeetingMatchStatus: primaryDate ? "skipped_primary" : "not_applied",
    firstMeetingConfidence: primaryDate ? 1 : 0,
    matchCandidates: [],
  };

  if (primaryDate) return base;

  if (!airtableIndex?.available) {
    return {
      ...base,
      firstMeetingMatchStatus: "index_unavailable",
    };
  }

  const match = resolveMatch(client, airtableIndex);
  base.firstMeetingMatchKey = match.matchKey;
  base.firstMeetingMatchStatus = match.matchStatus;
  base.firstMeetingConfidence = match.confidence;
  base.matchCandidates = match.matchCandidates;

  if (match.matchStatus !== "matched" || !match.backupClient) {
    return base;
  }

  const meetings = airtableIndex.meetingsByBackupId?.get(match.backupClient.backupId) || [];
  const earliest = pickEarliestCompletedMeeting(meetings);
  if (!earliest) {
    return {
      ...base,
      firstMeetingMatchStatus: "matched_no_completed_meeting",
    };
  }

  return {
    firstMeetingDate: earliest.scheduledIso,
    firstMeetingSource: "airtable",
    firstMeetingMatchKey: match.matchKey,
    firstMeetingMatchStatus: "matched",
    firstMeetingConfidence: match.confidence,
    matchCandidates: match.matchCandidates,
  };
}

/**
 * @param {Array<object>} resolutions
 */
export function aggregateFirstMeetingFallbackCoverage(resolutions) {
  const totals = {
    clients: resolutions.length,
    primary: 0,
    airtable: 0,
    unavailable: 0,
    matched: 0,
    ambiguous: 0,
    notFound: 0,
    noMatchKeys: 0,
    matchedNoMeeting: 0,
    indexUnavailable: 0,
    byMatchKey: { cpf: 0, email: 0, phone: 0, name: 0 },
  };

  for (const row of resolutions) {
    if (row.firstMeetingSource === "base_qv" || row.firstMeetingMatchStatus === "skipped_primary") {
      totals.primary += 1;
    } else if (row.firstMeetingSource === "airtable") {
      totals.airtable += 1;
      totals.matched += 1;
      if (row.firstMeetingMatchKey && totals.byMatchKey[row.firstMeetingMatchKey] != null) {
        totals.byMatchKey[row.firstMeetingMatchKey] += 1;
      }
    } else {
      totals.unavailable += 1;
    }

    if (row.firstMeetingMatchStatus === "ambiguous") totals.ambiguous += 1;
    if (row.firstMeetingMatchStatus === "not_found") totals.notFound += 1;
    if (row.firstMeetingMatchStatus === "no_match_keys") totals.noMatchKeys += 1;
    if (row.firstMeetingMatchStatus === "matched_no_completed_meeting") totals.matchedNoMeeting += 1;
    if (row.firstMeetingMatchStatus === "index_unavailable") totals.indexUnavailable += 1;
  }

  const withDateBefore = totals.primary;
  const withDateAfter = totals.primary + totals.airtable;
  const coverageBefore = totals.clients ? Math.round((withDateBefore / totals.clients) * 1000) / 10 : 0;
  const coverageAfter = totals.clients ? Math.round((withDateAfter / totals.clients) * 1000) / 10 : 0;

  return {
    ...totals,
    coverageBeforeFallback: coverageBefore,
    coverageAfterFallback: coverageAfter,
    coverageGain: Math.round((coverageAfter - coverageBefore) * 10) / 10,
  };
}

/**
 * Aplica fallback em linhas de clientes já consolidadas (ex.: meetings.mjs).
 * @returns {{ resolutions: object[], warnings: string[] }}
 */
export function applyFirstMeetingFallbackToClientRows(clientRows, rawClients, airtableIndex) {
  const rawById = new Map((rawClients || []).map((c) => [String(c.id), c]));
  const resolutions = [];

  for (const row of clientRows) {
    const raw = rawById.get(String(row.clientId)) || {};
    const resolution = resolveFirstMeetingWithFallback({
      client: {
        id: row.clientId,
        name: raw.name ?? row.clientName,
        cpf: raw.cpf,
        cpf_digits: raw.cpf_digits,
        email: raw.email,
        phone: raw.phone,
        phone_digits: raw.phone_digits,
        telefone: raw.telefone,
      },
      primaryFirstMeetingDate: row.firstMeetingDate,
      primarySourceLabel: "base_qv",
      airtableIndex,
    });
    resolutions.push(resolution);

    row.firstMeetingSource = resolution.firstMeetingSource;
    row.firstMeetingMatchKey = resolution.firstMeetingMatchKey;
    row.firstMeetingMatchStatus = resolution.firstMeetingMatchStatus;
    row.firstMeetingConfidence = resolution.firstMeetingConfidence;
    row.matchCandidates = resolution.matchCandidates;

    if (resolution.firstMeetingSource === "airtable" && resolution.firstMeetingDate) {
      row.firstMeetingDate = resolution.firstMeetingDate;
      row.firstMeetingCompleted = true;
      row.firstMeetingStatus = "airtable_fallback";
    }
  }

  const warnings = [...(airtableIndex?.warnings || [])];
  const coverage = aggregateFirstMeetingFallbackCoverage(resolutions);
  if (coverage.ambiguous) warnings.push(`${coverage.ambiguous} matches ambíguos no backup Airtable (nome/chave duplicada).`);
  if (coverage.matchedNoMeeting) {
    warnings.push(`${coverage.matchedNoMeeting} clientes encontrados no backup sem reunião realizada válida.`);
  }
  if (coverage.noMatchKeys) warnings.push(`${coverage.noMatchKeys} clientes sem CPF/e-mail/telefone/nome para match.`);

  return { resolutions, warnings, coverage };
}
