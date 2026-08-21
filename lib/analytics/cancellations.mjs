/**
 * Cancelamentos — processo operacional (BASE QV / public.*).
 *
 * Universo: 1 linha por client_id não arquivado em public.cancellations
 * (intenção, pedido ou efetivado) ∪ clients com data_churn.
 * Cancelamento efetivado = churn/distrato/data_churn (união distinta).
 */
import { dataConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import {
  getAnalyticsDataContext,
  perfDebugFromOptions,
  runWithAnalyticsDataContext,
} from "./analytics-data-context.mjs";
import { calculateClientSegment } from "./client-segment.mjs";
import {
  CANCELLATION_REASON_CATEGORIES,
  categorizeCancellationReason,
} from "./cancellation-reason-category.mjs";
import {
  parseFlexibleDate,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatusFromMaps,
} from "./analytical-cancellation.mjs";
import {
  CANCELLATION_PROCESS_SELECT,
  STAGE,
  STAGE_KEYS,
  buildCancellationProcessMap,
  medianOf,
  rateOrInsufficient,
  validPositiveDays,
  blankToNull,
  toNumber,
  resolveAnalyticalProcessSituation,
  isIntentionPedidoStatusName,
} from "./cancellation-process.mjs";
import { buildOrEvidenceGroup, statusNameMatches } from "./or-evidence.mjs";
import { applyRenewalTenureAdjustment, stayMonthsFromDays } from "./client-tenure.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";

async function fetchTable(table, select, order = "id.asc") {
  return fetchAllRows({ table, select, order: order || "id.asc" });
}

const STATUS_DIM_SELECT = "id,name,color,display_order,status_type,funnel_type,created_at";
const STATUS_UNKNOWN_LABEL = "Status não informado";

const CLIENT_SELECT =
  "id,codigo,name,email,status,data_inicio_ciclo,data_fim_ciclo,created_at,engenheiro_patrimonial,segmentacao,motivo_churn,data_churn,ciclo,programa";
const CANCEL_SELECT = CANCELLATION_PROCESS_SELECT;
const FINANCIAL_SELECT =
  "id,client_id,ultima_renda_mensal,ultimo_aporte,reserva_liquidez,valor_imoveis_quitados,cheque_especial,parcelamento_cartao,credito_pessoal,credito_consignado,created_at,updated_at";
const CALENDLY_SELECT =
  "id,client_id,calendly_event_uri,event_name,start_time,end_time,host_email,manually_linked";
const MANUAL_SELECT = "id,client_id,title,start_time,end_time,google_event_id";
const ATTENDANCE_SELECT = "calendly_event_uri,status,remarcado,link_gravacao,created_at,updated_at";

const SEGMENT_LABELS = ["APEX", "PRIVATE", "PRINCIPAL", "DEBTS", "OVER", "Dados insuficientes"];

const STAY_RANGES = [
  "Até 3 meses",
  "De 4 a 6 meses",
  "De 7 a 12 meses",
  "De 13 a 24 meses",
  "Mais de 24 meses",
  "Dados insuficientes",
];

const MEETING_RANGES = ["0 reuniões", "1 a 2", "3 a 5", "6 a 10", "Mais de 10", "Dados insuficientes"];

const FINANCIAL_RANGES = [
  "Até 30 dias antes",
  "31 a 60 dias",
  "61 a 90 dias",
  "91 a 180 dias",
  "Mais de 180 dias",
  "Sem atualização anterior",
];

const EXCLUSIVE_STAGE_ORDER = [
  STAGE.INTENCAO_PEDIDO,
  STAGE.RETENCAO,
  STAGE.OFFBOARDING,
  STAGE.EFETIVADO,
  STAGE.NENHUMA,
];

const USED_FIELDS = [
  { schema: "public", table: "cancellations", column: "client_id", role: "join" },
  { schema: "public", table: "cancellations", column: "status_id", role: "processStatusFk" },
  { schema: "public", table: "cancellation_statuses", column: "id", role: "processStatusPk" },
  { schema: "public", table: "cancellation_statuses", column: "name", role: "processStatusLabel" },
  { schema: "public", table: "cancellation_statuses", column: "display_order", role: "processStatusOrder" },
  { schema: "public", table: "cancellations", column: "motivo", role: "reason" },
  { schema: "public", table: "cancellations", column: "motivo_categoria", role: "categoryRef" },
  { schema: "public", table: "cancellations", column: "churn_efetivado_at", role: "cancellationDatePriority1" },
  { schema: "public", table: "cancellations", column: "distrato_assinado_at", role: "cancellationDatePriority2" },
  { schema: "public", table: "cancellations", column: "data_pedido", role: "processEntryPrimary" },
  { schema: "public", table: "cancellations", column: "intencao_registrada_at", role: "processEntryFallback" },
  { schema: "public", table: "cancellations", column: "archived_at", role: "softDelete" },
  { schema: "public", table: "cancellations", column: "passou_retencao", role: "retention" },
  { schema: "public", table: "cancellations", column: "desfecho", role: "retentionOutcome" },
  { schema: "public", table: "cancellations", column: "tratativa", role: "operations" },
  { schema: "public", table: "cancellations", column: "valor_pago", role: "financial" },
  { schema: "public", table: "cancellations", column: "valor_a_reembolsar", role: "financial" },
  { schema: "public", table: "clients", column: "id", role: "clientId" },
  { schema: "public", table: "clients", column: "data_inicio_ciclo", role: "hireDate" },
  { schema: "public", table: "clients", column: "data_fim_ciclo", role: "cycleEndDate" },
  { schema: "public", table: "clients", column: "programa", role: "program" },
  { schema: "public", table: "clients", column: "created_at", role: "hireFallback" },
  { schema: "public", table: "clients", column: "engenheiro_patrimonial", role: "engineer" },
  { schema: "public", table: "client_financial_data", column: "updated_at", role: "financialUpdate" },
  { schema: "public", table: "client_meetings", column: "start_time", role: "meetingStart" },
  { schema: "public", table: "meeting_attendance", column: "status", role: "attendance" },
];

function foldToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLabel(raw, fallback = "Não informado") {
  const trimmed = blankToNull(typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : raw);
  if (trimmed == null) return { key: "", label: fallback, raw: null };
  return { key: foldToken(trimmed), label: String(trimmed), raw: String(trimmed) };
}

function stayRangeFromMonths(months) {
  if (months == null) return "Dados insuficientes";
  if (months <= 3) return "Até 3 meses";
  if (months <= 6) return "De 4 a 6 meses";
  if (months <= 12) return "De 7 a 12 meses";
  if (months <= 24) return "De 13 a 24 meses";
  return "Mais de 24 meses";
}

function meetingCountBand(count) {
  if (count == null) return "Dados insuficientes";
  if (count === 0) return "0 reuniões";
  if (count <= 2) return "1 a 2";
  if (count <= 5) return "3 a 5";
  if (count <= 10) return "6 a 10";
  return "Mais de 10";
}

function financialRecencyBand(days) {
  if (days == null) return "Sem atualização anterior";
  if (days <= 30) return "Até 30 dias antes";
  if (days <= 60) return "31 a 60 dias";
  if (days <= 90) return "61 a 90 dias";
  if (days <= 180) return "91 a 180 dias";
  return "Mais de 180 dias";
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(start, end) {
  return Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000);
}

function toIso(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function robustStats(values) {
  const sorted = values.filter((v) => v != null && Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { median: null, mean: null, validCount: 0 };
  const mean = round1(sorted.reduce((a, b) => a + b, 0) / sorted.length);
  const median = round1(percentile(sorted, 50));
  return { median, mean, validCount: sorted.length };
}

function normalizeAttendanceStatus(status) {
  const s = foldToken(status).replace(/_/g, " ");
  if (!s) return "desconhecido";
  if (["compareceu", "realizado", "realizada", "concluido", "concluida", "presente"].includes(s)) {
    return "compareceu";
  }
  if (["nao compareceu", "faltou", "ausente", "no show", "noshow"].includes(s) || s.includes("nao compare")) {
    return "nao_compareceu";
  }
  if (["cancelada", "cancelado", "canceled", "cancelled"].includes(s)) return "cancelada";
  return "desconhecido";
}

function buildFinancialMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const clientId = blankToNull(row.client_id);
    if (!clientId) continue;
    const key = String(clientId);
    const updated = parseFlexibleDate(row.updated_at);
    const created = parseFlexibleDate(row.created_at);
    // Mesma regra do dashboard Atualização Financeira: só conta se updated_at > created_at.
    let date = null;
    let source = "unavailable";
    if (updated && created && updated.getTime() > created.getTime()) {
      date = updated;
      source = "updated_at_after_created";
    }
    const current = map.get(key);
    const score = date ? date.getTime() : 0;
    const currentScore = current?.date ? current.date.getTime() : -1;
    if (!current || score > currentScore || (score === currentScore && Number(row.id) > Number(current.id || 0))) {
      map.set(key, {
        id: row.id,
        date,
        source,
        monthlyIncome: toNumber(row.ultima_renda_mensal),
        lastContribution: toNumber(row.ultimo_aporte),
        liquidityReserve: toNumber(row.reserva_liquidez),
        paidPropertiesValue: toNumber(row.valor_imoveis_quitados),
        debt: {
          cheque_especial: row.cheque_especial,
          parcelamento_cartao: row.parcelamento_cartao,
          credito_pessoal: row.credito_pessoal,
          credito_consignado: row.credito_consignado,
        },
      });
    }
  }
  return map;
}

/** Segmento idêntico ao Dados Gerais (calculateClientSegment + financialMap). Independente da data de churn. */
function resolveClientSegmentInfo(clientId, client, financialMap) {
  const financial =
    financialMap.get(String(clientId))
    || (client?.id != null ? financialMap.get(String(client.id)) : null)
    || null;
  return calculateClientSegment(
    {
      monthlyIncome: financial?.monthlyIncome ?? null,
      liquidityReserve: financial?.liquidityReserve ?? null,
      lastContribution: financial?.lastContribution ?? null,
      paidPropertiesValue: financial?.paidPropertiesValue ?? null,
    },
    financial?.debt || {},
  );
}

function buildAttendanceMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const uri = blankToNull(row.calendly_event_uri);
    if (!uri) continue;
    const updated = parseFlexibleDate(row.updated_at) || parseFlexibleDate(row.created_at) || new Date(0);
    const current = map.get(uri);
    if (!current || updated > current.updated) {
      map.set(uri, { updated, status: normalizeAttendanceStatus(row.status) });
    }
  }
  return map;
}

