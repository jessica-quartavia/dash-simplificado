/**
 * Análise interna — Mecanismos × Satisfação (população principal: clientes com NPS válido).
 */
import { dataConfigurationError } from "../env.mjs";
import { runWithAnalyticsDataContext } from "./analytics-data-context.mjs";
import {
  assertNpsPopulationPartition,
  buildNpsClientPopulation,
  diagnoseNpsClientJoin,
} from "./nps-client-join.mjs";
import {
  filterWideClients,
  filterLongRows,
  normalizeInternalMechanismsSatisfactionFilters,
  parseInternalMechanismsSatisfactionFilters,
} from "./internal-mechanisms-satisfaction-filters.mjs";
import {
  IMS_MECHANISM_MIN_N,
  buildComVsSemComparison,
  buildGroupStatisticalTest,
  buildMechanismNpsRanking,
  buildNpsClientRows,
  buildNpsInsights,
  buildNpsMechanismMatrix,
  buildPopulationMeta,
  buildScoreDistribution,
  buildTemporalNpsFlags,
  paginateNpsClients,
  splitWithWithoutMechanism,
} from "./internal-mechanisms-nps-focus.mjs";
import {
  buildCsatComVsSem,
  buildCsatInsights,
  buildCsatMechanismRanking,
  buildCsatScoreDistribution,
  buildTemporalByMechanism,
  buildTemporalNpsSummary,
} from "./internal-mechanisms-secondary.mjs";
import { buildImsSectionDiagnostics } from "./internal-mechanisms-diagnostics.mjs";
import { loadMechanismsSatisfactionDataset, mechanismSlugFromName } from "./mechanisms-satisfaction-dataset.mjs";
import { coveragePct, mean } from "./stats-tests.mjs";
import { CALCULATION_VERSION } from "../cache/analytics-cache.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";

const IMS_SATISFACTION_CALCULATION_VERSION = `ims-satisfaction-v1-${CALCULATION_VERSION}`;

const CAUSALITY_NOTE =
  "Associações observadas não significam que o mecanismo causou melhora em NPS ou CSAT.";

function roundCsat(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10) / 10;
}

function buildSecondaryCsatOnly(npsPopulation) {
  const csatScores = npsPopulation.map((c) => c.latestCsat).filter((v) => v != null);
  const { withMechanism, withoutMechanism } = splitWithWithoutMechanism(npsPopulation);
  const csatA = withMechanism.map((c) => c.latestCsat).filter((v) => v != null);
  const csatB = withoutMechanism.map((c) => c.latestCsat).filter((v) => v != null);
  return {
    csatAverage: roundCsat(mean(csatScores)),
    csatRespondents: csatScores.length,
    csatCoveragePct: coveragePct(csatScores.length, npsPopulation.length),
    csatWithMechanism: roundCsat(mean(csatA)),
    csatWithoutMechanism: roundCsat(mean(csatB)),
  };
}

function buildPipelineDebug(dataset, canonicalNpsClients, filters) {
  const f = normalizeInternalMechanismsSatisfactionFilters(filters);
  const afterStatusAll = filterWideClients(canonicalNpsClients, { ...f, status: "all" });
  const afterStatusActive = filterWideClients(canonicalNpsClients, { ...f, status: "active" });
  const afterCurrent = filterWideClients(canonicalNpsClients, f);
  const statusDist = {};
  for (const row of canonicalNpsClients) {
    const st = String(row.analyticalStatus || "(vazio)");
    statusDist[st] = (statusDist[st] || 0) + 1;
  }
  let activeCount = 0;
  let inactiveCount = 0;
  for (const row of canonicalNpsClients) {
    if (matchesAnalyticalStatusFilter(row.analyticalStatus, "active")) activeCount += 1;
    else inactiveCount += 1;
  }
  const join = diagnoseNpsClientJoin(dataset.wideClients || [], dataset.npsDedupedRows || [], dataset.npsMeta || {});
  return {
    rawResponses: join.rawResponses,
    dedupedClients: join.dedupedClients,
    matchedBase: join.matchedToBaseClients,
    unmatched: join.unmatchedDeduped,
    canonicalBeforeFilters: canonicalNpsClients.length,
    afterStatusAll: afterStatusAll.length,
    afterStatusActive: afterStatusActive.length,
    afterCurrentFilters: afterCurrent.length,
    statusDistribution: statusDist,
    npsClientsActive: activeCount,
    npsClientsNotActive: inactiveCount,
    currentStatusFilter: f.status,
  };
}

function resolveCanonicalNpsClients(dataset) {
  return buildNpsClientPopulation(dataset.wideClients || [], dataset.npsDedupedRows || []);
}

function resolveNpsPopulation(dataset, filters, canonicalNpsClients = null) {
  const base = canonicalNpsClients || resolveCanonicalNpsClients(dataset);
  return filterWideClients(base, filters);
}

