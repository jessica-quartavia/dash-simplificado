/**
 * Fonte exclusiva do gráfico "Reuniões por tipo".
 * Business Data · "Agendamentos".calendly_eventos
 * (REST se o schema estiver exposto; senão ponte n8n Postgres — mesmo padrão do Atendimento.)
 */
import { normalizeMeetingEventType, buildMeetingTypeDistributions } from "./meeting-event-type.mjs";

const PAGE_SIZE = 1000;
const MAX_ROWS = 500000;
const SELECT_COLS =
  "event_uuid,event_type_name,event_name,event_status,start_time,group_name,canceled";
const SOURCE_LABEL = "Business Data · Agendamentos.calendly_eventos";

function blankToNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

function normalizeGroup(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function isCommercialGroup(groupName) {
  return normalizeGroup(groupName).includes("comercial");
}

function resolveMeetingType(eventTypeName, eventName) {
  return (
    blankToNull(typeof eventTypeName === "string" ? eventTypeName.trim() : eventTypeName)
    || blankToNull(typeof eventName === "string" ? eventName.trim() : eventName)
    || "Não informado"
  );
}

function isCanceledRow(row) {
  if (row?.canceled === true || row?.canceled === "true" || row?.canceled === "t") return true;
  const status = normalizeGroup(row?.event_status || row?.eventStatus || "");
  return status.includes("cancel");
}

function getBusinessDataEnv() {
  const url = (
    process.env.BUSINESS_DATA_SUPABASE_URL
    || process.env.BUSINESS_SUPABASE_URL
    || process.env.AUTH_SUPABASE_URL
    || ""
  ).trim().replace(/\/$/, "");
  const anonKey = (
    process.env.BUSINESS_DATA_SUPABASE_SERVICE_ROLE_KEY
    || process.env.BUSINESS_DATA_SUPABASE_ANON_KEY
    || process.env.AUTH_SUPABASE_ANON_KEY
    || ""
  ).trim();
  const schema = (
    process.env.CALENDLY_EVENTOS_SCHEMA
    || "Agendamentos"
  ).trim() || "Agendamentos";
  return { url, anonKey, schema };
}

function unavailable(message, extra = {}) {
  return {
    available: false,
    byFamily: [],
    byRaw: [],
    events: [],
    original: [],
    consolidated: [],
    totalEvents: 0,
    excludedCommercial: 0,
    missingGroup: 0,
    source: SOURCE_LABEL,
    metadata: {
      source: SOURCE_LABEL,
      scope: "meeting_types_chart_only",
      message,
      canceledPolicy: "include",
      futurePolicy: "include_when_in_period",
      ...extra,
    },
  };
}

function toChartItem(row) {
  return {
    name: row.label,
    count: row.count,
    percentage: row.percent,
  };
}

function buildResult(events, audit = {}, transport = {}) {
  const dist = buildMeetingTypeDistributions(events, { now: new Date() });
  const totalEvents = events.length;
  return {
    available: true,
    source: SOURCE_LABEL,
    totalEvents,
    excludedCommercial: audit.excludedCommercial ?? 0,
    missingGroup: audit.missingGroup ?? 0,
    byFamily: dist.byFamily,
    byRaw: dist.byRaw,
    original: dist.byRaw.map(toChartItem),
    consolidated: dist.byFamily.map(toChartItem),
    events: events.map((e) => ({
      eventUuid: e.eventUuid,
      rawEventType: e.rawEventType,
      canceled: e.canceled,
      startTime: e.startTime,
      groupName: e.groupName || null,
      ...normalizeMeetingEventType(e.rawEventType),
    })),
    metadata: {
      source: SOURCE_LABEL,
      scope: "meeting_types_chart_only",
      note: "Fonte exclusiva do gráfico Reuniões por tipo. Não altera KPIs operacionais.",
      canceledPolicy: "include",
      futurePolicy: "include_when_in_period",
      commercialRule: "normalize(group_name).includes('comercial')",
      rowCount: audit.rowCount ?? null,
      distinctEventUuids: audit.distinctEventUuids ?? totalEvents,
      duplicateExtraRows: audit.duplicateExtraRows ?? null,
      excludedCommercial: audit.excludedCommercial ?? 0,
      missingGroup: audit.missingGroup ?? 0,
      missingType: audit.missingType ?? 0,
      groupNames: audit.groupNames || [],
      distinctRawTypes: dist.byRaw.length,
      distinctFamilies: dist.byFamily.length,
      eligibleEvents: totalEvents,
      transport: transport.mode || null,
      pagesFetched: transport.pagesFetched ?? null,
      ...transport,
    },
  };
}

function mapRawRowsToEvents(rows) {
  const firstByUuid = new Map();
  let rowCount = 0;

  for (const row of rows || []) {
    rowCount += 1;
    const uuid = String(row.event_uuid || row.eventUuid || "").trim();
    if (!uuid) continue;
    // 1 event_uuid = 1 reunião (mantém a primeira ocorrência)
    if (firstByUuid.has(uuid)) continue;
    firstByUuid.set(uuid, row);
  }

  const events = [];
  let excludedCommercial = 0;
  let missingGroup = 0;
  let missingType = 0;
  const groupCounts = new Map();

  for (const [uuid, row] of firstByUuid.entries()) {
    const groupName = row.group_name ?? row.groupName ?? null;
    const groupTrim = blankToNull(typeof groupName === "string" ? groupName.trim() : groupName);
    const groupKey = groupTrim || "(vazio)";
    groupCounts.set(groupKey, (groupCounts.get(groupKey) || 0) + 1);
    if (!groupTrim) missingGroup += 1;

    if (isCommercialGroup(groupName)) {
      excludedCommercial += 1;
      continue;
    }

    const rawType = resolveMeetingType(row.event_type_name ?? row.eventTypeName, row.event_name ?? row.eventName);
    if (rawType === "Não informado") missingType += 1;
    const canceled = isCanceledRow(row);
    events.push({
      eventUuid: uuid,
      rawEventType: rawType,
      title: rawType,
      canceled,
      startTime: row.start_time || row.startTime || null,
      groupName: groupTrim,
      attendanceStatus: canceled ? "cancelada" : "desconhecido",
    });
  }

  const distinctEventUuids = firstByUuid.size;
  return {
    events,
    audit: {
      rowCount,
      distinctEventUuids,
      duplicateExtraRows: Math.max(0, rowCount - distinctEventUuids),
      excludedCommercial,
      missingGroup,
      missingType,
      groupNames: [...groupCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR")),
    },
  };
}

async function fetchRestPage({ url, anonKey, schema, offset }) {
  const endpoint = new URL("/rest/v1/calendly_eventos", url);
  endpoint.searchParams.set("select", SELECT_COLS);
  endpoint.searchParams.set("order", "event_uuid.asc");
  const response = await fetch(endpoint, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: "application/json",
      "Accept-Profile": schema,
      "Content-Profile": schema,
      Prefer: "count=exact",
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
  return { ok: response.ok, status: response.status, data, raw: text, contentRange: response.headers.get("content-range") };
}

async function loadViaRest() {
  const { url, anonKey, schema } = getBusinessDataEnv();
  if (!url || !anonKey) {
    return { ok: false, reason: "BUSINESS_DATA_SUPABASE_URL/AUTH_SUPABASE_ANON_KEY ausentes." };
  }

  const rows = [];
  let offset = 0;
  let pages = 0;
  while (offset < MAX_ROWS) {
    const page = await fetchRestPage({ url, anonKey, schema, offset });
    pages += 1;
    if (!page.ok) {
      return {
        ok: false,
        reason: `REST Agendamentos.calendly_eventos HTTP ${page.status}: ${(page.raw || "").slice(0, 220)}`,
        status: page.status,
      };
    }
    rows.push(...page.data);
    if (page.data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const mapped = mapRawRowsToEvents(rows);
  return {
    ok: true,
    result: buildResult(mapped.events, mapped.audit, {
      mode: "rest",
      schema,
      pagesFetched: pages,
      selectedColumns: SELECT_COLS,
    }),
  };
}

async function loadViaN8n() {
  const webhook = (
    process.env.N8N_MEETING_TYPES_WEBHOOK_URL
    || "https://n8n-n8n.orsh7l.easypanel.host/webhook/portal-meetings-calendly-tipos"
  ).trim();
  if (!webhook) {
    return { ok: false, reason: "N8N_MEETING_TYPES_WEBHOOK_URL ausente." };
  }
  const token = (process.env.N8N_INTERNAL_API_TOKEN || "").trim();
  const response = await fetch(webhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": token,
    },
    body: JSON.stringify({ source: "portal-meetings", view: "calendly_eventos_tipos" }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, reason: `Webhook meeting types: HTTP ${response.status} ${detail.slice(0, 180)}` };
  }
  const payload = await response.json();
  if (!payload?.success && !Array.isArray(payload?.events)) {
    return { ok: false, reason: "Webhook meeting types retornou payload inválido." };
  }

  const eventsRaw = Array.isArray(payload.events) ? payload.events : [];
  // Ponte já deduplica e exclui Comercial; ainda assim normaliza e re-deduplica.
  const mapped = mapRawRowsToEvents(
    eventsRaw.map((e) => ({
      event_uuid: e.eventUuid ?? e.event_uuid,
      event_type_name: e.eventTypeName ?? e.event_type_name,
      event_name: e.eventName ?? e.event_name,
      event_status: e.eventStatus ?? e.event_status,
      canceled: e.canceled,
      start_time: e.startTime ?? e.start_time,
      group_name: e.groupName ?? e.group_name,
    })),
  );

  const audit = {
    ...(payload.audit || {}),
    // Preferir auditoria do SQL quando presente; completar com remap se necessário
    excludedCommercial: payload.audit?.excludedCommercial ?? mapped.audit.excludedCommercial,
    missingGroup: payload.audit?.missingGroup ?? mapped.audit.missingGroup,
    missingType: payload.audit?.missingType ?? mapped.audit.missingType,
    rowCount: payload.audit?.rowCount ?? mapped.audit.rowCount,
    distinctEventUuids: payload.audit?.distinctEventUuids ?? mapped.audit.distinctEventUuids,
    duplicateExtraRows: payload.audit?.duplicateExtraRows ?? mapped.audit.duplicateExtraRows,
    groupNames: payload.audit?.groupNames || mapped.audit.groupNames,
  };

  return {
    ok: true,
    result: buildResult(mapped.events, audit, {
      mode: "n8n_postgres_bridge",
      webhookHost: (() => {
        try { return new URL(webhook).host; } catch { return null; }
      })(),
      selectedColumns: SELECT_COLS,
    }),
  };
}

/**
 * Carrega eventos Calendly e devolve distribuição por tipo (dedupe por event_uuid).
 * Cancelados e futuros: incluídos (mesma regra do CSV anterior).
 */
export async function loadMeetingTypesFromCalendly() {
  try {
    const rest = await loadViaRest();
    if (rest.ok) return rest.result;

    const bridge = await loadViaN8n();
    if (bridge.ok) {
      const result = bridge.result;
      result.metadata = {
        ...result.metadata,
        restFallbackReason: rest.reason || null,
      };
      return result;
    }

    return unavailable(
      `Não foi possível ler Agendamentos.calendly_eventos. REST: ${rest.reason || "falhou"}. Ponte: ${bridge.reason || "falhou"}.`,
      { restReason: rest.reason || null, bridgeReason: bridge.reason || null },
    );
  } catch (err) {
    return unavailable(err?.message || "Falha ao carregar tipos de reunião do Calendly.");
  }
}
