/**
 * Página Projeção Mecanismos × Renovação — payload A + B + comparação (sem alterar algoritmos).
 */
import { dataConfigurationError } from "../env.mjs";
import { runWithAnalyticsDataContext } from "./analytics-data-context.mjs";
import { buildAnalyticalCancellationMap, matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { civilDateInSaoPaulo } from "./client-cycle-renewal.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import {
  parseInternalMechanismsSatisfactionFilters,
  normalizeInternalMechanismsSatisfactionFilters,
} from "./internal-mechanisms-satisfaction-filters.mjs";
import { IMS_MECHANISM_MIN_N } from "./internal-mechanisms-nps-focus.mjs";
import {
  buildRenewalComVsSemFromPopulation,
  buildRenewalMechanismDetailedRanking,
} from "./internal-mechanisms-renewal-analysis.mjs";
import {
  buildMechanismAdoptionSeries,
  proposeMechanismEraCutoffs,
  MECHANISM_ERA_START_PRIMARY,
} from "./internal-mechanisms-renewal-historical-adoption.mjs";
import {
  buildCanonicalHistoricalRenewalPopulation,
  summarizeHistoricalPopulation,
} from "./internal-mechanisms-renewal-historical-population.mjs";
import {
  trainHistoricalStratifiedModel,
  mechanismCountBandTable,
  historicalMechanismAnalysis,
  comparisonDimensionVerdicts,
  populationQualityVerdict,
  temporalValidationVerdict,
} from "./internal-mechanisms-renewal-historical-model.mjs";
import {
  buildCanonicalRenewalPopulation,
  buildCanonicalAllClientsRenewalPopulation,
  summarizeRenewalPopulation,
  summarizeAllClientsRenewalPopulation,
  filterWideClientsForRenewalAnalysis,
  toStratifiedTrainingPool,
  mechanismCountBandTableFromCanonical,
  chartSplitItems,
} from "./internal-mechanisms-renewal-population.mjs";
import { safeAssessRenewalYearEndProjection, IMS_RENEWAL_PROJECTION_VERSION } from "./internal-mechanisms-renewal-projection.mjs";
import {
  fetchMechanismsSatisfactionRawData,
  loadMechanismsSatisfactionDataset,
  mechanismSlugFromName,
} from "./mechanisms-satisfaction-dataset.mjs";
import { blankToNull, parseDate } from "./meeting-metrics.mjs";
import { dedupeClientMechanisms } from "./mechanism-metrics.mjs";
import { CALCULATION_VERSION } from "../cache/analytics-cache.mjs";
import { STRATIFIED_CLIP, STRATIFIED_MIN_STRATUM } from "./internal-mechanisms-renewal-stratified-shared.mjs";

export const IMR_PAGE_CALCULATION_VERSION = `imr-projection-page-v2-all-base-${IMS_RENEWAL_PROJECTION_VERSION}-${CALCULATION_VERSION}`;

const EXPLORATORY_NOTE =
  "Esta análise é exploratória. Os resultados mostram associação histórica e capacidade preditiva, não causalidade.";

const MODEL_B_LIMITATION =
  "No Modelo B, clientes de diferentes momentos históricos são tratados juntos. Alguns clientes podem ter vivido em períodos em que mecanismos ainda eram pouco utilizados.";

function buildFinancialMap(financialRows) {
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
      debt: {},
    });
  }
  return map;
}

function buildHistoricalContext(raw) {
  const removedIds = excludedClientIds(raw.clientsRaw || []);
  const clients = filterExcludedClients(raw.clientsRaw || []);
  const cancellations = (raw.cancelRaw || []).filter((row) => !removedIds.has(String(row.client_id || "")));
  const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations, clients);
  const { rows: cmRows } = dedupeClientMechanisms(
    (raw.cmRaw || []).filter((row) => !removedIds.has(String(row.client_id || ""))),
  );
  const financialMap = buildFinancialMap(
    (raw.finRaw || []).filter((row) => !removedIds.has(String(row.client_id || ""))),
  );
  const mechMap = new Map((raw.mechRaw || []).map((m) => [String(m.id), m]));
  const catalog = (raw.mechRaw || []).map((m) => ({
    id: m.id,
    name: m.name,
    slug: mechanismSlugFromName(m.name),
  }));
  return { clients, cmRows, mechMap, cancelMap, financialMap, catalog, removedIds };
}