export function buildInternalMechanismsSatisfactionPayload(dataset, options = {}) {
  const filters = normalizeInternalMechanismsSatisfactionFilters(options.filters || {});
  const canonicalNpsClients = resolveCanonicalNpsClients(dataset);
  const npsPopulation = resolveNpsPopulation(dataset, filters, canonicalNpsClients);
  const wideFiltered = filterWideClients(dataset.wideClients || [], filters);
  const joinDiagnostics = diagnoseNpsClientJoin(
    dataset.wideClients || [],
    dataset.npsDedupedRows || [],
    dataset.npsMeta || {},
  );
  const pipelineDebug = buildPipelineDebug(dataset, canonicalNpsClients, filters);
  const catalog = dataset.catalog || [];
  const allWide = dataset.wideClients || [];
  const minMechN = filters.minMechanismSample || IMS_MECHANISM_MIN_N;

  const { withMechanism, withoutMechanism } = splitWithWithoutMechanism(npsPopulation);
  const comparison = buildComVsSemComparison(withMechanism, withoutMechanism);
  const groupTest = buildGroupStatisticalTest(withMechanism, withoutMechanism);
  const population = buildPopulationMeta(wideFiltered, npsPopulation, dataset.npsMeta || {}, joinDiagnostics);
  const temporalNps = buildTemporalNpsFlags(npsPopulation);
  const secondary = buildSecondaryCsatOnly(npsPopulation);

  const ranking = buildMechanismNpsRanking(npsPopulation, catalog, minMechN);
  const longFiltered = filterLongRows(dataset.longRows || [], dataset.wideClients || [], filters);
  const csatComVsSem = buildCsatComVsSem(withMechanism, withoutMechanism);
  const csatMechanismRanking = buildCsatMechanismRanking(npsPopulation, catalog, minMechN);
  const csatScoreDistribution = buildCsatScoreDistribution(withMechanism, withoutMechanism);
  const temporalNpsSummary = buildTemporalNpsSummary(npsPopulation);
  const temporalByMechanism = buildTemporalByMechanism(npsPopulation, longFiltered, catalog);
  const csatInsights = buildCsatInsights(csatComVsSem, 10);
  const sectionDiagnostics = buildImsSectionDiagnostics(
    npsPopulation,
    catalog,
    longFiltered,
    csatComVsSem,
    null,
    temporalNpsSummary,
    null,
  );

  const summary = {
    clientsWithNps: population.clientsWithNps,
    withNpsAndMechanism: population.withMechanism,
    withNpsWithoutMechanism: population.withoutMechanism,
    mechanismCoverageAmongNpsPct: population.mechanismCoverageAmongNps,
    portfolioNpsCoveragePct: population.portfolioNpsCoveragePct,
    npsIndexWithMechanism: comparison.withMechanism.npsIndex,
    npsIndexWithoutMechanism: comparison.withoutMechanism.npsIndex,
    meanScoreWithMechanism: comparison.withMechanism.meanScore,
    meanScoreWithoutMechanism: comparison.withoutMechanism.meanScore,
    medianScoreWithMechanism: comparison.withMechanism.medianScore,
    medianScoreWithoutMechanism: comparison.withoutMechanism.medianScore,
    csatAverage: secondary.csatAverage,
    csatRespondents: secondary.csatRespondents,
  };

  const filterOptions = {
    engineers: [...new Set(allWide.map((c) => c.ep).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    segments: [...new Set(allWide.map((c) => c.segment).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
  };

  const mechanismMatrix = buildNpsMechanismMatrix(npsPopulation, catalog, minMechN);
  mechanismMatrix.note = CAUSALITY_NOTE;

  const partitionCheck = assertNpsPopulationPartition(npsPopulation);
  const rankingClientIds = new Set(
    (catalog || []).flatMap((mech) => {
      const field = `implemented_${mech.slug}`;
      return npsPopulation.filter((c) => c[field]).map((c) => c.clientId);
    }),
  );
  const rankingSubsetValid = [...rankingClientIds].every((id) =>
    npsPopulation.some((c) => c.clientId === id),
  );

  const mechanismValidation = {};
  for (const probeName of ["Autoconstrução", "Arcadia", "Leilão Serial", "QVRA11", "ALABAMA"]) {
    const slug = mechanismSlugFromName(probeName);
    const field = `implemented_${slug}`;
    const mech = catalog.find((m) => m.slug === slug || m.name === probeName);
    const totalPortfolio = (dataset.wideClients || []).filter((c) => c[field]).length;
    const withNps = npsPopulation.filter((c) => c[field]).length;
    mechanismValidation[probeName] = {
      slug,
      catalogName: mech?.name || null,
      totalPortfolioWithMechanism: totalPortfolio,
      clientsWithNpsInCanonical: withNps,
      rankingRowClientsWithNps: ranking.find((r) => r.slug === slug)?.clientsWithNps ?? null,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    calculationVersion: IMS_SATISFACTION_CALCULATION_VERSION,
    experimental: true,
    badge: "Análise interna",
    filters,
    filterDefaults: {
      status: filters.status,
      note: "População principal: clientes com NPS válido (latest dedupe oficial). Status padrão: Ativo.",
    },
    methodology: {
      causalNote: CAUSALITY_NOTE,
      primaryUniverse: "Clientes com resposta NPS válida após filtros gerais (dedupe: submitted_at desc, created_at desc).",
      npsRule: "NPS (índice) = % promotores − % detratores. Nota média = média das notas 0–10 por cliente.",
      minMechanismSample: minMechN,
      groupTest: "Mann–Whitney U na nota 0–10 (com vs sem mecanismo); rank-biserial como tamanho de efeito.",
      sources: ["BASE QV — mechanisms-satisfaction-dataset"],
    },
    population,
    canonicalNpsClients: npsPopulation.map((c) => ({
      clientId: c.clientId,
      clientCode: c.clientCode,
      clientName: c.clientName,
      ep: c.ep,
      program: c.program,
      segment: c.segment,
      latestNps: c.latestNps,
      latestNpsDate: c.latestNpsDate,
      npsClass: c.latestNpsClass,
      npsResponseCount: c.npsResponseCount,
      hasMechanism: (c.totalImplementedMechanisms || 0) > 0,
      mechanismCount: c.totalImplementedMechanisms || 0,
      mechanismNames: c.implementedMechanismLabels || c.implementedMechanismNames,
    })),
    pipelineDebug,
    mechanismValidation,
    invariants: {
      clientsWithNpsEqualsCanonical: population.clientsWithNps === npsPopulation.length,
      partitionValid: partitionCheck.valid,
      rankingSubsetValid,
      summaryMatchesPopulation:
        summary.withNpsAndMechanism + summary.withNpsWithoutMechanism === summary.clientsWithNps,
    },
    npsJoin: joinDiagnostics,
    npsPopulationValid: partitionCheck.valid,
    summary,
    comVsSem: comparison,
    groupComparisonTest: groupTest,
    scoreDistribution: buildScoreDistribution(withMechanism, withoutMechanism),
    classComparison: {
      withMechanism: comparison.withMechanism,
      withoutMechanism: comparison.withoutMechanism,
    },
    segments: {
      withMechanism: {
        title: "Clientes com NPS e mecanismo",
        stats: comparison.withMechanism,
        distinctMechanisms: population.distinctMechanismsInAnalysis,
      },
      withoutMechanism: {
        title: "Clientes com NPS e sem mecanismo",
        stats: comparison.withoutMechanism,
      },
    },
    mechanismMatrix,
    mechanismRanking: ranking,
    charts: {
      scoreDistribution: buildScoreDistribution(withMechanism, withoutMechanism),
    },
    insights: [...buildNpsInsights(npsPopulation, comparison, ranking, groupTest, minMechN), ...csatInsights],
    csatAnalysis: {
      comVsSem: csatComVsSem,
      mechanismRanking: csatMechanismRanking,
      scoreDistribution: csatScoreDistribution,
    },
    secondaryAnalysis: secondary,
    temporal: {
      npsImplementation: temporalNps,
      npsSummary: temporalNpsSummary,
      byMechanism: temporalByMechanism,
    },
    catalog,
    filterOptions,
    npsClientsMeta: {
      total: npsPopulation.length,
      sortKeys: ["npsScore", "clientName", "mechanismCount", "npsDate"],
    },
    detailMeta: {
      totalRows: npsPopulation.length,
      kind: "nps_clients",
    },
    npsClientExportRows: buildNpsClientRows(npsPopulation),
    sectionDiagnostics,
  };
}

export async function computeInternalMechanismsSatisfactionPayload(options = {}) {
  return runWithAnalyticsDataContext(async () => {
    const configError = dataConfigurationError();
    if (configError) {
      const err = new Error(configError);
      err.code = "config";
      throw err;
    }
    const filters = options.filters || parseInternalMechanismsSatisfactionFilters(options.searchParams);
    const dataset = options.dataset || (await loadMechanismsSatisfactionDataset());
    const includeDetail = options.includeDetail === true;
    const payload = buildInternalMechanismsSatisfactionPayload(dataset, { filters });
    if (includeDetail) {
      const canonical = resolveCanonicalNpsClients(dataset);
      const npsPopulation = resolveNpsPopulation(dataset, filters, canonical);
      const allRows = buildNpsClientRows(npsPopulation);
      payload.detail = paginateNpsClients(allRows, {
        page: options.detailPage,
        pageSize: options.detailPageSize,
        sortKey: options.detailSort || "npsScore",
        sortDir: options.detailSortDir || "desc",
        search: filters.search,
      });
      payload.npsClientsAll = allRows;
    }
    return payload;
  }, { page: "internal_mechanisms_satisfaction", perfDebug: Boolean(options.perfDebug) });
}

export function toPublicInternalMechanismsSatisfactionPayload(payload) {
  const out = { ...payload };
  delete out.npsClientsAll;
  return out;
}

export { parseInternalMechanismsSatisfactionFilters };
