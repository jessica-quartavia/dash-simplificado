/**
 * Modelo B1 — mesmo estimador estratificado + validação temporal out-of-time.
 */
import { mean, rocAuc } from "./stats-tests.mjs";
import {
  buildStratifiedModelAudit,
  classificationMetrics,
  prAuc,
  thresholdSweep,
  utilityVerdict,
} from "./internal-mechanisms-renewal-model-audit.mjs";
import {
  buildStrataRates,
  hashHoldout,
  mechanismBand,
  predictStratifiedClient,
  STRATIFIED_MIN_STRATUM,
} from "./internal-mechanisms-renewal-stratified-shared.mjs";

const MIN_TRAIN = 40;
const MIN_TEST = 10;
const MIN_EVENTS_TRAIN = 8;
const MIN_EVENTS_TEST = 5;
const BRIER_MAX_VS_BASELINE = 1.05;

function round3(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 1000) / 1000;
}

function round4(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10000) / 10000;
}

function brierScore(probs, labels) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < probs.length; i += 1) {
    if (labels[i] !== 0 && labels[i] !== 1) continue;
    const p = Math.min(1, Math.max(0, probs[i] ?? 0));
    s += (p - labels[i]) ** 2;
    n += 1;
  }
  return n ? s / n : null;
}

export function calibrationBinsReport(probs, labels) {
  const defs = [
    { label: "0–10%", lo: 0, hi: 0.1 },
    { label: "10–20%", lo: 0.1, hi: 0.2 },
    { label: "20–40%", lo: 0.2, hi: 0.4 },
    { label: "40–60%", lo: 0.4, hi: 0.6 },
    { label: "60%+", lo: 0.6, hi: 1.001 },
  ];
  return defs.map(({ label, lo, hi }) => {
    const idx = [];
    for (let i = 0; i < probs.length; i += 1) {
      const p = probs[i];
      if (p == null || (labels[i] !== 0 && labels[i] !== 1)) continue;
      if (p >= lo && p < hi) idx.push(i);
    }
    if (!idx.length) return { bin: label, n: 0, meanPredicted: null, observedRate: null };
    const ps = idx.map((i) => probs[i]);
    const ys = idx.map((i) => labels[i]);
    const obs = ys.filter((y) => y === 1).length / ys.length;
    return { bin: label, n: idx.length, meanPredicted: round3(mean(ps)), observedRate: round3(obs) };
  });
}

function hashSplit(rows) {
  const pool = [...rows];
  const train = [];
  const test = [];
  for (const c of pool) {
    if (hashHoldout(c.clientId ?? c.client_id)) test.push(c);
    else train.push(c);
  }
  return {
    train,
    test,
    splitDate: null,
    type: "hash_holdout_client_id_seed_42",
    temporal: false,
    note: "Holdout espelhado do Modelo A quando split temporal não atinge eventos mínimos.",
  };
}

function splitHasBothClasses(rows) {
  const pos = rows.some((c) => c.y === 1);
  const neg = rows.some((c) => c.y === 0);
  return pos && neg;
}

function isEvaluableTemporalSplit(train, test) {
  if (train.length < MIN_TRAIN || test.length < MIN_TEST) return false;
  if (!splitHasBothClasses(train) || !splitHasBothClasses(test)) return false;
  const evTrain = train.filter((c) => c.y === 1).length;
  const evTest = test.filter((c) => c.y === 1).length;
  return evTrain >= MIN_EVENTS_TRAIN && evTest >= MIN_EVENTS_TEST;
}

/**
 * Varre cortes por reference_date. Retorna null se nenhum holdout temporal
 * tiver ambas as classes em treino e teste (comum quando renovados usam data_fim_ciclo futura).
 */
function findBestTemporalSplit(rows, trainShareTarget = 0.8) {
  const sorted = [...rows].sort((a, b) =>
    String(a.referenceDate || "").localeCompare(String(b.referenceDate || "")),
  );
  const n = sorted.length;
  const targetCut = Math.max(MIN_TRAIN, Math.floor(n * trainShareTarget));

  let best = null;
  let bestProximity = Infinity;

  for (let cut = MIN_TRAIN; cut <= n - MIN_TEST; cut += 1) {
    const train = sorted.slice(0, cut);
    const test = sorted.slice(cut);
    if (!isEvaluableTemporalSplit(train, test)) continue;
    const proximity = Math.abs(cut - targetCut);
    if (proximity < bestProximity) {
      bestProximity = proximity;
      const evTrain = train.filter((c) => c.y === 1).length;
      const evTest = test.filter((c) => c.y === 1).length;
      best = {
        train,
        test,
        splitDate: test[0]?.referenceDate ?? null,
        type: "temporal_out_of_time_by_reference_date",
        temporal: true,
        eventsTrain: evTrain,
        eventsTest: evTest,
        trainShareTarget,
        actualTrainShare: cut / n,
      };
    }
  }

  return best;
}

