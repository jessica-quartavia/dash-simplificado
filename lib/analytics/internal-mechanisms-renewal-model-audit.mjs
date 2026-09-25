/**
 * Auditoria de holdout do modelo exploratório (estratificação programa × faixa de mecanismos).
 */
import { mean, rocAuc } from "./stats-tests.mjs";

function round4(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10000) / 10000;
}

function round3(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 1000) / 1000;
}

export function confusionAtThreshold(probs, labels, threshold = 0.5) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < probs.length; i += 1) {
    const y = labels[i];
    if (y !== 0 && y !== 1) continue;
    const pred = (probs[i] ?? 0) >= threshold ? 1 : 0;
    if (pred === 1 && y === 1) tp += 1;
    else if (pred === 1 && y === 0) fp += 1;
    else if (pred === 0 && y === 0) tn += 1;
    else if (pred === 0 && y === 1) fn += 1;
  }
  return { tp, fp, tn, fn };
}

export function classificationMetrics(probs, labels, threshold = 0.5) {
  const { tp, fp, tn, fn } = confusionAtThreshold(probs, labels, threshold);
  const total = tp + fp + tn + fn;
  const positives = tp + fn;
  const negatives = tn + fp;
  const accuracy = total ? (tp + tn) / total : null;
  const baselineAccuracy = total ? (tn + fn) / total : null;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = positives ? tp / positives : null;
  const specificity = negatives ? tn / negatives : null;
  const f1 =
    precision != null && recall != null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  const sens = recall;
  const balAcc =
    recall != null && specificity != null ? (recall + specificity) / 2 : null;
  return {
    threshold,
    tp,
    fp,
    tn,
    fn,
    accuracy: round4(accuracy),
    baselineAccuracy: round4(baselineAccuracy),
    balancedAccuracy: round4(balAcc),
    precision: round4(precision),
    recall: round4(recall),
    specificity: round4(specificity),
    f1: round4(f1),
    sensitivity: round4(sens),
  };
}

/** PR-AUC trapezoidal em probabilidades ordenadas. */
export function prAuc(probs, labels) {
  const pairs = [];
  for (let i = 0; i < probs.length; i += 1) {
    if (labels[i] !== 0 && labels[i] !== 1) continue;
    pairs.push({ p: probs[i] ?? 0, y: labels[i] });
  }
  if (!pairs.length) return null;
  pairs.sort((a, b) => b.p - a.p);
  const totalPos = pairs.filter((x) => x.y === 1).length;
  if (!totalPos) return null;
  let tp = 0;
  let fp = 0;
  let auc = 0;
  let prevRecall = 0;
  let prevPrec = 1;
  for (const row of pairs) {
    if (row.y === 1) tp += 1;
    else fp += 1;
    const recall = tp / totalPos;
    const prec = tp + fp ? tp / (tp + fp) : 1;
    auc += ((recall - prevRecall) * (prec + prevPrec)) / 2;
    prevRecall = recall;
    prevPrec = prec;
  }
  return round4(auc);
}

export function thresholdSweep(probs, labels, thresholds = [0.2, 0.3, 0.4, 0.5]) {
  return thresholds.map((t) => classificationMetrics(probs, labels, t));
}

export function utilityVerdict(roc, pr, brier, baseBrier, calibrationOk) {
  const ranking =
    roc != null && roc >= 0.65 ? "PASS" : roc != null && roc >= 0.55 ? "ATENÇÃO" : "FRACO";
  const classify =
    roc != null && roc >= 0.6 ? "ATENÇÃO" : "FRACO";
  const volume =
    calibrationOk && brier != null && baseBrier != null && brier <= baseBrier * 1.05
      ? "PASS"
      : brier != null && baseBrier != null && brier <= baseBrier * 1.15
        ? "ATENÇÃO"
        : "FRACO";
  return { ranking, individualClassification: classify, volumeEstimate: volume };
}

