/**
 * Extensão exploratória: ranking preditivo multivariado, combinações,
 * alta performance, matriz comparativa de grupos, Health Score MVP.
 * Sem dependências externas; sem alteração de banco.
 */
import { dataConfigurationError } from "../env.mjs";
import { coveragePct, mean, median, rocAuc, round3, round4, sampleSd, standardizedDifference } from "./stats-tests.mjs";

const LEAKAGE_IDS = new Set([
  "isCancelled",
  "cancellationDate",
  "cancellationSource",
  "hasConfirmedDate",
  "cancelledWithoutDate",
  "survivalEvent",
  "survivalTime",
  "stayDays", // censura/evento misturados — leakage temporal para churn
]);

const CANDIDATE_FEATURES = [
  { id: "meetingCount", label: "Total de reuniões", dim: "Engajamento" },
  { id: "daysSinceLastMeeting", label: "Dias desde última reunião", dim: "Engajamento" },
  { id: "daysToFirstMeeting", label: "Dias até primeira reunião", dim: "Engajamento" },
  { id: "noShowCount", label: "No-shows", dim: "Engajamento" },
  { id: "rescheduleCount", label: "Remarcações", dim: "Engajamento" },
  { id: "attendanceRate", label: "Taxa de comparecimento", dim: "Engajamento" },
  { id: "averageIntervalDays", label: "Intervalo médio entre reuniões", dim: "Engajamento" },
  { id: "hasMeeting", label: "Possui reunião", dim: "Engajamento", binary: true },
  { id: "mechanismCount", label: "Quantidade de mecanismos", dim: "Implementação" },
  { id: "implementedMechanismCount", label: "Mecanismos implementados", dim: "Implementação" },
  { id: "implementationPercent", label: "Percentual implementado", dim: "Implementação" },
  { id: "hasMechanism", label: "Possui mecanismo", dim: "Implementação", binary: true },
  { id: "npsScore", label: "Nota NPS", dim: "Satisfação" },
  { id: "monthlyIncome", label: "Renda mensal", dim: "Perfil financeiro" },
  { id: "liquidityReserve", label: "Reserva de liquidez", dim: "Perfil financeiro" },
  { id: "lastContribution", label: "Último aporte", dim: "Perfil financeiro" },
  { id: "paidPropertiesValue", label: "Patrimônio", dim: "Perfil financeiro" },
  { id: "hasFinancialData", label: "Diagnóstico financeiro", dim: "Atualização financeira", binary: true },
  { id: "daysSinceFinancialUpdate", label: "Dias desde atualização financeira", dim: "Atualização financeira" },
  { id: "financialUpdateCount", label: "Qtd. atualizações financeiras", dim: "Atualização financeira" },
  { id: "hasRenewed", label: "Já renovou", dim: "Renovação", binary: true },
  { id: "currentCycle", label: "Ciclo atual", dim: "Renovação" },
];

