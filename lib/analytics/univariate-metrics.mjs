/**
 * Registry univariado + compute otimizado (cancelamento / renovação).
 * Cada variável é analisada uma vez; ranking/matrizes reutilizam o registry.
 */
import {
  associationStrength,
  buildContingencyFromGroups,
  chiSquareIndependence,
  coveragePct,
  fisherExact2x2,
  kaplanMeier,
  logRank,
  logisticUnivariateAuc,
  mannWhitney,
  mean,
  median,
  pointBiserial,
  pooledSd,
  round3,
  round4,
  sampleSd,
  standardizedDifference,
} from "./stats-tests.mjs";
import {
  getChurnCategoricalLabels,
  getChurnNumericSeries,
  getRenewalCategoricalLabels,
  getRenewalNumericSeries,
} from "./stat-analysis-context.mjs";
import { civilDateInSaoPaulo } from "./client-cycle-renewal.mjs";

const MIN_DESCRIPTIVE = 5;
const MIN_KM_GROUP = 20;
const RENEWAL_EXCLUDE_FIELDS = new Set(["renewalCount", "currentCycle", "hasRenewed", "renewed"]);

function pct(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function isConstantValues(aVals, cVals) {
  if (!aVals.length && !cVals.length) return true;
  let min = Infinity;
  let max = -Infinity;
  for (const v of aVals) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  for (const v of cVals) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === max;
}

function downsampleCurve(curve, maxPoints) {
  if (!curve?.length || curve.length <= maxPoints) return curve || [];
  const out = [curve[0]];
  const step = (curve.length - 2) / (maxPoints - 2);
  for (let i = 1; i < maxPoints - 1; i += 1) {
    out.push(curve[Math.round(i * step)]);
  }
  out.push(curve[curve.length - 1]);
  return out;
}

function kmFromClients(subset, maxPoints = 40) {
  const km = kaplanMeier(subset.map((c) => ({ time: c.survivalTime, event: c.survivalEvent })));
  return {
    ...km,
    curve: downsampleCurve(km.curve, maxPoints),
  };
}

function analyzeNumericChurn(def, series, minSample) {
  const aVals = series.aVals;
  const cVals = series.cVals;
  const xs = series.xs;
  const ys = series.ys;
  const miss = series.miss;
  const coveragePercent = Math.round((100 - miss) * 10) / 10;
  const nA = aVals.length;
  const nC = cVals.length;
  const warnings = [];
  const descriptiveOk = nA >= MIN_DESCRIPTIVE && nC >= MIN_DESCRIPTIVE;
  const inferenceOk = nA >= minSample && nC >= minSample;
  if (!inferenceOk) warnings.push("baixa amostra");
  if (miss >= 40) warnings.push("alta ausência");

  const medA = median(aVals);
  const medC = median(cVals);
  const meanA = mean(aVals);
  const meanC = mean(cVals);
  const sdA = sampleSd(aVals);
  const sdC = sampleSd(cVals);
  const sdPool = pooledSd(aVals, cVals);
  const stdDiff = standardizedDifference(medC, medA, sdPool);
  let diffAbs = null;
  let diffPct = null;
  if (medA != null && medC != null) {
    diffAbs = round3(medC - medA);
    if (medA !== 0) diffPct = pct(medC - medA, Math.abs(medA));
  }

  const mw = mannWhitney(aVals, cVals);
  if (mw.warning) warnings.push(mw.warning);

  const pb = pointBiserial(xs, ys);
  if (pb.warning) warnings.push(pb.warning);

  let aucResult = { auc: null, warning: "excluded" };
  if (def.predictive) {
    aucResult = logisticUnivariateAuc(xs, ys);
    if (aucResult.warning) warnings.push(aucResult.warning);
  } else {
    warnings.push("excluída do AUC (vazamento/censura)");
  }

  const effect = pb.r != null ? Math.abs(pb.r) : (mw.rankBiserial != null ? Math.abs(mw.rankBiserial) : null);
  const direction = pb.r == null ? null : (pb.r > 0 ? "maior nos cancelados" : pb.r < 0 ? "maior nos ativos" : "neutra");

  let status = "available";
  let reason = null;
  if (!descriptiveOk) {
    status = nA === 0 || nC === 0 ? "insufficient_groups" : "small_sample";
    reason = `Amostra descritiva insuficiente (ativos=${nA}, cancelados=${nC}; mín=${MIN_DESCRIPTIVE})`;
  } else if (pb.warning === "zero_variance" || isConstantValues(aVals, cVals)) {
    status = "constant";
    reason = "Variável constante no recorte";
  } else if (!inferenceOk) {
    status = "small_sample";
    reason = "Amostra pequena para inferência — medianas descritivas disponíveis";
  } else if (pb.r == null && descriptiveOk) {
    status = "small_sample";
    reason = pb.warning || "Associação não calculável; medianas disponíveis";
  }

  const row = {
    id: def.id,
    label: def.label,
    type: "numeric",
    source: def.source,
    predictiveEligible: Boolean(def.predictive),
    note: def.note || null,
    status,
    reason,
    activeMedian: round3(medA),
    cancelledMedian: round3(medC),
    medianActive: round3(medA),
    medianCancelled: round3(medC),
    medianNonCancelled: round3(medA),
    activeMean: round3(meanA),
    cancelledMean: round3(meanC),
    sdActive: round3(sdA),
    sdCancelled: round3(sdC),
    sdPooled: round3(sdPool),
    pooledSd: round3(sdPool),
    stdDiff,
    standardizedDifference: stdDiff,
    differenceAbs: diffAbs,
    differencePct: diffPct,
    diff: diffAbs,
    diffAbs,
    activeN: nA,
    cancelledN: nC,
    nActive: nA,
    nCancelled: nC,
    n: nA + nC,
    sampleSize: nA + nC,
    missingPercent: miss,
    coveragePercent,
    coverage: coveragePercent,
    associationMeasure: "point_biserial",
    association: pb.r,
    associationAbs: effect,
    absMeasure: effect,
    abs: effect,
    value: pb.r,
    measure: "point-biserial",
    strength: associationStrength(effect, "r"),
    associationStrength: associationStrength(effect, "r"),
    associationLabel: "Associação com cancelamento",
    effectSize: mw.rankBiserial,
    effectSizeMeasure: "rank_biserial",
    pValue: mw.pValue,
    test: "Mann–Whitney U",
    auc: aucResult.auc,
    aucRaw: aucResult.aucRaw ?? null,
    aucInverted: aucResult.aucInverted ?? false,
    aucDirection: aucResult.direction ?? null,
    sampleSmall: !inferenceOk,
    methodology: {
      comparison: "mediana prioritária; Mann–Whitney U (p bilateral, aprox. normal)",
      association: "point-biserial (numérico × cancelado)",
      auc: def.predictive ? "regressão logística univariada + AUC com CV estratificada" : "não aplicável",
    },
    warnings: [...new Set(warnings)],
  };

  return {
    row,
    registry: {
      association: pb.r,
      auc: aucResult.auc,
      coverage: coveragePercent,
      standardizedDifference: stdDiff,
      direction,
      n: nA + nC,
    },
  };
}

function analyzeCategoricalChurn(def, labelPack, active, cancelled, minSample) {
  const aLabs = labelPack.activeLabels;
  const cLabs = labelPack.cancelledLabels;
  const miss = labelPack.miss ?? 0;
  const warnings = [];
  const nA = labelPack.activeN ?? active.length;
  const nC = labelPack.cancelledN ?? cancelled.length;
  if (nA < minSample || nC < minSample) warnings.push("baixa amostra");
  if (miss >= 40) warnings.push("alta ausência");
  if (def.caution) warnings.push(def.caution);

  const { table, labels } = buildContingencyFromGroups(aLabs, cLabs);
  let chi = { chi2: null, pValue: null, cramersV: null, warning: "empty" };
  let fisher = null;
  if (table) {
    chi = chiSquareIndependence(table);
    if (chi.warning) warnings.push(chi.warning);
    if (labels.length === 2) {
      fisher = fisherExact2x2(table[0][0], table[0][1], table[1][0], table[1][1]);
    }
  }

  const dist = labels.map((lab, idx) => {
    const aN = table[0][idx];
    const cN = table[1][idx];
    const aP = pct(aN, nA || 1);
    const cP = pct(cN, nC || 1);
    return {
      label: lab,
      activeCount: aN,
      cancelledCount: cN,
      activePercent: aP,
      cancelledPercent: cP,
      diffPp: round3((cP ?? 0) - (aP ?? 0)),
    };
  }).sort((a, b) => Math.abs(b.diffPp) - Math.abs(a.diffPp));

  let aucResult = { auc: null, warning: "not_applicable" };
  if (def.predictive && labels.length === 2) {
    const posLabel = labels[0];
    const xs = [];
    const ys = [];
    for (let i = 0; i < aLabs.length; i += 1) {
      xs.push(aLabs[i] === posLabel ? 1 : 0);
      ys.push(0);
    }
    for (let i = 0; i < cLabs.length; i += 1) {
      xs.push(cLabs[i] === posLabel ? 1 : 0);
      ys.push(1);
    }
    aucResult = logisticUnivariateAuc(xs, ys);
    if (aucResult.warning) warnings.push(aucResult.warning);
  } else if (def.predictive && labels.length > 2) {
    if (labels.length > 8 || def.id === "engineer") {
      warnings.push("AUC não calculado (muitos níveis / risco de vazamento de encoding)");
      aucResult = { auc: null, warning: "high_cardinality" };
    } else {
      const rate = new Map();
      for (let idx = 0; idx < labels.length; idx += 1) {
        const lab = labels[idx];
        const n = table[0][idx] + table[1][idx];
        const e = table[1][idx];
        rate.set(lab, n ? e / n : 0);
      }
      const xs = [];
      const ys = [];
      for (let i = 0; i < aLabs.length; i += 1) {
        xs.push(rate.get(aLabs[i]) ?? 0);
        ys.push(0);
      }
      for (let i = 0; i < cLabs.length; i += 1) {
        xs.push(rate.get(cLabs[i]) ?? 0);
        ys.push(1);
      }
      aucResult = logisticUnivariateAuc(xs, ys);
      warnings.push("encoding categórico com taxa amostral (vazamento leve) — interpretar com cautela");
      if (aucResult.warning) warnings.push(aucResult.warning);
    }
  }

  const effect = chi.cramersV;
  const coveragePercent = Math.round((100 - miss) * 10) / 10;
  const descriptiveOk = nA >= MIN_DESCRIPTIVE && nC >= MIN_DESCRIPTIVE;
  const inferenceOk = nA >= minSample && nC >= minSample;
  let status = "available";
  let reason = null;
  if (!descriptiveOk) {
    status = "insufficient_groups";
    reason = `Grupos insuficientes (ativos=${nA}, cancelados=${nC})`;
  } else if (effect == null) {
    status = "small_sample";
    reason = chi.warning || "Cramér V não calculável";
  } else if (!inferenceOk) {
    status = "small_sample";
    reason = "Amostra pequena para inferência — contingência descritiva disponível";
  }

  const row = {
    id: def.id,
    label: def.label,
    type: "categorical",
    source: def.source,
    predictiveEligible: Boolean(def.predictive),
    status,
    reason,
    activeN: nA,
    cancelledN: nC,
    nActive: nA,
    nCancelled: nC,
    n: nA + nC,
    sampleSize: nA + nC,
    missingPercent: miss,
    coveragePercent,
    coverage: coveragePercent,
    distribution: dist,
    associationMeasure: "cramers_v",
    association: chi.cramersV,
    associationAbs: effect,
    absMeasure: effect,
    abs: effect,
    value: chi.cramersV,
    measure: "cramers-v",
    strength: associationStrength(effect, "cramers_v"),
    associationStrength: associationStrength(effect, "cramers_v"),
    associationLabel: "Associação com cancelamento",
    effectSize: chi.cramersV,
    effectSizeMeasure: "cramers_v",
    pValue: fisher?.pValue ?? chi.pValue,
    test: fisher ? "Fisher exact (2×2) / qui-quadrado" : "Qui-quadrado",
    chi2: chi.chi2,
    auc: aucResult.auc,
    aucRaw: aucResult.aucRaw ?? null,
    aucInverted: aucResult.aucInverted ?? false,
    aucDirection: aucResult.direction ?? null,
    sampleSmall: !inferenceOk,
    medianActive: null,
    medianCancelled: null,
    activeMedian: null,
    cancelledMedian: null,
    diff: dist[0]?.diffPp ?? null,
    differenceAbs: dist[0]?.diffPp ?? null,
    methodology: {
      comparison: "diferença em pontos percentuais por categoria",
      association: "Cramér’s V (+ Fisher se 2×2)",
      auc: def.predictive ? "logística univariada + AUC CV" : "não aplicável",
    },
    warnings: [...new Set(warnings)],
  };

  return {
    row,
    registry: {
      association: chi.cramersV,
      auc: aucResult.auc,
      coverage: coveragePercent,
      standardizedDifference: null,
      direction: null,
      n: nA + nC,
    },
  };
}

function buildSurvivalSection(ctx, clients, includeFrozenSeparate) {
  const survRecords = ctx.survivalRecords;
  const overall = kaplanMeier(survRecords);
  const groups = [];
  const groupField = "segment";

  for (const [level, subset] of ctx.survivalBySegment.entries()) {
    if (subset.length < MIN_KM_GROUP) continue;
    const km = kmFromClients(subset);
    groups.push({
      field: groupField,
      level,
      n: subset.length,
      events: km.events,
      censored: km.censored,
      medianSurvival: km.medianSurvival,
      curve: km.curve,
    });
  }
  groups.sort((a, b) => b.n - a.n);

  let logRankResult = null;
  if (groups.length >= 2) {
    const g0 = ctx.survivalBySegment.get(groups[0].level) || [];
    const g1 = ctx.survivalBySegment.get(groups[1].level) || [];
    logRankResult = {
      groupA: groups[0].level,
      groupB: groups[1].level,
      ...logRank(
        g0.map((c) => ({ time: c.survivalTime, event: c.survivalEvent })),
        g1.map((c) => ({ time: c.survivalTime, event: c.survivalEvent })),
      ),
      note: "Comparação log-rank entre os dois maiores segmentos; múltiplas comparações não corrigidas.",
    };
  }

  const buckets = ctx.survivalBuckets?.binary || {};
  for (const field of ["hasFinancialData", "hasMeeting", "hasMechanism", "hasRenewed"]) {
    const fieldBuckets = buckets[field];
    if (!fieldBuckets) continue;
    for (const level of [true, false]) {
      const subset = fieldBuckets[level];
      if (!subset || subset.length < MIN_KM_GROUP) continue;
      const km = kmFromClients(subset);
      groups.push({
        field,
        level: level ? "Sim" : "Não",
        n: subset.length,
        events: km.events,
        censored: km.censored,
        medianSurvival: km.medianSurvival,
        curve: km.curve,
      });
    }
  }

  const byField = ctx.survivalBuckets?.byField || new Map();
  for (const field of ["npsClass", "engineer"]) {
    const levelMap = byField.get(field);
    if (!levelMap) continue;
    for (const [level, subset] of levelMap.entries()) {
      if (subset.length < MIN_KM_GROUP) continue;
      const km = kmFromClients(subset);
      groups.push({
        field,
        level: String(level),
        n: subset.length,
        events: km.events,
        censored: km.censored,
        medianSurvival: km.medianSurvival,
        curve: km.curve,
      });
    }
  }

  const events = survRecords.filter((r) => r.event === 1).length;
  const censored = survRecords.filter((r) => r.event === 0).length;
  let cancelledWithDate = 0;
  let cancelledWithoutDate = 0;
  let unknownClients = 0;
  for (const c of clients) {
    if (c.isCancelled && c.hasConfirmedDate) cancelledWithDate += 1;
    if (c.isCancelled && c.cancelledWithoutDate) cancelledWithoutDate += 1;
    if (!c.isActive && !c.isCancelled && !c.isFrozen) unknownClients += 1;
  }

  return {
    populationExtras: { cancelledWithDate, cancelledWithoutDate, unknownClients, events, censored },
    survival: {
      overall: {
        ...overall,
        curve: downsampleCurve(overall.curve, 60),
        excluded: cancelledWithoutDate,
        excludedNoDate: cancelledWithoutDate,
        definition: {
          start: "data de contratação (data_inicio_ciclo ou created_at)",
          event: "cancelamento analítico com data consolidada",
          censor: "clientes sem cancelamento — tempo até a data de geração",
        },
      },
      groups,
      atRisk: survRecords.length,
      logRank: logRankResult,
      cutoffDate: civilDateInSaoPaulo(new Date()) || null,
    },
  };
}

function associationFromChurnRow(row) {
  return {
    id: row.id,
    label: row.label,
    type: row.type,
    status: row.status,
    reason: row.reason || null,
    association: row.association,
    associationAbs: row.associationAbs,
    absMeasure: row.associationAbs,
    abs: row.associationAbs,
    value: row.association,
    strength: row.associationStrength,
    direction: row.association != null && row.association > 0
      ? "positiva_com_cancelamento"
      : row.association < 0
        ? "negativa_com_cancelamento"
        : null,
    sample: row.activeN + row.cancelledN,
    n: row.activeN + row.cancelledN,
    activeN: row.activeN,
    cancelledN: row.cancelledN,
    nActive: row.activeN,
    nCancelled: row.cancelledN,
    missingPercent: row.missingPercent,
    coveragePercent: row.coveragePercent,
    coverage: row.coveragePercent,
    measure: row.associationMeasure,
    sampleSmall: row.sampleSmall,
  };
}

/**
 * @param {object} ctx — buildStatAnalysisContext
 * @param {{ numericVars, categoricalVars, minSample, minCoverage, includeFrozenSeparate, methodologyExcluded, section? }} opts
 */
export function buildChurnAnalysis(ctx, opts) {
  const {
    numericVars,
    categoricalVars,
    minSample,
    minCoverage,
    includeFrozenSeparate = false,
    methodologyExcluded = [],
    section = null,
  } = opts;

  const mark = (name, fn) => (section ? section.mark(name, fn) : fn());
  const clients = ctx.clients;
  const active = ctx.active;
  const cancelled = ctx.cancelled;
  const frozen = ctx.frozen;

  const univariateMetrics = { cancelamento: {} };
  const comparisons = [];
  const associations = [];
  const predictivePower = [];
  const quality = [];
  const excluded = methodologyExcluded.map((e) => ({ ...e }));

  mark("build_target", () => null);

  mark("numeric_associations", () => {
    for (const def of numericVars) {
      const series = getChurnNumericSeries(ctx, def);
      const { row, registry } = analyzeNumericChurn(def, series, minSample);
      univariateMetrics.cancelamento[def.id] = registry;
      if (minCoverage != null && Number.isFinite(minCoverage) && (row.coveragePercent ?? 0) < minCoverage) {
        row.status = "low_coverage";
        row.reason = `Cobertura ${row.coveragePercent}% abaixo do mínimo ${minCoverage}%`;
        row.warnings = [...new Set([...(row.warnings || []), "baixa cobertura"])];
      }
      comparisons.push(row);
      associations.push(associationFromChurnRow(row));
      if (def.predictive) {
        predictivePower.push({
          id: row.id,
          label: row.label,
          type: row.type,
          auc: row.auc,
          aucRaw: row.aucRaw ?? null,
          aucAdjusted: null,
          aucInverted: row.aucInverted,
          direction: row.aucDirection,
          status: row.status,
          coverage: row.coveragePercent,
          coveragePercent: row.coveragePercent,
          sample: (row.activeN || 0) + (row.cancelledN || 0),
          missingPercent: row.missingPercent,
          warnings: row.warnings,
        });
      } else {
        excluded.push({ id: def.id, label: def.label, reason: def.note || "Não elegível a AUC" });
      }
      quality.push({
        id: def.id,
        label: def.label,
        type: "numeric",
        missingPercent: row.missingPercent,
        coveragePercent: row.coveragePercent,
        activeN: row.activeN,
        cancelledN: row.cancelledN,
        sufficient: row.activeN >= minSample && row.cancelledN >= minSample,
      });
    }
  });

  mark("categorical_associations", () => {
    for (const def of categoricalVars) {
      const labelPack = getChurnCategoricalLabels(ctx, def);
      const a = def.requireNpsPredictive ? ctx.npsActive : active;
      const c = def.requireNpsPredictive ? ctx.npsCancelled : cancelled;
      const { row, registry } = analyzeCategoricalChurn(def, labelPack, a, c, minSample);
      univariateMetrics.cancelamento[def.id] = registry;
      if (minCoverage != null && Number.isFinite(minCoverage) && (row.coveragePercent ?? 0) < minCoverage) {
        row.status = "low_coverage";
        row.reason = `Cobertura ${row.coveragePercent}% abaixo do mínimo ${minCoverage}%`;
        row.warnings = [...new Set([...(row.warnings || []), "baixa cobertura"])];
      }
      comparisons.push(row);
      associations.push(associationFromChurnRow(row));
      if (def.predictive) {
        predictivePower.push({
          id: row.id,
          label: row.label,
          type: row.type,
          auc: row.auc,
          aucRaw: row.aucRaw ?? null,
          aucAdjusted: null,
          aucInverted: row.aucInverted,
          direction: row.aucDirection,
          status: row.status,
          coverage: row.coveragePercent,
          coveragePercent: row.coveragePercent,
          sample: (row.activeN || 0) + (row.cancelledN || 0),
          missingPercent: row.missingPercent,
          warnings: row.warnings,
        });
      }
      quality.push({
        id: def.id,
        label: def.label,
        type: "categorical",
        missingPercent: row.missingPercent,
        coveragePercent: row.coveragePercent,
        activeN: row.activeN,
        cancelledN: row.cancelledN,
        sufficient: row.activeN >= minSample && row.cancelledN >= minSample,
      });
    }
  });

  mark("ranking_inputs", () => {
    for (const p of predictivePower) {
      if (p.auc == null) {
        p.aucAdjusted = null;
      } else if (p.aucRaw != null && Number.isFinite(p.aucRaw)) {
        p.aucAdjusted = round4(Math.max(p.aucRaw, 1 - p.aucRaw));
      } else {
        p.aucAdjusted = round4(Math.max(p.auc, 1 - p.auc));
      }
    }
    associations.sort((a, b) => (b.associationAbs || 0) - (a.associationAbs || 0));
    predictivePower.sort((a, b) => (b.aucAdjusted || b.auc || 0) - (a.aucAdjusted || a.auc || 0));
  });

  const survivalBlock = mark("survival", () => buildSurvivalSection(ctx, clients, includeFrozenSeparate));
  const { populationExtras, survival } = survivalBlock;
  const numericAssociations = associations.filter((a) => a.type === "numeric");
  const categoricalAssociations = associations.filter((a) => a.type === "categorical");

  return {
    univariateMetrics,
    population: {
      total: clients.length,
      totalClients: clients.length,
      active: active.length,
      activeClients: active.length,
      cancelled: cancelled.length,
      confirmedCancelledClients: cancelled.length,
      cancelledWithDate: populationExtras.cancelledWithDate,
      cancelledWithoutDate: populationExtras.cancelledWithoutDate,
      frozen: frozen.length,
      frozenClients: frozen.length,
      unknown: populationExtras.unknownClients,
      unknownClients: populationExtras.unknownClients,
      excluded: 0,
      activeUsedInComparison: active.length,
      cancelledUsedInComparison: cancelled.length,
      events: populationExtras.events,
      censored: populationExtras.censored,
      survivalEligible: ctx.survivalRecords.length,
      includeFrozenSeparate,
    },
    comparisons,
    activeVsCancelled: comparisons.filter((r) => r.type === "numeric"),
    associations,
    churnAssociations: { numeric: numericAssociations, categorical: categoricalAssociations },
    predictivePower,
    univariatePredictivePower: predictivePower,
    survival,
    quality,
    excludedVariables: excluded,
  };
}

function analyzeRenewalNumeric(def, series, eligible, minSample) {
  if (RENEWAL_EXCLUDE_FIELDS.has(def.field) || RENEWAL_EXCLUDE_FIELDS.has(def.id)) return null;
  if (def.field === "stayDays") return null;

  const xs = series.xs;
  const ys = series.ys;
  const rVals = series.rVals;
  const nVals = series.nVals;
  const pb = pointBiserial(xs, ys);
  let n1 = 0;
  for (let i = 0; i < ys.length; i += 1) if (ys[i] === 1) n1 += 1;
  const n0 = ys.length - n1;
  const descriptiveOk = n1 >= MIN_DESCRIPTIVE && n0 >= MIN_DESCRIPTIVE;

  const medR = median(rVals);
  const medN = median(nVals);
  const sdPool = pooledSd(rVals, nVals);
  const stdDiff = standardizedDifference(medR, medN, sdPool);
  const mw = mannWhitney(nVals, rVals);
  let diffAbs = null;
  if (medR != null && medN != null) diffAbs = round3(medR - medN);

  return {
    association: {
      id: def.id,
      label: def.label,
      type: "numeric",
      measure: "point_biserial",
      association: pb.r,
      associationAbs: pb.r != null ? Math.abs(pb.r) : null,
      strength: associationStrength(pb.r, "r"),
      n: pb.n,
      nRenewed: n1,
      nNotRenewed: n0,
      meanRenewed: pb.mean1 ?? null,
      meanNotRenewed: pb.mean0 ?? null,
      status: !descriptiveOk ? "small_sample" : (pb.warning || "available"),
      warning: pb.warning,
      coverage: coveragePct(xs.length, eligible.length),
    },
    compare: {
      id: def.id,
      label: def.label,
      medianRenewed: round3(medR),
      medianNotRenewed: round3(medN),
      differenceAbs: diffAbs,
      sdPooled: round3(sdPool),
      pooledSd: round3(sdPool),
      stdDiff,
      standardizedDifference: stdDiff,
      nRenewed: rVals.length,
      nNotRenewed: nVals.length,
      coveragePercent: coveragePct(rVals.length + nVals.length, eligible.length),
      pValue: mw.pValue,
      rankBiserial: mw.rankBiserial,
      status: descriptiveOk ? "available" : "small_sample",
      sampleSmall: rVals.length < minSample || nVals.length < minSample,
    },
    registry: {
      association: pb.r,
      auc: null,
      coverage: coveragePct(xs.length, eligible.length),
      standardizedDifference: stdDiff,
      direction: pb.r == null ? null : (pb.r > 0 ? "maior nos renovados" : "menor nos renovados"),
      n: pb.n,
    },
  };
}

/**
 * Análise de renovação unificada — registry + associações + compareRenewedVsNot em uma passagem.
 */
export function buildRenewalAnalysis(ctx, numericVars, categoricalVars, minSample, section = null) {
  const mark = (name, fn) => (section ? section.mark(name, fn) : fn());
  const eligible = ctx.eligibleRenewal;
  const renewed = ctx.renewed;
  const notRenewed = ctx.notRenewed;
  const univariateMetrics = { renovacao: {} };
  const numeric = [];
  const categorical = [];
  const compareRows = [];

  mark("build_renewal_target", () => null);

  mark("numeric_associations", () => {
    for (const def of numericVars) {
      const series = getRenewalNumericSeries(ctx, def);
      const result = analyzeRenewalNumeric(def, series, eligible, minSample);
      if (!result) continue;
      univariateMetrics.renovacao[def.id] = result.registry;
      numeric.push(result.association);
      compareRows.push(result.compare);
    }
  });

  mark("categorical_associations", () => {
    for (const def of categoricalVars) {
      if (RENEWAL_EXCLUDE_FIELDS.has(def.field) || RENEWAL_EXCLUDE_FIELDS.has(def.id)) continue;
      const labelPack = getRenewalCategoricalLabels(ctx, def);
      const { table, labels } = buildContingencyFromGroups(labelPack.notRenewedLabels, labelPack.renewedLabels);
      let chi = { cramersV: null, pValue: null, warning: "empty" };
      if (table) chi = chiSquareIndependence(table);
      categorical.push({
        id: def.id,
        label: def.label,
        type: "categorical",
        measure: "cramers_v",
        association: chi.cramersV,
        associationAbs: chi.cramersV,
        strength: associationStrength(chi.cramersV, "cramers_v"),
        pValue: chi.pValue,
        labels,
        n: chi.n ?? labelPack.poolN,
        nRenewed: labelPack.renewedLabels.length,
        nNotRenewed: labelPack.notRenewedLabels.length,
        status: labelPack.notRenewedLabels.length < MIN_DESCRIPTIVE || labelPack.renewedLabels.length < MIN_DESCRIPTIVE
          ? "small_sample"
          : (chi.warning || "available"),
        warning: chi.warning,
        coverage: coveragePct(labelPack.poolN, eligible.length),
      });
      univariateMetrics.renovacao[def.id] = {
        association: chi.cramersV,
        auc: null,
        coverage: coveragePct(labelPack.poolN, eligible.length),
        standardizedDifference: null,
        direction: null,
        n: chi.n ?? labelPack.poolN,
      };
    }
  });

  mark("compareRenewedVsNot", () => null);
  mark("ranking_inputs", () => {
    numeric.sort((a, b) => (b.associationAbs || 0) - (a.associationAbs || 0));
    categorical.sort((a, b) => (b.associationAbs || 0) - (a.associationAbs || 0));
  });

  return {
    univariateMetrics,
    eligible: eligible.length,
    renewed: renewed.length,
    notRenewed: notRenewed.length,
    sampleSmall: renewed.length < minSample || notRenewed.length < minSample,
    numeric,
    categorical,
    compareRows,
    associations: { numeric, categorical },
  };
}