function sharedModelDefinition(modelAudit = {}) {
  return {
    type: modelAudit.algorithm || "Taxas estratificadas (programa × faixa de mecanismos)",
    features: modelAudit.featuresUsed || ["programa", "faixa de quantidade de mecanismos"],
    plainSummary:
      "O modelo coloca clientes parecidos em grupos e calcula a taxa histórica de renovação daquele grupo.",
    formula: modelAudit.hyperparameters || modelAudit.algorithm
      ? {
          taxa_base: "renovados_treino / N_treino",
          taxa_ajustada: "(renovados_grupo + 2 × taxa_base) / (N_grupo + 2)",
          shrinkageLabel: "Ajuste para grupos pequenos",
          fallback: "taxa_base quando N_estrato < minStratumN",
          clipLabel: `Limite das probabilidades: ${STRATIFIED_CLIP.low * 100}% a ${STRATIFIED_CLIP.high * 100}%`,
          minStratumLabel: `Amostra mínima do grupo: ${STRATIFIED_MIN_STRATUM} clientes`,
        }
      : null,
  };
}

function buildModelA(dataset, filters, catalog, minMechN) {
  const allWide = dataset.wideClients || [];
  const filtersA = normalizeInternalMechanismsSatisfactionFilters({ ...filters, status: "active" });
  const pop = buildCanonicalRenewalPopulation(allWide, filtersA);
  const popSummary = summarizeRenewalPopulation(pop);
  const activeOfficial = pop.filter((c) => matchesAnalyticalStatusFilter(c.analyticalStatus, "active")).length;
  const renewalPortfolioActive = filterWideClientsForRenewalAnalysis(allWide, filtersA).filter((c) =>
    matchesAnalyticalStatusFilter(c.analyticalStatus, "active"),
  );
  const renewalYearEndProjection = safeAssessRenewalYearEndProjection(null, {
    portfolioClients: renewalPortfolioActive,
    wideClients: allWide,
    filters: filtersA,
    renewalPopulation: pop,
    catalog,
    minMechanismSample: minMechN,
  });
  const renewalAnalysis = {
    comVsSem: buildRenewalComVsSemFromPopulation(pop),
    mechanismRanking: buildRenewalMechanismDetailedRanking(pop, catalog, minMechN),
  };
  const modelAudit = renewalYearEndProjection?.exploratory?.modelAudit || {};
  const perf = modelAudit.performance || {};
  const sampleSizes = modelAudit.sampleSizes || {};
  const split = modelAudit.split || {};
  const bands = mechanismCountBandTableFromCanonical(pop);

  return {
    label: "BASE ATIVA",
    badge: "PRODUÇÃO ATUAL",
    population: {
      activeOfficialAnalytical: activeOfficial,
      clientsUsed: popSummary.eligible,
      canonicalRenewalUniverse: popSummary.totalInUniverse,
      cycleValid: popSummary.eligible,
      renewed: popSummary.renewed,
      notYetRenewedRegistered: popSummary.notRenewed,
      withMechanism: popSummary.withMechanism,
      withoutMechanism: popSummary.withoutMechanism,
      renewedWithMechanism: popSummary.renewedWithMechanism,
      renewedWithoutMechanism: popSummary.renewedWithoutMechanism,
      targetNote: popSummary.officialRules?.targetNote || null,
    },
    charts: {
      mechanismSplit: chartSplitItems(popSummary.withMechanism, popSummary.withoutMechanism),
      renewalSplit: chartSplitItems(popSummary.renewed, popSummary.notRenewed, {
        with: "Renovados",
        without: "Ainda sem renovação registrada",
      }),
      mechanismBands: bands,
    },
    split: {
      type: split.type || "hash holdout por client_id",
      trainShare: split.trainShare ?? 0.8,
      testShare: split.testShare ?? 0.2,
      nTrain: sampleSizes.nTrain,
      nTest: sampleSizes.nTest,
      renewedTrain: sampleSizes.renewedTrain,
      renewedTest: sampleSizes.renewedTest,
      notRenewedTrain: sampleSizes.notRenewedTrain,
      notRenewedTest: sampleSizes.notRenewedTest,
      baseRate: sampleSizes.baseRate,
    },
    modelDefinition: sharedModelDefinition(modelAudit),
    metrics: { ...perf },
    confusion: {
      threshold: perf.threshold ?? 0.5,
      tp: perf.tp,
      fp: perf.fp,
      tn: perf.tn,
      fn: perf.fn,
    },
    thresholdSweep: modelAudit.thresholdSweep || [],
    calibrationBins: modelAudit.calibrationBins || [],
    mechanismRanking: renewalAnalysis.mechanismRanking?.rows || [],
    topByRawRate: renewalAnalysis.mechanismRanking?.topByRawRate || [],
    comVsSem: renewalAnalysis.comVsSem,
    renewalYearEndProjection,
  };
}

