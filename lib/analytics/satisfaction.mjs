import { dataConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";

async function fetchTable(table, select, order = "created_at.asc") {
  return fetchAllRows({ table, select, order: order || "created_at.asc" });
}

const USED_FIELDS = [
  { table: "nps_responses", column: "id", role: "npsResponseId" },
  { table: "nps_responses", column: "client_id", role: "clientId" },
  { table: "nps_responses", column: "score", role: "npsScore" },
  { table: "nps_responses", column: "created_at", role: "npsDate" },
  { table: "nps_responses", column: "tipo_de_forms", role: "npsFormType" },
  { table: "csat_responses", column: "id", role: "csatResponseId" },
  { table: "csat_responses", column: "client_id", role: "clientId" },
  { table: "csat_responses", column: "score", role: "csatScore" },
  { table: "csat_responses", column: "created_at", role: "csatDate" },
  { table: "csat_responses", column: "tipo_de_forms", role: "csatFormType" },
  { table: "nps_sends", column: "client_id", role: "npsSendClientId" },
  { table: "nps_sends", column: "sent_at", role: "npsSentAt" },
];

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

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function pct(part, total) {
  return total ? round1((part / total) * 100) : 0;
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return round1(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function quarterKey(date) {
  return `${date.getUTCFullYear()} T${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

function npsClassLabel(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  if (Number(score) >= 9) return "Promotor";
  if (Number(score) >= 7) return "Neutro";
  return "Detrator";
}

function latestNpsPerClient(rows) {
  const latest = new Map();
  for (const row of rows) {
    const clientId = blankToNull(row.client_id);
    const date = parseDate(row.created_at);
    if (!clientId || !date) continue;
    const current = latest.get(clientId);
    if (!current || date > parseDate(current.created_at)) latest.set(clientId, row);
  }
  return [...latest.values()];
}

function buildNpsQuarterly(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const date = parseDate(row.created_at);
    if (!date) continue;
    const quarter = quarterKey(date);
    if (!buckets.has(quarter)) buckets.set(quarter, []);
    buckets.get(quarter).push(row);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([quarter, quarterRows]) => {
    const clientRows = latestNpsPerClient(quarterRows);
    const scores = clientRows.map((row) => npsScore(row.score)).filter((score) => score != null);
    return {
      quarter, label: quarter, responses: quarterRows.length, distinctClients: clientRows.length,
      nps: calcNps(scores),
      promoters: scores.filter((score) => score >= 9).length,
      neutrals: scores.filter((score) => score >= 7 && score <= 8).length,
      detractors: scores.filter((score) => score <= 6).length,
    };
  });
}

function buildNpsTransitions(rows, clientMap) {
  const byClientQuarter = new Map();
  for (const row of rows) {
    const clientId = blankToNull(row.client_id);
    const date = parseDate(row.created_at);
    if (!clientId || !date) continue;
    const quarter = quarterKey(date);
    const key = `${clientId}|${quarter}`;
    const current = byClientQuarter.get(key);
    if (!current || date > parseDate(current.created_at)) byClientQuarter.set(key, row);
  }
  const histories = new Map();
  for (const [key, row] of byClientQuarter) {
    const separator = key.lastIndexOf("|");
    const clientId = key.slice(0, separator);
    const quarter = key.slice(separator + 1);
    if (!histories.has(clientId)) histories.set(clientId, []);
    histories.get(clientId).push({ quarter, row });
  }
  const transitions = [];
  for (const [clientId, history] of histories) {
    history.sort((a, b) => a.quarter.localeCompare(b.quarter));
    for (let index = 1; index < history.length; index += 1) {
      const previous = history[index - 1];
      const current = history[index];
      const fromClass = npsClassLabel(previous.row.score);
      const toClass = npsClassLabel(current.row.score);
      if (!fromClass || !toClass || fromClass === toClass) continue;
      const client = clientMap.get(clientId) || {};
      transitions.push({
        clientId,
        clientName: client.name || current.row.client_name || "Não informado",
        clientEmail: client.email || current.row.client_email || "Não informado",
        engineer: client.engenheiro_patrimonial || "Não informado",
        program: client.programa || "Não identificado",
        fromQuarter: previous.quarter,
        toQuarter: current.quarter,
        fromClass,
        toClass,
        fromScore: npsScore(previous.row.score),
        toScore: npsScore(current.row.score),
      });
    }
  }
  return transitions;
}

function npsScore(score) {
  if (score == null || score === "") return null;
  const value = Number(score);
  return Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function csatScore(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value < 1) return null;
  return Math.min(value, 5);
}

function npsLabel(score) {
  if (score == null) return "Sem nota";
  if (score >= 9) return "Promotor";
  if (score >= 7) return "Neutro";
  return "Detrator";
}

function calcNps(scores) {
  const valid = scores.filter((score) => score != null);
  if (!valid.length) return null;
  const promoters = valid.filter((score) => score >= 9).length;
  const detractors = valid.filter((score) => score <= 6).length;
  return round1(pct(promoters, valid.length) - pct(detractors, valid.length));
}

function isCsat(row) {
  return fold(row?.tipo_de_forms).includes("csat");
}

function programFromFormType(value) {
  const text = fold(value);
  if (text.includes("pharus")) return "Pharus";
  if (text.includes("davos")) return "Davos";
  return null;
}

function payloadProgram(row) {
  const raw = row?.raw_payload;
  let payload = raw;
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }
  const hidden = payload?.form_response?.hidden || payload?.hidden || {};
  const definition = payload?.form_response?.definition || payload?.definition || {};
  return programFromFormType([
    row?.tipo_de_forms,
    row?.typeform_form_id,
    hidden.tipo,
    hidden.programa,
    hidden.program,
    hidden.origem,
    hidden.origin,
    definition.title,
  ].filter(Boolean).join(" "));
}

function buildClientProgramMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const clientId = String(row?.id || row?.client_id || "").trim();
    const program = programFromFormType(row?.programa || row?.program);
    if (clientId && program) map.set(clientId, program);
  }
  return map;
}

function resolvedProgram(row, clientPrograms) {
  const clientId = String(row?.client_id || "").trim();
  return (clientId && clientPrograms.get(clientId)) || payloadProgram(row);
}

function dedupeByKey(rows, keyFields) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = keyFields.map((field) => blankToNull(row?.[field])).find(Boolean) || row.id;
    if (!key || seen.has(String(key))) continue;
    seen.add(String(key));
    result.push(row);
  }
  return result;
}

function buildNpsMonthly(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const date = parseDate(row.created_at);
    const score = npsScore(row.score);
    if (!date || score == null) continue;
    const key = monthKey(date);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(score);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, scores]) => ({
      month,
      label: month,
      count: scores.length,
      nps: calcNps(scores),
      promoters: scores.filter((score) => score >= 9).length,
      neutrals: scores.filter((score) => score >= 7 && score <= 8).length,
      detractors: scores.filter((score) => score <= 6).length,
    }));
}

function buildRows(npsRows, csatRows, clientPrograms = new Map()) {
  const byClient = new Map();
  const ensure = (clientId, seed = {}) => {
    const key = clientId || `sem-cliente-${byClient.size + 1}`;
    if (!byClient.has(key)) {
      byClient.set(key, {
        clientId: clientId || null,
        clientName: seed.client_name || seed.clientName || "Não informado",
        clientEmail: seed.client_email || seed.clientEmail || "Não informado",
        npsResponses: 0,
        latestNps: null,
        latestNpsAt: null,
        csatResponses: 0,
        averageCsat: null,
        latestCsatAt: null,
        programs: [],
      });
    }
    return byClient.get(key);
  };

  for (const row of npsRows) {
    const client = ensure(blankToNull(row.client_id), row);
    const program = resolvedProgram(row, clientPrograms);
    if (program && !client.programs.includes(program)) client.programs.push(program);
    const score = npsScore(row.score);
    const date = parseDate(row.created_at);
    client.npsResponses += score == null ? 0 : 1;
    if (score != null && (!client.latestNpsAt || (date && date > parseDate(client.latestNpsAt)))) {
      client.latestNps = score;
      client.latestNpsAt = date ? date.toISOString() : null;
    }
  }

  const csatByClient = new Map();
  for (const row of csatRows) {
    const score = csatScore(row.score);
    if (score == null) continue;
    const client = ensure(blankToNull(row.client_id), row);
    const program = resolvedProgram(row, clientPrograms);
    if (program && !client.programs.includes(program)) client.programs.push(program);
    const key = client.clientId || client.clientEmail || client.clientName;
    if (!csatByClient.has(key)) csatByClient.set(key, []);
    csatByClient.get(key).push(score);
    client.csatResponses += 1;
    const date = parseDate(row.created_at);
    if (!client.latestCsatAt || (date && date > parseDate(client.latestCsatAt))) {
      client.latestCsatAt = date ? date.toISOString() : null;
    }
  }

  for (const client of byClient.values()) {
    const key = client.clientId || client.clientEmail || client.clientName;
    client.averageCsat = average(csatByClient.get(key) || []);
  }

  return [...byClient.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
}

function indicator(indicator, viability, value, total, metric) {
  return {
    indicator,
    viability,
    value,
    total,
    coverage: pct(value || 0, total || 0),
    metric,
  };
}

export function resolveSatisfactionQuarter(npsQuarterly = [], quarterFilter = "latest") {
  const quarters = (npsQuarterly || []).map((item) => item.quarter).filter(Boolean);
  if (!quarters.length) return null;
  if (quarterFilter === "latest" || !quarterFilter || quarterFilter === "all") return quarters.at(-1);
  return quarters.includes(quarterFilter) ? quarterFilter : quarters.at(-1);
}

function rowsInQuarter(rows, selectedQuarter) {
  if (!selectedQuarter) return [];
  return rows.filter((row) => {
    const date = parseDate(row.created_at);
    return date && quarterKey(date) === selectedQuarter;
  });
}

function enrichSatisfactionClientRows(clientRows, clientMap) {
  return clientRows.map((row) => {
    const client = clientMap.get(String(row.clientId || ""));
    return {
      ...row,
      clientName: row.clientName || client?.name || "Não informado",
      clientCode: client?.codigo || null,
      engineer: client?.engenheiro_patrimonial || "Não informado",
      program: client?.programa || null,
      analyticalStatus: client?.status || null,
    };
  });
}

/** Recorte trimestral — mesma regra do handler satisfaction.mjs V1 (latest quarter default). */
export function buildSatisfactionQuarterView({
  allNpsRows = [],
  allCsatRows = [],
  npsSends = [],
  selectedQuarter = null,
  npsQuarterly = [],
  totalClients = 0,
  clientPrograms = new Map(),
  clientMap = new Map(),
} = {}) {
  const quarter = selectedQuarter ?? resolveSatisfactionQuarter(npsQuarterly, "latest");
  const quarterNpsRows = latestNpsPerClient(rowsInQuarter(allNpsRows, quarter));
  const quarterCsatRows = rowsInQuarter(allCsatRows, quarter);
  const npsScores = quarterNpsRows.map((row) => npsScore(row.score)).filter((score) => score != null);
  const csatScores = quarterCsatRows.map((row) => csatScore(row.score)).filter((score) => score != null);
  const latestNpsRow = [...quarterNpsRows].sort((a, b) => parseDate(b.created_at) - parseDate(a.created_at))[0] || null;
  const latestNpsScore = latestNpsRow ? npsScore(latestNpsRow.score) : null;
  const promoters = npsScores.filter((score) => score >= 9).length;
  const neutrals = npsScores.filter((score) => score >= 7 && score <= 8).length;
  const detractors = npsScores.filter((score) => score <= 6).length;
  const satisfiedCsat = csatScores.filter((score) => score === 5).length;
  const clientRows = enrichSatisfactionClientRows(buildRows(quarterNpsRows, quarterCsatRows, clientPrograms), clientMap);
  const feedbackClients = clientRows.filter((row) => row.npsResponses > 0 || row.csatResponses > 0);
  const totalNpsResponses = quarterNpsRows.length;

  return {
    selectedQuarter: quarter,
    summary: {
      nps: calcNps(npsScores),
      latestNps: latestNpsScore,
      latestNpsAt: latestNpsRow?.created_at || null,
      npsResponses: totalNpsResponses,
      npsDistinctClients: quarterNpsRows.length,
      npsSends: npsSends.length,
      npsResponseRate: pct(totalNpsResponses, npsSends.length),
      promoters,
      neutrals,
      detractors,
      csatAverage: average(csatScores),
      csatResponses: quarterCsatRows.length,
      csatSatisfied: satisfiedCsat,
      csatSatisfiedPercent: pct(satisfiedCsat, csatScores.length),
      clientsWithFeedback: feedbackClients.length,
      feedbackCoveragePercent: pct(feedbackClients.length, totalClients),
      npsCoveragePercent: pct(quarterNpsRows.length, totalClients),
    },
    distributions: {
      npsClassification: [
        { label: "Promotores", count: promoters, percent: pct(promoters, npsScores.length) },
        { label: "Neutros", count: neutrals, percent: pct(neutrals, npsScores.length) },
        { label: "Detratores", count: detractors, percent: pct(detractors, npsScores.length) },
      ],
      csatSatisfaction: [
        { label: "Satisfeitos (5)", count: satisfiedCsat, percent: pct(satisfiedCsat, csatScores.length) },
        {
          label: "Não satisfeitos (1-4)",
          count: Math.max(0, csatScores.length - satisfiedCsat),
          percent: pct(Math.max(0, csatScores.length - satisfiedCsat), csatScores.length),
        },
      ],
    },
    clients: clientRows,
  };
}

export function buildSatisfactionPayload({
  clients = [],
  clientMap = new Map(),
  npsRowsRaw = [],
  csatRowsRaw = [],
  npsSends = [],
  selectedQuarter = null,
} = {}) {
  const totalClients = clients.length;
  const clientPrograms = buildClientProgramMap(clients);
  const allNpsRows = dedupeByKey(npsRowsRaw, ["typeform_response_id", "id"]).filter((row) => npsScore(row.score) != null);
  const allCsatRows = dedupeByKey(csatRowsRaw.filter(isCsat), ["typeform_response_id", "form_response_id", "id"]).filter((row) => csatScore(row.score) != null);
  const npsMonthly = buildNpsMonthly(allNpsRows);
  const npsQuarterly = buildNpsQuarterly(allNpsRows);
  const npsTransitions = buildNpsTransitions(allNpsRows, clientMap);
  const quarter = selectedQuarter ?? resolveSatisfactionQuarter(npsQuarterly, "latest");
  const scoped = buildSatisfactionQuarterView({
    allNpsRows,
    allCsatRows,
    npsSends,
    selectedQuarter: quarter,
    npsQuarterly,
    totalClients,
    clientPrograms,
    clientMap,
  });

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      quarter: scoped.selectedQuarter,
    },
    methodology: {
      npsRule:
        "Última resposta NPS válida por cliente no trimestre selecionado (created_at desc), após dedupe por typeform_response_id/id — mesma regra da tela Pesquisa de Satisfação V1.",
      npsHelperNote:
        "O helper nps-metrics (EP/Análises) usa submitted_at desc; esta página mantém a regra consolidada da tela de satisfação.",
      csatRule: "Média de csat_responses.score com tipo_de_forms contendo CSAT no trimestre; satisfeito = 5.",
      cesRule: "CES não possui fonte estruturada — indicador ausente do Dash Kids.",
    },
    population: {
      totalClients,
      respondents: scoped.summary.clientsWithFeedback,
      npsClients: scoped.summary.npsDistinctClients,
    },
    summary: scoped.summary,
    distributions: {
      ...scoped.distributions,
      npsMonthly,
      npsQuarterly,
    },
    npsTransitions,
    clients: scoped.clients,
    scopeInputs: {
      allNpsRows,
      allCsatRows,
      npsSends,
      npsQuarterly,
      totalClients,
      clientPrograms: [...clientPrograms.entries()],
      clientBasics: clients.map((client) => [
        String(client.id),
        {
          codigo: client.codigo,
          name: client.name,
          engenheiro_patrimonial: client.engenheiro_patrimonial,
          programa: client.programa,
          status: client.status,
        },
      ]),
    },
    warnings: [
      "Cobertura NPS baixa sobre a carteira — interpretar com cautela.",
      "CSAT pode ter denominador indisponível em parte dos recortes.",
    ],
    quality: { usedFields: USED_FIELDS },
  };
}

export async function computeSatisfactionPayload() {
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }
  const [clientsRaw, npsRowsRaw, csatRowsRaw, npsSends] = await Promise.all([
    fetchTable("clients", "id,codigo,name,email,status,engenheiro_patrimonial,programa", "id.asc"),
    fetchTable(
      "nps_responses",
      "id,typeform_response_id,typeform_form_id,client_id,client_name,client_email,tipo_de_forms,score,comment,raw_payload,created_at",
      "created_at.asc",
    ),
    fetchTable(
      "csat_responses",
      "id,typeform_response_id,form_response_id,typeform_form_id,client_id,client_name,client_email,tipo_de_forms,score,comment,raw_payload,created_at,meeting_date",
      "created_at.asc",
    ),
    fetchTable("nps_sends", "id,client_id,sent_at,created_at", "created_at.asc"),
  ]);
  const removedIds = excludedClientIds(clientsRaw);
  const clients = filterExcludedClients(clientsRaw);
  const clientMap = new Map(clients.map((c) => [String(c.id), c]));
  const npsRows = npsRowsRaw.filter((row) => !removedIds.has(String(row.client_id || "")));
  const csatRows = csatRowsRaw.filter((row) => !removedIds.has(String(row.client_id || "")));
  return buildSatisfactionPayload({ clients, clientMap, npsRowsRaw: npsRows, csatRowsRaw: csatRows, npsSends });
}

export function toPublicSatisfactionPayload(payload) {
  return payload;
}