function consolidateMeetings(calendlyRows, manualRows, attendanceMap) {
  const byClient = new Map();
  const seenUris = new Set();
  const seenComposite = new Set();

  const push = (clientId, meeting) => {
    if (!clientId) return;
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId).push(meeting);
  };

  for (const row of calendlyRows) {
    const clientId = blankToNull(row.client_id);
    const start = parseFlexibleDate(row.start_time);
    const uri = blankToNull(row.calendly_event_uri);
    const dedupe = uri || `cm:${row.id}`;
    if (seenUris.has(dedupe)) continue;
    seenUris.add(dedupe);
    const title = blankToNull(row.event_name) || "Reunião";
    const comp = clientId && start
      ? `${clientId}|${start.toISOString().slice(0, 16)}|${foldToken(title)}`
      : null;
    if (comp) seenComposite.add(comp);
    const attendance = uri ? attendanceMap.get(uri) : null;
    push(clientId ? String(clientId) : null, {
      startTime: start,
      attendanceStatus: attendance?.status || "desconhecido",
      title,
      source: "calendly",
    });
  }

  for (const row of manualRows) {
    const clientId = blankToNull(row.client_id);
    const start = parseFlexibleDate(row.start_time);
    const title = blankToNull(row.title) || "Reunião manual";
    const googleId = blankToNull(row.google_event_id);
    if (googleId && seenUris.has(`g:${googleId}`)) continue;
    const comp = clientId && start
      ? `${clientId}|${start.toISOString().slice(0, 16)}|${foldToken(title)}`
      : null;
    if (comp && seenComposite.has(comp)) continue;
    if (googleId) seenUris.add(`g:${googleId}`);
    if (comp) seenComposite.add(comp);
    push(clientId ? String(clientId) : null, {
      startTime: start,
      attendanceStatus: "desconhecido",
      title,
      source: "manual",
    });
  }

  return byClient;
}

function distributionFrom(rows, getLabel, preferredOrder = null) {
  const total = rows.length || 1;
  const map = new Map();
  const labels = new Map();
  for (const row of rows) {
    const { key, label } = normalizeLabel(getLabel(row));
    const k = key || "__empty__";
    map.set(k, (map.get(k) || 0) + 1);
    if (!labels.has(k)) labels.set(k, label);
  }
  let entries = [...map.entries()].map(([k, count]) => ({
    key: k,
    label: labels.get(k),
    count,
    percent: pct(count, total),
  }));
  if (preferredOrder?.length) {
    const byLabel = new Map(entries.map((e) => [e.label, e]));
    entries = preferredOrder.map((label) => {
      const found = byLabel.get(label);
      return found || { key: foldToken(label), label, count: 0, percent: 0 };
    });
  } else {
    entries.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
  }
  return entries;
}

function buildCancelMonthSeries(dates, now, monthsBack = 12) {
  const buckets = new Map();
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, 0);
  }
  const nowKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  for (const date of dates) {
    if (!date || date > now) continue;
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (key > nowKey || !buckets.has(key)) continue;
    buckets.set(key, buckets.get(key) + 1);
  }
  return [...buckets.entries()].map(([month, count]) => ({ month, label: month, count }));
}

/** Séries mensais agrupadas: intenções × efetivados (clientes distintos por mês/série). */
function buildIntentionVsEffectiveMonthSeries(rows, now, monthsBack = 12) {
  const buckets = new Map();
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { intentions: new Set(), effective: new Set() });
  }
  const nowKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  for (const row of rows || []) {
    const clientId = String(row.clientId || "");
    if (!clientId) continue;
    const intencaoAt = row.intencaoAt instanceof Date
      ? row.intencaoAt
      : parseFlexibleDate(row.intencaoAt);
    if (intencaoAt && intencaoAt <= now) {
      const key = `${intencaoAt.getUTCFullYear()}-${String(intencaoAt.getUTCMonth() + 1).padStart(2, "0")}`;
      if (key <= nowKey && buckets.has(key)) buckets.get(key).intentions.add(clientId);
    }
    // Efetivados sem data confirmada NÃO entram no gráfico mensal
    if (row.hasEfetivado && row.hasConfirmedDate !== false) {
      const d = row.cancellationDate instanceof Date
        ? row.cancellationDate
        : parseFlexibleDate(row.cancellationDate);
      if (d && d <= now) {
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        if (key <= nowKey && buckets.has(key)) buckets.get(key).effective.add(clientId);
      }
    }
  }

  return [...buckets.entries()].map(([month, sets]) => {
    const intentions = sets.intentions.size;
    const effective = sets.effective.size;
    return {
      month,
      label: month,
      intentions,
      effective,
      effectiveCancellations: effective,
      difference: intentions - effective,
      note: "Séries independentes por data; não é taxa de conversão do mesmo cliente.",
    };
  });
}

function pushWarning(list, code, message, extra = {}) {
  list.push({ code, message, severity: extra.severity || "warning", ...extra });
}

