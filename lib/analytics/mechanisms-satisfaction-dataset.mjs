/**
 * Base analítica compartilhada: mecanismos × NPS × CSAT × renovação (BASE QV).
 * Mesma lógica do export scripts/analyse-mechanisms-renewal-satisfaction-export.mjs
 */
import { fetchAllRows } from "../data/supabase-rest.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatusFromMaps,
} from "./analytical-cancellation.mjs";
import { calculateClientSegment } from "./client-segment.mjs";
import { calendarDateFromValue, renewalFromClient } from "./client-cycle-renewal.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import { resolveClientProgram } from "./filters/program.mjs";
import { dedupeClientMechanisms, foldToken } from "./mechanism-metrics.mjs";
import {
  isBaseQvImplementedRawStatus,
  normalizeBaseQvMechanismStatus,
} from "./mechanisms/mechanism-status.mjs";
import { blankToNull, parseDate } from "./meeting-metrics.mjs";
import { classifyNpsScore, dedupeNpsResponses } from "./nps-metrics.mjs";

export const MECH_SAT_CLIENT_SELECT =
  "id,codigo,name,status,engenheiro_patrimonial,segmentacao,programa,data_inicio_ciclo,data_fim_ciclo,ciclo,created_at,data_churn,email,phone,cpf_digits,phone_digits,linked_user_id,davos_contrato_assinado";
export const MECH_SAT_CM_SELECT =
  "id,client_id,mecanismo_id,status,implemented_at,created_at,no_plano,sequence,valor_aplicado,source";
export const MECH_SAT_MEC_SELECT = "id,name,categoria,mercado,programa,status,codigo";
export const MECH_SAT_FINANCIAL_SELECT =
  "id,client_id,reserva_liquidez,ultimo_aporte,ultima_renda_mensal,valor_imoveis_quitados,cheque_especial,parcelamento_cartao,credito_pessoal,credito_consignado,updated_at";
export const MECH_SAT_NPS_SELECT =
  "id,typeform_response_id,typeform_form_id,client_id,client_name,client_email,tipo_de_forms,score,comment,created_at,submitted_at";
export const MECH_SAT_CSAT_SELECT =
  "id,typeform_response_id,form_response_id,typeform_form_id,client_id,client_name,client_email,tipo_de_forms,score,comment,created_at,meeting_date";

export function mechanismSlugFromName(name) {
  const token = foldToken(name || "mecanismo");
  const slug = token.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return slug || "mecanismo";
}

