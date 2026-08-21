import { dataConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatus,
} from "./analytical-cancellation.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import { calculateClientSegment } from "./client-segment.mjs";

const CLIENT_SELECT =
  "id,codigo,name,email,status,engenheiro_patrimonial,programa,data_churn";
const FINANCIAL_SELECT =
  "id,client_id,reserva_liquidez,ultima_renda_mensal,ultimo_aporte,possui_imovel,possui_carro,possui_consorcio,created_at,updated_at";
const CANCEL_SELECT = ANALYTICAL_CANCEL_SELECT;
const MEETING_SELECT = "id,client_id,event_name,start_time";

const USED_FIELDS = [
  { table: "clients", column: "id", role: "clientId" },
  { table: "clients", column: "codigo", role: "clientCode" },
  { table: "clients", column: "name", role: "clientName" },
  { table: "clients", column: "status", role: "rawStatus" },
  { table: "clients", column: "engenheiro_patrimonial", role: "engineer" },
  { table: "client_financial_data", column: "client_id", role: "financialJoin" },
  { table: "client_financial_data", column: "created_at", role: "financialCreated" },
  { table: "client_financial_data", column: "updated_at", role: "financialUpdated" },
  { table: "client_financial_data", column: "reserva_liquidez", role: "liquidityReserve" },
  { table: "client_financial_data", column: "ultima_renda_mensal", role: "monthlyIncome" },
  { table: "client_financial_data", column: "ultimo_aporte", role: "lastContribution" },
  { table: "client_financial_data", column: "possui_imovel", role: "hasProperty" },
  { table: "client_financial_data", column: "possui_carro", role: "hasCar" },
  { table: "client_financial_data", column: "possui_consorcio", role: "hasConsortium" },
  { table: "cancellations", column: "client_id", role: "cancellationJoin" },
  { table: "cancellations", column: "churn_efetivado_at", role: "cancellationDatePriority1" },
  { table: "cancellations", column: "distrato_assinado_at", role: "cancellationDatePriority2" },
  { table: "cancellations", column: "archived_at", role: "cancellationSoftDelete" },
  { table: "cancellations", column: "data_pedido", role: "operationalOnly" },
  { table: "cancellations", column: "intencao_registrada_at", role: "operationalOnly" },
];

const RECENCY_BANDS = [
  "Atualizado nos últimos 30 dias",
  "De 31 a 60 dias",
  "De 61 a 90 dias",
  "De 91 a 180 dias",
  "Mais de 180 dias",
  "Sem data de atualização",
  "Sem dados financeiros",
];

const FIELD_COVERAGE_DEFS = [
  { key: "liquidityReserve", label: "Reserva de liquidez", kind: "number" },
  { key: "monthlyIncome", label: "Última renda mensal", kind: "number" },
  { key: "lastContribution", label: "Último aporte", kind: "number" },
  { key: "hasProperty", label: "Possui imóvel", kind: "bool" },
  { key: "hasCar", label: "Possui carro", kind: "bool" },
  { key: "hasConsortium", label: "Possui consórcio", kind: "bool" },
];

const TOTAL_FINANCIAL_FIELDS = FIELD_COVERAGE_DEFS.length;

function configurationError() {
  return dataConfigurationError();
}

async function fetchTable(table, select, order = "id.asc") {
  return fetchAllRows({ table, select, order: order || "id.asc" });
}

function blankToNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

function toNumber(value) {
  const raw = blankToNull(value);
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toBool(value) {
  const raw = blankToNull(value);
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw).trim().toLowerCase();
  if (["true", "t", "1", "sim", "yes", "y"].includes(s)) return true;
  if (["false", "f", "0", "nao", "não", "no", "n"].includes(s)) return false;
  return null;
}

