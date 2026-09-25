/**
 * Renovação × mecanismos — população canônica (sem NPS).
 */
import { coveragePct } from "./stats-tests.mjs";
import { IMS_MECHANISM_MIN_N } from "./internal-mechanisms-nps-focus.mjs";
import { splitWithWithoutMechanism } from "./internal-mechanisms-nps-focus.mjs";

function round1(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10) / 10;
}

function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

export function buildRenewalComVsSemFromPopulation(renewalPopulation = []) {
  const { withMechanism, withoutMechanism } = splitWithWithoutMechanism(renewalPopulation);
  const eligA = withMechanism.filter((c) => c.cycleValid);
  const eligB = withoutMechanism.filter((c) => c.cycleValid);
  const renA = eligA.filter((c) => c.renewed).length;
  const renB = eligB.filter((c) => c.renewed).length;
  const rateA = pct(renA, eligA.length);
  const rateB = pct(renB, eligB.length);
  return {
    universe: "canonicalRenewalPopulation",
    withMechanism: { eligible: eligA.length, renewed: renA, ratePct: rateA },
    withoutMechanism: { eligible: eligB.length, renewed: renB, ratePct: rateB },
    diffPct: rateA != null && rateB != null ? round1(rateA - rateB) : null,
    table: [
      { indicator: "Clientes elegíveis", with: eligA.length, without: eligB.length },
      { indicator: "Renovaram", with: renA, without: renB },
      { indicator: "Taxa de renovação %", with: rateA, without: rateB },
    ],
  };
}

export function buildRenewalMechanismDetailedRanking(
  renewalPopulation = [],
  catalog = [],
  minSample = IMS_MECHANISM_MIN_N,
) {
  const withoutRate = buildRenewalComVsSemFromPopulation(renewalPopulation).withoutMechanism.ratePct;
  const rows = (catalog || [])
    .map((mech) => {
      const field = `implemented_${mech.slug}`;
      const clients = renewalPopulation.filter((c) => c[field]);
      const eligible = clients.filter((c) => c.cycleValid);
      const renewed = eligible.filter((c) => c.renewed).length;
      const notRenewed = eligible.length - renewed;
      const rate = pct(renewed, eligible.length);
      return {
        mechanismId: mech.id,
        mechanismName: mech.name,
        slug: mech.slug,
        eligible: eligible.length,
        renewed,
        notRenewed,
        renewalRatePct: rate,
        withoutMechanismRatePct: withoutRate,
        diffVsWithoutMechanismPp:
          rate != null && withoutRate != null ? round1(rate - withoutRate) : null,
        coveragePct: coveragePct(clients.length, renewalPopulation.length),
        smallSample: eligible.length < minSample,
        sampleLabel: eligible.length < minSample ? "Amostra pequena" : "OK",
      };
    })
    .filter((r) => r.eligible > 0);

  const byRawRate = [...rows]
    .filter((r) => !r.smallSample)
    .sort((a, b) => (b.renewalRatePct ?? -1) - (a.renewalRatePct ?? -1) || b.eligible - a.eligible);

  const byAssociation = [...rows]
    .filter((r) => !r.smallSample)
    .sort(
      (a, b) =>
        (b.diffVsWithoutMechanismPp ?? -999) - (a.diffVsWithoutMechanismPp ?? -999)
        || b.eligible - a.eligible,
    );

  return {
    rows,
    topByRawRate: byRawRate.slice(0, 3),
    topByAdjustedAssociation: byAssociation.slice(0, 3),
    tableColumns: [
      "mechanismName",
      "eligible",
      "renewed",
      "renewalRatePct",
      "notRenewed",
      "withoutMechanismRatePct",
      "diffVsWithoutMechanismPp",
      "sampleLabel",
    ],
  };
}

export function renewalRateFromPopulation(renewalPopulation = []) {
  const eligible = renewalPopulation.filter((c) => c.cycleValid);
  if (!eligible.length) return null;
  return pct(eligible.filter((c) => c.renewed).length, eligible.length);
}

/** @deprecated use buildRenewalMechanismDetailedRanking — mantido para compat. */
export function buildRenewalMechanismRanking(renewalPopulation, catalog, minSample) {
  const { rows } = buildRenewalMechanismDetailedRanking(renewalPopulation, catalog, minSample);
  return rows
    .map((r) => ({
      mechanismName: r.mechanismName,
      slug: r.slug,
      eligible: r.eligible,
      renewed: r.renewed,
      renewalRatePct: r.renewalRatePct,
      diffVsWithoutMechanismPct: r.diffVsWithoutMechanismPp,
      coveragePct: r.coveragePct,
      smallSample: r.smallSample,
    }))
    .sort((a, b) => (b.renewalRatePct ?? -1) - (a.renewalRatePct ?? -1));
}

export function buildRenewalComVsSem(withMechanism, withoutMechanism) {
  const combined = [...(withMechanism || []), ...(withoutMechanism || [])];
  const { withMechanism: w, withoutMechanism: wo } = splitWithWithoutMechanism(combined);
  return buildRenewalComVsSemFromPopulation([...w, ...wo]);
}