function buildModelBAllClients(dataset, filters, catalog, minMechN) {
  const allWide = dataset.wideClients || [];
  const pop = buildCanonicalAllClientsRenewalPopulation(allWide, filters);
  const popSummary = summarizeAllClientsRenewalPopulation(pop);
  const trainingPool = toStratifiedTrainingPool(pop);
  const trained = trainHistoricalStratifiedModel(trainingPool);
  const perf = trained.performance || {};
  const splitMeta = trained.modelAudit?.split || {};
  const bands = mechanismCountBandTableFromCanonical(pop);
  const renewalAnalysis = {
    comVsSem: buildRenewalComVsSemFromPopulation(pop.filter((c) => c.cycleValid)),
    mechanismRanking: buildRenewalMechanismDetailedRanking(pop.filter((c) => c.cycleValid), catalog, minMechN),
  };

  return {
    label: "BASE COMPLETA",
    badge: "EXPERIMENTO",
    available: trained.available !== false,
    limitationNote: MODEL_B_LIMITATION,
    population: {
      totalClients: popSummary.totalClients,
      cycleValid: popSummary.eligible,
      renewed: popSummary.renewed,
      notYetRenewedRegistered: popSummary.notRenewed,
      withMechanism: popSummary.withMechanism,
      withoutMechanism: popSummary.withoutMechanism,
      active: popSummary.active,
      cancelled: popSummary.cancelled,
      frozen: popSummary.frozen,
      other: popSummary.other,
    },
    charts: {
      statusDistribution: (popSummary.statusDistribution || []).map((r) => ({
        ...r,
        percent: popSummary.totalClients
          ? Math.round((r.count / popSummary.totalClients) * 1000) / 10
          : 0,
      })),
      mechanismSplit: chartSplitItems(popSummary.withMechanism, popSummary.withoutMechanism),
      renewalSplit: chartSplitItems(popSummary.renewed, popSummary.notRenewed, {
        with: "Renovados",
        without: "Sem renovação registrada",
      }),
      mechanismBands: bands,
    },
    split: {
      type: splitMeta.type || "hash_holdout_client_id_seed_42",
      trainShare: splitMeta.trainShare ?? 0.8,
      testShare: splitMeta.testShare ?? 0.2,
      nTrain: trained.trainRows?.length ?? splitMeta.nTrain,
      nTest: trained.testRows?.length ?? splitMeta.nTest,
      renewedTrain: trained.trainRows?.filter((c) => c.y === 1).length,
      renewedTest: trained.testRows?.filter((c) => c.y === 1).length,
      baseRate: trained.baseRate,
      hashHoldoutRule: splitMeta.hashHoldoutRule || "80% treino / 20% teste · hash(client_id) seed 42",
    },
    modelDefinition: sharedModelDefinition(trained.modelAudit),
    metrics: trained.available === false ? {} : { ...perf },
    confusion: trained.available === false
      ? {}
      : {
          threshold: perf.threshold ?? 0.5,
          tp: perf.tp,
          fp: perf.fp,
          tn: perf.tn,
          fn: perf.fn,
        },
    thresholdSweep: trained.modelAudit?.thresholdSweep || [],
    calibrationBins: trained.modelAudit?.calibrationBins || [],
    mechanismRanking: renewalAnalysis.mechanismRanking?.rows || [],
    topByRawRate: renewalAnalysis.mechanismRanking?.topByRawRate || [],
    comVsSem: renewalAnalysis.comVsSem,
    trainUnavailableReason: trained.available === false ? trained.reason : null,
    projectionOperational: false,
    projectionNote: "Modelo B ainda não publicado para projeção operacional.",
  };
}

