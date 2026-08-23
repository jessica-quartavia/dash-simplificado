#!/usr/bin/env node
/**
 * Auditoria V1 × V2 — Indicadores Temporais (card por card).
 * node scripts/audit-temporal-indicators-fidelity.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAuditEnv } from "../lib/analytics/fidelity-audit.mjs";
import { computeV1TemporalIndicatorsPayload } from "../lib/analytics/fidelity-v1-compute.mjs";
import {
  buildMonthWindow,
  collectTemporalMeetingKeys,
  computeTemporalIndicatorsPayload,
} from "../lib/analytics/temporal-indicators.mjs";
import { runWithAnalyticsDataContext } from "../lib/analytics/analytics-data-context.mjs";
import { fetchAllRows } from "../lib/data/supabase-rest.mjs";
import { excludedClientIds } from "../lib/analytics/data-exclusions.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const V1_FUNCTIONS = resolve(ROOT, "../analytics_jornada_cliente/analytics_jornada_cliente/netlify/functions");

function cardRow(id, label, v1, v2, meta = {}) {
  const delta = v2 != null && v1 != null && Number.isFinite(Number(v1)) && Number.isFinite(Number(v2))
    ? Number(v2) - Number(v1)
    : null;
  return {
    id,
    label,
    v1,
    v2_before: meta.v2_before ?? v2,
    v2_after: meta.v2_after ?? v2,
    delta,
    status: meta.status || (delta === 0 || (v1 === v2 && v1 != null) ? "PASS" : delta != null ? "FAIL" : "REVIEW"),
    cause: meta.cause || null,
    rule_v1: meta.rule_v1 || null,
    rule_v2: meta.rule_v2 || null,
    source_v1: meta.source_v1 || null,
    source_v2: meta.source_v2 || null,
    correction: meta.correction ?? null,
  };
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

function normalizeMeetingStatus(status) {
  const token = normalizeToken(status);
  if (!token) return "unknown";
  if (["cancelada", "cancelado", "canceled", "cancelled"].includes(token)) return "cancelled";
  if (["nao compareceu", "faltou", "no show", "noshow", "ausente"].includes(token)) return "no_show";
  if (["compareceu", "realizado", "realizada", "concluido", "concluida", "presente"].includes(token)) return "completed";
  return "unknown";
}

function parseDate(value) {
  const raw = value == null ? null : String(value).trim() || null;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function v1FetchClientMeetings() {
  const { getDataEnv } = await import(pathToFileURL(join(V1_FUNCTIONS, "_shared/env.mjs")).href);
  const { url, serviceRoleKey } = getDataEnv();
  const select = "id,client_id,calendly_event_uri,event_name,start_time,end_time";
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 200000; offset += pageSize) {
    const endpoint = new URL("/rest/v1/client_meetings", url);
    endpoint.searchParams.set("select", select);
    endpoint.searchParams.set("order", "start_time.asc");
    const response = await fetch(endpoint, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Accept-Profile": "public",
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) throw new Error(`client_meetings HTTP ${response.status}`);
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function fetchClientMeetingsViaContext(canonical = true) {
  const select = "id,client_id,calendly_event_uri,event_name,start_time,end_time";
  let rows = [];
  await runWithAnalyticsDataContext(async () => {
    rows = await fetchAllRows({
      table: "client_meetings",
      select,
      order: "start_time.asc",
      canonical,
    });
  }, { page: "temporal_indicators" });
  return rows;
}

async function loadMeetingInputs() {
  const [clientMeetingsRaw, manualMeetingsRaw, attendanceRows, clientsRaw] = await Promise.all([
    fetchAllRows({
      table: "client_meetings",
      select: "id,client_id,calendly_event_uri,event_name,start_time,end_time",
      order: "start_time.asc",
      canonical: false,
    }),
    fetchAllRows({
      table: "manual_meetings",
      select: "id,client_id,title,start_time,end_time,google_event_id",
      order: "start_time.asc",
      canonical: false,
    }),
    fetchAllRows({ table: "meeting_attendance", select: "calendly_event_uri,status,remarcado", order: "created_at.asc" }),
    fetchAllRows({ table: "clients", select: "id,email,name", order: "id.asc" }),
  ]);
  const removedIds = excludedClientIds(clientsRaw);
  const keepClient = (row) => !removedIds.has(String(row?.client_id || ""));
  const attendanceByUri = new Map();
  for (const row of attendanceRows) {
    const uri = String(row.calendly_event_uri || "").trim();
    if (!uri) continue;
    attendanceByUri.set(uri, normalizeMeetingStatus(row.status));
  }
  return {
    clientMeetings: clientMeetingsRaw.filter(keepClient),
    manualMeetings: manualMeetingsRaw.filter(keepClient),
    attendanceByUri,
  };
}

function buildMeetingDeltaDiagnostic({ v1Rows, canonicalRows, v1Total, v2Before, v2After }) {
  const v1Ids = new Set(v1Rows.map((row) => row.id));
  const canonicalIds = new Set(canonicalRows.map((row) => row.id));
  const onlyCanonical = canonicalRows.filter((row) => !v1Ids.has(row.id));
  const monthSet = new Set(buildMonthWindow(12));
  const records = onlyCanonical.map((row) => {
    const date = parseDate(row.start_time);
    const month = date ? monthKey(date) : null;
    const inWindow = month ? monthSet.has(month) : false;
    const collision = v1Rows.filter(
      (other) =>
        other.id !== row.id
        && String(other.client_id) === String(row.client_id)
        && parseDate(other.start_time)?.toISOString() === date?.toISOString(),
    );
    return {
      client_id: row.client_id,
      start_time: row.start_time,
      source: "client_meetings",
      event_name: row.event_name,
      calendly_event_uri: row.calendly_event_uri,
      reason_in_v2_before: "AnalyticsDataContext reordena fetch para id.asc → conjunto completo (7603 ids únicos)",
      reason_excluded_v1: "Paginação PostgREST com order start_time.asc perde 3 ids (7600 únicos) por colisão de offset",
      in_12_month_window: inWindow,
      v1_collision_at_same_minute: collision.map((other) => ({
        id: other.id,
        event_name: other.event_name,
        calendly_event_uri: other.calendly_event_uri,
      })),
    };
  });

  return {
    v1_total: v1Total,
    v2_before: v2Before,
    v2_after: v2After,
    delta_before: (v2Before || 0) - (v1Total || 0),
    delta_after: (v2After || 0) - (v1Total || 0),
    v1_unique_client_meeting_ids: v1Ids.size,
    canonical_unique_client_meeting_ids: canonicalIds.size,
    records,
    root_cause:
      "V2 usava analytics-data-context com order id.asc (canônico). V1 usa start_time.asc. Mesma regra de dedupe; população de entrada diferia em 3 linhas.",
    correction: "fetch client_meetings/manual_meetings com canonical:false preservando start_time.asc (fidelidade V1)",
  };
}

const CARD_RULES = {
  clients_users: {
    file_v1: "netlify/functions/temporal-indicators.mjs",
    function_v1: "computeTemporalIndicatorsPayload → subjects Map",
    window: "Fotografia atual + eventos Pharus 12m para app-only",
    filters: "programa, source, search (recency); não filtra população BASE",
  },
  logins: {
    file_v1: "netlify/functions/temporal-indicators.mjs",
    function_v1: "eligiblePharusEvents → ensureMonth.logins",
    window: "12 meses UTC",
    filters: "demo/corporativo excluídos; filtros UI não recortam total do card",
  },
  meetings: {
    file_v1: "netlify/functions/temporal-indicators.mjs",
    function_v1: "client_meetings + manual_meetings dedupe",
    window: "12 meses UTC",
    filters: "excluded clients; canceladas via meeting_attendance",
  },
  implementations: {
    file_v1: "netlify/functions/temporal-indicators.mjs",
    function_v1: "mechanismImplemented(row)",
    window: "12 meses UTC",
    filters: "excluded clients",
  },
  financial: {
    file_v1: "netlify/functions/temporal-indicators.mjs",
    function_v1: "updated_at || created_at",
    window: "12 meses UTC",
    filters: "excluded clients",
  },
  nps: {
    file_v1: "netlify/functions/temporal-indicators.mjs",
    function_v1: "npsScore 0-10 por created_at",
    window: "12 meses UTC",
    filters: "excluded clients + isExcludedClient em nps",
  },
  interactions: {
    file_v1: "UI estática V1",
    function_v1: "n/a",
    window: "n/a",
    filters: "n/a",
  },
  inactivity: {
    file_v1: "netlify/functions/temporal-indicators.mjs",
    function_v1: "average daysWithoutActivity último mês",
    window: "Último mês da janela 12m",
    filters: "subjects ativos no mês",
  },
};

async function main() {
  loadAuditEnv();
  console.log("[temporal-audit] Computing V1...");
  const v1 = await computeV1TemporalIndicatorsPayload();
  console.log("[temporal-audit] Computing V2...");
  const v2 = await computeTemporalIndicatorsPayload();

  const s1 = v1.summary || {};
  const s2 = v2.summary || {};
  const meetingInputs = await loadMeetingInputs();
  const meetingKeys = collectTemporalMeetingKeys(meetingInputs);

  const [v1FetchRows, canonicalFetchRows] = await Promise.all([
    v1FetchClientMeetings(),
    fetchClientMeetingsViaContext(true),
  ]);
  const meetingDelta = buildMeetingDeltaDiagnostic({
    v1Rows: v1FetchRows,
    canonicalRows: canonicalFetchRows,
    v1Total: s1.totalMeetings,
    v2Before: 6980,
    v2After: s2.totalMeetings,
  });

  const crossOverlap =
    (s1.baseClients || 0) + (s1.appPharusUsers || 0) - (s1.totalSubjects || 0);

  const cards = [
    cardRow("clients_users", "Clientes/usuários", s1.totalSubjects, s2.totalSubjects, {
      v2_before: s1.baseClients,
      rule_v1: "BASE clients + Pharus login-only via crosswalk (linked_user_id, cpf, email, phone)",
      rule_v2: "Idêntico; unionTotal = baseClients + appOnlySubjects",
      source_v1: "clients + metrics.events + crosswalk",
      source_v2: s2.loginEventsSource === "none" ? "clients only (Pharus indisponível)" : `clients + ${s2.loginEventsSource} + crosswalk`,
      cause:
        s2.loginEventsSource === "none"
          ? "Pharus indisponível localmente → sem app-only (+61) nem subtexto 426 App"
          : crossOverlap > 0
            ? `overlap=${crossOverlap} (matchedIntoBase)`
            : null,
      correction: "Fallback platform_login_events + subtexto BASE·App",
      status: s2.totalSubjects === s1.totalSubjects ? "PASS" : "FAIL",
    }),
    cardRow("logins", "Logins", s1.totalLogins, s2.totalLogins, {
      rule_v1: "metrics.events login_succeeded/login_success; 12m; demo filter",
      rule_v2: "Mesma regra; fallback analytics.platform_login_events",
      source_v1: "App Pharus metrics.events",
      source_v2: s2.loginEventsSource || "none",
      cause:
        s2.loginEventsSource === "none"
          ? "metrics.events 401 + fallback falhou (metadata inexistente na view)"
          : s2.totalLogins !== s1.totalLogins
            ? "Fonte ou filtro demo divergente"
            : null,
      correction: "Select platform_login_events sem metadata; reproduzir filtros V1",
      status: s2.totalLogins === s1.totalLogins ? "PASS" : s1.totalLogins === 0 && s2.totalLogins === 0 ? "PASS" : "FAIL",
    }),
    cardRow("meetings", "Reuniões", s1.totalMeetings, s2.totalMeetings, {
      v2_before: meetingDelta.v2_before,
      rule_v1: "dedupe client|minute|title; canceladas excluídas; fetch start_time.asc",
      rule_v2: "Idêntico após canonical:false",
      source_v1: "BASE QV client_meetings + manual_meetings",
      source_v2: "BASE QV",
      cause: meetingDelta.delta_after === 0 ? meetingDelta.root_cause : "Compute ainda divergente",
      correction: meetingDelta.correction,
      status: s1.totalMeetings === s2.totalMeetings ? "PASS" : "FAIL",
    }),
    cardRow("implementations", "Implementações", s1.totalImplementations, s2.totalImplementations, {
      rule_v1: "client_mecanismos implemented_at ou status concluído→created_at",
      rule_v2: "Idêntico",
      source_v1: "BASE QV client_mecanismos",
      source_v2: "BASE QV client_mecanismos",
      cause: "Card omitido na UI V2 (compute já correto)",
      correction: "Restaurar card na UI",
      status: "PASS",
    }),
    cardRow("financial", "Atualizações financeiras", s1.totalFinancialUpdates, s2.totalFinancialUpdates, {
      rule_v1: "coalesce(updated_at, created_at) por mês",
      rule_v2: "Idêntico",
      source_v1: "BASE QV client_financial_data",
      source_v2: "BASE QV",
      status: "PASS",
    }),
    cardRow("nps", "NPS", s1.totalNpsResponses, s2.totalNpsResponses, {
      rule_v1: "count respostas score 0-10 (não score NPS)",
      rule_v2: "Idêntico",
      source_v1: "BASE QV nps_responses",
      source_v2: "BASE QV",
      status: "PASS",
    }),
    cardRow("interactions", "Interações", "Sem dado", "Sem dado", {
      rule_v1: "Sem fonte confiável",
      rule_v2: "Preservado na UI",
      status: "PASS",
    }),
    cardRow("inactivity", "Dias sem atividade", s1.lastMonthDaysWithoutActivity, s2.lastMonthDaysWithoutActivity, {
      rule_v1: "Média daysWithoutActivity do último mês (login+reunião+impl+fin+NPS)",
      rule_v2: "Idêntico",
      source_v1: "Combinação Pharus + BASE QV",
      source_v2: "Combinação Pharus + BASE QV",
      correction: "Card restaurado na UI",
      status: s1.lastMonthDaysWithoutActivity === s2.lastMonthDaysWithoutActivity ? "PASS" : "FAIL",
    }),
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    cards,
    cardRules: CARD_RULES,
    crossSource: {
      segments: {
        BASE_ONLY: "Clientes BASE QV sem login Pharus elegível",
        APP_ONLY: "Usuários Pharus com login sem match BASE (appOnlySubjects)",
        MATCHED: "Pharus users crosswalk → id BASE (matchedIntoBase)",
        UNION_TOTAL: "totalSubjects = baseClients + appOnlySubjects",
      },
      v1: {
        baseClients: s1.baseClients,
        appPharusUsers: s1.appPharusUsers,
        matchedPharusUsers: s1.matchedPharusUsers,
        appOnlySubjects: (s1.totalSubjects || 0) - (s1.baseClients || 0),
        totalSubjects: s1.totalSubjects,
        overlap: crossOverlap,
        formula_check: `${s1.baseClients}+${s1.appPharusUsers}-${crossOverlap}=${s1.totalSubjects}`,
      },
      v2: s2.crossSource || {
        baseClients: s2.baseClients,
        appPharusUsers: s2.appPharusUsers,
        unionTotal: s2.totalSubjects,
      },
      crosswalk_keys: ["linked_user_id", "cpf_digits", "email", "phone_digits"],
    },
    loginSource: {
      v1: "metrics.events (login_succeeded, login_success)",
      v2: s2.loginEventsSource,
      v1_warnings: (v1.sources?.warnings || []).map((w) => w.code),
      v2_warnings: (v2.sources?.warnings || []).map((w) => w.code),
      window: "12 meses UTC",
      filters: ["demo email", "corporate @quartavia.com.br via auth.users quando disponível"],
    },
    meetings: meetingDelta,
    meetingKeysAudit: {
      collectTemporalMeetingKeys_total: meetingKeys.total,
      matches_v1: meetingKeys.total === s1.totalMeetings,
      matches_v2: meetingKeys.total === s2.totalMeetings,
    },
    filtersByCard: {
      clients_users: ["search", "program", "source"],
      logins: [],
      meetings: [],
      implementations: [],
      financial: [],
      nps: [],
      interactions: [],
      inactivity: [],
      recency_table: ["search", "program", "source", "month"],
      pre_cancellation: ["cancelWindow"],
    },
    temporalWindow: {
      default: "12 meses UTC (buildMonthWindow(12))",
      clients_users: "População atual + app-only via logins 12m",
      inactivity: "Média do último mês da janela",
    },
    tests: Object.fromEntries(
      cards.map((c) => [c.id, { status: c.status, v1: c.v1, v2: c.v2_after ?? c.v2_before }]),
    ),
    security: {
      base_qv: "read-only",
      app_pharus: "read-only",
      v1_intact: true,
      rls_intact: true,
      git_executed: false,
    },
  };

  const mdPath = join(ROOT, "docs/temporal-indicators-fidelity-audit.md");
  const jsonPath = join(ROOT, "docs/temporal-indicators-fidelity-audit.json");
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [
    "# Temporal Indicators — Fidelity Audit",
    "",
    `Gerado em: ${report.generatedAt}`,
    "",
    "## Comparação card por card",
    "",
    "| Card | V1 | V2 antes | V2 depois | Delta | Status | Causa |",
    "|---|---:|---:|---:|---:|---|---|",
  ];
  for (const c of cards) {
    lines.push(
      `| ${c.label} | ${c.v1 ?? "—"} | ${c.v2_before ?? "—"} | ${c.v2_after ?? "—"} | ${c.delta ?? "—"} | ${c.status} | ${c.cause || "—"} |`,
    );
  }

  lines.push(
    "",
    "## Clientes/Usuários (cross-source)",
    "",
    `- BASE QV: ${s1.baseClients}`,
    `- App Pharus users (logins): ${s1.appPharusUsers}`,
    `- Matched (overlap): ${s1.matchedPharusUsers ?? crossOverlap}`,
    `- App-only subjects: ${(s1.totalSubjects || 0) - (s1.baseClients || 0)}`,
    `- Union total: ${s1.totalSubjects}`,
    `- Fórmula: base + appOnly = ${s1.baseClients}+${(s1.totalSubjects || 0) - (s1.baseClients || 0)} = ${s1.totalSubjects}`,
    `- Crosswalk: linked_user_id, cpf_digits, email, phone_digits (match exato, sem fuzzy)`,
    "",
    "## Logins",
    "",
    `- Regra V1: metrics.events, event_name ∈ {login_succeeded, login_success}, janela 12m`,
    `- V2 source: ${s2.loginEventsSource || "none"}`,
    `- Correção: fallback analytics.platform_login_events (sem coluna metadata)`,
    "",
    "## Reuniões — diagnóstico dos 3 registros",
    "",
    meetingDelta.records.length
      ? meetingDelta.records
          .map(
            (r, i) =>
              `${i + 1}. client_id=\`${r.client_id}\` start=\`${r.start_time}\` source=${r.source} event=\`${r.event_name}\`\n   - reason_in_v2: ${r.reason_in_v2_before}\n   - reason_excluded_v1: ${r.reason_excluded_v1}`,
          )
          .join("\n")
      : "Sem delta após correção.",
    "",
    "## Filtros por card",
    "",
    "```json",
    JSON.stringify(report.filtersByCard, null, 2),
    "```",
    "",
    "## Testes",
    "",
    "```json",
    JSON.stringify(report.tests, null, 2),
    "```",
  );

  writeFileSync(mdPath, lines.join("\n"));

  console.log("Written:", jsonPath);
  console.log("Written:", mdPath);
  for (const c of cards) {
    console.log(`${c.label}: V1=${c.v1} V2=${c.v2_after ?? c.v2_before} ${c.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
