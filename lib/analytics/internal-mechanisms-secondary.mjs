/**
 * CSAT, renovação e temporalidade — Análise interna Mecanismos × Satisfação.
 * População de entrada: clientes canônicos com NPS (mesmo recorte dos KPIs).
 */
import { mechanismSlugFromName } from "./mechanisms-satisfaction-dataset.mjs";
import { parseDate } from "./meeting-metrics.mjs";
import { coveragePct, mean, median } from "./stats-tests.mjs";
import { IMS_MECHANISM_MIN_N } from "./internal-mechanisms-nps-focus.mjs";

function round1(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10) / 10;
}

function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function csatScores(clients) {
  return clients.map((c) => Number(c.latestCsat)).filter((s) => Number.isFinite(s) && s >= 1 && s <= 5);
}

export function buildCsatComVsSem(withMechanism, withoutMechanism) {
  const scoresA = csatScores(withMechanism);
  const scoresB = csatScores(withoutMechanism);
  const satA = withMechanism.filter((c) => c.csatSatisfied === true);
  const satB = withoutMechanism.filter((c) => c.csatSatisfied === true);
  const withCsatA = withMechanism.filter((c) => c.latestCsat != null);
  const withCsatB = withoutMechanism.filter((c) => c.latestCsat != null);
  return {
    withMechanism: {
      clientsWithCsat: withCsatA.length,
      meanCsat: round1(mean(scoresA)),
      medianCsat: median(scoresA),
      satisfiedPct: pct(satA.length, withCsatA.length),
      unsatisfiedPct: pct(withCsatA.length - satA.length, withCsatA.length),
    },
    withoutMechanism: {
      clientsWithCsat: withCsatB.length,
      meanCsat: round1(mean(scoresB)),
      medianCsat: median(scoresB),
      satisfiedPct: pct(satB.length, withCsatB.length),
      unsatisfiedPct: pct(withCsatB.length - satB.length, withCsatB.length),
    },
    table: [
      { indicator: "Clientes com CSAT", with: withCsatA.length, without: withCsatB.length },
      { indicator: "CSAT médio", with: round1(mean(scoresA)), without: round1(mean(scoresB)) },
      { indicator: "Mediana CSAT", with: median(scoresA), without: median(scoresB) },
      { indicator: "Satisfeitos %", with: pct(satA.length, withCsatA.length), without: pct(satB.length, withCsatB.length) },
      { indicator: "Não satisfeitos %", with: pct(withCsatA.length - satA.length, withCsatA.length), without: pct(withCsatB.length - satB.length, withCsatB.length) },
    ],
  };
}

export function buildCsatScoreDistribution(withMechanism, withoutMechanism) {
  return [1, 2, 3, 4, 5].map((score) => {
    const w = withMechanism.filter((c) => Number(c.latestCsat) === score).length;
    const wo = withoutMechanism.filter((c) => Number(c.latestCsat) === score).length;
    return {
      score,
      withMechanism: w,
      withoutMechanism: wo,
      withPct: pct(w, withMechanism.filter((c) => c.latestCsat != null).length),
      withoutPct: pct(wo, withoutMechanism.filter((c) => c.latestCsat != null).length),
    };
  });
}

export function buildCsatMechanismRanking(npsPopulation, catalog, minSample = IMS_MECHANISM_MIN_N) {
  const total = npsPopulation.length;
  return catalog
    .map((mech) => {
      const field = `implemented_${mech.slug}`;
      const clients = npsPopulation.filter((c) => c[field] && c.latestCsat != null);
      const scores = csatScores(clients);
      const satisfied = clients.filter((c) => c.csatSatisfied === true).length;
      return {
        mechanismId: mech.id,
        mechanismName: mech.name,
        slug: mech.slug,
        clientsWithCsat: clients.length,
        meanCsat: round1(mean(scores)),
        medianCsat: median(scores),
        satisfiedPct: pct(satisfied, clients.length),
        unsatisfiedPct: pct(clients.length - satisfied, clients.length),
        coveragePct: coveragePct(clients.length, total),
        smallSample: clients.length < minSample,
      };
    })
    .filter((r) => r.clientsWithCsat > 0)
    .sort((a, b) => (b.meanCsat ?? -1) - (a.meanCsat ?? -1));
}