function pickTrainTestSplit(pool) {
  const temporal = findBestTemporalSplit(pool);
  if (temporal) {
    return {
      ...temporal,
      primary: "temporal",
      metricsSplit: "temporal",
      referenceDateConfoundingNote: null,
    };
  }

  const hashed = hashSplit(pool);
  const evTrain = hashed.train.filter((c) => c.y === 1).length;
  const evTest = hashed.test.filter((c) => c.y === 1).length;
  return {
    ...hashed,
    primary: "hash",
    metricsSplit: "hash",
    eventsTrain: evTrain,
    eventsTest: evTest,
    temporalFeasible: false,
    referenceDateConfoundingNote:
      "Out-of-time por reference_date inviável: renovados concentram data_fim_ciclo futura; os 8 primeiros eventos positivos só aparecem após ~88% da série ordenada. Métricas B1 usam hash holdout (igual ao A); ver split temporal ilustrativo no snapshot.",
  };
}

export function trainHistoricalStratifiedModel(population = []) {
  const pool = population.filter((c) => c.y === 0 || c.y === 1);
  const split = pickTrainTestSplit(pool);
  const { train, test, splitDate, type, primary, referenceDateConfoundingNote, temporalFeasible } =
    split;
  const trainRows = train.map((c) => ({ ...c, y: c.y }));
  const testRows = test.map((c) => ({ ...c, y: c.y }));

  const eventsTrain = trainRows.filter((c) => c.y === 1).length;
  const eventsTest = testRows.filter((c) => c.y === 1).length;
  if (
    trainRows.length < MIN_TRAIN
    || testRows.length < MIN_TEST
    || eventsTrain < MIN_EVENTS_TRAIN
    || eventsTest < MIN_EVENTS_TEST
  ) {
    return {
      available: false,
      reason: "Amostra ou eventos insuficientes para Modelo B1.",
      trainN: trainRows.length,
      testN: testRows.length,
      eventsTrain,
      eventsTest,
      splitAttempt: { type, primary, referenceDateConfoundingNote },
    };
  }

  const model = buildStrataRates(trainRows);
  const testPreds = testRows.map((c) => predictStratifiedClient(c, model));
  const testLabels = testRows.map((c) => c.y);
  const brier = brierScore(testPreds, testLabels);
  const baseRate = trainRows.length ? eventsTrain / trainRows.length : null;
  const baseBrier = baseRate != null ? baseRate * (1 - baseRate) : null;
  const calibrationOk =
    brier != null && baseBrier != null ? brier <= baseBrier * BRIER_MAX_VS_BASELINE : false;

  const modelAudit = buildStratifiedModelAudit({
    train: trainRows,
    test: testRows,
    predictFn: (c) => predictStratifiedClient(c, model),
    modelMeta: { minStratumN: STRATIFIED_MIN_STRATUM },
    calibrationBins: calibrationBinsReport(testPreds, testLabels),
    brier,
    baseBrier,
    calibrationOk,
  });

  modelAudit.split = {
    type,
    primary,
    metricsSplit: primary,
    temporal: primary === "temporal",
    temporalFeasible: temporalFeasible !== false,
    splitDate,
    trainShare: round4(trainRows.length / (trainRows.length + testRows.length)),
    testShare: round4(testRows.length / (trainRows.length + testRows.length)),
    eventsTrain,
    eventsTest,
    referenceDateConfoundingNote,
    hashHoldoutRule: primary === "hash" ? "20% determinístico por hash(client_id), seed=42" : null,
  };

  const temporalIllustrative = (() => {
    if (primary === "temporal") return null;
    const sorted = [...pool].sort((a, b) =>
      String(a.referenceDate || "").localeCompare(String(b.referenceDate || "")),
    );
    const n = sorted.length;
    const targetCut = Math.max(MIN_TRAIN, Math.floor(n * 0.8));
    let pick = null;
    for (let cut = MIN_TRAIN; cut <= n - MIN_TEST; cut += 1) {
      const tr = sorted.slice(0, cut);
      const te = sorted.slice(cut);
      if (!splitHasBothClasses(te)) continue;
      const ee = te.filter((c) => c.y === 1).length;
      const ne = te.filter((c) => c.y === 0).length;
      if (ee < MIN_EVENTS_TEST || ne < 5) continue;
      const prox = Math.abs(cut - targetCut);
      if (!pick || prox < pick.prox) {
        pick = { cut, tr, te, prox, splitDate: te[0]?.referenceDate };
      }
    }
    if (!pick) return { feasible: false, reason: "Nenhum corte com teste balanceado." };
    const modelT = buildStrataRates(pick.tr);
    const preds = pick.te.map((c) => predictStratifiedClient(c, modelT));
    const labels = pick.te.map((c) => c.y);
    const brierT = brierScore(preds, labels);
    const perf = classificationMetrics(preds, labels, 0.5);
    return {
      feasible: true,
      warning: "Métricas ilustrativas — treino com poucos renovados (reference_date).",
      splitDate: pick.splitDate,
      trainN: pick.tr.length,
      testN: pick.te.length,
      eventsTrain: pick.tr.filter((c) => c.y === 1).length,
      eventsTest: pick.te.filter((c) => c.y === 1).length,
      brier: round4(brierT),
      rocAuc: rocAuc(preds, labels),
      prAuc: prAuc(preds, labels),
      accuracy: perf.accuracy,
    };
  })();

  return {
    available: true,
    model,
    trainRows,
    testRows,
    testPreds,
    testLabels,
    brier,
    baseBrier,
    baseRate,
    calibrationOk,
    modelAudit,
    performance: modelAudit.performance,
    utility: modelAudit.utility,
    splitMeta: { primary, temporalIllustrative },
  };
}