function parseDate(value) {
  const raw = blankToNull(value);
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const text = String(raw).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, dd, mm, yyyy, hh = "0", mi = "0", ss = "0"] = br;
    const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function emptyPayload(extraWarnings = []) {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalClients: 0,
      clientsWithFinancialData: 0,
      financialDataCoveragePercent: 0,
      updatedLast30Days: 0,
      updatedLast30DaysPercent: 0,
      updatedLast30DaysPercentOfFinancial: 0,
      updatedLast30DaysPercentOfPortfolio: 0,
      medianDaysSinceUpdate: null,
      averageDaysSinceUpdate: null,
      outdatedOver90Days: 0,
      outdatedOver90DaysPercent: 0,
      hasUpdateHistory: false,
      totalFinancialUpdates: null,
      note: "Resposta mínima: consolidação incompleta.",
    },
    distributions: {
      updateRecency: [],
      updatesByMonth: [],
      updatesByMonthRanges: { months6: [], months12: [], months24: [] },
      fieldCoverage: [],
      updatesByEngineer: [],
    },
    clients: [],
    warnings: extraWarnings,
    quality: { usedFields: USED_FIELDS, warnings: extraWarnings },
  };
}

async function probeFinancialTable() {
  const url = new URL("/rest/v1/client_financial_data", process.env.DATA_SUPABASE_URL);
  url.searchParams.set("select", "id,client_id,created_at,updated_at");
  url.searchParams.set("limit", "1");
  const key = process.env.DATA_SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Accept-Profile": "public",
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let code = "";
    let message = detail.slice(0, 200);
    try {
      const parsed = JSON.parse(detail);
      code = parsed.code || "";
      message = parsed.message || message;
    } catch {
      /* keep */
    }
    console.error("[Financial Updates] probe failed", {
      table: "client_financial_data",
      httpStatus: response.status,
      code: code || null,
      message: message.slice(0, 160),
    });
    const err = new Error(`Probe client_financial_data: HTTP ${response.status}${code ? ` [${code}]` : ""}`);
    err.meta = { httpStatus: response.status, code, message };
    throw err;
  }
  return true;
}