export function buildStratifiedModelAudit({
  train = [],
  test = [],
  predictFn,
  modelMeta = {},
  calibrationBins = [],
  brier = null,
  baseBrier = null,
  calibrationOk = false,
}) {
  const testPreds = test.map((c) => predictFn(c));
  const testLabels = test.map((c) => c.y);
  const defaultThreshold = 0.5;
  const holdout = classificationMetrics(testPreds, testLabels, defaultThreshold);
  const roc = rocAuc(testPreds, testLabels);
  const pr = prAuc(testPreds, testLabels);
  const trainEvents = train.filter((c) => c.y === 1).length;
  const testEvents = test.filter((c) => c.y === 1).length;
  const baseRate = train.length ? trainEvents / train.length : null;

  return {
    algorithm: "Taxas estratificadas (programa × faixa de quantidade de mecanismos) com shrinkage bayesiano simples",
    library: "Implementação nativa (lib/analytics/internal-mechanisms-renewal-exploratory-projection.mjs)",
    implementationNote:
      "Não há regressão logística ajustada nesta versão; predictClient usa taxa do estrato ou taxa base global.",
    target: {
      name: "renewed_binary",
      positive: 1,
      negative: 0,
      derivation: "1 se clients.ciclo > 1 entre clientes cycleValid; 0 se ciclo = 1.",
    },
    featuresUsed: [
      { name: "program", type: "categorical", encoding: "parte da chave de estrato program/band" },
      {
        name: "mechanism_count_band",
        type: "categorical",
        encoding: "0,1,2,3,4+ — parte da chave de estrato",
      },
    ],
    featuresExcluded: [
      { name: "latest_nps", reason: "Renovação independente de satisfação nesta versão." },
      { name: "latest_csat", reason: "Idem." },
      { name: "implemented_<slug> individuais", reason: "Não entram no predictClient; usados só em rankings associativos." },
    ],
    hyperparameters: {
      penalty: null,
      C: null,
      solver: null,
      max_iter: null,
      class_weight: null,
      random_state: null,
      fit_intercept: null,
      minStratumN: modelMeta.minStratumN ?? 5,
      shrinkagePriorEvents: 2,
      probabilityClip: [0.05, 0.95],
      holdoutRule: "20% determinístico por hash(client_id), seed=42",
    },
    split: {
      type: "hash holdout por client_id",
      trainShare: 0.8,
      testShare: 0.2,
      stratified: false,
      temporal: false,
      random_state: 42,
    },
    sampleSizes: {
      nTotal: train.length + test.length,
      nTrain: train.length,
      nTest: test.length,
      renewedTrain: trainEvents,
      notRenewedTrain: train.length - trainEvents,
      renewedTest: testEvents,
      notRenewedTest: test.length - testEvents,
      baseRate: round4(baseRate),
    },
    performance: {
      ...holdout,
      rocAuc: round4(roc),
      prAuc: round4(pr),
      brier: round4(brier),
      baselineBrier: round4(baseBrier),
    },
    thresholdSweep: thresholdSweep(testPreds, testLabels),
    calibrationBins,
    calibrationOk,
    coefficients: [],
    mechanismAdjustedCoefficients: [],
    multicollinearity: {
      note: "predictClient usa apenas program × mechanism_count_band; mecanismos binários não coexistentes no mesmo modelo.",
      mechanismCountVsBinary: "Redundância conceitual — contagem define o estrato; coeficientes logísticos por mecanismo não estimados.",
      vif: null,
    },
    backtest: {
      possible: false,
      reason: "Sem série temporal de eventos de renovação datados na BASE QV para backtest temporal oficial.",
    },
    utility: utilityVerdict(roc, pr, brier, baseBrier, calibrationOk),
    interpretationPlain:
      holdout.baselineAccuracy != null && holdout.accuracy != null
        ? `O modelo acerta ${(holdout.accuracy * 100).toFixed(1)}% das classificações no holdout, mas o baseline que prevê "não renova" para todos já acertaria ${(holdout.baselineAccuracy * 100).toFixed(1)}%. Por isso, balanced accuracy, recall, precision e calibração são mais importantes.`
        : null,
  };
}