export function mechanismCountBandTable(population = []) {
  const bands = ["0", "1", "2", "3", "4+"];
  return bands.map((band) => {
    const rows = population.filter(
      (c) => mechanismBand(c.mechanismCountAtReference ?? 0) === band,
    );
    const renewed = rows.filter((c) => c.y === 1).length;
    return {
      band,
      clients: rows.length,
      renewed,
      renewalRatePct: rows.length ? Math.round((renewed / rows.length) * 1000) / 10 : null,
    };
  });
}

export function historicalMechanismAnalysis(population = [], catalog = [], minSample = 30) {
  const eligible = population.filter((c) => c.y === 0 || c.y === 1);
  const without = eligible.filter((c) => (c.mechanismCountAtReference || 0) === 0);
  const withoutRate = without.length
    ? without.filter((c) => c.y === 1).length / without.length
    : null;

  const rows = (catalog || []).map((mech) => {
    const slug = mech.slug;
    const exposed = eligible.filter((c) => (c.mechanismsBeforeReference || []).includes(slug));
    const renewed = exposed.filter((c) => c.y === 1).length;
    const rate = exposed.length ? renewed / exposed.length : null;
    return {
      mechanismName: mech.name,
      slug,
      clients: exposed.length,
      renewed,
      notRenewed: exposed.length - renewed,
      renewalRatePct: rate != null ? Math.round(rate * 1000) / 10 : null,
      rateWithoutPct: withoutRate != null ? Math.round(withoutRate * 1000) / 10 : null,
      deltaPp:
        rate != null && withoutRate != null ? Math.round((rate - withoutRate) * 1000) / 10 : null,
      sampleOk: exposed.length >= minSample,
    };
  });

  const ok = rows.filter((r) => r.sampleOk && r.clients > 0);
  const topRaw = [...ok].sort(
    (a, b) => (b.renewalRatePct ?? -1) - (a.renewalRatePct ?? -1) || b.clients - a.clients,
  );
  const topDelta = [...ok].sort(
    (a, b) => (b.deltaPp ?? -999) - (a.deltaPp ?? -999) || b.clients - a.clients,
  );

  return {
    rows,
    topRawRate: topRaw.slice(0, 3),
    topDelta: topDelta.slice(0, 3),
  };
}

export function populationQualityVerdict(summary, excluded) {
  const openShare = summary.total
    ? (excluded.outcome_still_open || 0) / (summary.total + excluded.outcome_still_open)
    : 1;
  if (openShare < 0.15 && summary.total >= 200) return "PASS";
  if (summary.total >= 100) return "ATENÇÃO";
  return "FRACO";
}

export function temporalValidationVerdict(modelResult) {
  if (!modelResult?.available) return "FRACO";
  const sp = modelResult.modelAudit?.split;
  if (sp?.primary === "temporal" && sp.temporalFeasible !== false) return "PASS";
  if (sp?.primary === "hash" && sp.temporalFeasible === false) return "FRACO";
  return "ATENÇÃO";
}

export function comparisonDimensionVerdicts(modelA = {}, modelBResult = {}, qualityPop = "ATENÇÃO") {
  const perfB = modelBResult?.performance || {};
  const perfA = modelA.metrics || modelA;
  const rocB = perfB.rocAuc;
  const rocA = perfA.rocAuc;
  const ranking =
    rocB != null && rocA != null
      ? rocB >= rocA - 0.02
        ? "PASS"
        : rocB >= rocA - 0.08
          ? "ATENÇÃO"
          : "FRACO"
      : rocB != null && rocB >= 0.65
        ? "PASS"
        : "ATENÇÃO";
  const classification =
    perfB.balancedAccuracy != null && perfB.balancedAccuracy >= 0.55 ? "ATENÇÃO" : "FRACO";
  const volume =
    modelBResult.calibrationOk && perfB.brier != null && perfB.baselineBrier != null
    && perfB.brier <= perfB.baselineBrier * BRIER_MAX_VS_BASELINE
      ? "PASS"
      : "ATENÇÃO";
  return {
    ranking,
    individualClassification: classification,
    volumeEstimate: volume,
    populationQuality: qualityPop,
    temporalValidation: temporalValidationVerdict(modelBResult),
  };
}

export { mechanismBand, prAuc, classificationMetrics, thresholdSweep, utilityVerdict };
