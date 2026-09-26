/**
 * Projeção exploratória de renovação (PROXY data_fim_ciclo) — estratificada + validação simples.
 */
import { mean, logisticUnivariateAuc, rocAuc } from "./stats-tests.mjs";
import { buildStratifiedModelAudit } from "./internal-mechanisms-renewal-model-audit.mjs";

const MIN_TRAIN = 40;
const MIN_EVENTS = 8;
const MIN_STRATUM = 5;
const BRIER_MAX_VS_BASELINE = 1.05;

function mechanismBand(n) {
  const x = Number(n) || 0;
  if (x >= 4) return "4+";
  return String(x);
}

function stratumKey(c) {
  return `${c.program || "?"}/${mechanismBand(c.totalImplementedMechanisms ?? c.mechanismCount ?? 0)}`;
}

function round1(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10) / 10;
}

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

function calibrationBins(probs, labels, bins = 5) {
  const rows = [];
  for (let b = 0; b < bins; b += 1) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const idx = [];
    for (let i = 0; i < probs.length; i += 1) {
      const p = probs[i];
      if (p == null) continue;
      if (b === bins - 1 ? p >= lo && p <= hi : p >= lo && p < hi) idx.push(i);
    }
    if (!idx.length) {
      rows.push({ bin: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, n: 0, meanPredicted: null, observedRate: null });
      continue;
    }
    const ps = idx.map((i) => probs[i]);
    const ys = idx.map((i) => labels[i]).filter((y) => y === 0 || y === 1);
    const obs = ys.length ? ys.filter((y) => y === 1).length / ys.length : null;
    rows.push({
      bin: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`,
      n: idx.length,
      meanPredicted: round3(mean(ps)),
      observedRate: obs != null ? round3(obs) : null,
    });
  }
  return rows;
}

function hashHoldout(clientId, seed = 42) {
  const s = String(clientId);
  let h = seed;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 100) < 20;
}

function buildStrataRates(training) {
  const global = training.filter((c) => c.y === 0 || c.y === 1);
  const baseRate = global.length ? global.filter((c) => c.y === 1).length / global.length : null;
  const strata = new Map();
  for (const c of training) {
    if (c.y !== 0 && c.y !== 1) continue;
    const k = stratumKey(c);
    if (!strata.has(k)) strata.set(k, { n: 0, events: 0 });
    const s = strata.get(k);
    s.n += 1;
    if (c.y === 1) s.events += 1;
  }
  const rates = new Map();
  for (const [k, s] of strata.entries()) {
    if (s.n < MIN_STRATUM) continue;
    const raw = s.events / s.n;
    const shrunk = (s.events + 2 * (baseRate ?? 0.2)) / (s.n + 2);
    rates.set(k, { n: s.n, events: s.events, rate: shrunk, rawRate: raw });
  }
  return { baseRate, rates };
}

function predictClient(c, model) {
  const k = stratumKey(c);
  const hit = model.rates.get(k);
  const p = hit ? hit.rate : model.baseRate ?? 0.2;
  return Math.min(0.95, Math.max(0.05, p));
}

function riskBand(p) {
  if (p == null) return null;
  if (p >= 0.7) return "ALTA expectativa";
  if (p >= 0.4) return "MÉDIA expectativa";
  return "BAIXA expectativa";
}

function wilsonInterval(successes, n) {
  const z = 1.96;
  if (!n) return { low: null, high: null };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return {
    low: Math.max(0, (center - margin) / denom),
    high: Math.min(1, (center + margin) / denom),
  };
}

function buildTopMechanismsByRawRate(train, catalog, minN) {
  const eligible = train.filter((c) => c.y === 0 || c.y === 1);
  return (catalog || [])
    .map((mech) => {
      const field = `implemented_${mech.slug}`;
      const withMech = eligible.filter((c) => c[field]);
      const events = withMech.filter((c) => c.y === 1).length;
      const rate = withMech.length ? events / withMech.length : null;
      return {
        mechanismName: mech.name,
        slug: mech.slug,
        historicalN: withMech.length,
        historicalRenewed: events,
        historicalRatePct: rate != null ? round1(rate * 100) : null,
        smallSample: withMech.length < minN,
      };
    })
    .filter((r) => r.historicalN >= minN && !r.smallSample)
    .sort((a, b) => (b.historicalRatePct ?? -1) - (a.historicalRatePct ?? -1) || b.historicalN - a.historicalN)
    .slice(0, 3);
}

function buildTopMechanismsAssociative(train, horizonScored, horizonClients, catalog, minN) {
  const eligible = train.filter((c) => c.y === 0 || c.y === 1);
  const horizonById = new Map((horizonClients || []).map((c) => [String(c.clientId), c]));
  const withoutRate = (() => {
    const w = eligible.filter((c) => (c.totalImplementedMechanisms ?? 0) === 0);
    return w.length ? w.filter((c) => c.y === 1).length / w.length : null;
  })();

  const rows = (catalog || []).map((mech) => {
    const field = `implemented_${mech.slug}`;
    const withMech = eligible.filter((c) => c[field]);
    const without = eligible.filter((c) => !c[field]);
    const events = withMech.filter((c) => c.y === 1).length;
    const rate = withMech.length ? events / withMech.length : null;
    const rateWithout = without.length
      ? without.filter((c) => c.y === 1).length / without.length
      : withoutRate;
    const diffPp = rate != null && rateWithout != null ? (rate - rateWithout) * 100 : null;
    const ci = wilsonInterval(events, withMech.length);
    const horizonWith = horizonScored.filter((r) => {
      const full = horizonById.get(String(r.clientId)) || train.find((t) => String(t.clientId) === String(r.clientId));
      return full?.[field];
    });
    const expectedAmong = horizonWith.reduce((a, r) => a + (r.predictedRenewalProbability || 0), 0);
    const meanProb =
      horizonWith.length
        ? mean(horizonWith.map((r) => r.predictedRenewalProbability))
        : null;
    return {
      mechanismId: mech.id,
      mechanismName: mech.name,
      slug: mech.slug,
      historicalN: withMech.length,
      historicalRenewed: events,
      historicalRatePct: rate != null ? round1(rate * 100) : null,
      rateWithoutPct: rateWithout != null ? round1(rateWithout * 100) : null,
      diffPp: diffPp != null ? round1(diffPp) : null,
      ciLowPct: ci.low != null ? round1(ci.low * 100) : null,
      ciHighPct: ci.high != null ? round1(ci.high * 100) : null,
      horizonClientsWithEndDate: horizonWith.length,
      meanPredictedProbability: round3(meanProb),
      adjustedAssociationNote: "Diferença vs sem mecanismo (histórico); não causal.",
      expectedRenewalsAmongHorizon: round1(expectedAmong),
      smallSample: withMech.length < minN,
    };
  });

  return rows
    .filter((r) => r.historicalN >= minN && !r.smallSample)
    .sort((a, b) => (b.diffPp ?? -999) - (a.diffPp ?? -999) || b.historicalN - a.historicalN)
    .slice(0, 3);
}

/**
 * @param {object[]} portfolioActive — ativos com cycleValid
 * @param {object[]} horizonClients — fim de ciclo entre hoje e 31/12
 */
export function buildExploratoryRenewalProjection(portfolioActive, horizonClients, catalog, options = {}) {
  const trainingPool = (portfolioActive || []).filter(
    (c) => c.cycleValid && (c.renewed === true || c.renewed === false),
  );
  const y = (c) => (c.renewed ? 1 : 0);

  const train = [];
  const test = [];
  for (const c of trainingPool) {
    const row = { ...c, y: y(c) };
    if (hashHoldout(c.clientId)) test.push(row);
    else train.push(row);
  }

  const eventsTrain = train.filter((c) => c.y === 1).length;
  const baseRate = train.length ? eventsTrain / train.length : null;

  if (train.length < MIN_TRAIN || eventsTrain < MIN_EVENTS) {
    return {
      available: false,
      reason: "Amostra insuficiente para modelo exploratório (treino ou eventos de renovação).",
      training: { n: train.length, events: eventsTrain, baseRate: round3(baseRate) },
    };
  }

  const model = buildStrataRates(train);
  const testPreds = test.map((c) => predictClient(c, model));
  const testLabels = test.map((c) => c.y);
  const brier = brierScore(testPreds, testLabels);
  const baseBrier = baseRate != null ? baseRate * (1 - baseRate) : null;
  const calibrationOk =
    brier != null && baseBrier != null ? brier <= baseBrier * BRIER_MAX_VS_BASELINE : brier != null && brier <= 0.28;

  const mechCounts = test.map((c) => c.totalImplementedMechanisms ?? 0);
  const mechAuc = logisticUnivariateAuc(mechCounts, testLabels);

  const horizonScored = (horizonClients || []).map((c) => {
    const p = predictClient(c, model);
    return {
      clientId: c.clientId,
      clientCode: c.clientCode,
      clientName: c.clientName,
      ep: c.ep,
      program: c.program,
      segment: c.segment,
      renewalDueDate: c.cycleEndDate,
      tenureDays: c.tenureDays,
      mechanismCount: c.totalImplementedMechanisms ?? 0,
      mechanismNames: c.implementedMechanismLabels || c.implementedMechanismNames || [],
      predictedRenewalProbability: round3(p),
      expectedRenewalContribution: round3(p),
      riskBand: riskBand(p),
    };
  });

  const sumP = horizonScored.reduce((a, r) => a + (r.predictedRenewalProbability || 0), 0);
  const nHorizon = horizonScored.length;
  const expectedRate = nHorizon ? sumP / nHorizon : null;

  let expectedLow = null;
  let expectedHigh = null;
  if (calibrationOk && nHorizon) {
    expectedLow = Math.floor(sumP * 0.85);
    expectedHigh = Math.ceil(sumP * 1.15);
  }

  const distributionBuckets = [
    { label: "0–10%", min: 0, max: 0.1 },
    { label: "10–20%", min: 0.1, max: 0.2 },
    { label: "20–30%", min: 0.2, max: 0.3 },
    { label: "30–40%", min: 0.3, max: 0.4 },
    { label: "40–50%", min: 0.4, max: 0.5 },
    { label: "50%+", min: 0.5, max: 1.01 },
  ].map((b) => ({
    label: b.label,
    count: horizonScored.filter((r) => {
      const p = r.predictedRenewalProbability ?? 0;
      return p >= b.min && p < b.max;
    }).length,
  }));

  const mechanismCountBands = ["0", "1", "2", "3", "4+"].map((band) => {
    const inHorizon = horizonScored.filter((r) => mechanismBand(r.mechanismCount) === band);
    const avgP = inHorizon.length
      ? mean(inHorizon.map((r) => r.predictedRenewalProbability))
      : null;
    const hist = train.filter((c) => mechanismBand(c.totalImplementedMechanisms ?? 0) === band);
    const histRate = hist.length ? hist.filter((c) => c.y === 1).length / hist.length : null;
    return {
      band,
      horizonClients: inHorizon.length,
      meanProbability: round3(avgP),
      expectedRenewals: round1(inHorizon.reduce((a, r) => a + (r.predictedRenewalProbability || 0), 0)),
      historicalRenewalRate: round3(histRate),
      historicalN: hist.length,
    };
  });

  const withoutMech = horizonScored.filter((r) => (r.mechanismCount || 0) === 0);
  const withoutMechSum = withoutMech.reduce((a, r) => a + (r.predictedRenewalProbability || 0), 0);

  const top3Adjusted = buildTopMechanismsAssociative(
    train,
    horizonScored,
    horizonClients,
    catalog,
    options.minMechanismSample || 10,
  );

  const top3RawRate = buildTopMechanismsByRawRate(train, catalog, options.minMechanismSample || 10);

  const modelAudit = buildStratifiedModelAudit({
    train,
    test,
    predictFn: (c) => predictClient(c, model),
    modelMeta: { minStratumN: MIN_STRATUM },
    calibrationBins: calibrationBins(testPreds, testLabels),
    brier,
    baseBrier,
    calibrationOk,
  });

  const publishExpectation = calibrationOk && nHorizon > 0;
  const testAuc = rocAuc(testPreds, testLabels);

  return {
    available: publishExpectation,
    badge: "PROXY / EXPLORATÓRIO",
    disclaimer:
      "Utiliza data_fim_ciclo como aproximação da próxima janela de renovação. Não é a data oficial de renovação.",
    methodology: {
      name: "Taxas estratificadas (programa × faixa de mecanismos) + shrinkage",
      target: "renewed_binary (clients.ciclo > 1) entre clientes com cycleValid",
      validation: "Holdout 20% determinístico por client_id (hash, seed=42)",
      trainingUniverse: "Carteira ativa com ciclo válido — independente de NPS",
      features: ["programa (Pharus/Davos)", "faixa mechanism_count (0,1,2,3,4+)"],
      excludedFeatures: ["NPS", "CSAT", "mecanismos binários no predictClient"],
      leakageNote: "Snapshot atual; viés de permanência.",
    },
    modelAudit,
    model: {
      trainN: train.length,
      trainEvents: eventsTrain,
      baseRate: round3(baseRate),
      testN: test.length,
      rocAuc: round4(testAuc),
      brierScore: round4(brier),
      brierBaseline: round4(baseBrier),
      calibrationOk,
      calibrationBins: calibrationBins(testPreds, testLabels),
      mechanismCountAuc: mechAuc?.auc ?? null,
    },
    expectation: publishExpectation
      ? {
          horizonClients: nHorizon,
          expectedRenewalRatePct: round1((expectedRate ?? 0) * 100),
          expectedRenewals: round1(sumP),
          intervalLow: expectedLow,
          intervalHigh: expectedHigh,
          narrative: `Esperamos aproximadamente ${round1(sumP)} renovações até ${options.horizonEnd || "31/12"} entre ${nHorizon} clientes com fim de ciclo no horizonte.`,
          subtext: "Estimativa baseada no comportamento histórico de clientes comparáveis (estratificação).",
        }
      : {
          horizonClients: nHorizon,
          message: "Calibração insuficiente — quantidade esperada não publicada como KPI exploratório.",
        },
    horizonClientsDetail: horizonScored.sort(
      (a, b) => (b.predictedRenewalProbability ?? 0) - (a.predictedRenewalProbability ?? 0),
    ),
    probabilityDistribution: distributionBuckets,
    mechanismCountBands,
    withoutMechanismBaseline: {
      horizonClients: withoutMech.length,
      expectedRenewalRatePct: withoutMech.length
        ? round1((withoutMechSum / withoutMech.length) * 100)
        : null,
      expectedRenewals: round1(withoutMechSum),
    },
    topMechanisms: top3Adjusted,
    topMechanismsAdjusted: top3Adjusted,
    topMechanismsByRawRate: top3RawRate,
    exportRows: horizonScored.map((r) => ({
      client_id: r.clientId,
      client_code: r.clientCode,
      client_name: r.clientName,
      program: r.program,
      ep: r.ep,
      segment: r.segment,
      cycle_end_date: r.renewalDueDate,
      tenure_days: r.tenureDays,
      mechanism_count: r.mechanismCount,
      mechanism_names: Array.isArray(r.mechanismNames) ? r.mechanismNames.join("; ") : r.mechanismNames || "",
      predicted_probability: r.predictedRenewalProbability,
      expected_contribution: r.expectedRenewalContribution,
    })),
  };
}