function enrichMeetingsAndFinancial({
  clientId,
  client,
  cancellationDate,
  now,
  meetingsByClient,
  financialMap,
  dataWarnings,
}) {
  const segmentInfo = resolveClientSegmentInfo(clientId, client, financialMap);

  if (!cancellationDate) {
    return {
      meetingsBeforeCancellation: null,
      meetingsBeforeBand: "Dados insuficientes",
      lastMeetingDate: null,
      daysSinceLastMeeting: null,
      lastInteractionDate: null,
      daysWithoutInteraction: null,
      financialUpdateDate: null,
      financialUpdateSource: "unavailable",
      daysSinceFinancialUpdate: null,
      financialRecencyBand: "Sem atualização anterior",
      meetingsSummary: null,
      segmentInfo,
    };
  }

  const meetings = meetingsByClient.get(clientId) || [];
  const completedBefore = meetings
    .filter((m) => {
      if (!m.startTime || m.startTime > now) return false;
      if (m.attendanceStatus !== "compareceu") return false;
      return startOfDay(m.startTime) <= startOfDay(cancellationDate);
    })
    .sort((a, b) => a.startTime - b.startTime);

  const meetingsAfterCancel = meetings.filter(
    (m) => m.startTime
      && m.attendanceStatus === "compareceu"
      && startOfDay(m.startTime) > startOfDay(cancellationDate),
  );
  if (meetingsAfterCancel.length) dataWarnings.push("Reunião posterior ao cancelamento");

  const meetingsBeforeCount = completedBefore.length;
  const lastMeeting = completedBefore.length ? completedBefore[completedBefore.length - 1] : null;
  let daysSinceLastMeeting = null;
  if (lastMeeting?.startTime) {
    const d = daysBetween(lastMeeting.startTime, cancellationDate);
    if (d >= 0) daysSinceLastMeeting = d;
  } else {
    dataWarnings.push("Cliente sem reunião realizada anterior ao cancelamento");
  }

  const financial = financialMap.get(String(clientId)) || (client?.id != null ? financialMap.get(String(client.id)) : null) || null;
  let financialUpdateDate = null;
  let financialUpdateSource = "unavailable";
  let daysSinceFinancialUpdate = null;
  if (financial?.date) {
    if (startOfDay(financial.date) > startOfDay(cancellationDate)) {
      dataWarnings.push("Atualização financeira posterior ao cancelamento");
    } else {
      financialUpdateDate = financial.date;
      financialUpdateSource = financial.source;
      daysSinceFinancialUpdate = daysBetween(financial.date, cancellationDate);
      if (daysSinceFinancialUpdate < 0) {
        daysSinceFinancialUpdate = null;
        dataWarnings.push("Valor negativo em dias sem atualização financeira");
      }
    }
  } else {
    dataWarnings.push("Cliente sem atualização financeira anterior");
  }

  return {
    meetingsBeforeCancellation: meetingsBeforeCount,
    meetingsBeforeBand: meetingCountBand(meetingsBeforeCount),
    lastMeetingDate: toIso(lastMeeting?.startTime),
    daysSinceLastMeeting,
    lastInteractionDate: toIso(lastMeeting?.startTime),
    daysWithoutInteraction: daysSinceLastMeeting,
    financialUpdateDate: toIso(financialUpdateDate),
    financialUpdateSource,
    daysSinceFinancialUpdate,
    financialRecencyBand: financialRecencyBand(daysSinceFinancialUpdate),
    meetingsSummary: completedBefore.slice(-5).map((m) => ({
      title: m.title,
      startTime: m.startTime.toISOString(),
      source: m.source,
    })),
    segmentInfo,
  };
}

function buildStatusDimensionMap(statusRows) {
  const byId = new Map();
  for (const row of statusRows || []) {
    const id = blankToNull(row.id);
    if (!id) continue;
    byId.set(String(id), {
      id: String(id),
      name: blankToNull(row.name) || STATUS_UNKNOWN_LABEL,
      displayOrder: Number.isFinite(Number(row.display_order)) ? Number(row.display_order) : null,
      statusType: blankToNull(row.status_type),
      funnelType: blankToNull(row.funnel_type),
      color: blankToNull(row.color),
    });
  }
  return byId;
}

function resolveProcessStatus(statusId, statusById) {
  if (!statusId) {
    return {
      processStatusId: null,
      processStatusName: STATUS_UNKNOWN_LABEL,
      processStatusOrder: null,
      processStatusMatched: false,
    };
  }
  const dim = statusById.get(String(statusId));
  if (!dim) {
    return {
      processStatusId: String(statusId),
      processStatusName: STATUS_UNKNOWN_LABEL,
      processStatusOrder: null,
      processStatusMatched: false,
    };
  }
  return {
    processStatusId: dim.id,
    processStatusName: dim.name,
    processStatusOrder: dim.displayOrder,
    processStatusMatched: true,
  };
}

/**
 * Funil baseado em cancellation_statuses + evidências com OR deduplicado.
 * A) statusFunnelExclusive — etapa atual (1 cliente = 1 status), ordenada por display_order
 * B) evidenceFunnel — evidências sobrepostas (intenção/pedido/efetivado) com sources
 */
function buildStatusAndEvidenceFunnel(rows, statusById) {
  const universe = rows.length || 1;
  const statusCounts = new Map();
  for (const r of rows) {
    if (!r.processStatusId && !r.processStatusName) continue;
    // Inclui todos com status de processo (mesmo efetivados) para visão de status atual
    const key = r.processStatusName || STATUS_UNKNOWN_LABEL;
    if (!statusCounts.has(key)) {
      statusCounts.set(key, {
        name: key,
        displayOrder: r.processStatusOrder,
        clients: new Set(),
      });
    }
    const bucket = statusCounts.get(key);
    if (bucket.displayOrder == null && r.processStatusOrder != null) {
      bucket.displayOrder = r.processStatusOrder;
    }
    bucket.clients.add(String(r.clientId));
  }

  // Completar ordem a partir da dimensão
  for (const dim of statusById.values()) {
    if (!statusCounts.has(dim.name)) {
      statusCounts.set(dim.name, {
        name: dim.name,
        displayOrder: dim.displayOrder,
        clients: new Set(),
        funnelType: dim.funnelType,
        statusType: dim.statusType,
      });
    } else {
      const b = statusCounts.get(dim.name);
      b.funnelType = dim.funnelType;
      b.statusType = dim.statusType;
      if (b.displayOrder == null) b.displayOrder = dim.displayOrder;
    }
  }

  const statusFunnelExclusive = [...statusCounts.values()]
    .filter((s) => s.clients.size > 0 || (s.funnelType === "cancelamento" && !String(s.name).includes("[LEGADO]")))
    .map((s) => ({
      stage: s.name,
      totalDistinctClients: s.clients.size,
      sources: [{ key: "status", label: "Status da BASE QV", clients: s.clients.size }],
      overlapClients: 0,
      percentage: pct(s.clients.size, universe),
      displayOrder: s.displayOrder,
      funnelType: s.funnelType || null,
      statusType: s.statusType || null,
      exclusive: true,
      ruleDescription: `Status atual do processo em cancellation_statuses (${s.name}). Cada cliente conta uma vez.`,
    }))
    .sort((a, b) => {
      const ao = a.displayOrder;
      const bo = b.displayOrder;
      if (ao != null && bo != null && ao !== bo) return ao - bo;
      if (ao != null && bo == null) return -1;
      if (ao == null && bo != null) return 1;
      return b.totalDistinctClients - a.totalDistinctClients;
    });

  // Evidências OR
  const novaIntencao = new Set(
    rows
      .filter((r) => statusNameMatches(r.processStatusName, ["nova intencao", "nova intenção"]))
      .map((r) => String(r.clientId)),
  );
  const intencaoDate = new Set(
    rows.filter((r) => r.hasIntencao).map((r) => String(r.clientId)),
  );
  const pedidoDate = new Set(
    rows.filter((r) => r.hasPedido).map((r) => String(r.clientId)),
  );
  // Não existe status "Pedido de cancelamento" na dimensão atual — documentado
  const pedidoStatus = new Set(); // reservado se a dimensão ganhar o nome

  const churnSrc = new Set();
  const distratoAtSrc = new Set();
  const distratoTextSrc = new Set();
  const dataChurnSrc = new Set();
  for (const r of rows) {
    if (!r.hasEfetivado) continue;
    const id = String(r.clientId);
    const matched = Array.isArray(r.sourcesMatched) ? r.sourcesMatched : [];
    if (matched.includes("churn_efetivado_at")) churnSrc.add(id);
    if (matched.includes("distrato_assinado_at")) distratoAtSrc.add(id);
    if (matched.includes("distrato_assinado_text")) distratoTextSrc.add(id);
    if (matched.includes("clients.data_churn")) dataChurnSrc.add(id);
    if (!matched.length) {
      const src = r.cancellationDateSource || null;
      if (src === "churn_efetivado_at") churnSrc.add(id);
      else if (src === "distrato_assinado_at") distratoAtSrc.add(id);
      else if (src === "distrato_assinado_text") distratoTextSrc.add(id);
      else if (src === "clients.data_churn") dataChurnSrc.add(id);
      else if (r.hasClientDataChurn) dataChurnSrc.add(id);
      else if (r.hasDistratoTextSigned) distratoTextSrc.add(id);
    }
  }

  const intentionEvidence = buildOrEvidenceGroup({
    stage: "Intenção de cancelamento",
    ruleDescription:
      "Status «Nova intenção» OU intencao_registrada_at preenchida. Total = união distinta por cliente.",
    universeSize: universe,
    sources: [
      { key: "status", label: "Status «Nova intenção»", set: novaIntencao },
      { key: "date", label: "intencao_registrada_at preenchida", set: intencaoDate },
    ],
  });

  const pedidoEvidence = buildOrEvidenceGroup({
    stage: "Pedidos de cancelamento",
    ruleDescription:
      "Na dimensão atual não há status «Pedido de cancelamento». Total usa data_pedido preenchida (clientes distintos). Se o status for criado, passa a entrar no OR.",
    universeSize: universe,
    sources: [
      { key: "status", label: "Status «Pedido de cancelamento» (inexistente na dimensão)", set: pedidoStatus },
      { key: "date", label: "data_pedido preenchida", set: pedidoDate },
    ],
  });

  const efetivadoEvidence = buildOrEvidenceGroup({
    stage: "Cancelamento efetivado",
    ruleDescription:
      "churn_efetivado_at OU distrato_assinado_at OU distrato=Assinado OU clients.data_churn. Total = união distinta; barras não somam o cartão.",
    universeSize: universe,
    sources: [
      { key: "churn_efetivado_at", label: "Churn efetivado", set: churnSrc },
      { key: "distrato_assinado_at", label: "Distrato com data", set: distratoAtSrc },
      { key: "distrato_assinado_text", label: "Distrato textual assinado", set: distratoTextSrc },
      { key: "clients.data_churn", label: "Data churn em clients", set: dataChurnSrc },
    ],
  });

  // Overlap multi-fonte efetivado
  const allEff = new Set([...churnSrc, ...distratoAtSrc, ...distratoTextSrc, ...dataChurnSrc]);
  let multiSourceEff = 0;
  for (const id of allEff) {
    const n = [churnSrc, distratoAtSrc, distratoTextSrc, dataChurnSrc].filter((s) => s.has(id)).length;
    if (n > 1) multiSourceEff += 1;
  }
  efetivadoEvidence.overlapClients = multiSourceEff;
  efetivadoEvidence.multiSourceClients = multiSourceEff;

  const evidenceFunnel = [intentionEvidence, pedidoEvidence, efetivadoEvidence];

  return {
    mode: "status_dimension_plus_evidence",
    note:
      "Dois conceitos: (A) status atual exclusivo via cancellation_statuses.display_order; (B) evidências sobrepostas com OR deduplicado. Não misturar soma das barras com o total.",
    statusAudit: [...statusById.values()]
      .sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999))
      .map((s) => ({
        status_id: s.id,
        status_name: s.name,
        display_order: s.displayOrder,
        funnel_type: s.funnelType,
        status_type: s.statusType,
      })),
    statusFunnelExclusive,
    evidenceFunnel,
    funnel: evidenceFunnel,
  };
}

