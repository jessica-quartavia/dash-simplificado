/**
 * População histórica temporalmente comparável — Modelo B (canonicalHistoricalRenewalPopulation).
 */
import { resolveAnalyticalStatusFromMaps } from "./analytical-cancellation.mjs";
import { calendarDateFromValue, civilDateInSaoPaulo, renewalFromClient } from "./client-cycle-renewal.mjs";
import { resolveClientProgram } from "./filters/program.mjs";
import { isBaseQvImplementedRawStatus } from "./mechanisms/mechanism-status.mjs";
import { mechanismSlugFromName } from "./mechanisms-satisfaction-dataset.mjs";
import { blankToNull, parseDate } from "./meeting-metrics.mjs";
import { calculateClientSegment } from "./client-segment.mjs";

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(`${a}T12:00:00Z`);
  const db = new Date(`${b}T12:00:00Z`);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.round((db - da) / 86400000);
}

function parseImplDate(link) {
  const impl = parseDate(link.implemented_at);
  if (impl) return calendarDateFromValue(impl);
  const created = parseDate(link.created_at);
  return created ? calendarDateFromValue(created) : null;
}

function countMechanismsBefore(links, mechMap, referenceDate) {
  const slugs = new Set();
  let n = 0;
  for (const link of links || []) {
    if (!isBaseQvImplementedRawStatus(link.status)) continue;
    const d = parseImplDate(link);
    if (!d || !referenceDate || d > referenceDate) continue;
    n += 1;
    const mech = mechMap.get(String(link.mecanismo_id));
    const name = blankToNull(mech?.name) || "mecanismo";
    slugs.add(mechanismSlugFromName(name));
  }
  return { count: n, slugs: [...slugs] };
}

function resolveReferenceDate({ cycleEndDate, cancelDate, today, renewed, currentCycle }) {
  if (renewed && currentCycle >= 2) {
    return cycleEndDate || cancelDate || today;
  }
  if (currentCycle === 1 && cycleEndDate && cycleEndDate <= today) {
    return cycleEndDate;
  }
  if (cancelDate) return cancelDate;
  return cycleEndDate && cycleEndDate <= today ? cycleEndDate : null;
}

function resolveOutcome({ renewed, currentCycle, cycleEndDate, cancelDate, today, referenceDate }) {
  if (renewed && currentCycle >= 2) {
    return { y: 1, resolved: true, reason: "renewed_observed" };
  }
  if (currentCycle === 1 && cancelDate && cancelDate <= today) {
    return { y: 0, resolved: true, reason: "cancelled_without_renewal" };
  }
  if (currentCycle === 1 && referenceDate && cycleEndDate && cycleEndDate <= today) {
    return { y: 0, resolved: true, reason: "cycle_window_closed_no_renewal" };
  }
  if (currentCycle === 1 && (!cycleEndDate || cycleEndDate > today)) {
    return { y: null, resolved: false, reason: "outcome_still_open" };
  }
  return { y: null, resolved: false, reason: "unresolved" };
}

export function auditMinExposureDays(clientsInEraSample) {
  const values = clientsInEraSample.filter((v) => v != null && v >= 0).sort((a, b) => a - b);
  if (!values.length) return { minExposureDays: 90, source: "default_90_no_sample" };
  const p25 = values[Math.floor(values.length * 0.25)] ?? values[0];
  const chosen = Math.max(30, Math.min(180, Math.round(p25)));
  return { minExposureDays: chosen, p25ExposureDays: p25, sampleN: values.length };
}

/**
 * @param {object} ctx
 * @param {string} ctx.eraStart YYYY-MM-DD
 */