async function fetchFinancialRowsResilient() {
  const warnings = [];
  try {
    const rows = await fetchTable("client_financial_data", FINANCIAL_SELECT);
    return { rows, warnings };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Financial Updates] full select failed, retrying core columns", msg.slice(0, 160));
    warnings.push("Consulta completa de client_financial_data falhou; tentando colunas essenciais.");
    const coreSelect = "id,client_id,created_at,updated_at,reserva_liquidez,ultima_renda_mensal,ultimo_aporte,possui_imovel,possui_carro,possui_consorcio";
    try {
      const rows = await fetchTable("client_financial_data", coreSelect);
      return { rows, warnings };
    } catch (inner) {
      const innerMsg = inner instanceof Error ? inner.message : String(inner);
      warnings.push(`Falha ao carregar client_financial_data: ${innerMsg.slice(0, 120)}`);
      throw inner;
    }
  }
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(start, end) {
  const ms = startOfDay(end).getTime() - startOfDay(start).getTime();
  return Math.floor(ms / 86400000);
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentMonthKey(now = new Date()) {
  return monthKey(now);
}

function average(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : round1((sorted[middle - 1] + sorted[middle]) / 2);
}

function fold(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function financialToActivationSummary(clients, financialRows, meetingRows) {
  const allowedIds = new Set(clients.map((client) => String(client.id)));
  const firstFinancial = new Map();
  const activations = new Map();
  for (const row of financialRows) {
    const clientId = String(row.client_id || "");
    const date = parseDate(row.created_at);
    if (!allowedIds.has(clientId) || !date) continue;
    if (!firstFinancial.has(clientId) || date < firstFinancial.get(clientId)) firstFinancial.set(clientId, date);
  }
  for (const row of meetingRows) {
    const clientId = String(row.client_id || "");
    const date = parseDate(row.start_time);
    if (!allowedIds.has(clientId) || !date || !fold(row.event_name).includes("ativacao das engrenagens")) continue;
    if (!activations.has(clientId)) activations.set(clientId, []);
    activations.get(clientId).push(date);
  }
  const days = [];
  const byClient = {};
  let clientsWithBothSources = 0;
  let negativePairs = 0;
  for (const [clientId, financialDate] of firstFinancial) {
    const meetings = (activations.get(clientId) || []).sort((a, b) => a - b);
    if (!meetings.length) continue;
    clientsWithBothSources += 1;
    if (meetings[0] < financialDate) negativePairs += 1;
    const firstValid = meetings.find((date) => date >= financialDate);
    if (firstValid) {
      const value = daysBetween(financialDate, firstValid);
      days.push(value);
      byClient[clientId] = value;
    }
  }
  return {
    medianDays: median(days),
    averageDays: average(days),
    sampleSize: days.length,
    clientsWithBothSources,
    excludedNegativePairs: negativePairs,
    byClient,
    rule: "primeira reunião de Ativação das Engrenagens em/apos a primeira client_financial_data.created_at",
  };
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

function round1(n) {
  return Math.round(n * 10) / 10;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function isFieldFilled(value, kind) {
  if (kind === "bool") return value === true || value === false;
  return value != null;
}

/**
 * Atualização financeira válida: updated_at > created_at (timestamps reais).
 * Criação inicial (updated_at === created_at) NÃO conta como atualização.
 */
function isFinancialRecordUpdated(row) {
  const updated = parseDate(row?.updated_at);
  const created = parseDate(row?.created_at);
  if (!updated || !created) return false;
  return updated.getTime() > created.getTime();
}

function resolveFinancialUpdateDate(row) {
  const updated = parseDate(row.updated_at);
  const created = parseDate(row.created_at);
  if (updated && created && updated.getTime() > created.getTime()) {
    return { date: updated, source: "updated_at_after_created", isUpdated: true };
  }
  return { date: null, source: "no_post_creation_update", isUpdated: false };
}

function auditFinancialTimestamps(financialRows) {
  let total = 0;
  let equal = 0;
  let updatedAfter = 0;
  let updatedBefore = 0;
  let missingCreated = 0;
  let missingUpdated = 0;
  let invalid = 0;
  const positiveDiffs = [];

  for (const row of financialRows || []) {
    total += 1;
    const updated = parseDate(row.updated_at);
    const created = parseDate(row.created_at);
    if (!created) missingCreated += 1;
    if (!updated) missingUpdated += 1;
    if (!created || !updated) {
      invalid += 1;
      continue;
    }
    const diff = updated.getTime() - created.getTime();
    if (diff === 0) equal += 1;
    else if (diff > 0) {
      updatedAfter += 1;
      positiveDiffs.push(diff);
    } else updatedBefore += 1;
  }

  const sorted = positiveDiffs.sort((a, b) => a - b);
  const medianDiffMs = sorted.length
    ? percentile(sorted.map((ms) => ms / 86400000), 50)
    : null;

  return {
    totalRecords: total,
    updatedEqualsCreated: equal,
    updatedAfterCreated: updatedAfter,
    updatedBeforeCreated: updatedBefore,
    missingCreatedAt: missingCreated,
    missingUpdatedAt: missingUpdated,
    invalidOrIncompleteTimestamps: invalid,
    medianDaysCreatedToUpdate: medianDiffMs == null ? null : Math.round(medianDiffMs * 10) / 10,
    rule: "isUpdated = updated_at > created_at",
  };
}

function recencyBand(days, hasFinancial, hasValidUpdate) {
  if (!hasFinancial) return "Sem dados financeiros";
  if (!hasValidUpdate || days == null) return "Sem data de atualização";
  if (days <= 30) return "Atualizado nos últimos 30 dias";
  if (days <= 60) return "De 31 a 60 dias";
  if (days <= 90) return "De 61 a 90 dias";
  if (days <= 180) return "De 91 a 180 dias";
  return "Mais de 180 dias";
}

/**
 * Um registro analítico por client_id.
 * Preferência: updated_at válido (após created_at) mais recente → id.
 */
function buildFinancialMap(financialRows) {
  const byClient = new Map();
  const counts = new Map();
  let rowsWithoutClientId = 0;
  const orphanClientIds = [];

  for (const row of financialRows || []) {
    const clientId = blankToNull(row.client_id);
    if (!clientId) {
      rowsWithoutClientId += 1;
      continue;
    }
    counts.set(clientId, (counts.get(clientId) || 0) + 1);

    const updated = parseDate(row.updated_at);
    const created = parseDate(row.created_at);
    const isUpdated = Boolean(updated && created && updated.getTime() > created.getTime());
    // Preferir registros com atualização real; empate por updated_at / id
    const recency = isUpdated
      ? updated.getTime()
      : (created?.getTime() || 0) * 0.001;
    const current = byClient.get(clientId);
    if (
      !current ||
      recency > current._recency ||
      (recency === current._recency && String(row.id || "") > String(current.id || ""))
    ) {
      byClient.set(clientId, { ...row, _recency: recency, _isUpdated: isUpdated });
    }
  }

  const multiples = [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ clientId: id, count: n }));
  return { byClient, counts, multiples, rowsWithoutClientId, orphanClientIds };
}

function buildMonthSeries(rows, now, monthsBack) {
  const nowKey = currentMonthKey(now);
  const buckets = new Map();
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = monthKey(d);
    if (key > nowKey) continue;
    buckets.set(key, new Set());
  }
  for (const row of rows) {
    if (!row.hasPostCreationUpdate || !row.financialUpdateDate) continue;
    const d = parseDate(row.financialUpdateDate);
    if (!d) continue;
    if (d > now) continue;
    const key = monthKey(d);
    if (!buckets.has(key)) continue;
    buckets.get(key).add(row.clientId);
  }
  return [...buckets.entries()].map(([month, set]) => ({
    month,
    count: set.size,
    label: month,
  }));
}

function buildPayload(clients, financialRows, cancellations, meetingRows = []) {
  const now = new Date();
  const today = startOfDay(now);
  const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations, clients);
  const { byClient, counts, multiples, rowsWithoutClientId } = buildFinancialMap(financialRows);
  const timestampAudit = auditFinancialTimestamps(financialRows);
  const financialToActivation = financialToActivationSummary(clients, financialRows, meetingRows);
  const clientIds = new Set(clients.map((c) => String(c.id)));

  const qualityWarnings = [];
  if (rowsWithoutClientId > 0) {
    qualityWarnings.push(`${rowsWithoutClientId} registro(s) financeiro(s) sem client_id.`);
  }
  if (multiples.length > 0) {
    qualityWarnings.push(
      `${multiples.length} cliente(s) com mais de um registro em client_financial_data; usado o mais recente com atualização válida quando houver.`,
    );
  }
  qualityWarnings.push(
    "Histórico de atualizações não disponível: a base mantém apenas o estado financeiro mais recente por cliente. Contagem de atualizações = clientes com updated_at > created_at.",
  );
  if (timestampAudit.updatedEqualsCreated > 0) {
    qualityWarnings.push(
      `${timestampAudit.updatedEqualsCreated} registro(s) com updated_at igual a created_at (criação inicial; não contam como atualização).`,
    );
  }
  if (timestampAudit.updatedBeforeCreated > 0) {
    qualityWarnings.push(
      `${timestampAudit.updatedBeforeCreated} registro(s) com updated_at anterior a created_at (excluídos da regra de atualização).`,
    );
  }
  if (timestampAudit.missingCreatedAt > 0 || timestampAudit.missingUpdatedAt > 0) {
    qualityWarnings.push(
      `Timestamps ausentes: created_at vazio em ${timestampAudit.missingCreatedAt}; updated_at vazio em ${timestampAudit.missingUpdatedAt}.`,
    );
  }

  let orphanFinancial = 0;
  for (const clientId of byClient.keys()) {
    if (!clientIds.has(String(clientId))) {
      orphanFinancial += 1;
    }
  }
  if (orphanFinancial > 0) {
    qualityWarnings.push(`${orphanFinancial} registro(s) financeiro(s) sem cliente correspondente.`);
  }

  const rows = [];
  for (const client of clients) {
    const clientId = String(client.id);
    const cancelInfo = cancelMap.get(String(clientId)) || cancelMap.get(clientId) || null;
    const analyticalStatus = resolveAnalyticalStatus(client.status, cancelInfo);
    const financial = byClient.get(clientId) || null;
    const dataWarnings = [];

    let financialCreatedAt = null;
    let financialUpdatedAt = null;
    let financialUpdateDate = null;
    let financialUpdateSource = "no_post_creation_update";
    let hasPostCreationUpdate = false;
    let daysSinceFinancialUpdate = null;
    let updatedLast30Days = false;
    let outdatedOver90Days = false;
    let liquidityReserve = null;
    let monthlyIncome = null;
    let lastContribution = null;
    let hasProperty = null;
    let hasCar = null;
    let hasConsortium = null;
    let filledFinancialFields = 0;
    const hasFinancialData = Boolean(financial);

    if (financial) {
      financialCreatedAt = parseDate(financial.created_at);
      financialUpdatedAt = parseDate(financial.updated_at);
      const resolved = resolveFinancialUpdateDate(financial);
      financialUpdateDate = resolved.date;
      financialUpdateSource = resolved.source;
      hasPostCreationUpdate = resolved.isUpdated === true;

      if (financialUpdatedAt && financialCreatedAt && financialUpdatedAt.getTime() === financialCreatedAt.getTime()) {
        dataWarnings.push("updated_at igual a created_at (somente criação)");
      }
      if (financialUpdatedAt && financialCreatedAt && financialUpdatedAt < financialCreatedAt) {
        dataWarnings.push("updated_at anterior a created_at");
      }
      if (financialUpdatedAt && financialUpdatedAt > now) {
        dataWarnings.push("updated_at futuro");
      }
      if (financialCreatedAt && financialCreatedAt > now) {
        dataWarnings.push("created_at futuro");
      }
      if (!hasPostCreationUpdate) {
        dataWarnings.push("Sem atualização posterior à criação do registro financeiro");
      }

      liquidityReserve = toNumber(financial.reserva_liquidez);
      monthlyIncome = toNumber(financial.ultima_renda_mensal);
      lastContribution = toNumber(financial.ultimo_aporte);
      hasProperty = toBool(financial.possui_imovel);
      hasCar = toBool(financial.possui_carro);
      hasConsortium = toBool(financial.possui_consorcio);

      const values = {
        liquidityReserve,
        monthlyIncome,
        lastContribution,
        hasProperty,
        hasCar,
        hasConsortium,
      };
      filledFinancialFields = FIELD_COVERAGE_DEFS.filter((f) => isFieldFilled(values[f.key], f.kind)).length;
      if (filledFinancialFields === 0) {
        dataWarnings.push("Registro financeiro sem campos preenchidos");
      }

      if ((counts.get(clientId) || 0) > 1) {
        dataWarnings.push(`Mais de um registro financeiro (${counts.get(clientId)}); usado o mais recente`);
      }

      if (hasPostCreationUpdate && financialUpdateDate && financialUpdateDate <= now) {
        daysSinceFinancialUpdate = daysBetween(financialUpdateDate, today);
        if (daysSinceFinancialUpdate != null && daysSinceFinancialUpdate >= 0) {
          updatedLast30Days = daysSinceFinancialUpdate <= 30;
          outdatedOver90Days = daysSinceFinancialUpdate > 90;
          if (outdatedOver90Days) dataWarnings.push("Mais de 90 dias sem atualização financeira");
        }
      } else if (financialUpdateDate && financialUpdateDate > now) {
        dataWarnings.push("Data de atualização financeira futura; excluída dos indicadores de recência");
        daysSinceFinancialUpdate = null;
      }
    } else if (analyticalStatus === "Ativo") {
      dataWarnings.push("Cliente ativo sem dados financeiros");
    }

    const segmentInfo = calculateClientSegment(
      hasFinancialData
        ? { monthlyIncome, liquidityReserve, lastContribution, paidPropertiesValue: null }
        : null,
      null,
    );

    rows.push({
      clientId,
      clientCode: blankToNull(client.codigo),
      clientName: blankToNull(client.name) || "Não informado",
      analyticalStatus,
      engineer: blankToNull(client.engenheiro_patrimonial) || "Não informado",
      segment: segmentInfo.segment || "Dados insuficientes",
      program: blankToNull(client.programa),
      hasFinancialData,
      hasPostCreationUpdate,
      financialRecordId: financial ? blankToNull(financial.id) : null,
      financialCreatedAt: financialCreatedAt ? financialCreatedAt.toISOString() : null,
      financialUpdatedAt: financialUpdatedAt ? financialUpdatedAt.toISOString() : null,
      financialUpdateDate: financialUpdateDate ? financialUpdateDate.toISOString() : null,
      financialUpdateSource,
      daysSinceFinancialUpdate,
      updatedLast30Days,
      outdatedOver90Days,
      liquidityReserve,
      monthlyIncome,
      lastContribution,
      hasProperty,
      hasCar,
      hasConsortium,
      filledFinancialFields,
      totalFinancialFields: TOTAL_FINANCIAL_FIELDS,
      recencyBand: recencyBand(daysSinceFinancialUpdate, hasFinancialData, hasPostCreationUpdate),
      daysFinancialToActivation: financialToActivation.byClient[clientId] ?? null,
      dataWarnings,
    });
  }

  const totalClients = rows.length;
  const withFinancial = rows.filter((r) => r.hasFinancialData);
  const clientsWithFinancialData = withFinancial.length;
  const clientsWithPostCreationUpdate = rows.filter((r) => r.hasPostCreationUpdate).length;
  const updatedLast30Days = withFinancial.filter((r) => r.updatedLast30Days).length;
  const outdatedOver90Days = withFinancial.filter((r) => r.outdatedOver90Days).length;
  const daysValues = withFinancial
    .map((r) => r.daysSinceFinancialUpdate)
    .filter((d) => d != null && Number.isFinite(d) && d >= 0);
  const sortedDays = [...daysValues].sort((a, b) => a - b);
  const medianDaysSinceUpdate = sortedDays.length ? round1(percentile(sortedDays, 50)) : null;
  const averageDaysSinceUpdate = average(sortedDays);

  if (clientsWithFinancialData > clientsWithPostCreationUpdate) {
    qualityWarnings.push(
      `${clientsWithFinancialData - clientsWithPostCreationUpdate} cliente(s) com registro financeiro sem atualização posterior à criação.`,
    );
  }

  const updateRecency = RECENCY_BANDS.map((label) => {
    const count = rows.filter((r) => r.recencyBand === label).length;
    return { label, count, percent: pct(count, totalClients) };
  });

  const fieldCoverage = FIELD_COVERAGE_DEFS.map((field) => {
    const count = rows.filter((r) => isFieldFilled(r[field.key], field.kind)).length;
    return {
      label: field.label,
      key: field.key,
      count,
      percent: pct(count, totalClients),
    };
  });

  const byEngineer = new Map();
  for (const row of rows) {
    const eng = row.engineer || "Não informado";
    if (!byEngineer.has(eng)) {
      byEngineer.set(eng, { engineer: eng, totalClients: 0, withFinancial: 0, updatedLast30Days: 0 });
    }
    const bucket = byEngineer.get(eng);
    bucket.totalClients += 1;
    if (row.hasFinancialData) bucket.withFinancial += 1;
    if (row.updatedLast30Days) bucket.updatedLast30Days += 1;
  }
  const updatesByEngineer = [...byEngineer.values()]
    .map((b) => ({
      label: b.engineer,
      engineer: b.engineer,
      totalClients: b.totalClients,
      withFinancial: b.withFinancial,
      updatedLast30Days: b.updatedLast30Days,
      recentUpdatePercent: pct(b.updatedLast30Days, b.withFinancial || 0),
      coveragePercent: pct(b.withFinancial, b.totalClients || 0),
      count: b.updatedLast30Days,
      percent: pct(b.updatedLast30Days, clientsWithFinancialData || 1),
    }))
    .sort(
      (a, b) =>
        b.recentUpdatePercent - a.recentUpdatePercent ||
        b.updatedLast30Days - a.updatedLast30Days ||
        a.label.localeCompare(b.label, "pt-BR"),
    );

  const hasUpdateHistory = false;
  void hasUpdateHistory;

  return {
    generatedAt: now.toISOString(),
    summary: {
      totalClients,
      clientsWithFinancialData,
      financialDataCoveragePercent: pct(clientsWithFinancialData, totalClients),
      updatedLast30Days,
      updatedLast30DaysPercentOfFinancial: pct(updatedLast30Days, clientsWithFinancialData),
      updatedLast30DaysPercentOfPortfolio: pct(updatedLast30Days, totalClients),
      medianDaysSinceUpdate,
      averageDaysSinceUpdate,
      outdatedOver90Days,
      outdatedOver90DaysPercent: pct(outdatedOver90Days, clientsWithFinancialData),
      updatedLast30DaysPercent: pct(updatedLast30Days, clientsWithFinancialData),
      hasUpdateHistory: false,
      clientsWithPostCreationUpdate,
      totalFinancialUpdates: clientsWithPostCreationUpdate,
      averageUpdatesPerClient: null,
      clientsUpdatedMoreThanOnce: null,
      latestFinancialUpdateInBase: (() => {
        const dates = withFinancial
          .filter((r) => r.hasPostCreationUpdate)
          .map((r) => r.financialUpdateDate)
          .filter(Boolean)
          .sort();
        return dates.length ? dates[dates.length - 1] : null;
      })(),
      note:
        "Atualização = updated_at > created_at. A criação inicial não conta. Sem histórico de eventos: o indicador reflete clientes com registro alterado após a criação.",
      updateRule: "updated_at > created_at",
      financialToActivation,
    },
    distributions: {
      updateRecency,
      updatesByMonth: buildMonthSeries(rows, now, 12),
      updatesByMonthRanges: {
        months6: buildMonthSeries(rows, now, 6),
        months12: buildMonthSeries(rows, now, 12),
        months24: buildMonthSeries(rows, now, 24),
      },
      fieldCoverage,
      updatesByEngineer,
    },
    clients: rows,
    warnings: qualityWarnings,
    quality: {
      usedFields: USED_FIELDS,
      warnings: qualityWarnings,
      financialDedup: {
        totalRows: (financialRows || []).length,
        distinctClients: byClient.size,
        clientsWithMultipleRows: multiples.length,
        maxRowsPerClient: multiples.length ? Math.max(...multiples.map((m) => m.count)) : 1,
        rule: "Preferir updated_at > created_at mais recente; uma linha analítica por client_id",
      },
      timestampAudit,
      historyAudit: {
        hasUpdateHistory: false,
        activityLogsFinancialEvents: "partial_not_used",
        note:
          "Sem histórico de eventos: totalFinancialUpdates = clientes com updated_at > created_at (registro alterado após a criação).",
      },
      futureFields: {
        valor_imoveis_quitados:
          "Coluna existe em client_financial_data, mas não representa patrimônio total/atual; não usada neste dashboard.",
        patrimonio:
          "Nenhuma coluna confirmada de patrimônio inicial/atual/total/evolução patrimonial.",
      },
    },
  };
}

