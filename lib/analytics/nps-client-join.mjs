/**
 * Resolução NPS → cliente BASE QV (dedupe oficial nps-metrics / Pesquisa de Satisfação).
 * Chave primária: client_id (mesma de buildOfficialNpsProgramBreakdown).
 */
import { npsClassLabelPt } from "./mechanisms-satisfaction-dataset.mjs";
import { calendarDateFromValue } from "./client-cycle-renewal.mjs";
import { parseDate } from "./meeting-metrics.mjs";

export function normalizeClientId(value) {
  const id = String(value ?? "").trim();
  return id || null;
}

export function normalizeClientCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function clientsByCodeFromWide(wideClients = []) {
  const byCode = new Map();
  for (const row of wideClients) {
    const code = normalizeClientCode(row?.clientCode);
    if (code && !byCode.has(code)) byCode.set(code, row);
  }
  return byCode;
}

export function npsLatestDateFromDedupeRow(npsRow) {
  if (!npsRow) return null;
  const submitted = calendarDateFromValue(npsRow.submittedAt || npsRow.submitted_at);
  if (submitted) return submitted;
  return calendarDateFromValue(npsRow.createdAt || npsRow.created_at);
}

function applyLatestNpsFields(target, score, npsRow, npsResponseCount) {
  const n = Number(score);
  if (!Number.isFinite(n)) return target;
  const latestNpsDate = npsLatestDateFromDedupeRow(npsRow);
  return {
    ...target,
    latestNps: n,
    latestNpsDate,
    latestNpsClass: npsClassLabelPt(n),
    npsIsPromoter: n >= 9 ? 1 : 0,
    npsIsNeutral: n >= 7 && n <= 8 ? 1 : 0,
    npsIsDetractor: n <= 6 ? 1 : 0,
    npsResponseCount: npsResponseCount ?? target.npsResponseCount ?? 1,
  };
}

function mechanismNamesFromWide(wide) {
  const names = wide?.implementedMechanismNames || wide?.implementedMechanismLabels;
  if (Array.isArray(names)) return names;
  if (typeof names === "string" && names.trim()) return names.split(/\s*·\s*/);
  return [];
}

/** Registro canônico por cliente (população única NPS × mecanismos). */
export function toNpsClientPopulationRecord(wide, npsRow = null) {
  if (!wide) return null;
  const mechanismNames = mechanismNamesFromWide(wide);
  const mechanismCount = wide.totalImplementedMechanisms || 0;
  let row = { ...wide };
  if (npsRow) {
    row = applyLatestNpsFields(row, npsRow.score, npsRow, wide.npsResponseCount);
  }
  return {
    ...row,
    hasMechanism: mechanismCount > 0,
    mechanismCount,
    mechanismNames,
    npsClass: row.latestNpsClass,
  };
}

/**
 * População canônica: dedupe oficial (1 linha/client_id) ∩ clientes BASE QV (wide).
 * Fallback: wide com latestNps (dataset já aplica o mesmo dedupe).
 */
export function buildNpsClientPopulation(wideClients = [], dedupedNpsRows = []) {
  const wideById = new Map();
  for (const row of wideClients) {
    const id = normalizeClientId(row.clientId);
    if (id) wideById.set(id, row);
  }

  const records = [];
  for (const nps of dedupedNpsRows || []) {
    const id = normalizeClientId(nps.clientId ?? nps.client_id);
    if (!id) continue;
    const wide = wideById.get(id);
    if (!wide) continue;
    const rec = toNpsClientPopulationRecord(wide, nps);
    if (rec?.latestNps != null && Number.isFinite(Number(rec.latestNps))) records.push(rec);
  }

  if (records.length > 0) return records;

  return (wideClients || [])
    .filter((c) => c.latestNps != null && Number.isFinite(Number(c.latestNps)))
    .map((wide) => toNpsClientPopulationRecord(wide, null))
    .filter(Boolean);
}

/** @deprecated use buildNpsClientPopulation */
export function buildCanonicalNpsClientRecords(wideClients = [], dedupedNpsRows = []) {
  return buildNpsClientPopulation(wideClients, dedupedNpsRows);
}

export function diagnoseNpsClientJoin(wideClients = [], dedupedNpsRows = [], npsMeta = {}) {
  const wideById = new Map();
  for (const row of wideClients) {
    const id = normalizeClientId(row.clientId);
    if (id) wideById.set(id, row);
  }
  let matched = 0;
  let unmatched = 0;
  let dedupedWithoutClientId = 0;
  for (const nps of dedupedNpsRows || []) {
    const id = normalizeClientId(nps.clientId ?? nps.client_id);
    if (!id) {
      dedupedWithoutClientId += 1;
      unmatched += 1;
      continue;
    }
    if (wideById.has(id)) matched += 1;
    else unmatched += 1;
  }
  return {
    rawResponses: npsMeta.rawResponses ?? null,
    validDedupedClients: dedupedNpsRows?.length ?? 0,
    dedupedClients: dedupedNpsRows?.length ?? 0,
    matchedToBaseClients: matched,
    unmatchedDeduped: unmatched,
    withoutClientId: npsMeta.withoutClientId ?? dedupedWithoutClientId,
    invalidScore: npsMeta.invalidScore ?? null,
    skippedNonNpsTipo: npsMeta.skippedNonNpsTipo ?? null,
    dedupeRule: npsMeta.dedupeRule ?? "submitted_at desc, created_at desc · 1 linha por client_id",
  };
}

export function assertNpsPopulationPartition(npsPopulation = []) {
  const withM = npsPopulation.filter((c) => (c.totalImplementedMechanisms || c.mechanismCount || 0) > 0).length;
  const withoutM = npsPopulation.filter((c) => !(c.totalImplementedMechanisms || c.mechanismCount || 0)).length;
  return {
    total: npsPopulation.length,
    withMechanism: withM,
    withoutMechanism: withoutM,
    valid: withM + withoutM === npsPopulation.length,
  };
}