export function npsClassLabelPt(score) {
  const cls = classifyNpsScore(score);
  if (cls === "promoter") return "promotor";
  if (cls === "passive") return "neutro";
  if (cls === "detractor") return "detrator";
  return null;
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

function aggregateCsatByClient(allCsatRows) {
  const byClient = new Map();
  for (const row of allCsatRows || []) {
    const clientId = blankToNull(row.client_id);
    if (!clientId) continue;
    const score = csatScoreValue(row.score);
    if (score == null) continue;
    const key = String(clientId);
    if (!byClient.has(key)) {
      byClient.set(key, { csatResponses: 0, scores: [], latestCsat: null, latestCsatDate: null });
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

export async function fetchMechanismsSatisfactionRawData() {
  const [clientsRaw, cmRaw, mechRaw, cancelRaw, finRaw, npsRaw, csatRaw] = await Promise.all([
    fetchAllRows({ table: "clients", select: MECH_SAT_CLIENT_SELECT }),
    fetchAllRows({ table: "client_mecanismos", select: MECH_SAT_CM_SELECT }),
    fetchAllRows({ table: "mecanismos", select: MECH_SAT_MEC_SELECT }),
    fetchAllRows({ table: "cancellations", select: ANALYTICAL_CANCEL_SELECT }),
    fetchAllRows({ table: "client_financial_data", select: MECH_SAT_FINANCIAL_SELECT }),
    fetchAllRows({ table: "nps_responses", select: MECH_SAT_NPS_SELECT, order: "created_at.asc" }),
    fetchAllRows({ table: "csat_responses", select: MECH_SAT_CSAT_SELECT, order: "created_at.asc" }),
  ]);
  return { clientsRaw, cmRaw, mechRaw, cancelRaw, finRaw, npsRaw, csatRaw };
}

/**
 * @returns {{
 *   wideClients: object[],
 *   longRows: object[],
 *   catalog: object[],
 *   npsMeta: object,
 *   refDate: string,
 * }}
 */
export function buildMechanismsSatisfactionDataset(raw = {}) {
  const removedIds = excludedClientIds(raw.clientsRaw || []);
  const clients = filterExcludedClients(raw.clientsRaw || []);
  const cancellations = (raw.cancelRaw || []).filter((row) => !removedIds.has(String(row.client_id || "")));
  const financialRows = (raw.finRaw || []).filter((row) => !removedIds.has(String(row.client_id || "")));
  const cmRows = (raw.cmRaw || [])
    .filter((row) => blankToNull(row.client_id))
    .filter((row) => !removedIds.has(String(row.client_id || "")));
  const npsRows = (raw.npsRaw || []).filter((row) => !removedIds.has(String(row.client_id || "")));
  const csatRows = (raw.csatRaw || []).filter((row) => !removedIds.has(String(row.client_id || "")));

  const mechMap = new Map((raw.mechRaw || []).map((m) => [String(m.id), m]));
  const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations, clients);
  const financialMap = buildFinancialLookup(financialRows);
  const { rows: dedupedCm } = dedupeClientMechanisms(cmRows);

  const byClientMechanisms = new Map();
  for (const row of dedupedCm) {
    const clientId = String(row.client_id);
    if (!byClientMechanisms.has(clientId)) byClientMechanisms.set(clientId, []);
    byClientMechanisms.get(clientId).push(row);
  }

  const { rows: npsDeduped, meta: npsMeta } = dedupeNpsResponses(npsRows);
  const npsByClient = new Map(npsDeduped.map((r) => [r.clientId, r]));
  const npsResponseCountByClient = new Map();
  for (const row of npsRows || []) {
    const clientId = row?.client_id != null ? String(row.client_id) : "";
    if (!clientId) continue;
    const score = Number(row.score);
    if (!Number.isFinite(score) || score < 0 || score > 10) continue;
    const tipo = String(row.tipo_de_forms || "").toUpperCase();
    if (tipo && !tipo.startsWith("NPS")) continue;
    npsResponseCountByClient.set(clientId, (npsResponseCountByClient.get(clientId) || 0) + 1);
  }
  const csatByClient = aggregateCsatByClient(
    dedupeByKey(csatRows.filter(isCsatRow), ["typeform_response_id", "form_response_id", "id"]).filter(
      (row) => csatScoreValue(row.score) != null,
    ),
  );

  const refDate =
    clients
      .map((c) => parseDate(c.data_inicio_ciclo))
      .filter(Boolean)
      .sort((a, b) => b - a)[0] || new Date();

  const catalog = [...mechMap.values()]
    .map((m) => ({
      id: String(m.id),
      name: blankToNull(m.name) || "Mecanismo sem nome",
      slug: mechanismSlugFromName(m.name),
      category: blankToNull(m.categoria) ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const wideClients = [];
  const longRows = [];

  for (const client of clients) {
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
    const entryDate = calendarDateFromValue(client.data_inicio_ciclo);
    const entryParsed = parseDate(client.data_inicio_ciclo);
    const tenureDays =
      entryParsed && refDate ? Math.max(0, Math.round((refDate - entryParsed) / 86400000)) : null;

    const links = byClientMechanisms.get(clientId) || [];
    let totalImplemented = 0;
    const implementedBySlug = {};
    const implementedMechanismNames = [];
    for (const c of catalog) implementedBySlug[c.slug] = false;

    const nps = npsByClient.get(clientId);
    const csat = csatByClient.get(clientId);
    const latestNps = nps?.score ?? null;
    const latestNpsDate = nps ? npsLatestDate(nps) : null;
    const latestNpsDateObj = latestNpsDate ? parseDate(latestNpsDate) : null;
    let implementedBeforeLatestNps = false;

    const wide = {
      clientId,
      clientCode: blankToNull(client.codigo),
      clientName: blankToNull(client.name) || "Não informado",
      analyticalStatus,
      ep: blankToNull(client.engenheiro_patrimonial) ?? "Não informado",
      segment: segmentInfo.segment || "Dados insuficientes",
      program: resolveClientProgram(client),
      entryDate,
      cycleEndDate: calendarDateFromValue(client.data_fim_ciclo),
      currentCycle: renewal.currentCycle,
      renewalCount: renewal.renewalCount,
      renewed: renewal.hasRenewed,
      cycleValid: renewal.valid,
      totalImplementedMechanisms: 0,
      totalMechanismLinks: links.length,
      hasAnyMechanism: links.length > 0,
      hasMechanism: links.some((r) => isBaseQvImplementedRawStatus(r.status)),
      latestNps,
      latestNpsDate,
      latestNpsClass: latestNps != null ? npsClassLabelPt(latestNps) : null,
      npsResponseCount: npsResponseCountByClient.get(clientId) || (latestNps != null ? 1 : 0),
      npsIsPromoter: latestNps != null && latestNps >= 9 ? 1 : latestNps != null ? 0 : null,
      npsIsNeutral: latestNps != null && latestNps >= 7 && latestNps <= 8 ? 1 : latestNps != null ? 0 : null,
      npsIsDetractor: latestNps != null && latestNps <= 6 ? 1 : latestNps != null ? 0 : null,
      latestCsat: csat?.latestCsat ?? null,
      averageCsat: csat?.averageCsat ?? null,
      latestCsatDate: csat?.latestCsatDate ? calendarDateFromValue(csat.latestCsatDate) : null,
      csatResponseCount: csat?.csatResponses || 0,
      csatSatisfied: csat?.csatSatisfied === true,
      tenureDays,
      renewedBinary: renewal.valid && renewal.hasRenewed ? 1 : renewal.valid ? 0 : null,
    };

    for (const link of links) {
      const mech = mechMap.get(String(link.mecanismo_id));
      const statusInfo = normalizeBaseQvMechanismStatus(link.status);
      const implemented = statusInfo.label === "Implementado";
      if (implemented) totalImplemented += 1;
      const mechName = blankToNull(mech?.name) || "Mecanismo sem nome";
      const slug = mechanismSlugFromName(mechName);
      if (implemented) {
        implementedBySlug[slug] = true;
        if (!implementedMechanismNames.includes(mechName)) implementedMechanismNames.push(mechName);
      }
      const implDate = parseDate(link.implemented_at);
      if (implemented && implDate && latestNpsDateObj && implDate.getTime() <= latestNpsDateObj.getTime()) {
        implementedBeforeLatestNps = true;
      }
      const linkDate = parseDate(link.created_at);
      longRows.push({
        clientId,
        clientCode: wide.clientCode,
        clientName: wide.clientName,
        program: wide.program,
        ep: wide.ep,
        segment: wide.segment,
        analyticalStatus: wide.analyticalStatus,
        mechanismId: String(link.mecanismo_id || ""),
        mechanismName: mechName,
        mechanismCategory: blankToNull(mech?.categoria) ?? "",
        mechanismStatus: statusInfo.label,
        mechanismImplemented: implemented,
        mechanismLinkDate: linkDate ? calendarDateFromValue(linkDate) : null,
        mechanismImplementationDate: implDate ? calendarDateFromValue(implDate) : null,
        mechanismSource: blankToNull(link.source) ?? "",
        latestNps: wide.latestNps,
        latestNpsClass: wide.latestNpsClass,
        latestCsat: wide.latestCsat,
        renewed: wide.renewed,
        cycleValid: wide.cycleValid,
        renewalDate: null,
      });
    }

    if (!links.length) {
      longRows.push({
        ...wide,
        mechanismId: "",
        mechanismName: "",
        mechanismCategory: "",
        mechanismStatus: "",
        mechanismImplemented: false,
        mechanismLinkDate: null,
        mechanismImplementationDate: null,
        mechanismSource: "",
        renewalDate: null,
      });
    }

    wide.totalImplementedMechanisms = totalImplemented;
    wide.implementedMechanismNames = implementedMechanismNames.sort((a, b) => a.localeCompare(b, "pt-BR"));
    wide.implementedMechanismLabels = wide.implementedMechanismNames.length
      ? wide.implementedMechanismNames.join(" · ")
      : "Sem mecanismo";
    wide.implementedBeforeLatestNps = implementedBeforeLatestNps;
    wide.hasMechanismImplemented = totalImplemented > 0;
    for (const c of catalog) {
      wide[`implemented_${c.slug}`] = implementedBySlug[c.slug] === true;
    }
    wideClients.push(wide);
  }

  return { wideClients, longRows, catalog, npsMeta, npsDedupedRows: npsDeduped, refDate: refDate.toISOString?.() || String(refDate) };
}

export async function loadMechanismsSatisfactionDataset() {
  const raw = await fetchMechanismsSatisfactionRawData();
  return buildMechanismsSatisfactionDataset(raw);
}