function buildPayload(
  clients,
  cancellations,
  financialRows,
  calendlyRows,
  manualRows,
  attendanceRows,
  statusRows = [],
) {
  const now = new Date();
  const process = buildCancellationProcessMap(cancellations, {
    includeArchived: true,
    clients,
  });
  const analyticalCancel = buildAnalyticalCancellationMap(cancellations, clients);
  const {
    map: processMap,
    multiples,
    rowsWithoutClientId,
    archivedRows,
    distratoTextSignedWithoutDate,
    invalidDateCount,
    invalidDateSamples,
  } = process;

  const statusById = buildStatusDimensionMap(statusRows);
  const clientById = new Map(clients.map((c) => [String(c.id), c]));
  const financialMap = buildFinancialMap(financialRows);
  const processStatusLines = cancellations
    .filter((row) => !parseFlexibleDate(row.archived_at))
    .map((row) => {
      const status = resolveProcessStatus(row.status_id, statusById);
      const client = clientById.get(String(row.client_id || ""));
      return {
        cancellationId: row.id == null ? null : String(row.id),
        clientId: row.client_id == null ? null : String(row.client_id),
        processStatusId: status.processStatusId,
        processStatusName: status.processStatusName,
        processStatusOrder: status.processStatusOrder,
        segment: resolveClientSegmentInfo(String(row.client_id || ""), client, financialMap)?.segmentLabel
          || "Dados insuficientes",
      };
    });
  const attendanceMap = buildAttendanceMap(attendanceRows);
  const meetingsByClient = consolidateMeetings(calendlyRows, manualRows, attendanceMap);

  const structuredWarnings = [];
  const rows = [];

  let orphanCancelCount = 0;
  let efetivadoSemIntencao = 0;
  let efetivadoSemPedido = 0;
  let pedidoSemIntencao = 0;
  let intencaoSemMotivo = 0;
  let motivoSemCategoria = 0;
  let passouSemDataRetencao = 0;
  let tratativaSemDesfecho = 0;
  let semEtapa = 0;
  let datasOrdemInconsistente = 0;
  let clientsDistratoTextSignedWithoutDate = 0;
  let chronologicalIssueClients = 0;
  let processStatusNull = 0;
  let processStatusUnmatched = 0;
  let processEntryFromPedido = 0;
  let processEntryFromIntencao = 0;

  for (const [clientId, proc] of processMap.entries()) {
    const client = clientById.get(String(clientId));
    if (!client) orphanCancelCount += 1;

    const dataWarnings = [];
    const cancelInfo = analyticalCancel.map.get(String(clientId)) || null;
    // Preferir mapa consolidado (inclui data_churn / distrato texto)
    const hasEfetivado = Boolean(cancelInfo?.isCancelled || proc.hasEfetivado);
    const cancellationDate = cancelInfo?.date || proc.analyticalCancellationAt || null;
    const cancellationDateSource = cancelInfo?.source || proc.analyticalSource || null;
    const hasConfirmedDate = cancelInfo
      ? Boolean(cancelInfo.hasConfirmedDate && cancelInfo.date)
      : Boolean(proc.hasConfirmedDate && cancellationDate);

    if (hasEfetivado && !hasConfirmedDate) {
      dataWarnings.push("Efetivado sem data confirmada");
    }

    const hireCycle = client ? parseFlexibleDate(client.data_inicio_ciclo) : null;
    const createdAt = client ? parseFlexibleDate(client.created_at) : null;
    const hireDate = hireCycle || createdAt;
    const hireSource = hireCycle ? "data_inicio_ciclo" : createdAt ? "created_at" : null;
    const cycleEndDate = client ? parseFlexibleDate(client.data_fim_ciclo) : null;
    const cancellationTiming = hasEfetivado && cancellationDate && cycleEndDate
      ? (cancellationDate < cycleEndDate ? "Antes do fim do ciclo" : "Não renovação")
      : "Sem dado";

    let daysToCancellation = null;
    let stayMonths = null;
    let stayRange = "Dados insuficientes";
    const currentCycleRaw = client?.ciclo;
    const currentCycleNum = currentCycleRaw == null || currentCycleRaw === ""
      ? null
      : Number(currentCycleRaw);
    const currentCycle = Number.isFinite(currentCycleNum) ? currentCycleNum : null;
    if (hasEfetivado && hireDate && cancellationDate) {
      const daysBase = daysBetween(hireDate, cancellationDate);
      if (daysBase < 0) {
        dataWarnings.push("Cancelamento anterior à contratação");
      } else if (cancellationDate > now) {
        dataWarnings.push("Data de cancelamento futura");
      } else {
        daysToCancellation = applyRenewalTenureAdjustment(daysBase, currentCycle);
        stayMonths = stayMonthsFromDays(daysToCancellation);
        stayRange = stayRangeFromMonths(stayMonths);
      }
    } else if (hasEfetivado) {
      if (!hireDate) dataWarnings.push("Data de contratação ausente");
      if (!cancellationDate) dataWarnings.push("Data de cancelamento ausente");
    }

    // Motivo: cancellations.motivo (já no process map); fallback clients.motivo_churn
    const motivoSource = proc.motivo != null
      ? proc.motivo
      : (client ? blankToNull(client.motivo_churn) : null);
    const motivoNorm = normalizeLabel(motivoSource);
    const hasReason = Boolean(motivoNorm.raw);
    const categorized = categorizeCancellationReason(motivoNorm.raw);
    const reasonCategory = categorized.category;
    const dbCategoryNorm = normalizeLabel(proc.motivoCategoriaDb);

    if (!hasReason) dataWarnings.push("Motivo ausente");
    if (multiples.has(clientId) || multiples.has(String(clientId))) {
      dataWarnings.push("Duplicidade de cancelamento (múltiplos processos ativos)");
    }

    const daysIntencaoToPedido = validPositiveDays(proc.intencaoAt, proc.pedidoAt);
    const daysPedidoToEfetivado = validPositiveDays(proc.pedidoAt, cancellationDate);
    const daysIntencaoToEfetivado = validPositiveDays(proc.intencaoAt, cancellationDate);
    const daysInRetencao = validPositiveDays(proc.retentionStartAt, cancellationDate || now);
    const daysEfetivadoToOffboarding = validPositiveDays(cancellationDate, proc.enteredOffboardingAt);

    const processStatus = resolveProcessStatus(proc.statusId, statusById);
    if (!proc.statusId) processStatusNull += 1;
    else if (!processStatus.processStatusMatched) processStatusUnmatched += 1;
    if (proc.processEntrySource === "data_pedido") processEntryFromPedido += 1;
    else if (proc.processEntrySource === "intencao_registrada_at") processEntryFromIntencao += 1;

    const processEndForDuration = hasEfetivado ? cancellationDate : now;
    const daysInProcess = validPositiveDays(proc.processEntryAt, processEndForDuration);
    const hasIntentionOrPedido = Boolean(
      proc.hasPedido
      || proc.hasIntencao
      || proc.hasIntentionOrPedido
      || isIntentionPedidoStatusName(processStatus.processStatusName),
    );
    const hasRetencao = Boolean(
      proc.hasRetencao
      || proc.passouRetencao === true
      || proc.retentionStartAt,
    );
    const hasOffboarding = Boolean(proc.hasOffboarding || proc.enteredOffboardingAt);
    const exclusiveRecalc = (() => {
      if (hasEfetivado) return { key: STAGE_KEYS.EFETIVADO, label: STAGE.EFETIVADO };
      if (hasOffboarding) return { key: STAGE_KEYS.OFFBOARDING, label: STAGE.OFFBOARDING };
      if (hasRetencao) return { key: STAGE_KEYS.RETENCAO, label: STAGE.RETENCAO };
      if (hasIntentionOrPedido) {
        return { key: STAGE_KEYS.INTENCAO_PEDIDO, label: STAGE.INTENCAO_PEDIDO };
      }
      return { key: STAGE_KEYS.NENHUMA, label: STAGE.NENHUMA };
    })();
    const analyticalSituation = resolveAnalyticalProcessSituation({
      hasEfetivado,
      hasConfirmedDate,
      hasOffboarding,
      hasRetencao,
      hasIntentionOrPedido,
    });
    const inProcessCurrently = hasIntentionOrPedido && !hasEfetivado;

    const clientAnalyticalStatus = resolveAnalyticalStatusFromMaps(
      client?.status,
      cancelInfo || { isCancelled: hasEfetivado, date: cancellationDate },
    );

    // Quality counters
    if (hasEfetivado && !proc.hasIntencao) efetivadoSemIntencao += 1;
    if (hasEfetivado && !proc.hasPedido) efetivadoSemPedido += 1;
    if (proc.hasPedido && !proc.hasIntencao) pedidoSemIntencao += 1;
    if (proc.hasIntencao && !hasReason) intencaoSemMotivo += 1;
    // Motivo preenchido mas categoria analítica ainda "Não informado"
    if (hasReason && reasonCategory === "Não informado") {
      motivoSemCategoria += 1;
    }
    if (proc.passouRetencao === true && !proc.retentionStartAt) passouSemDataRetencao += 1;
    if (proc.hasTratativa && !proc.hasDesfecho) tratativaSemDesfecho += 1;
    if (exclusiveRecalc.key === STAGE_KEYS.NENHUMA) semEtapa += 1;
    if (proc.distratoTextSignedWithoutDate) clientsDistratoTextSignedWithoutDate += 1;
    if (proc.chronologicalIssues?.length) {
      chronologicalIssueClients += 1;
      datasOrdemInconsistente += proc.chronologicalIssues.length;
      dataWarnings.push(...proc.chronologicalIssues.map((c) => `Ordem inconsistente: ${c}`));
    }

    let enrichment = {
      meetingsBeforeCancellation: null,
      meetingsBeforeBand: "Dados insuficientes",
      lastMeetingDate: null,
      daysSinceLastMeeting: null,
      lastInteractionDate: null,
      daysWithoutInteraction: null,
      financialUpdateDate: null,
      financialUpdateSource: "unavailable",
      daysSinceFinancialUpdate: null,
      financialRecencyBand: "Sem atualização anterior",
      meetingsSummary: null,
      segmentInfo: resolveClientSegmentInfo(String(clientId), client, financialMap),
    };

    if (hasEfetivado) {
      enrichment = enrichMeetingsAndFinancial({
        clientId: String(clientId),
        client,
        cancellationDate,
        now,
        meetingsByClient,
        financialMap,
        dataWarnings,
      });
    }

    const segmentLabel =
      enrichment.segmentInfo?.segmentLabel
      || "Dados insuficientes";

    // Não usar segmentacao bruta de clients como fallback de erro de join —
    // "Dados insuficientes" só quando calculateClientSegment assim classificou.
    const insufficientCore =
      hasEfetivado
      && (
        daysToCancellation == null
        || enrichment.meetingsBeforeCancellation == null
        || (!hasReason && enrichment.daysSinceFinancialUpdate == null && enrichment.daysSinceLastMeeting == null)
      );

    rows.push({
      clientId: String(clientId),
      clientCode: blankToNull(client?.codigo) || "Não informado",
      clientName: blankToNull(client?.name) || "Não informado",
      engineer: normalizeLabel(client?.engenheiro_patrimonial).label,
      program: blankToNull(client?.programa),
      segment: segmentLabel,
      analyticalStatus: clientAnalyticalStatus,
      exclusiveStage: exclusiveRecalc.label,
      exclusiveStageKey: exclusiveRecalc.key,
      processStatusId: processStatus.processStatusId,
      processStatusName: processStatus.processStatusName,
      processStatusOrder: processStatus.processStatusOrder,
      processStatusMatched: processStatus.processStatusMatched,
      intencaoAt: toIso(proc.intencaoAt),
      pedidoAt: toIso(proc.pedidoAt),
      processEntryAt: toIso(proc.processEntryAt),
      processEntrySource: proc.processEntrySource || null,
      daysInProcess,
      inProcessCurrently,
      analyticalSituation,
      churnEfetivadoAt: toIso(proc.churnEfetivadoAt),
      distratoAssinadoAt: toIso(proc.distratoAssinadoAt),
      cancellationDate: toIso(cancellationDate),
      cancellationDateSource,
      hasConfirmedDate,
      effectiveWithoutConfirmedDate: hasEfetivado && !hasConfirmedDate,
      hasIntencao: proc.hasIntencao,
      hasPedido: proc.hasPedido,
      hasIntentionOrPedido,
      hasEfetivado,
      hasRetencao,
      hasOffboarding,
      hasClientDataChurn: Boolean(cancelInfo?.hasClientDataChurn || proc.hasClientDataChurn),
      hasDistratoTextSigned: Boolean(cancelInfo?.hasDistratoTextSigned || proc.distratoTextSignedWithoutDate),
      sourcesMatched: cancelInfo?.sourcesMatched || [],
      dataChurnAt: toIso(client ? parseFlexibleDate(client.data_churn) : null),
      distratoText: proc.distratoText || null,
      hireDate: toIso(hireDate),
      hireDateSource: hireSource,
      cycleEndDate: toIso(cycleEndDate),
      cancellationTiming,
      daysToCancellation,
      stayMonths,
      stayRange,
      reason: motivoNorm.label,
      reasonRaw: motivoNorm.raw,
      reasonCategory,
      category: reasonCategory,
      categoryRaw: reasonCategory,
      hasReason,
      dbMotivoCategoria: dbCategoryNorm.raw,
      passouRetencao: proc.passouRetencao,
      desfecho: proc.desfecho,
      isRetido: Boolean(proc.isRetido),
      tratativa: proc.tratativa,
      hasTratativa: Boolean(proc.hasTratativa),
      hasDesfecho: Boolean(proc.hasDesfecho),
      responsavel: proc.responsavel || "Não informado",
      isCritical: Boolean(proc.isCritical),
      estagioCliente: proc.estagioCliente,
      isArchived: Boolean(proc.isArchived),
      hasArchivedRecord: Boolean(proc.hasArchivedRecord || proc.isArchived),
      valorPago: proc.valorPago,
      valorReembolso: proc.valorReembolso,
      retentionStartAt: toIso(proc.retentionStartAt),
      enteredOffboardingAt: toIso(proc.enteredOffboardingAt),
      daysIntencaoToPedido,
      daysPedidoToEfetivado,
      daysIntencaoToEfetivado,
      daysInRetencao,
      daysEfetivadoToOffboarding,
      meetingsBeforeCancellation: enrichment.meetingsBeforeCancellation,
      meetingsBeforeBand: enrichment.meetingsBeforeBand,
      lastMeetingDate: enrichment.lastMeetingDate,
      daysSinceLastMeeting: enrichment.daysSinceLastMeeting,
      lastInteractionDate: enrichment.lastInteractionDate,
      daysWithoutInteraction: enrichment.daysWithoutInteraction,
      interactionDefinition: "last_completed_meeting_before_cancellation",
      financialUpdateDate: enrichment.financialUpdateDate,
      financialUpdateSource: enrichment.financialUpdateSource,
      daysSinceFinancialUpdate: enrichment.daysSinceFinancialUpdate,
      financialRecencyBand: enrichment.financialRecencyBand,
      insufficientData: Boolean(insufficientCore),
      meetingsSummary: enrichment.meetingsSummary,
      dataWarnings: [...new Set(dataWarnings)],
      chronologicalIssues: proc.chronologicalIssues || [],
    });
  }

  const totalDistinctClients = rows.length;
  const efetivados = rows.filter((r) => r.hasEfetivado);
  const inProcessRows = rows.filter((r) => r.inProcessCurrently);
  const intentionsRegistered = rows.filter((r) => r.hasIntencao).length;
  const ordersRegistered = rows.filter((r) => r.hasPedido).length;
  const intentionsOrOrdersRegistered = rows.filter((r) => r.hasIntentionOrPedido).length;
  const effectiveCancellations = efetivados.length;
  const clientsInCancellationProcess = inProcessRows.length;
  const effectiveWithoutConfirmedDate = efetivados.filter((r) => r.effectiveWithoutConfirmedDate).length;

  // Ativos com intenção: status analítico Ativo + intenção/pedido + sem efetivação
  const activeWithCancellationIntention = rows.filter((r) => {
    if (!r.hasIntentionOrPedido || r.hasEfetivado || r.isArchived) return false;
    return r.analyticalStatus === "Ativo";
  }).length;

  const pedidosComIntencao = rows.filter((r) => r.hasPedido && r.hasIntencao).length;
  const efetivadosComPedido = efetivados.filter((r) => r.hasPedido).length;
  const efetivadosComIntencao = efetivados.filter((r) => r.hasIntencao).length;

  const funnel = {
    intentions: intentionsRegistered,
    orders: ordersRegistered,
    intentionsOrOrders: intentionsOrOrdersRegistered,
    effective: effectiveCancellations,
    rateIntentionToOrder: rateOrInsufficient(pedidosComIntencao, intentionsRegistered),
    rateOrderToEffective: rateOrInsufficient(efetivadosComPedido, ordersRegistered),
    rateIntentionToEffective: rateOrInsufficient(efetivadosComIntencao, intentionsRegistered),
  };

  const exclusiveStages = distributionFrom(rows, (r) => r.exclusiveStage, EXCLUSIVE_STAGE_ORDER).map((e) => ({
    label: e.label,
    key:
      e.label === STAGE.EFETIVADO ? STAGE_KEYS.EFETIVADO
        : e.label === STAGE.OFFBOARDING ? STAGE_KEYS.OFFBOARDING
          : e.label === STAGE.RETENCAO ? STAGE_KEYS.RETENCAO
            : e.label === STAGE.INTENCAO_PEDIDO ? STAGE_KEYS.INTENCAO_PEDIDO
              : STAGE_KEYS.NENHUMA,
    count: e.count,
    percent: e.percent,
    exclusive: true,
    rule: "Etapa atual exclusiva: efetivado > offboarding > retenção > intenção/pedido > nenhuma.",
    universe: "Clientes no processo de cancelamento (não arquivados por padrão).",
  }));
  const statusEvidenceFunnel = buildStatusAndEvidenceFunnel(rows, statusById);

  const timing = {
    medianIntentionToOrder: medianOf(rows.map((r) => r.daysIntencaoToPedido)),
    medianOrderToEffective: medianOf(rows.map((r) => r.daysPedidoToEfetivado)),
    medianIntentionToEffective: medianOf(rows.map((r) => r.daysIntencaoToEfetivado)),
    medianRetentionDays: medianOf(rows.map((r) => r.daysInRetencao)),
    medianEffectiveToOffboarding: medianOf(rows.map((r) => r.daysEfetivadoToOffboarding)),
    medianDaysInProcess: medianOf(inProcessRows.map((r) => r.daysInProcess)),
    medianDaysInProcessAll: medianOf(rows.map((r) => r.daysInProcess)),
  };

  const passouRetencaoRows = rows.filter((r) => r.passouRetencao === true);
  const retainedCount = rows.filter((r) => r.isRetido).length;
  const cancelledAfterRetentionCount = rows.filter((r) => r.passouRetencao === true && r.hasEfetivado).length;
  const withoutOutcomeCount = passouRetencaoRows.filter((r) => !r.hasDesfecho).length;
  const desfechoCoverage = rows.filter((r) => r.hasDesfecho).length;
  const medianRetentionDays = timing.medianRetentionDays;

  const retention = {
    passedRetentionCount: passouRetencaoRows.length,
    passedRetentionPercent: pct(passouRetencaoRows.length, totalDistinctClients || 1),
    retainedCount,
    cancelledAfterRetentionCount,
    withoutOutcomeCount,
    desfechoCoverage,
    medianRetentionDays,
  };

  const byResponsible = distributionFrom(
    rows,
    (r) => (r.responsavel && r.responsavel !== "Não informado" ? r.responsavel : null),
  ).map((e) => ({
    label: e.label,
    count: e.count,
    percent: e.percent,
  }));

  const operations = {
    byResponsible,
    criticalCount: rows.filter((r) => r.isCritical).length,
    withoutResponsibleCount: rows.filter((r) => !r.responsavel || r.responsavel === "Não informado").length,
    withoutTratativaCount: rows.filter((r) => !r.hasTratativa).length,
    withoutReasonCount: rows.filter((r) => !r.hasReason).length,
    inRetentionCount: rows.filter((r) => r.passouRetencao === true).length,
    inOffboardingCount: rows.filter((r) => r.enteredOffboardingAt).length,
    archivedRecords: archivedRows,
  };

  const paidValues = rows.map((r) => r.valorPago).filter((v) => v != null);
  const refundValues = rows.map((r) => r.valorReembolso).filter((v) => v != null);
  const financialAvailable = paidValues.length > 0 || refundValues.length > 0;
  const paidStats = medianOf(paidValues);
  const refundStats = medianOf(refundValues);
  const totalPaid = paidValues.length ? round1(paidValues.reduce((a, b) => a + b, 0)) : null;
  const totalRefund = refundValues.length ? round1(refundValues.reduce((a, b) => a + b, 0)) : null;

  const financial = financialAvailable
    ? {
        available: true,
        totalPaid,
        totalRefund,
        medianPaid: paidStats.median,
        medianRefund: refundStats.median,
        differencePaidMinusRefund:
          totalPaid != null && totalRefund != null ? round1(totalPaid - totalRefund) : null,
        coveragePaid: pct(paidValues.length, totalDistinctClients || 1),
        coverageRefund: pct(refundValues.length, totalDistinctClients || 1),
      }
    : {
        available: false,
        totalPaid: null,
        totalRefund: null,
        medianPaid: null,
        medianRefund: null,
        differencePaidMinusRefund: null,
        coveragePaid: 0,
        coverageRefund: 0,
      };

  const withReason = rows.filter((r) => r.hasReason).length;
  const withoutReason = totalDistinctClients - withReason;
  const efetivadoWithReason = efetivados.filter((r) => r.hasReason).length;
  const efetivadoWithoutReason = effectiveCancellations - efetivadoWithReason;

  const byReasonCategoryEfetivado = distributionFrom(efetivados, (r) => r.reasonCategory || r.category);
  const topReasonCategory = byReasonCategoryEfetivado[0]?.label || null;
  const secondReasonCategory = byReasonCategoryEfetivado[1]?.label || topReasonCategory;
  const efetivadoReasons = distributionFrom(efetivados.filter((r) => r.hasReason), (r) => r.reason);
  const topReason = efetivadoReasons[0]?.label || null;
  const secondReason = efetivadoReasons[1]?.label || topReason;
  const cancellationReasonsBySemester = (() => {
    const semesters = new Map();
    for (const row of efetivados) {
      const date = parseFlexibleDate(row.cancellationDate);
      if (!date) continue;
      const semester = `${date.getUTCFullYear()} S${date.getUTCMonth() < 6 ? 1 : 2}`;
      if (!semesters.has(semester)) semesters.set(semester, []);
      semesters.get(semester).push(row);
    }
    return [...semesters.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([semester, semesterRows]) => ({
        semester,
        total: semesterRows.length,
        reasons: distributionFrom(semesterRows, (row) => row.reasonCategory || row.category),
      }));
  })();

  const stayStats = robustStats(efetivados.map((r) => r.daysToCancellation));
  const meetingStats = robustStats(efetivados.map((r) => r.meetingsBeforeCancellation));
  const financialStats = robustStats(
    efetivados.map((r) => r.daysSinceFinancialUpdate).filter((d) => d != null),
  );
  const interactionStats = robustStats(
    efetivados.map((r) => r.daysWithoutInteraction).filter((d) => d != null),
  );
  const insufficientDataClients = efetivados.filter((r) => r.insufficientData).length;
  const othersCount = efetivados.filter((r) => (r.reasonCategory || r.category) === "Outros motivos").length;
  const notInformedCount = efetivados.filter((r) => (r.reasonCategory || r.category) === "Não informado").length;

  const byEngineer = distributionFrom(
    efetivados,
    (r) => (r.engineer === "Não informado" ? null : r.engineer),
  ).map((e) => ({
    ...e,
    sampleSize: e.count,
    percentOfCancellations: e.percent,
  }));

  // --- quality warnings ---
  if (distratoTextSignedWithoutDate) {
    pushWarning(
      structuredWarnings,
      "DISTRATO_TEXT_WITHOUT_DATE",
      `${distratoTextSignedWithoutDate} registro(s) com distrato textual "Assinado" sem distrato_assinado_at`
        + (clientsDistratoTextSignedWithoutDate
          ? ` (${clientsDistratoTextSignedWithoutDate} cliente(s) no mapa).`
          : "."),
      { count: distratoTextSignedWithoutDate, clients: clientsDistratoTextSignedWithoutDate },
    );
  }
  if (efetivadoSemIntencao) {
    pushWarning(
      structuredWarnings,
      "EFETIVADO_SEM_INTENCAO",
      `${efetivadoSemIntencao} churn/efetivado(s) sem intenção registrada.`,
      { count: efetivadoSemIntencao },
    );
  }
  if (efetivadoSemPedido) {
    pushWarning(
      structuredWarnings,
      "EFETIVADO_SEM_PEDIDO",
      `${efetivadoSemPedido} churn/efetivado(s) sem pedido de cancelamento.`,
      { count: efetivadoSemPedido },
    );
  }
  if (pedidoSemIntencao) {
    pushWarning(
      structuredWarnings,
      "PEDIDO_SEM_INTENCAO",
      `${pedidoSemIntencao} pedido(s) sem intenção registrada.`,
      { count: pedidoSemIntencao },
    );
  }
  if (intencaoSemMotivo) {
    pushWarning(
      structuredWarnings,
      "INTENCAO_SEM_MOTIVO",
      `${intencaoSemMotivo} intenção(ões) sem motivo.`,
      { count: intencaoSemMotivo },
    );
  }
  if (motivoSemCategoria) {
    pushWarning(
      structuredWarnings,
      "MOTIVO_SEM_CATEGORIA",
      `${motivoSemCategoria} motivo(s) sem categoria analítica informativa (Não informado).`,
      { count: motivoSemCategoria },
    );
  }
  if (passouSemDataRetencao) {
    pushWarning(
      structuredWarnings,
      "RETENCAO_SEM_DATA",
      `${passouSemDataRetencao} caso(s) com passou_retencao=true sem data de retenção.`,
      { count: passouSemDataRetencao },
    );
  }
  if (tratativaSemDesfecho) {
    pushWarning(
      structuredWarnings,
      "TRATATIVA_SEM_DESFECHO",
      `${tratativaSemDesfecho} tratativa(s) sem desfecho.`,
      { count: tratativaSemDesfecho },
    );
  }
  if (semEtapa) {
    pushWarning(
      structuredWarnings,
      "SEM_ETAPA",
      `${semEtapa} cliente(s) não arquivado(s) sem etapa identificada.`,
      { count: semEtapa },
    );
  }
  if (invalidDateCount) {
    pushWarning(
      structuredWarnings,
      "DATE_FORMAT",
      `${invalidDateCount} valor(es) de data com formato inconsistente (não parseável)`
        + (invalidDateSamples?.length ? `: ex. ${invalidDateSamples.slice(0, 3).join(", ")}.` : "."),
      { count: invalidDateCount, samples: invalidDateSamples },
    );
  }
  if (chronologicalIssueClients || datasOrdemInconsistente) {
    pushWarning(
      structuredWarnings,
      "DATE_ORDER",
      `${chronologicalIssueClients} cliente(s) com ordem de datas inconsistente.`,
      { count: chronologicalIssueClients, issues: datasOrdemInconsistente },
    );
  }
  if (multiples.size) {
    pushWarning(
      structuredWarnings,
      "MULTIPLES",
      `${multiples.size} cliente(s) com múltiplos registros de cancelamento ativos.`,
      { count: multiples.size },
    );
  }
  if (rowsWithoutClientId) {
    pushWarning(
      structuredWarnings,
      "SEM_CLIENT_ID",
      `${rowsWithoutClientId} registro(s) sem client_id.`,
      { count: rowsWithoutClientId },
    );
  }
  if (orphanCancelCount) {
    pushWarning(
      structuredWarnings,
      "ORPHAN_CANCEL",
      `${orphanCancelCount} cancelamento(s) sem cliente encontrado.`,
      { count: orphanCancelCount, label: "Cancelamentos sem cliente correspondente" },
    );
  }
  if (!financialAvailable) {
    pushWarning(
      structuredWarnings,
      "FINANCIAL_COVERAGE_ZERO",
      "Os campos valor_pago e valor_a_reembolsar não possuem cobertura suficiente.",
      { count: 0 },
    );
  }
  if (
    passouRetencaoRows.length > 0
    && withoutOutcomeCount / passouRetencaoRows.length > 0.5
  ) {
    pushWarning(
      structuredWarnings,
      "DESFECHO_COVERAGE_LOW",
      `${withoutOutcomeCount} de ${passouRetencaoRows.length} casos com passou_retencao sem desfecho (>50%).`,
      { count: withoutOutcomeCount },
    );
  }

  if (processStatusNull) {
    pushWarning(
      structuredWarnings,
      "PROCESS_STATUS_NULL",
      `${processStatusNull} cliente(s) no processo sem status_id.`,
      { count: processStatusNull },
    );
  }
  if (processStatusUnmatched) {
    pushWarning(
      structuredWarnings,
      "PROCESS_STATUS_UNMATCHED",
      `${processStatusUnmatched} cliente(s) com status_id sem correspondência em cancellation_statuses.`,
      { count: processStatusUnmatched },
    );
  }

  return {
    generatedAt: now.toISOString(),
    source: "public.cancellations + public.cancellation_statuses + public.clients (BASE QV) — process map",
    processStatusDimension: {
      table: "public.cancellation_statuses",
      join: "cancellations.status_id = cancellation_statuses.id",
      orderField: "display_order",
      statuses: [...statusById.values()]
        .sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999) || a.name.localeCompare(b.name, "pt-BR"))
        .map((s) => ({
          id: s.id,
          name: s.name,
          displayOrder: s.displayOrder,
          statusType: s.statusType,
          funnelType: s.funnelType,
        })),
    },
    interactionDefinition: {
      version: 1,
      label: "Dias desde a última reunião antes do cancelamento",
      rule: "Última reunião com presença confirmada (compareceu) com data <= cancelamento (efetivados).",
      pendingAppPharus: [
        "mecanismos implementados antes do cancelamento",
        "último acesso antes do cancelamento",
      ],
    },
    reasonCategorization: {
      sourceField: "public.cancellations.motivo",
      fallbackField: "public.clients.motivo_churn",
      categories: CANCELLATION_REASON_CATEGORIES,
      note: "Categorias analíticas calculadas no backend. motivo_categoria do banco não é a fonte.",
    },
    summary: {
      totalRecordsRead: (cancellations || []).length,
      totalDistinctClients,
      intentionsRegistered,
      ordersRegistered,
      intentionsOrOrdersRegistered,
      effectiveCancellations,
      clientsInCancellationProcess,
      activeWithCancellationIntention,
      effectiveWithoutConfirmedDate,
      processEntryFromPedido,
      processEntryFromIntencao,
      processWithoutStatus: inProcessRows.filter((r) => r.processStatusName === STATUS_UNKNOWN_LABEL).length,
      /** Alias chatbot / métricas legado */
      totalCancellations: effectiveCancellations,
      archivedRecords: archivedRows,
      funnel,
      statusEvidenceFunnel,
      evidenceFunnel: statusEvidenceFunnel.evidenceFunnel,
      statusFunnelExclusive: statusEvidenceFunnel.statusFunnelExclusive,
      exclusiveStages,
      timing,
      retention,
      operations,
      financial,
      withReason,
      withoutReason,
      withReasonPercent: pct(withReason, totalDistinctClients || 1),
      withoutReasonPercent: pct(withoutReason, totalDistinctClients || 1),
      distratoTextSignedWithoutDate,
      clientsDistratoTextSignedWithoutDate,
      tratativaCoverage: {
        withTratativa: totalDistinctClients - operations.withoutTratativaCount,
        withoutTratativa: operations.withoutTratativaCount,
        percent: pct(totalDistinctClients - operations.withoutTratativaCount, totalDistinctClients || 1),
      },
      motivoCoverage: {
        withReason,
        withoutReason,
        percent: pct(withReason, totalDistinctClients || 1),
      },
      chronologicalInconsistencyClients: chronologicalIssueClients,
      efetivadoReasonCoverage: {
        withReason: efetivadoWithReason,
        withoutReason: efetivadoWithoutReason,
        withReasonPercent: pct(efetivadoWithReason, effectiveCancellations || 1),
        withoutReasonPercent: pct(efetivadoWithoutReason, effectiveCancellations || 1),
      },
      topReasonCategory,
      secondReasonCategory,
      topReason,
      secondReason,
      othersReasonCategoryCount: othersCount,
      notInformedReasonCategoryCount: notInformedCount,
      medianDaysToCancellation: stayStats.median,
      averageDaysToCancellation: stayStats.mean,
      staySampleSize: stayStats.validCount,
      medianMeetingsBeforeCancellation: meetingStats.median,
      averageMeetingsBeforeCancellation: meetingStats.mean,
      meetingsSampleSize: meetingStats.validCount,
      medianDaysSinceFinancialUpdate: financialStats.median,
      averageDaysSinceFinancialUpdate: financialStats.mean,
      financialSampleSize: financialStats.validCount,
      medianDaysWithoutInteraction: interactionStats.median,
      averageDaysWithoutInteraction: interactionStats.mean,
      interactionSampleSize: interactionStats.validCount,
      insufficientDataClients,
    },
    distributions: {
      byExclusiveStage: exclusiveStages,
      byProcessStatus: (() => {
        const orderMap = new Map(
          [...statusById.values()].map((s) => [s.name, s.displayOrder]),
        );
        const dist = distributionFrom(inProcessRows, (r) => r.processStatusName || STATUS_UNKNOWN_LABEL);
        const totalIn = inProcessRows.length || 1;
        return dist
          .map((e) => ({
            ...e,
            percent: pct(e.count, totalIn),
            displayOrder: orderMap.has(e.label) ? orderMap.get(e.label) : null,
          }))
          .sort((a, b) => {
            const ao = a.displayOrder;
            const bo = b.displayOrder;
            if (ao != null && bo != null && ao !== bo) return ao - bo;
            if (ao != null && bo == null) return -1;
            if (ao == null && bo != null) return 1;
            return b.count - a.count;
          });
      })(),
      byProcessSegment: distributionFrom(inProcessRows, (r) => r.segment, SEGMENT_LABELS),
      byProcessEngineer: distributionFrom(
        inProcessRows,
        (r) => (r.engineer === "Não informado" ? null : r.engineer),
      ),
      byReason: distributionFrom(efetivados, (r) => (r.hasReason ? r.reason : null)),
      byCategory: byReasonCategoryEfetivado,
      byReasonCategory: byReasonCategoryEfetivado,
      byReasonSemester: cancellationReasonsBySemester,
      byReasonCategoryByStage: {
        all: distributionFrom(rows, (r) => r.reasonCategory || r.category),
        intencao: distributionFrom(
          rows.filter((r) => r.hasIntencao),
          (r) => r.reasonCategory || r.category,
        ),
        pedido: distributionFrom(
          rows.filter((r) => r.hasPedido),
          (r) => r.reasonCategory || r.category,
        ),
        efetivado: byReasonCategoryEfetivado,
      },
      byEstagioCliente: {
        all: distributionFrom(rows, (r) => r.estagioCliente),
        efetivado: distributionFrom(efetivados, (r) => r.estagioCliente),
      },
      byMonth: buildCancelMonthSeries(
        efetivados
          .filter((r) => r.hasConfirmedDate !== false)
          .map((r) => parseFlexibleDate(r.cancellationDate))
          .filter(Boolean),
        now,
        12,
      ),
      byMonthIntentionVsEffective: buildIntentionVsEffectiveMonthSeries(rows, now, 12),
      byResponsible,
      byStayRange: distributionFrom(efetivados, (r) => r.stayRange, STAY_RANGES),
      byMeetingCount: distributionFrom(efetivados, (r) => r.meetingsBeforeBand, MEETING_RANGES),
      byFinancialRecency: distributionFrom(efetivados, (r) => r.financialRecencyBand, FINANCIAL_RANGES),
      byEngineer,
      bySegment: distributionFrom(efetivados, (r) => r.segment, SEGMENT_LABELS),
    },
    processStatusLines,
    clients: rows,
    warnings: structuredWarnings,
    quality: {
      usedFields: USED_FIELDS,
      meetingRule: "presence_confirmed_compareceu_only",
      warnings: structuredWarnings,
      pendingAppPharus: [
        "mecanismos implementados antes do cancelamento",
        "último acesso antes do cancelamento",
      ],
      processMeta: {
        rowsWithoutClientId,
        archivedRows,
        distratoTextSignedWithoutDate,
        invalidDateCount,
        multiples: multiples.size,
      },
      effectiveCancellationAudit: analyticalCancel.audit || null,
      effectiveCancellationRule: {
        cancellations: "churn_efetivado_at OR distrato_assinado_at OR distrato='Assinado'",
        clients: "data_churn",
        union: "count(distinct client_id)",
        datePriority: ["churn_efetivado_at", "distrato_assinado_at", "clients.data_churn"],
        withoutDate: "distrato Assinado sem data → efetivado sem data confirmada (fora do mensal)",
      },
    },
  };
}

