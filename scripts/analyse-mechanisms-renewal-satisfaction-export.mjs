#!/usr/bin/env node
/**
 * Exportação read-only: mecanismos × renovação × NPS × CSAT (BASE QV).
 * Não altera banco, API ou dashboard.
 *
 * Uso: node scripts/analyse-mechanisms-renewal-satisfaction-export.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/data/supabase-rest.mjs";
import { dataConfigurationError } from "../lib/env.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatusFromMaps,
} from "../lib/analytics/analytical-cancellation.mjs";
import { calculateClientSegment } from "../lib/analytics/client-segment.mjs";
import {
  calendarDateFromValue,
  renewalFromClient,
} from "../lib/analytics/client-cycle-renewal.mjs";
import { excludedClientIds, filterExcludedClients } from "../lib/analytics/data-exclusions.mjs";
import { resolveClientProgram } from "../lib/analytics/filters/program.mjs";
import { computeMechanismsPayload } from "../lib/analytics/mechanisms.mjs";
import { defaultMechanismFilters, filterMechanismClients } from "../lib/analytics/mechanism-filters.mjs";
import {
  computeBaseQvMechanismAudit,
  dedupeClientMechanisms,
  foldToken,
  summarizeMechanismRows,
} from "../lib/analytics/mechanism-metrics.mjs";
import {
  isBaseQvImplementedRawStatus,
  normalizeBaseQvMechanismStatus,
} from "../lib/analytics/mechanisms/mechanism-status.mjs";
import { blankToNull, parseDate } from "../lib/analytics/meeting-metrics.mjs";
import { classifyNpsScore, dedupeNpsResponses } from "../lib/analytics/nps-metrics.mjs";
import { buildRenewalPayload } from "../lib/analytics/renewal.mjs";
import { computeRenewalPayload } from "../lib/analytics/renewal.mjs";
import {
  buildSatisfactionPayload,
  computeSatisfactionPayload,
} from "../lib/analytics/satisfaction.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "exports");

const CLIENT_SELECT =
  "id,codigo,name,status,engenheiro_patrimonial,segmentacao,programa,data_inicio_ciclo,data_fim_ciclo,ciclo,created_at,data_churn,email,phone,cpf_digits,phone_digits,linked_user_id,davos_contrato_assinado";
const CM_SELECT =
  "id,client_id,mecanismo_id,status,implemented_at,created_at,no_plano,sequence,valor_aplicado,source";
const MEC_SELECT = "id,name,categoria,mercado,programa,status,codigo";
const FINANCIAL_SELECT =
  "id,client_id,reserva_liquidez,ultimo_aporte,ultima_renda_mensal,valor_imoveis_quitados,cheque_especial,parcelamento_cartao,credito_pessoal,credito_consignado,updated_at";
const NPS_SELECT =
  "id,typeform_response_id,typeform_form_id,client_id,client_name,client_email,tipo_de_forms,score,comment,created_at,submitted_at";
const CSAT_SELECT =
  "id,typeform_response_id,form_response_id,typeform_form_id,client_id,client_name,client_email,tipo_de_forms,score,comment,created_at,meeting_date";

const LONG_CSV = "analise_mecanismos_renovacao_satisfacao.csv";
const WIDE_CSV = "analise_mecanismos_clientes_wide.csv";
const NPS_HIST_CSV = "analise_nps_historico.csv";
const CSAT_HIST_CSV = "analise_csat_historico.csv";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function loadEnv() {
  const merged = { ...parseEnvFile(join(ROOT, ".env")), ...parseEnvFile(join(ROOT, ".env.local")) };
  for (const [key, value] of Object.entries(merged)) {
    if (!String(process.env[key] || "").trim()) process.env[key] = value;
  }
}

function csvEscape(value) {
  if (value == null || value === undefined) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function formatCsvValue(value) {
  if (value == null || value === undefined) return "";
  if (typeof value === "object") return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  return value;
}

function writeCsv(filePath, headers, records) {
  const lines = [headers.map(csvEscape).join(";")];
  for (const record of records) {
    lines.push(headers.map((h) => csvEscape(formatCsvValue(record[h]))).join(";"));
  }
  writeFileSync(filePath, `\uFEFF${lines.join("\n")}\r\n`, "utf8");
}

function mechanismSlug(name) {
  const token = foldToken(name || "mecanismo");
  const slug = token.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return slug || "mecanismo";
}

function npsClassPt(score) {
  const cls = classifyNpsScore(score);
  if (cls === "promoter") return "promotor";
  if (cls === "passive") return "neutro";
  if (cls === "detractor") return "detrator";
  return "";
}

function foldForms(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function csatScoreValue(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value < 1) return null;
  return Math.min(value, 5);
}

function isCsatRow(row) {
  return foldForms(row?.tipo_de_forms).includes("csat");
}

function dedupeByKey(rows, keyFields) {
  const seen = new Set();
  const result = [];
  for (const row of rows || []) {
    const key = keyFields.map((field) => blankToNull(row?.[field])).find(Boolean) || row.id;
    if (!key || seen.has(String(key))) continue;
    seen.add(String(key));
    result.push(row);
  }
  return result;
}

function npsScoreValue(score) {
  if (score == null || score === "") return null;
  const value = Number(score);
  return Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

/** Mesma validação de linha que dedupeNpsResponses (para contagem por cliente). */
function isValidNpsRow(row) {
  const clientId = row?.client_id != null ? String(row.client_id) : "";
  if (!clientId) return false;
  if (npsScoreValue(row.score) == null) return false;
  const tipo = String(row.tipo_de_forms || "").toUpperCase();
  if (tipo && !tipo.startsWith("NPS")) return false;
  return true;
}