/** Análise auxiliar — população historicamente comparável (antigo Modelo B1). */
function buildHistoricalComparablePopulation(histCtx, today) {
  const adoption = buildMechanismAdoptionSeries(histCtx.cmRows, histCtx.clients, histCtx.cancelMap);
  const eraProposal = proposeMechanismEraCutoffs(adoption);
  const primaryCutoff =
    eraProposal.cutoffs.find((c) => c.id === MECHANISM_ERA_START_PRIMARY)
    || eraProposal.cutoffs.find((c) => c.id === "intermediate")
    || eraProposal.cutoffs[0];

  const sensitivity = (eraProposal.cutoffs || []).map((cutoff) => {
    const built = buildCanonicalHistoricalRenewalPopulation({
      clients: histCtx.clients,
      cmRows: histCtx.cmRows,
      mechMap: histCtx.mechMap,
      cancelMap: histCtx.cancelMap,
      financialMap: histCtx.financialMap,
      eraStart: cutoff.eraStart,
      today,
    });
    const summary = summarizeHistoricalPopulation(built.population);
    const model = trainHistoricalStratifiedModel(built.population);
    return { cutoff, built, summary, model };
  });

  const primary =
    sensitivity.find((s) => s.cutoff?.id === primaryCutoff?.id && s.built)
    || sensitivity.find((s) => s.built)
    || null;

  const adoptionChart = (adoption.monthly || []).map((m) => ({
    month: m.month,
    clientsFirstImplementation: m.clientsFirstImplementation,
    totalImplementations: m.totalImplementations,
  }));

  return {
    title: "Análise auxiliar — população historicamente comparável",
    note: "Não é o Modelo B oficial. Serve apenas para sensibilidade temporal (cortes de era dos mecanismos).",
    era: {
      firstImplementationDate: adoption.firstImplementationDate,
      cutoffs: eraProposal.cutoffs || [],
      primaryCutoff: primary?.cutoff || primaryCutoff,
    },
    adoptionSeries: adoptionChart,
    primary: primary
      ? {
          summary: primary.summary,
          excluded: primary.built.excluded,
          metrics: primary.model?.performance || null,
          split: primary.model?.modelAudit?.split || null,
          temporalValidation: temporalValidationVerdict(primary.model),
        }
      : null,
    sensitivity: sensitivity.map((s) => ({
      cutoff: s.cutoff,
      summary: s.summary,
      metrics: s.model?.performance || null,
      available: s.model?.available,
    })),
    quality: primary
      ? {
          population: populationQualityVerdict(primary.summary, primary.built.excluded),
          temporalValidation: temporalValidationVerdict(primary.model),
        }
      : null,
  };
}

function buildComparison(modelA, modelB) {
  const popA = modelA.population || {};
  const popB = modelB.population || {};
  const mA = modelA.metrics || {};
  const mB = modelB.metrics || {};
  const rows = [
    { group: "populacao", metric: "populacao", label: "Clientes no treino (ciclo válido)", a: popA.cycleValid ?? popA.clientsUsed, b: popB.cycleValid, interpret: "Quantos clientes entram no aprendizado do modelo." },
    { group: "populacao", metric: "renewed", label: "Renovados", a: popA.renewed, b: popB.renewed, interpret: "Clientes com ciclo > 1 (renovação inferida)." },
    { group: "populacao", metric: "with_mechanism", label: "Com mecanismo", a: popA.withMechanism, b: popB.withMechanism, interpret: "Pelo menos um mecanismo implementado." },
    { group: "populacao", metric: "without_mechanism", label: "Sem mecanismo", a: popA.withoutMechanism, b: popB.withoutMechanism, interpret: "Nenhum mecanismo registrado." },
    { group: "treino", metric: "n_train", label: "Treino", a: modelA.split?.nTrain, b: modelB.split?.nTrain, interpret: "Parte usada para aprender." },
    { group: "treino", metric: "n_test", label: "Teste", a: modelA.split?.nTest, b: modelB.split?.nTest, interpret: "Parte reservada para avaliar." },
    { group: "classificacao", metric: "accuracy", label: "Accuracy", a: mA.accuracy, b: mB.accuracy, interpret: "Acertos totais — pode parecer alta quando renovação é minoria." },
    { group: "classificacao", metric: "balanced_accuracy", label: "Balanced accuracy", a: mA.balancedAccuracy, b: mB.balancedAccuracy, interpret: "Equilibra acerto em renovados e não renovados." },
    { group: "classificacao", metric: "precision", label: "Precision", a: mA.precision, b: mB.precision, interpret: "Dos previstos como renovação, quantos renovaram." },
    { group: "classificacao", metric: "recall", label: "Recall", a: mA.recall, b: mB.recall, interpret: "Dos que renovaram, quantos o modelo encontrou." },
    { group: "classificacao", metric: "f1", label: "F1", a: mA.f1, b: mB.f1, interpret: "Equilíbrio entre precision e recall." },
    { group: "ranking", metric: "roc_auc", label: "ROC-AUC", a: mA.rocAuc, b: mB.rocAuc, interpret: "Capacidade de ordenar maior vs menor chance." },
    { group: "ranking", metric: "pr_auc", label: "PR-AUC", a: mA.prAuc, b: mB.prAuc, interpret: "Foco em encontrar renovações (classe rara)." },
    { group: "probabilidade", metric: "brier", label: "Brier", a: mA.brier, b: mB.brier, interpret: "Erro das probabilidades — menor é melhor." },
    { group: "probabilidade", metric: "baseline_brier", label: "Baseline Brier", a: mA.baselineBrier, b: mB.baselineBrier, interpret: "Referência simples para calibrar probabilidades." },
  ];
  return {
    rows,
    chartMetrics: ["roc_auc", "pr_auc", "balanced_accuracy", "recall", "f1"],
    dimensions: comparisonDimensionVerdicts(
      { metrics: mA },
      { available: modelB.available !== false, performance: mB, calibrationOk: modelB.metrics?.brier != null },
      null,
    ),
    noWinnerCallout:
      "Os dois modelos permanecem em avaliação. Métricas melhores em B não substituem limitações de base histórica e projeção operacional.",
  };
}