function sigmoid(z) {
  if (z >= 30) return 1;
  if (z <= -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

function mulberry32(a) {
  return function rng() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function num(v) {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stratifiedSplit(rows, testRatio, seed) {
  const rng = mulberry32(seed);
  const pos = rows.filter((r) => r.y === 1);
  const neg = rows.filter((r) => r.y === 0);
  shuffleInPlace(pos, rng);
  shuffleInPlace(neg, rng);
  const nTestPos = Math.max(1, Math.floor(pos.length * testRatio));
  const nTestNeg = Math.max(1, Math.floor(neg.length * testRatio));
  const test = [...pos.slice(0, nTestPos), ...neg.slice(0, nTestNeg)];
  const train = [...pos.slice(nTestPos), ...neg.slice(nTestNeg)];
  shuffleInPlace(train, rng);
  shuffleInPlace(test, rng);
  return { train, test };
}

function standardizeMatrix(rows, featureIds) {
  const stats = featureIds.map((id) => {
    const vals = rows.map((r) => r.x[id]).filter((v) => v != null);
    const mu = vals.length ? mean(vals) : 0;
    const sd = vals.length > 1
      ? Math.sqrt(vals.reduce((a, v) => a + (v - mu) ** 2, 0) / (vals.length - 1)) || 1
      : 1;
    return { id, mu, sd: sd || 1, coverage: coveragePct(vals.length, rows.length) };
  });
  const data = rows.map((r) => ({
    y: r.y,
    x: featureIds.map((id, i) => {
      const v = r.x[id];
      if (v == null) return 0;
      return (v - stats[i].mu) / stats[i].sd;
    }),
  }));
  return { data, stats };
}

function fitMultiLogistic(data, nFeat, { maxIter = 80, l2 = 0.5 } = {}) {
  const w = Array(nFeat).fill(0);
  let b = 0;
  for (let iter = 0; iter < maxIter; iter += 1) {
    const gw = Array(nFeat).fill(0);
    let gb = 0;
    for (const row of data) {
      let z = b;
      for (let j = 0; j < nFeat; j += 1) z += w[j] * row.x[j];
      const pr = sigmoid(z);
      const err = row.y - pr;
      gb += err;
      for (let j = 0; j < nFeat; j += 1) gw[j] += err * row.x[j];
    }
    const n = data.length || 1;
    b += gb / n;
    for (let j = 0; j < nFeat; j += 1) {
      w[j] = w[j] + gw[j] / n - l2 * w[j];
    }
  }
  return { w, b };
}

function predictProba(model, row) {
  let z = model.b;
  for (let j = 0; j < model.w.length; j += 1) z += model.w[j] * row.x[j];
  return sigmoid(z);
}

function confusionAt(scores, labels, threshold = 0.5) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < scores.length; i += 1) {
    const pred = scores[i] >= threshold ? 1 : 0;
    const y = labels[i];
    if (pred === 1 && y === 1) tp += 1;
    else if (pred === 1 && y === 0) fp += 1;
    else if (pred === 0 && y === 0) tn += 1;
    else fn += 1;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && (precision + recall)
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return {
    tp, fp, tn, fn,
    precision: precision == null ? null : round4(precision),
    recall: recall == null ? null : round4(recall),
    f1: f1 == null ? null : round4(f1),
  };
}

function buildFeatureRows(clients, features) {
  return clients
    .filter((c) => typeof c.isCancelled === "boolean")
    .map((c) => {
      const x = {};
      for (const f of features) {
        x[f.id] = num(c[f.id]);
      }
      return { y: c.isCancelled ? 1 : 0, x, hire: c.contractDate || c.hireDate || null };
    });
}

/**
 * Regressão logística L2 + importância por |coef| e permutação no holdout.
 */
export function buildPredictiveRanking(clients, univariatePredictivePower = [], associations = []) {
  const features = CANDIDATE_FEATURES.filter((f) => !LEAKAGE_IDS.has(f.id));
  const raw = buildFeatureRows(clients, features);
  const n1 = raw.filter((r) => r.y === 1).length;
  const n0 = raw.length - n1;
  if (raw.length < 80 || n1 < 20 || n0 < 20) {
    return {
      method: "logistic_l2_stratified_holdout",
      status: "insufficient_sample",
      note: "Amostra insuficiente para modelo multivariado; ranking univariado (AUC) permanece disponível.",
      metrics: null,
      ranking: (univariatePredictivePower || []).slice(0, 20).map((p, i) => ({
        rank: i + 1,
        id: p.id,
        label: p.label || p.id,
        importance: p.aucAdjusted ?? p.auc,
        importanceType: "univariate_auc",
        direction: p.direction || null,
        univariateAuc: p.aucAdjusted ?? p.auc,
        coveragePercent: p.coveragePercent ?? p.coverage,
        leakageRisk: LEAKAGE_IDS.has(p.id) ? "high" : "low",
        observation: "Fallback univariado — modelo multivariado não ajustado.",
      })),
    };
  }

  // Prefer temporal split when hire dates span enough range
  const dated = raw.filter((r) => r.hire);
  let train;
  let test;
  let splitType = "stratified_random_70_30";
  let trainPeriod = null;
  let validPeriod = null;
  if (dated.length > raw.length * 0.7) {
    const sorted = [...dated].sort((a, b) => String(a.hire).localeCompare(String(b.hire)));
    const cut = Math.floor(sorted.length * 0.7);
    train = sorted.slice(0, cut);
    test = sorted.slice(cut);
    const t1 = train.filter((r) => r.y === 1).length;
    const v1 = test.filter((r) => r.y === 1).length;
    if (t1 >= 15 && v1 >= 10 && train.length - t1 >= 15 && test.length - v1 >= 10) {
      splitType = "temporal_70_30";
      trainPeriod = { from: train[0]?.hire, to: train[train.length - 1]?.hire };
      validPeriod = { from: test[0]?.hire, to: test[test.length - 1]?.hire };
    } else {
      ({ train, test } = stratifiedSplit(raw, 0.3, 42));
    }
  } else {
    ({ train, test } = stratifiedSplit(raw, 0.3, 42));
  }

  // Keep features with coverage >= 25% on train
  const coverOk = features.filter((f) => {
    const valid = train.filter((r) => r.x[f.id] != null).length;
    return coveragePct(valid, train.length) >= 25;
  }).slice(0, 18);

  const { data: trainStd, stats } = standardizeMatrix(train, coverOk.map((f) => f.id));
  const { data: testStd } = standardizeMatrix(test, coverOk.map((f) => f.id));
  // Re-standardize test with train stats
  const testAligned = test.map((r) => ({
    y: r.y,
    x: coverOk.map((f, i) => {
      const v = r.x[f.id];
      if (v == null) return 0;
      return (v - stats[i].mu) / stats[i].sd;
    }),
  }));

  const model = fitMultiLogistic(trainStd, coverOk.length, { l2: 0.35, maxIter: 100 });
  const scores = testAligned.map((r) => predictProba(model, r));
  const labels = testAligned.map((r) => r.y);
  const auc = rocAuc(scores, labels);
  const conf = confusionAt(scores, labels, 0.5);

  // Permutation importance on holdout
  const baseAuc = auc ?? 0.5;
  const importances = coverOk.map((f, j) => {
    const col = testAligned.map((r) => r.x[j]);
    const rng = mulberry32(100 + j);
    shuffleInPlace(col, rng);
    const scoresP = testAligned.map((r, i) => {
      const x = r.x.slice();
      x[j] = col[i];
      return predictProba(model, { x });
    });
    const aucP = rocAuc(scoresP, labels) ?? 0.5;
    const drop = baseAuc - aucP;
    const coef = model.w[j];
    const uni = (univariatePredictivePower || []).find((p) => p.id === f.id);
    const assoc = (associations || []).find((a) => a.id === f.id);
    return {
      id: f.id,
      label: f.label,
      dim: f.dim,
      importance: round4(Math.max(0, drop) + Math.abs(coef) * 0.05),
      permutationDrop: round4(drop),
      absCoef: round4(Math.abs(coef)),
      coef: round4(coef),
      direction: coef >= 0 ? "positive" : "negative",
      univariateAuc: uni?.aucAdjusted ?? uni?.auc ?? null,
      univariateAssociation: assoc?.association ?? null,
      coveragePercent: stats[j]?.coverage ?? null,
      leakageRisk: "low",
      stability: round4(1 - Math.min(1, Math.abs(drop))),
      observation: "Importância = queda de AUC ao permutar no holdout (+ |coef| regularizado). Não é causalidade.",
    };
  });

  importances.sort((a, b) => b.importance - a.importance);
  const ranking = importances.slice(0, 20).map((r, i) => ({ rank: i + 1, ...r }));

  return {
    method: "logistic_l2_regularized + permutation_importance",
    status: "available",
    splitType,
    trainPeriod,
    validPeriod,
    sample: {
      total: raw.length,
      train: train.length,
      test: test.length,
      prevalence: round4(n1 / raw.length),
      cancelled: n1,
      active: n0,
    },
    featuresUsed: coverOk.map((f) => f.id),
    excludedLeakage: [...LEAKAGE_IDS],
    metrics: {
      rocAuc: auc == null ? null : round4(auc),
      ...conf,
      note: "Métricas no conjunto de validação. Importância não implica causalidade.",
    },
    ranking,
  };
}

export function buildHighPerformance(clients) {
  const pool = (clients || []).filter((c) => c.npsClass || c.hasRenewed != null);
  const promoters = pool.filter((c) => c.npsClass === "promoter");
  const renewed = pool.filter((c) => c.hasRenewed);
  const both = pool.filter((c) => c.npsClass === "promoter" && c.hasRenewed);
  const baseline = {
    n: pool.length,
    cancelledPct: pool.length ? round3((pool.filter((c) => c.isCancelled).length / pool.length) * 100) : null,
    medianMeetings: median(pool.map((c) => num(c.meetingCount)).filter((v) => v != null)),
    medianMechanisms: median(pool.map((c) => num(c.mechanismCount)).filter((v) => v != null)),
    hasFinancialPct: pool.length ? round3((pool.filter((c) => c.hasFinancialData).length / pool.length) * 100) : null,
  };

  function profile(group, label) {
    if (!group.length) {
      return { label, n: 0, status: "insufficient_sample" };
    }
    return {
      label,
      n: group.length,
      cancelledPct: round3((group.filter((c) => c.isCancelled).length / group.length) * 100),
      medianMeetings: median(group.map((c) => num(c.meetingCount)).filter((v) => v != null)),
      medianStayDays: median(group.map((c) => num(c.stayDays)).filter((v) => v != null)),
      medianMechanisms: median(group.map((c) => num(c.mechanismCount)).filter((v) => v != null)),
      medianIncome: median(group.map((c) => num(c.monthlyIncome)).filter((v) => v != null)),
      hasFinancialPct: round3((group.filter((c) => c.hasFinancialData).length / group.length) * 100),
      hasMeetingPct: round3((group.filter((c) => c.hasMeeting).length / group.length) * 100),
      medianAttendance: median(group.map((c) => num(c.attendanceRate)).filter((v) => v != null)),
    };
  }

  return {
    definition: "Alta performance principal = Promotor E Renovado. Análises separadas para somente Promotor e somente Renovado.",
    baseline,
    groups: [
      profile(promoters, "Somente Promotor"),
      profile(renewed, "Somente Renovado"),
      profile(both, "Promotor e Renovado (alta performance)"),
    ],
    note: "Diferenças descritivas frente à população do recorte. Não implica causalidade.",
  };
}

export function buildGroupComparativeMatrix(clients) {
  const groups = [
    { id: "active", label: "Ativos", test: (c) => c.isActive && !c.isCancelled },
    { id: "cancelled", label: "Cancelados", test: (c) => !!c.isCancelled },
    { id: "renewed", label: "Renovados", test: (c) => Number(c.currentCycle) >= 2 },
    { id: "notRenewed", label: "Não renovados", test: (c) => c.currentCycle === 1 },
    { id: "promoter", label: "Promotores", test: (c) => c.npsClass === "promoter" },
    { id: "passive", label: "Neutros", test: (c) => c.npsClass === "passive" },
    { id: "detractor", label: "Detratores", test: (c) => c.npsClass === "detractor" },
    { id: "highPerf", label: "Alta performance", test: (c) => c.npsClass === "promoter" && Number(c.currentCycle) >= 2 },
  ];

  const variables = [
    { id: "stayDays", label: "Permanência (dias)", kind: "median" },
    { id: "meetingCount", label: "Reuniões", kind: "median" },
    { id: "noShowCount", label: "No-shows", kind: "median" },
    { id: "implementedMechanismCount", label: "Mecanismos implementados", kind: "median" },
    { id: "implementationPercent", label: "% implementação", kind: "median" },
    { id: "monthlyIncome", label: "Renda", kind: "median" },
    { id: "liquidityReserve", label: "Reserva", kind: "median" },
    { id: "npsScore", label: "NPS", kind: "median" },
    { id: "hasMeeting", label: "% com reunião", kind: "pct" },
    { id: "hasFinancialData", label: "% com financeiro", kind: "pct" },
    { id: "hasRenewed", label: "% renovado", kind: "pct" },
    { id: "isCancelled", label: "% cancelado", kind: "pct" },
  ];

  const groupData = groups.map((g) => {
    const rows = clients.filter(g.test);
    return { ...g, n: rows.length, rows };
  });

  const globalMed = {};
  const globalSd = {};
  for (const v of variables) {
    if (v.kind === "median") {
      const allVals = clients.map((c) => num(c[v.id])).filter((x) => x != null);
      globalMed[v.id] = median(allVals);
      globalSd[v.id] = sampleSd(allVals);
    } else {
      const valid = clients.filter((c) => c[v.id] != null && c[v.id] !== "");
      globalMed[v.id] = valid.length
        ? (valid.filter((c) => !!c[v.id] && c[v.id] !== 0).length / valid.length) * 100
        : null;
      globalSd[v.id] = null;
    }
  }

  const cells = [];
  for (let i = 0; i < variables.length; i += 1) {
    const v = variables[i];
    for (let j = 0; j < groupData.length; j += 1) {
      const g = groupData[j];
      let value = null;
      let coverage = null;
      if (g.n >= 5) {
        if (v.kind === "median") {
          const vals = g.rows.map((c) => num(c[v.id])).filter((x) => x != null);
          value = vals.length ? median(vals) : null;
          coverage = coveragePct(vals.length, g.n);
        } else {
          const vals = g.rows.filter((c) => c[v.id] != null && c[v.id] !== "");
          const pos = vals.filter((c) => !!c[v.id] && c[v.id] !== 0).length;
          value = vals.length ? round3((pos / vals.length) * 100) : null;
          coverage = coveragePct(vals.length, g.n);
        }
      }
      const gref = globalMed[v.id];
      let standardized = null;
      let difference = null;
      if (value != null && gref != null) {
        difference = round4(value - gref);
        if (v.kind === "median" && globalSd[v.id] != null && globalSd[v.id] > 1e-12) {
          standardized = standardizedDifference(value, gref, globalSd[v.id]);
        } else if (Math.abs(gref) > 1e-9) {
          standardized = round4((value - gref) / (Math.abs(gref) || 1));
        } else {
          standardized = round4(value - gref);
        }
      }
      cells.push({
        i, j,
        varId: v.id,
        groupId: g.id,
        labelRow: v.label,
        labelCol: g.label,
        value,
        reference: gref,
        difference,
        standardized,
        coveragePercent: coverage,
        n: g.n,
        nValid: coverage != null && g.n ? Math.round((coverage / 100) * g.n) : null,
      });
    }
  }

  return {
    title: "Matriz comparativa dos grupos",
    mode: "standardized_vs_global",
    note: "Cada cor compara o grupo com a referência geral da população filtrada. Laranja representa valores acima da referência, azul abaixo e cinza valores semelhantes.",
    referenceNote: "Referência = população elegível após os filtros aplicados.",
    referenceN: clients.length,
    variables,
    groups: groupData.map((g) => ({ id: g.id, label: g.label, n: g.n })),
    cells,
  };
}

export function buildHealthScoreCandidates({
  predictive,
  associations = [],
  npsCorrelations = [],
  renewalAssociations = {},
  univariatePredictivePower = [],
} = {}) {
  const assocById = new Map(associations.map((a) => [a.id, a]));
  const npsById = new Map(npsCorrelations.map((a) => [a.id, a]));
  const renFlat = [...(renewalAssociations.numeric || []), ...(renewalAssociations.categorical || [])];
  const renById = new Map(renFlat.map((a) => [a.id, a]));
  const uniById = new Map(univariatePredictivePower.map((p) => [p.id, p]));

  const dimBest = new Map();
  const ranking = predictive?.ranking || [];
  for (const row of ranking) {
    const meta = CANDIDATE_FEATURES.find((f) => f.id === row.id) || { dim: "Outros", label: row.label };
    const churnAssoc = assocById.get(row.id);
    const nps = npsById.get(row.id);
    const ren = renById.get(row.id);
    const uni = uniById.get(row.id);
    const coverage = row.coveragePercent ?? uni?.coveragePercent ?? churnAssoc?.coveragePercent;
    if (coverage != null && coverage < 30) continue;
    if (LEAKAGE_IDS.has(row.id)) continue;
    const score =
      (row.importance || 0) * 2 +
      Math.abs(churnAssoc?.association || 0) +
      Math.abs(nps?.association || nps?.rho || 0) * 0.5 +
      Math.abs(ren?.association || 0) * 0.5 +
      (coverage || 0) / 200;
    const candidate = {
      id: row.id,
      label: row.label || meta.label,
      dimension: meta.dim,
      associationChurn: churnAssoc?.association ?? null,
      associationRenewal: ren?.association ?? null,
      associationNps: nps?.association ?? nps?.rho ?? null,
      univariateAuc: uni?.aucAdjusted ?? uni?.auc ?? row.univariateAuc,
      coveragePercent: coverage,
      stability: row.stability ?? null,
      operationalEase: ["meetingCount", "daysSinceLastMeeting", "hasMeeting", "mechanismCount", "hasFinancialData", "npsScore", "hasRenewed"].includes(row.id)
        ? "alta"
        : "média",
      score: round4(score),
      justification: null,
      limitations: null,
    };
    const prev = dimBest.get(meta.dim);
    if (!prev || candidate.score > prev.score) dimBest.set(meta.dim, candidate);
  }

  const preferredOrder = [
    "Engajamento",
    "Satisfação",
    "Implementação",
    "Atualização financeira",
    "Renovação",
    "Perfil financeiro",
  ];
  const picked = [];
  for (const dim of preferredOrder) {
    if (dimBest.has(dim)) picked.push(dimBest.get(dim));
    if (picked.length >= 5) break;
  }
  if (picked.length < 3) {
    for (const c of [...dimBest.values()].sort((a, b) => b.score - a.score)) {
      if (!picked.find((p) => p.id === c.id)) picked.push(c);
      if (picked.length >= 3) break;
    }
  }

  return picked.slice(0, 5).map((c) => {
    const bits = [];
    if (c.univariateAuc != null) bits.push(`AUC individual ${Number(c.univariateAuc).toFixed(3)}`);
    if (c.associationChurn != null) bits.push(`assoc. churn ${Number(c.associationChurn).toFixed(2)}`);
    if (c.coveragePercent != null) bits.push(`cobertura ${Number(c.coveragePercent).toFixed(0)}%`);
    c.justification = `${c.label} (${c.dimension}): ${bits.join("; ") || "evidência no ranking preditivo"}. Pode ser atualizado operacionalmente com facilidade ${c.operationalEase}.`;
    c.limitations = "Candidato exploratório ao Health Score MVP. Exige validação temporal, regras de corte e monitoramento antes de uso operacional. Associação não é causalidade.";
    return c;
  });
}

export function buildDiscoveryRankings({
  associations = [],
  npsCorrelations = [],
  renewalAssociations = {},
  univariatePredictivePower = [],
} = {}) {
  const churn = (associations || [])
    .filter((a) => a.id !== "stayDays")
    .map((a) => {
      const uni = univariatePredictivePower.find((p) => p.id === a.id);
      return {
        id: a.id,
        label: a.label || a.id,
        association: a.association ?? null,
        auc: uni?.aucAdjusted ?? uni?.auc ?? null,
        pValue: a.pValue ?? null,
        coveragePercent: a.coveragePercent ?? a.coverage ?? null,
        direction: a.direction || null,
        strength: a.strength || null,
        n: a.n ?? a.sample ?? null,
        observation: a.note || a.reason || null,
      };
    })
    .sort((a, b) => Math.abs(b.association || 0) - Math.abs(a.association || 0) || (b.auc || 0) - (a.auc || 0))
    .slice(0, 15)
    .map((r, i) => ({ rank: i + 1, ...r }));

  const nps = (npsCorrelations || [])
    .map((a) => ({
      id: a.id,
      label: a.label || a.id,
      association: a.association ?? a.rho ?? null,
      pValue: a.pValue ?? null,
      coveragePercent: a.coveragePercent ?? a.coverage ?? null,
      direction: a.direction || null,
      n: a.n ?? a.sample ?? null,
    }))
    .sort((a, b) => Math.abs(b.association || 0) - Math.abs(a.association || 0))
    .slice(0, 15)
    .map((r, i) => ({ rank: i + 1, ...r }));

  const ren = [...(renewalAssociations.numeric || []), ...(renewalAssociations.categorical || [])]
    .filter((a) => !["currentCycle", "renewalCount", "hasRenewed"].includes(a.id))
    .map((a) => ({
      id: a.id,
      label: a.label || a.id,
      association: a.association ?? null,
      coveragePercent: a.coveragePercent ?? a.coverage ?? null,
      direction: a.direction || null,
      n: a.n ?? a.sample ?? null,
    }))
    .sort((a, b) => Math.abs(b.association || 0) - Math.abs(a.association || 0))
    .slice(0, 15)
    .map((r, i) => ({ rank: i + 1, ...r }));

  return { cancellation: churn, nps, renewal: ren };
}

export function buildExploratoryBundle(ctx) {
  const predictive = buildPredictiveRanking(
    ctx.clients,
    ctx.univariatePredictivePower,
    ctx.associations,
  );
  const highPerformance = buildHighPerformance(ctx.clients);
  const groupComparative = buildGroupComparativeMatrix(ctx.clients);
  const discoveryRankings = buildDiscoveryRankings(ctx);
  const healthScoreCandidates = buildHealthScoreCandidates({
    predictive,
    associations: ctx.associations,
    npsCorrelations: ctx.npsCorrelations,
    renewalAssociations: ctx.renewalAssociations,
    univariatePredictivePower: ctx.univariatePredictivePower,
  });
  return {
    predictive,
    highPerformance,
    groupComparative,
    discoveryRankings,
    healthScoreCandidates,
  };
}