export async function computeCancellationsPayload(options = {}) {
  return runWithAnalyticsDataContext(async () => {
  const startedAt = Date.now();
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }
  const [clientsRaw, cancellationsRaw, financialRowsRaw, calendlyRowsRaw, manualRowsRaw, attendanceRows, statusRows] =
    await Promise.all([
      fetchTable("clients", CLIENT_SELECT),
      fetchTable("cancellations", CANCEL_SELECT),
      fetchTable("client_financial_data", FINANCIAL_SELECT),
      fetchTable("client_meetings", CALENDLY_SELECT),
      fetchTable("manual_meetings", MANUAL_SELECT),
      fetchTable("meeting_attendance", ATTENDANCE_SELECT),
      fetchTable("cancellation_statuses", STATUS_DIM_SELECT, "display_order.asc"),
    ]);
  const clients = filterExcludedClients(clientsRaw);
  const removedIds = excludedClientIds(clientsRaw);
  const keepClient = (row) => !removedIds.has(String(row?.client_id || ""));
  const cancellations = cancellationsRaw.filter(keepClient);
  const financialRows = financialRowsRaw.filter(keepClient);
  const calendlyRows = calendlyRowsRaw.filter(keepClient);
  const manualRows = manualRowsRaw.filter(keepClient);
  const payload = buildPayload(
    clients,
    cancellations,
    financialRows,
    calendlyRows,
    manualRows,
    attendanceRows,
    statusRows,
  );
  payload._fetchStats = getAnalyticsDataContext()?.snapshot() || [];
  getAnalyticsDataContext()?.logPerf({
    total_ms: Date.now() - startedAt,
    payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
  });
  return payload;
  }, { perfDebug: perfDebugFromOptions(options), page: "cancellations" });
}

export function toPublicCancellationsPayload(payload) {
  return payload;
}