/** Fonte única reutilizada pelo handler e por runners/smoke. */
export async function computeFinancialUpdatesPayload() {
  const configError = configurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }
  await probeFinancialTable();
  const [{ rows: financialRowsRaw, warnings: fetchWarnings }, clientsRaw, cancellations, meetingRowsRaw] = await Promise.all([
    fetchFinancialRowsResilient(),
    fetchTable("clients", CLIENT_SELECT),
    fetchTable("cancellations", CANCEL_SELECT),
    fetchTable("client_meetings", MEETING_SELECT, "start_time.asc"),
  ]);
  const removedIds = excludedClientIds(clientsRaw);
  const clients = filterExcludedClients(clientsRaw);
  const financialRows = financialRowsRaw.filter((row) => !removedIds.has(String(row.client_id || "")));
  const meetingRows = meetingRowsRaw.filter((row) => !removedIds.has(String(row.client_id || "")));
  const payload = buildPayload(clients, financialRows, cancellations, meetingRows);
  if (fetchWarnings.length) {
    payload.warnings = [...(payload.warnings || []), ...fetchWarnings];
    payload.quality = payload.quality || {};
    payload.quality.warnings = [...(payload.quality.warnings || []), ...fetchWarnings];
  }
  return payload;
}

export function toPublicFinancialUpdatesPayload(payload) {
  if (!payload) return payload;
  const { quality, warnings, ...rest } = payload;
  return { ...rest, warnings: warnings || [], quality: quality || {} };
}

export { buildPayload as buildFinancialUpdatesPayloadFromRaw };