export function buildInternalMechanismsRenewalProjectionPagePayload(dataset, raw, options = {}) {
  const filters = normalizeInternalMechanismsSatisfactionFilters(options.filters || {});
  const catalog = dataset.catalog || [];
  const minMechN = filters.minMechanismSample || IMS_MECHANISM_MIN_N;
  const today = civilDateInSaoPaulo();
  const histCtx = buildHistoricalContext(raw);
  const adoption = buildMechanismAdoptionSeries(histCtx.cmRows, histCtx.clients, histCtx.cancelMap);

  const modelA = buildModelA(dataset, filters, catalog, minMechN);
  const modelB = buildModelBAllClients(dataset, filters, catalog, minMechN);
  modelB.adoptionTimeline = {
    firstImplementationDate: adoption.firstImplementationDate,
    monthly: (adoption.monthly || []).map((m) => ({
      month: m.month,
      clientsFirstImplementation: m.clientsFirstImplementation,
    })),
  };
  const historicalComparablePopulation = buildHistoricalComparablePopulation(histCtx, today);
  const comparison = buildComparison(modelA, modelB);

  const mechanismScatter = (modelA.mechanismRanking || [])
    .filter((r) => r.clients >= minMechN)
    .map((r) => ({
      name: r.mechanismName,
      n: r.clients,
      ratePct: r.renewalRatePct,
      renewed: r.renewed,
      diffPp: r.diffVsWithoutMechanismPct,
    }));

  return {
    generatedAt: new Date().toISOString(),
    calculationVersion: IMR_PAGE_CALCULATION_VERSION,
    exploratoryNote: EXPLORATORY_NOTE,
    filters,
    modelA,
    modelB,
    historicalComparablePopulation,
    comparison,
    mechanismInsights: {
      bands: modelA.charts?.mechanismBands || [],
      ranking: modelA.mechanismRanking || [],
      scatter: mechanismScatter,
      minSample: minMechN,
      note: "Mecanismos específicos não entram na fórmula do modelo (programa × faixa). Análise histórica complementar.",
    },
    productionModel: "A",
    causalNote:
      "Mecanismos específicos não entram diretamente na fórmula do modelo atual (programa × faixa de quantidade). Rankings são análise histórica complementar.",
    businessRenewal: {
      source: "modelA_base_ativa",
      comVsSem: modelA.comVsSem,
      mechanismRanking: modelA.mechanismRanking || [],
      topByRawRate: modelA.topByRawRate || [],
      mechanismBands: modelA.charts?.mechanismBands || [],
      minSample: minMechN,
    },
  };
}

export async function computeInternalMechanismsRenewalProjectionPagePayload(options = {}) {
  return runWithAnalyticsDataContext(async () => {
    const configError = dataConfigurationError();
    if (configError) {
      const err = new Error(configError);
      err.code = "config";
      throw err;
    }
    const filters = options.filters || parseInternalMechanismsSatisfactionFilters(options.searchParams);
    const [dataset, raw] = await Promise.all([
      options.dataset || loadMechanismsSatisfactionDataset(),
      options.raw || fetchMechanismsSatisfactionRawData(),
    ]);
    return buildInternalMechanismsRenewalProjectionPagePayload(dataset, raw, { filters });
  }, { page: "internal_mechanisms_renewal_projection", perfDebug: Boolean(options.perfDebug) });
}

export function toPublicInternalMechanismsRenewalProjectionPayload(payload) {
  return payload;
}

export { parseInternalMechanismsSatisfactionFilters };
