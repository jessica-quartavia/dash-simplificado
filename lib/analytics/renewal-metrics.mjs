/**
 * Métricas — Renovação (V2). Inferência por clients.ciclo.
 */
import {
  RENEWAL_COUNT_BAND_ORDER,
  renewalCountDistributionLabel,
} from "./client-cycle-renewal.mjs";

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function summarizeRenewalRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const eligible = list.filter((r) => r.cycleValid);
  const renewed = eligible.filter((r) => r.renewed);
  const maxCycle = eligible.reduce((max, r) => Math.max(max, r.currentCycle || 0), 0);
  const totalRenewals = eligible.reduce((sum, r) => sum + Math.max(0, (r.renewalCount || 0)), 0);

  return {
    totalClients: list.length,
    eligibleClients: eligible.length,
    renewedClients: renewed.length,
    renewedClientsPercent: pct(renewed.length, eligible.length),
    totalRenewals,
    maxCurrentCycle: maxCycle || null,
    firstCycleClients: eligible.filter((r) => !r.renewed).length,
  };
}

export function distributionsFromRenewalRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const eligible = list.filter((r) => r.cycleValid);
  const renewed = eligible.filter((r) => r.renewed).length;
  const firstCycle = eligible.length - renewed;

  const renewalCountBuckets = new Map(RENEWAL_COUNT_BAND_ORDER.map((label) => [label, 0]));
  for (const row of list) {
    const bucket = renewalCountDistributionLabel(row.renewalCount);
    renewalCountBuckets.set(bucket, (renewalCountBuckets.get(bucket) || 0) + 1);
  }

  const byEngineer = new Map();
  for (const row of eligible) {
    const engineer = row.engineer || "Não informado";
    if (!byEngineer.has(engineer)) byEngineer.set(engineer, { engineer, total: 0, renewed: 0 });
    const bucket = byEngineer.get(engineer);
    bucket.total += 1;
    if (row.renewed) bucket.renewed += 1;
  }

  return {
    renewedYesNo: [
      { label: "Renovou (ciclo > 1)", count: renewed, percent: pct(renewed, eligible.length) },
      { label: "Ainda no 1º ciclo", count: firstCycle, percent: pct(firstCycle, eligible.length) },
    ],
    renewalCountBands: RENEWAL_COUNT_BAND_ORDER.map((label) => ({
      label,
      count: renewalCountBuckets.get(label) || 0,
      percent: pct(renewalCountBuckets.get(label) || 0, list.length),
    })),
    renewedByEngineer: [...byEngineer.values()]
      .filter((row) => row.total > 0)
      .map((row) => ({
        label: row.engineer,
        engineer: row.engineer,
        count: row.renewed,
        renewed: row.renewed,
        percent: pct(row.renewed, row.total),
      }))
      .sort((a, b) => b.percent - a.percent || b.renewed - a.renewed || a.label.localeCompare(b.label, "pt-BR")),
  };
}