export function buildCanonicalHistoricalRenewalPopulation(ctx) {
  const {
    clients = [],
    cmRows = [],
    mechMap = new Map(),
    cancelMap = new Map(),
    financialMap = new Map(),
    eraStart,
    today = civilDateInSaoPaulo(),
  } = ctx;

  const linksByClient = new Map();
  for (const link of cmRows) {
    const id = blankToNull(link.client_id);
    if (!id) continue;
    const k = String(id);
    if (!linksByClient.has(k)) linksByClient.set(k, []);
    linksByClient.get(k).push(link);
  }

  const exposureSamples = [];
  const excluded = {
    before_era: 0,
    insufficient_exposure: 0,
    outcome_still_open: 0,
    invalid_cycle: 0,
    missing_reference: 0,
    other: 0,
  };

  const draftRows = [];

  for (const client of clients) {
    const clientId = String(client.id);
    const rawStatus = blankToNull(client.status);
    const cancelInfo = cancelMap.get(clientId) || null;
    const analyticalStatus = resolveAnalyticalStatusFromMaps(rawStatus, cancelInfo);
    const renewal = renewalFromClient(client);
    if (!renewal.valid) {
      excluded.invalid_cycle += 1;
      continue;
    }

    const entryDate =
      calendarDateFromValue(client.data_inicio_ciclo) || calendarDateFromValue(client.created_at);
    const cycleEndDate = calendarDateFromValue(client.data_fim_ciclo);
    const cancelDate = cancelInfo?.date ? calendarDateFromValue(cancelInfo.date) : null;
    const portfolioEnd = cancelDate || today;

    if (!entryDate || entryDate < eraStart) {
      if (portfolioEnd < eraStart) {
        excluded.before_era += 1;
        continue;
      }
    }

    const eraPresenceStart = entryDate && entryDate > eraStart ? entryDate : eraStart;
    const exposureDays = daysBetween(eraPresenceStart, portfolioEnd);
    if (exposureDays != null) exposureSamples.push(exposureDays);

    const referenceDate = resolveReferenceDate({
      cycleEndDate,
      cancelDate,
      today,
      renewed: renewal.hasRenewed,
      currentCycle: renewal.currentCycle,
    });

    const outcome = resolveOutcome({
      renewed: renewal.hasRenewed,
      currentCycle: renewal.currentCycle,
      cycleEndDate,
      cancelDate,
      today,
      referenceDate,
    });

    if (!outcome.resolved) {
      if (outcome.reason === "outcome_still_open") excluded.outcome_still_open += 1;
      else excluded.other += 1;
      continue;
    }

    if (!referenceDate) {
      excluded.missing_reference += 1;
      continue;
    }

    if (referenceDate < eraStart) {
      excluded.before_era += 1;
      continue;
    }

    const links = linksByClient.get(clientId) || [];
    const mechAtRef = countMechanismsBefore(links, mechMap, referenceDate);
    const fin = financialMap.get(clientId);
    const segmentInfo = calculateClientSegment(
      fin
        ? {
            monthlyIncome: fin.monthlyIncome,
            liquidityReserve: fin.liquidityReserve,
            lastContribution: fin.lastContribution,
            paidPropertiesValue: fin.paidPropertiesValue,
          }
        : {},
      fin?.debt || {},
    );

    draftRows.push({
      clientId,
      clientCode: blankToNull(client.codigo),
      program: resolveClientProgram(client),
      segment: segmentInfo.segment || "Dados insuficientes",
      ep: blankToNull(client.engenheiro_patrimonial) ?? "Não informado",
      entryDate,
      referenceDate,
      renewedBinary: outcome.y,
      mechanismCountAtReference: mechAtRef.count,
      mechanismsBeforeReference: mechAtRef.slugs,
      tenureDaysAtReference: daysBetween(entryDate, referenceDate),
      currentCycle: renewal.currentCycle,
      finalStatus: analyticalStatus,
      cycleEndDate,
      cancelDate,
      exposureDaysInEra: exposureDays,
      outcomeReason: outcome.reason,
      y: outcome.y,
    });
  }

  const { minExposureDays, p25ExposureDays, sampleN } = auditMinExposureDays(exposureSamples);
  const population = [];
  for (const row of draftRows) {
    if (row.exposureDaysInEra == null || row.exposureDaysInEra < minExposureDays) {
      excluded.insufficient_exposure += 1;
      continue;
    }
    population.push(row);
  }

  return {
    population,
    excluded,
    exposureRule: {
      minExposureDays,
      p25ExposureDays,
      auditSampleN: sampleN,
      definition: `Dias entre max(entry_date, era_start) e min(cancelamento, hoje), exigindo >= ${minExposureDays} (P25 auditado).`,
    },
    eraStart,
  };
}

export function summarizeHistoricalPopulation(population = []) {
  const renewed = population.filter((c) => c.y === 1).length;
  const notRenewed = population.filter((c) => c.y === 0).length;
  const withMech = population.filter((c) => (c.mechanismCountAtReference || 0) > 0).length;
  const withoutMech = population.length - withMech;
  return {
    total: population.length,
    renewed,
    notRenewed,
    withMechanism: withMech,
    withoutMechanism: withoutMech,
    renewalRatePct: population.length ? Math.round((renewed / population.length) * 1000) / 10 : null,
  };
}