export {
  buildRenewalComVsSem,
  buildRenewalComVsSemFromPopulation,
  buildRenewalMechanismRanking,
  buildRenewalMechanismDetailedRanking,
  renewalRateFromPopulation,
} from "./internal-mechanisms-renewal-analysis.mjs";

export function buildTemporalNpsSummary(npsPopulation) {
  const withMech = npsPopulation.filter((c) => (c.totalImplementedMechanisms || 0) > 0);
  let before = 0;
  let after = 0;
  let noData = 0;
  for (const c of withMech) {
    if (!c.latestNpsDate) {
      noData += 1;
      continue;
    }
    if (c.implementedBeforeLatestNps === true) before += 1;
    else if (c.implementedBeforeLatestNps === false) after += 1;
    else noData += 1;
  }
  const withDates = before + after;
  return {
    clientsWithMechanismAndNps: withMech.length,
    implementedBeforeNps: before,
    implementedAfterNps: after,
    insufficientDates: noData,
    beforePct: pct(before, withMech.length),
    afterPct: pct(after, withMech.length),
    noDataPct: pct(noData, withMech.length),
    message:
      withMech.length > 0
        ? `${before} implementados antes ou no dia do NPS · ${after} depois do NPS · ${noData} sem data suficiente (total com mecanismo: ${withMech.length}).`
        : "Nenhum cliente com NPS e mecanismo no recorte.",
  };
}

/**
 * Temporal por mecanismo usando vínculos long (implemented_at × latestNpsDate).
 */
export function buildTemporalByMechanism(npsPopulation, longRows, catalog) {
  const npsById = new Map(npsPopulation.map((c) => [String(c.clientId), c]));
  const byMech = new Map();
  for (const mech of catalog) {
    byMech.set(mech.slug, { mechanismName: mech.name, before: 0, after: 0, noData: 0, valid: 0 });
  }
  for (const row of longRows || []) {
    if (!row.mechanismImplemented) continue;
    const client = npsById.get(String(row.clientId));
    if (!client?.latestNpsDate) continue;
    const slug = mechanismSlugFromName(row.mechanismName);
    if (!slug || !byMech.has(slug)) continue;
    const bucket = byMech.get(slug);
    const impl = parseDate(row.mechanismImplementationDate);
    const npsD = parseDate(client.latestNpsDate);
    if (!impl || !npsD) {
      bucket.noData += 1;
      continue;
    }
    bucket.valid += 1;
    if (impl.getTime() <= npsD.getTime()) bucket.before += 1;
    else bucket.after += 1;
  }
  return [...byMech.values()]
    .map((b) => ({
      ...b,
      beforePct: pct(b.before, b.valid || b.before + b.after + b.noData),
      afterPct: pct(b.after, b.valid || b.before + b.after + b.noData),
    }))
    .filter((b) => b.valid + b.noData > 0)
    .sort((a, b) => b.valid - a.valid);
}

export function buildCsatInsights(csatComVsSem, minN = 10) {
  const a = csatComVsSem.withMechanism;
  const b = csatComVsSem.withoutMechanism;
  if (a.clientsWithCsat < minN || b.clientsWithCsat < minN) return [];
  if (a.meanCsat == null || b.meanCsat == null) return [];
  return [
    {
      text: `Clientes com mecanismo apresentaram CSAT médio ${a.meanCsat} (n=${a.clientsWithCsat}), contra ${b.meanCsat} entre quem não possui mecanismo (n=${b.clientsWithCsat}).`,
    },
  ];
}