function countNpsResponsesByClient(npsRows) {
  const counts = new Map();
  for (const row of npsRows || []) {
    if (!isValidNpsRow(row)) continue;
    const id = String(row.client_id);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function prepareAllCsatRows(csatRowsRaw) {
  return dedupeByKey(csatRowsRaw.filter(isCsatRow), ["typeform_response_id", "form_response_id", "id"]).filter(
    (row) => csatScoreValue(row.score) != null,
  );
}

function prepareAllNpsRows(npsRowsRaw) {
  return dedupeByKey(npsRowsRaw, ["typeform_response_id", "id"]).filter((row) => npsScoreValue(row.score) != null);
}

/** Agregação CSAT por cliente — mesma lógica de buildRows (satisfaction.mjs), escopo all-time. */
function aggregateCsatByClient(allCsatRows) {
  const byClient = new Map();
  for (const row of allCsatRows || []) {
    const clientId = blankToNull(row.client_id);
    if (!clientId) continue;
    const score = csatScoreValue(row.score);
    if (score == null) continue;
    const key = String(clientId);
    if (!byClient.has(key)) {
      byClient.set(key, {
        csatResponses: 0,
        scores: [],
        latestCsat: null,
        latestCsatDate: null,
      });
    }
    const bucket = byClient.get(key);
    bucket.csatResponses += 1;
    bucket.scores.push(score);
    const date = parseDate(row.created_at);
    if (!bucket.latestCsatDate || (date && date > parseDate(bucket.latestCsatDate))) {
      bucket.latestCsatDate = date ? date.toISOString() : bucket.latestCsatDate;
      bucket.latestCsat = score;
    }
  }
  for (const bucket of byClient.values()) {
    const sum = bucket.scores.reduce((a, b) => a + b, 0);
    bucket.averageCsat = bucket.scores.length ? Math.round((sum / bucket.scores.length) * 10) / 10 : null;
    bucket.csatSatisfied = bucket.latestCsat === 5;
  }
  return byClient;
}

function buildFinancialLookup(financialRows) {
  const map = new Map();
  for (const row of financialRows || []) {
    const clientId = blankToNull(row.client_id);
    if (!clientId) continue;
    const updated = parseDate(row.updated_at) || new Date(0);
    const current = map.get(String(clientId));
    if (current && current.updated >= updated) continue;
    map.set(String(clientId), {
      updated,
      monthlyIncome: row.ultima_renda_mensal,
      liquidityReserve: row.reserva_liquidez,
      lastContribution: row.ultimo_aporte,
      paidPropertiesValue: row.valor_imoveis_quitados,
      debt: {
        cheque_especial: row.cheque_especial,
        parcelamento_cartao: row.parcelamento_cartao,
        credito_pessoal: row.credito_pessoal,
        credito_consignado: row.credito_consignado,
      },
    });
  }
  return map;
}

function npsLatestDate(row) {
  if (!row) return null;
  const submitted = calendarDateFromValue(row.submittedAt);
  if (submitted) return submitted;
  return calendarDateFromValue(row.createdAt);
}

function clientContext(client, cancelMap, financialMap) {
  const clientId = String(client.id);
  const cancelInfo = cancelMap.get(clientId) || null;
  const analyticalStatus = resolveAnalyticalStatusFromMaps(client?.status, cancelInfo);
  const fin = financialMap.get(clientId) || null;
  const segmentInfo = calculateClientSegment(
    fin
      ? {
          monthlyIncome: fin.monthlyIncome,
          liquidityReserve: fin.liquidityReserve,
          lastContribution: fin.lastContribution,
          paidPropertiesValue: fin.paidPropertiesValue,
        }
      : null,
    fin?.debt || null,
  );
  const renewal = renewalFromClient(client);
  return {
    client_id: clientId,
    client_code: blankToNull(client.codigo),
    client_name: blankToNull(client.name) || "Não informado",
    analytical_status: analyticalStatus,
    ep: blankToNull(client.engenheiro_patrimonial) ?? "Não informado",
    segment: segmentInfo.segment || "Dados insuficientes",
    program: resolveClientProgram(client),
    entry_date: calendarDateFromValue(client.data_inicio_ciclo),
    cycle_end_date: calendarDateFromValue(client.data_fim_ciclo),
    current_cycle: renewal.currentCycle,
    renewal_count: renewal.renewalCount,
    renewed: renewal.hasRenewed,
    cycle_valid: renewal.valid,
  };
}

async function fetchBaseQvData() {
  const [clientsRaw, cmRaw, mechRaw, cancelRaw, finRaw, npsRaw, csatRaw] = await Promise.all([
    fetchAllRows({ table: "clients", select: CLIENT_SELECT }),
    fetchAllRows({ table: "client_mecanismos", select: CM_SELECT }),
    fetchAllRows({ table: "mecanismos", select: MEC_SELECT }),
    fetchAllRows({ table: "cancellations", select: ANALYTICAL_CANCEL_SELECT }),
    fetchAllRows({ table: "client_financial_data", select: FINANCIAL_SELECT }),
    fetchAllRows({ table: "nps_responses", select: NPS_SELECT, order: "created_at.asc" }),
    fetchAllRows({ table: "csat_responses", select: CSAT_SELECT, order: "created_at.asc" }),
  ]);
  return { clientsRaw, cmRaw, mechRaw, cancelRaw, finRaw, npsRaw, csatRaw };
}

function printValidations(stats) {
  console.log("\n=== Validações (export BASE QV) ===");
  const lines = [
    ["1. Clientes brutos", stats.rawClients],
    ["2. Clientes após exclusões", stats.clientsAfterExclusions],
    ["3. Clientes com ciclo válido", stats.clientsCycleValid],
    ["4. Clientes renovados", stats.clientsRenewed],
    ["5. Clientes sem renovação (ciclo válido)", stats.clientsNotRenewed],
    ["6. Quantidade bruta client_mecanismos", stats.rawCmRows],
    ["7. Pares cliente × mecanismo após dedupe", stats.dedupedPairs],
    ["8. Clientes com ≥1 mecanismo", stats.clientsWithAnyMechanism],
    ["9. Clientes com ≥1 mecanismo IMPLEMENTADO", stats.clientsWithImplemented],
    ["10. Mecanismos distintos implementados (pares)", stats.distinctImplementedMechanisms],
    ["11. Clientes com NPS (dedupe oficial)", stats.clientsWithNps],
    ["12. Clientes com CSAT", stats.clientsWithCsat],
    ["13. Vínculos implementados sem implemented_at", stats.implementedWithoutDate],
    ["14. Duplicatas cliente × mecanismo pós-dedupe", stats.duplicatePairsAfterDedupe],
  ];
  for (const [label, value] of lines) {
    console.log(`${label}: ${value}`);
  }
}

function printPageComparison(comparison) {
  console.log("\n=== Comparação com páginas (filtros equivalentes a Todos onde aplicável) ===");
  for (const block of comparison) {
    console.log(`\n--- ${block.page} ---`);
    for (const line of block.lines) {
      console.log(line);
    }
    if (block.notes?.length) {
      for (const note of block.notes) {
        console.log(`  ⚠ ${note}`);
      }
    }
  }
}

async function main() {
  loadEnv();
  const configError = dataConfigurationError();
  if (configError) {
    console.error(configError);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const { clientsRaw, cmRaw, mechRaw, cancelRaw, finRaw, npsRaw, csatRaw } = await fetchBaseQvData();

  const removedIds = excludedClientIds(clientsRaw);
  const clients = filterExcludedClients(clientsRaw);
  const cancellations = (cancelRaw || []).filter((row) => !removedIds.has(String(row.client_id || "")));
  const financialRows = (finRaw || []).filter((row) => !removedIds.has(String(row.client_id || "")));
  const cmRowsAll = (cmRaw || []).filter((row) => blankToNull(row.client_id));
  const cmRows = cmRowsAll.filter((row) => !removedIds.has(String(row.client_id || "")));
  const npsRows = (npsRaw || []).filter((row) => !removedIds.has(String(row.client_id || "")));
  const csatRows = (csatRaw || []).filter((row) => !removedIds.has(String(row.client_id || "")));

  const mechMap = new Map((mechRaw || []).map((m) => [String(m.id), m]));
  const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations, clients);
  const financialMap = buildFinancialLookup(financialRows);

  const { rows: dedupedCm, duplicatePairs } = (() => {
    const result = dedupeClientMechanisms(cmRows);
    return { rows: result.rows, duplicatePairs: result.duplicatePairs ?? 0 };
  })();

  const pairKeys = new Set();
  let duplicateAfterDedupe = 0;
  for (const row of dedupedCm) {
    const key = `${row.client_id}|${row.mecanismo_id}`;
    if (pairKeys.has(key)) duplicateAfterDedupe += 1;
    pairKeys.add(key);
  }

  const byClientMechanisms = new Map();
  for (const row of dedupedCm) {
    const clientId = String(row.client_id);
    if (!byClientMechanisms.has(clientId)) byClientMechanisms.set(clientId, []);
    byClientMechanisms.get(clientId).push(row);
  }

  const { rows: npsDeduped, meta: npsMeta } = dedupeNpsResponses(npsRows);
  const npsByClient = new Map(npsDeduped.map((r) => [r.clientId, r]));
  const npsCountByClient = countNpsResponsesByClient(npsRows);

  const allNpsRows = prepareAllNpsRows(npsRows);
  const allCsatRows = prepareAllCsatRows(csatRows);
  const csatByClient = aggregateCsatByClient(allCsatRows);

  let implementedWithoutDate = 0;
  const implementedMechanismIds = new Set();
  for (const row of dedupedCm) {
    if (!isBaseQvImplementedRawStatus(row.status)) continue;
    implementedMechanismIds.add(String(row.mecanismo_id));
    if (!blankToNull(row.implemented_at)) implementedWithoutDate += 1;
  }

  const clientsWithAnyMechanism = byClientMechanisms.size;
  const clientsWithImplemented = [...byClientMechanisms.entries()].filter(([, rows]) =>
    rows.some((r) => isBaseQvImplementedRawStatus(r.status)),
  ).length;

  let clientsCycleValid = 0;
  let clientsRenewed = 0;
  let clientsNotRenewed = 0;
  for (const client of clients) {
    const r = renewalFromClient(client);
    if (r.valid) {
      clientsCycleValid += 1;
      if (r.hasRenewed) clientsRenewed += 1;
      else clientsNotRenewed += 1;
    }
  }

  const stats = {
    rawClients: clientsRaw.length,
    clientsAfterExclusions: clients.length,
    clientsCycleValid,
    clientsRenewed,
    clientsNotRenewed,
    rawCmRows: cmRows.length,
    dedupedPairs: dedupedCm.length,
    clientsWithAnyMechanism,
    clientsWithImplemented,
    distinctImplementedMechanisms: implementedMechanismIds.size,
    clientsWithNps: npsDeduped.length,
    clientsWithCsat: csatByClient.size,
    implementedWithoutDate,
    duplicatePairsAfterDedupe: duplicateAfterDedupe,
  };
  printValidations(stats);

  function satisfactionFields(clientId) {
    const nps = npsByClient.get(clientId);
    const csat = csatByClient.get(clientId);
    const latestNps = nps?.score ?? null;
    return {
      latest_nps: latestNps,
      latest_nps_date: nps ? npsLatestDate(nps) : null,
      latest_nps_class: latestNps != null ? npsClassPt(latestNps) : "",
      nps_response_count: npsCountByClient.get(clientId) || 0,
      latest_csat: csat?.latestCsat ?? null,
      average_csat: csat?.averageCsat ?? null,
      latest_csat_date: csat?.latestCsatDate ? calendarDateFromValue(csat.latestCsatDate) : null,
      csat_response_count: csat?.csatResponses || 0,
      csat_satisfied: csat ? csat.csatSatisfied : false,
      has_nps: Boolean(nps),
      has_csat: Boolean(csat),
    };
  }

  const longHeaders = [
    "client_id",
    "client_code",
    "client_name",
    "analytical_status",
    "ep",
    "segment",
    "program",
    "entry_date",
    "cycle_end_date",
    "current_cycle",
    "renewal_count",
    "renewed",
    "cycle_valid",
    "mechanism_id",
    "mechanism_name",
    "mechanism_category",
    "mechanism_status",
    "mechanism_implemented",
    "mechanism_link_date",
    "mechanism_implementation_date",
    "mechanism_source",
    "total_implemented_mechanisms",
    "total_mechanism_links",
    "has_any_mechanism",
    "latest_nps",
    "latest_nps_date",
    "latest_nps_class",
    "nps_response_count",
    "latest_csat",
    "average_csat",
    "latest_csat_date",
    "csat_response_count",
    "csat_satisfied",
    "has_mechanism_date",
    "has_nps",
    "has_csat",
  ];

  const longRecords = [];
  const wideBaseByClient = new Map();
  const implementedSlugsByClient = new Map();

  for (const client of clients) {
    const ctx = clientContext(client, cancelMap, financialMap);
    const links = byClientMechanisms.get(ctx.client_id) || [];
    const totalLinks = links.length;
    const totalImplemented = links.filter((r) => isBaseQvImplementedRawStatus(r.status)).length;
    const hasAny = totalLinks > 0;
    const sat = satisfactionFields(ctx.client_id);

    wideBaseByClient.set(ctx.client_id, { ...ctx, ...sat, total_implemented_mechanisms: totalImplemented });
    implementedSlugsByClient.set(ctx.client_id, new Set());

    const shared = {
      ...ctx,
      total_implemented_mechanisms: totalImplemented,
      total_mechanism_links: totalLinks,
      has_any_mechanism: hasAny,
      ...sat,
    };

    if (!links.length) {
      longRecords.push({
        ...shared,
        mechanism_id: "",
        mechanism_name: "",
        mechanism_category: "",
        mechanism_status: "",
        mechanism_implemented: false,
        mechanism_link_date: "",
        mechanism_implementation_date: "",
        mechanism_source: "",
        has_mechanism_date: false,
      });
      continue;
    }

    for (const link of links) {
      const mech = mechMap.get(String(link.mecanismo_id));
      const statusInfo = normalizeBaseQvMechanismStatus(link.status);
      const implemented = statusInfo.label === "Implementado";
      const implDate = parseDate(link.implemented_at);
      const linkDate = parseDate(link.created_at);
      const mechName = blankToNull(mech?.name) || "Mecanismo sem nome";
      if (implemented) {
        implementedSlugsByClient.get(ctx.client_id).add(mechanismSlug(mechName));
      }
      longRecords.push({
        ...shared,
        mechanism_id: String(link.mecanismo_id || ""),
        mechanism_name: mechName,
        mechanism_category: blankToNull(mech?.categoria) ?? "",
        mechanism_status: statusInfo.label,
        mechanism_implemented: implemented,
        mechanism_link_date: linkDate ? calendarDateFromValue(linkDate) : "",
        mechanism_implementation_date: implDate ? calendarDateFromValue(implDate) : "",
        mechanism_source: blankToNull(link.source) ?? "",
        has_mechanism_date: Boolean(implDate),
      });
    }
  }

  const catalogSlugs = [...mechMap.values()]
    .map((m) => ({ id: String(m.id), name: blankToNull(m.name) || "Mecanismo sem nome", slug: mechanismSlug(m.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const slugColumns = [];
  const slugSeen = new Set();
  for (const item of catalogSlugs) {
    let col = `implemented_${item.slug}`;
    let n = 2;
    while (slugSeen.has(col)) {
      col = `implemented_${item.slug}_${n}`;
      n += 1;
    }
    slugSeen.add(col);
    slugColumns.push({ mechanismId: item.id, name: item.name, column: col, slug: item.slug });
  }

  const wideHeaders = [
    "client_id",
    "client_code",
    "client_name",
    "analytical_status",
    "ep",
    "segment",
    "program",
    "entry_date",
    "cycle_end_date",
    "current_cycle",
    "renewal_count",
    "renewed",
    "cycle_valid",
    "total_implemented_mechanisms",
    "total_mechanism_links",
    "has_any_mechanism",
    "latest_nps",
    "latest_nps_date",
    "latest_nps_class",
    "nps_response_count",
    "latest_csat",
    "average_csat",
    "latest_csat_date",
    "csat_response_count",
    "csat_satisfied",
    "has_nps",
    "has_csat",
    ...slugColumns.map((c) => c.column),
  ];

  const wideRecords = [];
  for (const [clientId, base] of wideBaseByClient.entries()) {
    const implSlugs = implementedSlugsByClient.get(clientId) || new Set();
    const row = { ...base };
    for (const col of slugColumns) {
      row[col.column] = implSlugs.has(col.slug);
    }
    wideRecords.push(row);
  }

  const npsHistHeaders = [
    "response_id",
    "client_id",
    "client_code",
    "score",
    "nps_class",
    "created_at",
    "submitted_at",
    "tipo_de_forms",
    "typeform_response_id",
  ];
  const clientCodeMap = new Map(clients.map((c) => [String(c.id), blankToNull(c.codigo) ?? ""]));
  const npsHistRecords = allNpsRows.map((row) => {
    const score = npsScoreValue(row.score);
    return {
      response_id: row.id ?? "",
      client_id: row.client_id ?? "",
      client_code: clientCodeMap.get(String(row.client_id)) ?? "",
      score,
      nps_class: score != null ? npsClassPt(score) : "",
      created_at: row.created_at ?? "",
      submitted_at: row.submitted_at ?? "",
      tipo_de_forms: row.tipo_de_forms ?? "",
      typeform_response_id: row.typeform_response_id ?? "",
    };
  });

  const csatHistHeaders = [
    "response_id",
    "client_id",
    "client_code",
    "score",
    "csat_satisfied",
    "created_at",
    "meeting_date",
    "tipo_de_forms",
    "typeform_response_id",
  ];
  const csatHistRecords = allCsatRows.map((row) => {
    const score = csatScoreValue(row.score);
    return {
      response_id: row.id ?? "",
      client_id: row.client_id ?? "",
      client_code: clientCodeMap.get(String(row.client_id)) ?? "",
      score,
      csat_satisfied: score === 5,
      created_at: row.created_at ?? "",
      meeting_date: row.meeting_date ?? "",
      tipo_de_forms: row.tipo_de_forms ?? "",
      typeform_response_id: row.typeform_response_id ?? "",
    };
  });

  const paths = {
    long: join(OUT_DIR, LONG_CSV),
    wide: join(OUT_DIR, WIDE_CSV),
    npsHist: join(OUT_DIR, NPS_HIST_CSV),
    csatHist: join(OUT_DIR, CSAT_HIST_CSV),
  };

  writeCsv(paths.long, longHeaders, longRecords);
  writeCsv(paths.wide, wideHeaders, wideRecords);
  writeCsv(paths.npsHist, npsHistHeaders, npsHistRecords);
  writeCsv(paths.csatHist, csatHistHeaders, csatHistRecords);

  console.log("\n=== Arquivos gerados ===");
  for (const [label, p] of Object.entries(paths)) {
    const size = statSync(p).size;
    console.log(`${label}: ${p} (${size} bytes)`);
  }
  console.log(`Linhas long: ${longRecords.length} · clientes: ${clients.length} · colunas wide mecanismos: ${slugColumns.length}`);

  const baseAudit = computeBaseQvMechanismAudit(cmRows);
  const renewalPayload = buildRenewalPayload({ clients, cancellations, financialRows });
  const satisfactionPayload = buildSatisfactionPayload({
    clients,
    clientMap: new Map(clients.map((c) => [String(c.id), c])),
    npsRowsRaw: npsRows,
    csatRowsRaw: csatRows,
  });

  let mechanismsPagePayload = null;
  try {
    mechanismsPagePayload = await computeMechanismsPayload();
  } catch (error) {
    console.warn("Não foi possível carregar payload consolidado de Mecanismos:", error.message);
  }

  const filtersAll = { ...defaultMechanismFilters(), status: "all" };
  const comparison = [];

  comparison.push({
    page: "Mecanismos",
    lines: [
      `Export BASE QV — clientes com ≥1 vínculo: ${stats.clientsWithAnyMechanism} (audit: ${baseAudit.clientsWithMechanisms})`,
      `Export BASE QV — clientes com ≥1 implementado: ${stats.clientsWithImplemented} (audit: ${baseAudit.clientsWithImplementedMechanism})`,
      `Export BASE QV — vínculos dedupe: ${stats.dedupedPairs} (audit links: ${baseAudit.links})`,
    ],
    notes: [],
  });

  if (mechanismsPagePayload) {
    const filtered = filterMechanismClients(mechanismsPagePayload.clients || [], filtersAll);
    const summary = summarizeMechanismRows(filtered, {
      catalog: mechanismsPagePayload.catalog || [],
      portfolio: mechanismsPagePayload.portfolio || [],
      consolidationQuality: mechanismsPagePayload.metadata?.consolidationQuality,
      pharusAvailable: Boolean(mechanismsPagePayload.metadata?.pharusConsulted),
    });
    comparison[0].lines.push(
      `Página (status=Todos) — clientes com mecanismo (consolidado): ${summary.displayedCombinedTotal ?? "—"}`,
      `Página (status=Todos) — clientes implementados (consolidado): ${summary.clientsWithImplementedMechanism ?? "—"}`,
    );
    comparison[0].notes.push(
      "Este export usa somente BASE QV; a página soma App Pharus quando disponível (KPIs consolidados).",
      `BASE QV na página (audit local do export): vínculos=${baseAudit.links}, clientes com vínculo=${baseAudit.clientsWithMechanisms}, implementados=${baseAudit.clientsWithImplementedMechanism}.`,
    );
  }

  comparison.push({
    page: "Renovação",
    lines: [
      `Export — clientes ciclo válido: ${stats.clientsCycleValid} · renovados: ${stats.clientsRenewed}`,
      `Página buildRenewalPayload — elegíveis: ${renewalPayload.population?.eligibleClients ?? "—"} · renovados: ${renewalPayload.summary?.renewedClients ?? "—"}`,
    ],
    notes: [],
  });

  const satOfficial = satisfactionPayload.benchmarks?.total;
  comparison.push({
    page: "Satisfação",
    lines: [
      `Export — clientes com NPS (dedupe): ${stats.clientsWithNps} (meta: ${npsMeta.respondentClients})`,
      `Página — respondentes NPS oficial: ${satOfficial?.n ?? satisfactionPayload.summary?.npsDistinctClients ?? "—"}`,
      `Export — clientes com CSAT (all-time agregado): ${stats.clientsWithCsat}`,
      `Página — CSAT no trimestre selecionado (${satisfactionPayload.filters?.quarter ?? "—"}): ${satisfactionPayload.summary?.csatResponses ?? "—"} respostas`,
    ],
    notes: [
      "CSAT do export agrega all-time (como histórico bruto); cards trimestrais da página podem diferir.",
    ],
  });

  printPageComparison(comparison);

  try {
    const liveRenewal = await computeRenewalPayload();
    const liveSat = await computeSatisfactionPayload();
    if (liveRenewal.summary?.renewedClients !== renewalPayload.summary?.renewedClients) {
      console.warn(
        "\n⚠ Renovação: divergência entre build local e computeRenewalPayload — investigar fetch/context.",
      );
    }
    if ((liveSat.benchmarks?.total?.n ?? 0) !== (satOfficial?.n ?? 0)) {
      console.warn("\n⚠ Satisfação: divergência entre build local e computeSatisfactionPayload.");
    }
  } catch {
    /* optional double-check */
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
