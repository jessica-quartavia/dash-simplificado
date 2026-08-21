/**
 * Métricas — Atualização Financeira (V2). Recálculo client-side sobre o recorte filtrado.
 */
import { distributionFrom } from "./meeting-metrics.mjs";
import { coverageOf, median } from "./onboarding-metrics.mjs";
import { inPeriod, resolvePeriod } from "./filters/period.mjs";

const FIELD_DEFS = [
  { key: "liquidityReserve", label: "Reserva de liquidez", kind: "number" },
  { key: "monthlyIncome", label: "Última renda mensal", kind: "number" },
  { key: "lastContribution", label: "Último aporte", kind: "number" },
  { key: "hasProperty", label: "Possui imóvel", kind: "bool" },
  { key: "hasCar", label: "Possui carro", kind: "bool" },
  { key: "hasConsortium", label: "Possui consórcio", kind: "bool" },
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

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function isFieldFilled(value, kind) {
  if (kind === "bool") return value === true || value === false;
  return value != null;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildMonthSeries(rows, monthsBack = 12, now = new Date()) {
  const buckets = new Map();
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.set(monthKey(d), new Set());
  }
  const nowKey = monthKey(now);
  for (const row of rows || []) {
    if (!row.hasPostCreationUpdate || !row.financialUpdateDate) continue;
    const date = new Date(row.financialUpdateDate);
    if (Number.isNaN(date.getTime()) || date > now) continue;
    const key = monthKey(date);
    if (key > nowKey || !buckets.has(key)) continue;
    buckets.get(key).add(String(row.clientId));
  }
  return [...buckets.entries()].map(([month, set]) => ({
    month,
    label: month,
    count: set.size,
    percent: 0,
  }));
}

export function isFinancialRecordUpdated(row) {
  const created = row?.created_at ? new Date(row.created_at) : null;
  const updated = row?.updated_at ? new Date(row.updated_at) : null;
  if (!created || !updated || Number.isNaN(created.getTime()) || Number.isNaN(updated.getTime())) return false;
  return updated.getTime() > created.getTime();
}

export function summarizeFinancialUpdateRows(rows, payloadSummary = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const withFinancial = list.filter((r) => r.hasFinancialData);
  const withPostUpdate = list.filter((r) => r.hasPostCreationUpdate);
  const updatedLast30 = withFinancial.filter((r) => r.updatedLast30Days);
  const outdated90 = withFinancial.filter((r) => r.outdatedOver90Days);
  const daysValues = withFinancial
    .map((r) => r.daysSinceFinancialUpdate)
    .filter((d) => d != null && Number.isFinite(d) && d >= 0);
  const activationDays = list
    .map((r) => r.daysFinancialToActivation)
    .filter((d) => d != null && Number.isFinite(d) && d >= 0);
  const fta = payloadSummary.financialToActivation || {};

  return {
    totalClients: total,
    clientsWithFinancialData: withFinancial.length,
    financialDataCoveragePercent: pct(withFinancial.length, total),
    clientsWithPostCreationUpdate: withPostUpdate.length,
    updatedLast30Days: updatedLast30.length,
    updatedLast30DaysPercentOfFinancial: pct(updatedLast30.length, withFinancial.length),
    medianDaysSinceUpdate: median(daysValues),
    averageDaysSinceUpdate: daysValues.length
      ? Math.round((daysValues.reduce((a, b) => a + b, 0) / daysValues.length) * 10) / 10
      : null,
    outdatedOver90Days: outdated90.length,
    outdatedOver90DaysPercent: pct(outdated90.length, withFinancial.length),
    medianDaysFinancialToActivation: median(activationDays) ?? fta.medianDays ?? null,
    financialToActivationSample: activationDays.length || fta.sampleSize || 0,
    financialToActivationCoverage: coverageOf(activationDays.length || fta.sampleSize || 0, total),
  };
}

/** EP(s) com mais clientes com atualização válida (updated_at > created_at) no recorte. */
export function financialUpdatesLeader(rows) {
  const counts = new Map();
  for (const row of rows || []) {
    if (!row.hasPostCreationUpdate) continue;
    const eng = row.engineer || "Não informado";
    counts.set(eng, (counts.get(eng) || 0) + 1);
  }
  if (!counts.size) return null;
  const max = Math.max(...counts.values());
  const leaders = [...counts.entries()]
    .filter(([, count]) => count === max)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { leaders, count: max };
}

export function formatFinancialLeaderNote(leader) {
  if (!leader?.leaders?.length) return null;
  if (leader.leaders.length === 1) {
    return `${leader.leaders[0]} é o EP com mais atualizações financeiras no recorte atual.`;
  }
  return `${leader.leaders.join(" e ")} lideram as atualizações financeiras no recorte atual.`;
}

export function distributionsFromFinancialRows(rows, { monthRange = 12, filters = null, now = new Date() } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length || 1;
  const period = filters ? resolvePeriod(filters, now) : { active: false };
  const eventRows = list.filter((row) => {
    if (!row.hasPostCreationUpdate || !row.financialUpdateDate) return false;
    if (period.active && !inPeriod(row.financialUpdateDate, period)) return false;
    return true;
  });
  const byEngineer = new Map();
  for (const row of list) {
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
      count: b.updatedLast30Days,
      updatedLast30Days: b.updatedLast30Days,
      recentUpdatePercent: pct(b.updatedLast30Days, b.withFinancial || 0),
      percent: pct(b.updatedLast30Days, list.filter((r) => r.hasFinancialData).length || 1),
    }))
    .sort(
      (a, b) =>
        b.recentUpdatePercent - a.recentUpdatePercent ||
        b.updatedLast30Days - a.updatedLast30Days ||
        a.label.localeCompare(b.label, "pt-BR"),
    );

  const fieldCoverage = FIELD_DEFS.map((field) => {
    const count = list.filter((r) => isFieldFilled(r[field.key], field.kind)).length;
    return { label: field.label, key: field.key, count, percent: pct(count, total) };
  });

  return {
    updateRecency: RECENCY_BANDS.map((label) => {
      const count = list.filter((r) => r.recencyBand === label).length;
      return { label, count, percent: pct(count, total) };
    }),
    updatesByMonth: buildMonthSeries(eventRows, monthRange, now),
    fieldCoverage,
    updatesByEngineer,
  };
}
