/**
 * Testes estatísticos determinísticos (sem biblioteca externa).
 * Usado por Cruzamentos Estatísticos — somente backend.
 */

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function median(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

export function mean(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Desvio-padrão amostral (n−1). */
export function sampleSd(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (nums.length < 2) return null;
  const m = mean(nums);
  if (m == null) return null;
  const ss = nums.reduce((acc, v) => acc + (v - m) * (v - m), 0);
  return Math.sqrt(ss / (nums.length - 1));
}

/**
 * Desvio-padrão agrupado de dois grupos.
 * Usado na diferença padronizada: (média/mediana₁ − média/mediana₀) / sdPooled.
 */
export function pooledSd(groupA, groupB) {
  const a = (groupA || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  const b = (groupB || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  const sa = sampleSd(a);
  const sb = sampleSd(b);
  if (sa == null && sb == null) return null;
  if (sa == null) return sb;
  if (sb == null) return sa;
  const na = a.length;
  const nb = b.length;
  if (na + nb < 3) return sa || sb;
  return Math.sqrt(((na - 1) * sa * sa + (nb - 1) * sb * sb) / (na + nb - 2));
}

/**
 * Diferença padronizada entre dois grupos (efeito comparável).
 * Convenção: (valorGrupoAlvo − valorReferência) / sdPooled.
 * Positivo = alvo maior; negativo = alvo menor.
 */
export function standardizedDifference(targetStat, referenceStat, pooled) {
  const t = Number(targetStat);
  const r = Number(referenceStat);
  const sd = Number(pooled);
  if (!Number.isFinite(t) || !Number.isFinite(r)) return null;
  const denom = Number.isFinite(sd) && sd > 1e-12 ? sd : null;
  if (denom == null) return t === r ? 0 : null;
  return round4((t - r) / denom);
}

export function round4(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

export function round3(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

/** Cobertura percentual (0–100); zero válidos é 0, não null. */
export function coveragePct(valid, total) {
  if (total == null || !Number.isFinite(total) || total <= 0) return null;
  if (valid == null || !Number.isFinite(valid) || valid < 0) return 0;
  return Math.round((valid / total) * 1000) / 10;
}

function averageRanks(values) {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j += 1;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) ranks[indexed[k].i] = avg;
    i = j;
  }
  return ranks;
}

/** Correlação de Spearman (ranks + Pearson); empates usam rank médio. */
export function spearman(x, y) {
  const pairs = [];
  const nIn = Math.min(x?.length || 0, y?.length || 0);
  for (let i = 0; i < nIn; i += 1) {
    if (x[i] == null || !Number.isFinite(Number(x[i]))) continue;
    if (y[i] == null || !Number.isFinite(Number(y[i]))) continue;
    pairs.push({ x: Number(x[i]), y: Number(y[i]) });
  }
  const n = pairs.length;
  if (n < 3) {
    return { rho: null, r: null, n, warning: "sample_too_small", status: "sample_too_small", reason: "n < 3" };
  }
  const rx = averageRanks(pairs.map((p) => p.x));
  const ry = averageRanks(pairs.map((p) => p.y));
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = rx[i] - mx;
    const b = ry[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (!dx || !dy) {
    return { rho: null, r: null, n, warning: "zero_variance", status: "zero_variance", reason: "variância zero nos ranks" };
  }
  const rho = round4(num / Math.sqrt(dx * dy));
  return { rho, r: rho, n, warning: null, status: "ok", reason: null };
}

/** Correlação de Pearson (pares completos). */
export function pearson(x, y) {
  const pairs = [];
  const nIn = Math.min(x?.length || 0, y?.length || 0);
  for (let i = 0; i < nIn; i += 1) {
    if (x[i] == null || !Number.isFinite(Number(x[i]))) continue;
    if (y[i] == null || !Number.isFinite(Number(y[i]))) continue;
    pairs.push({ x: Number(x[i]), y: Number(y[i]) });
  }
  const n = pairs.length;
  if (n < 3) {
    return { r: null, rho: null, n, warning: "sample_too_small", status: "sample_too_small", reason: "n < 3" };
  }
  const mx = mean(pairs.map((p) => p.x));
  const my = mean(pairs.map((p) => p.y));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const p of pairs) {
    const a = p.x - mx;
    const b = p.y - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (!dx || !dy) {
    return { r: null, rho: null, n, warning: "zero_variance", status: "zero_variance", reason: "variância zero" };
  }
  const r = round4(num / Math.sqrt(dx * dy));
  return { r, rho: r, n, warning: null, status: "ok", reason: null };
}

/** Mann–Whitney U (two-sided p via normal approximation with tie correction). */
export function mannWhitney(groupA, groupB) {
  const a = groupA.filter((v) => v != null && Number.isFinite(v));
  const b = groupB.filter((v) => v != null && Number.isFinite(v));
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 3 || n2 < 3) {
    return { u: null, pValue: null, rankBiserial: null, n1, n2, warning: "sample_too_small" };
  }
  const combined = [
    ...a.map((v) => ({ v, g: 0 })),
    ...b.map((v) => ({ v, g: 1 })),
  ].sort((x, y) => x.v - y.v);

  // Average ranks for ties
  const ranks = new Array(combined.length);
  let i = 0;
  const tieCounts = [];
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].v === combined[i].v) j += 1;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) ranks[k] = avg;
    if (j - i > 1) tieCounts.push(j - i);
    i = j;
  }

  let r1 = 0;
  for (let k = 0; k < combined.length; k += 1) {
    if (combined[k].g === 0) r1 += ranks[k];
  }
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);
  const mu = (n1 * n2) / 2;
  let tieTerm = 0;
  for (const t of tieCounts) tieTerm += t * t * t - t;
  const n = n1 + n2;
  const sigma = Math.sqrt((n1 * n2 / 12) * ((n + 1) - tieTerm / (n * (n - 1))));
  if (!sigma || sigma <= 0) {
    return { u: round4(u), pValue: null, rankBiserial: null, n1, n2, warning: "zero_variance" };
  }
  const z = (u - mu + 0.5) / sigma; // continuity correction toward mean
  const pValue = Math.min(1, Math.max(0, 2 * Math.min(normalCdf(z), 1 - normalCdf(z))));
  // Rank-biserial: 1 - (2U)/(n1*n2) using U for group A advantage direction via u1
  const rankBiserial = 1 - (2 * u1) / (n1 * n2);
  return {
    u: round4(u),
    u1: round4(u1),
    pValue: round4(pValue),
    rankBiserial: round4(rankBiserial),
    n1,
    n2,
    warning: null,
  };
}

/** Point-biserial correlation: continuous x vs binary y (0/1). */
export function pointBiserial(x, yBinary) {
  const pairs = [];
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] == null || !Number.isFinite(x[i])) continue;
    if (yBinary[i] !== 0 && yBinary[i] !== 1) continue;
    pairs.push({ x: x[i], y: yBinary[i] });
  }
  const n = pairs.length;
  const n1 = pairs.filter((p) => p.y === 1).length;
  const n0 = n - n1;
  if (n < 10 || n1 < 3 || n0 < 3) {
    return { r: null, n, n1, n0, warning: "sample_too_small" };
  }
  const m1 = mean(pairs.filter((p) => p.y === 1).map((p) => p.x));
  const m0 = mean(pairs.filter((p) => p.y === 0).map((p) => p.x));
  const sx = Math.sqrt(mean(pairs.map((p) => (p.x - mean(pairs.map((q) => q.x))) ** 2)) * (n / (n - 1)) || 0);
  // population sd for point-biserial often uses n; use sample sd
  const mu = mean(pairs.map((p) => p.x));
  const sd = Math.sqrt(pairs.reduce((a, p) => a + (p.x - mu) ** 2, 0) / (n - 1));
  if (!sd) return { r: null, n, n1, n0, warning: "zero_variance" };
  const r = ((m1 - m0) / sd) * Math.sqrt((n1 * n0) / (n * n));
  return { r: round4(r), n, n1, n0, mean1: round4(m1), mean0: round4(m0), warning: null };
}

function logGamma(z) {
  // Lanczos approximation
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.984369654078991e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i += 1) x += p[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logFactorial(n) {
  return logGamma(n + 1);
}

/** Chi-square independence for contingency table (rows x cols). */
export function chiSquareIndependence(table) {
  const rows = table.length;
  const cols = table[0]?.length || 0;
  if (!rows || !cols) return { chi2: null, pValue: null, dof: null, cramersV: null, warning: "empty" };
  const rowSum = table.map((r) => r.reduce((a, b) => a + b, 0));
  const colSum = Array.from({ length: cols }, (_, j) => table.reduce((a, r) => a + r[j], 0));
  const n = rowSum.reduce((a, b) => a + b, 0);
  if (n < 5) return { chi2: null, pValue: null, dof: null, cramersV: null, n, warning: "sample_too_small" };

  let chi2 = 0;
  let lowExpected = false;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const exp = (rowSum[i] * colSum[j]) / n;
      if (exp < 5) lowExpected = true;
      if (exp <= 0) continue;
      const o = table[i][j];
      chi2 += ((o - exp) ** 2) / exp;
    }
  }
  const dof = (rows - 1) * (cols - 1);
  const pValue = chiSquareSf(chi2, dof);
  const k = Math.min(rows - 1, cols - 1);
  const cramersV = k > 0 && n > 0 ? Math.sqrt(chi2 / (n * k)) : null;
  return {
    chi2: round4(chi2),
    pValue: round4(pValue),
    dof,
    cramersV: round4(cramersV),
    n,
    warning: lowExpected ? "low_expected_frequency" : null,
  };
}

/** Survival function of chi-square (upper tail) via regularized gamma Q. */
function chiSquareSf(x, k) {
  if (x == null || !Number.isFinite(x) || k <= 0) return null;
  if (x <= 0) return 1;
  return gammaQ(k / 2, x / 2);
}

function gammaQ(a, x) {
  // Q(a,x) = 1 - P(a,x); use series / continued fraction
  if (x < 0 || a <= 0) return null;
  if (x === 0) return 1;
  if (x < a + 1) return 1 - gammaPSeries(a, x);
  return gammaQCf(a, x);
}

function gammaPSeries(a, x) {
  let sum = 1 / a;
  let term = sum;
  for (let n = 1; n < 200; n += 1) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function gammaQCf(a, x) {
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Fisher exact test for 2x2 (two-sided). */
export function fisherExact2x2(a, b, c, d) {
  const n = a + b + c + d;
  if (n < 1) return { pValue: null, warning: "empty" };
  const row1 = a + b;
  const col1 = a + c;
  const lo = Math.max(0, row1 + col1 - n);
  const hi = Math.min(row1, col1);
  const logDenom = logFactorial(row1) + logFactorial(n - row1) + logFactorial(col1) + logFactorial(n - col1) - logFactorial(n);
  function logHyper(k) {
    return (
      logDenom
      - logFactorial(k)
      - logFactorial(row1 - k)
      - logFactorial(col1 - k)
      - logFactorial(n - row1 - col1 + k)
    );
  }
  const logPObs = logHyper(a);
  let p = 0;
  for (let k = lo; k <= hi; k += 1) {
    const lp = logHyper(k);
    if (lp <= logPObs + 1e-12) p += Math.exp(lp);
  }
  return { pValue: round4(Math.min(1, p)), warning: null };
}

/**
 * Univariate logistic regression (Newton-Raphson) + ROC AUC.
 * x numeric (or 0/1 for binary categorical encoded).
 */
export function logisticUnivariateAuc(x, y, { folds = 5, seed = 42 } = {}) {
  const pairs = [];
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] == null || !Number.isFinite(x[i])) continue;
    if (y[i] !== 0 && y[i] !== 1) continue;
    pairs.push({ x: x[i], y: y[i] });
  }
  const n = pairs.length;
  const n1 = pairs.filter((p) => p.y === 1).length;
  const n0 = n - n1;
  if (n < 30 || n1 < 8 || n0 < 8) {
    return { auc: null, aucInverted: null, direction: null, coef: null, n, n1, n0, warning: "sample_too_small" };
  }
  const xs = pairs.map((p) => p.x);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  if (xmax === xmin) {
    return { auc: null, aucInverted: null, direction: null, coef: null, n, n1, n0, warning: "constant_variable" };
  }

  // Standardize x for stability
  const mu = mean(xs);
  const sd = Math.sqrt(xs.reduce((a, v) => a + (v - mu) ** 2, 0) / (n - 1)) || 1;
  const data = pairs.map((p) => ({ x: (p.x - mu) / sd, y: p.y }));

  const fit = fitLogistic(data);
  if (!fit) {
    return { auc: null, aucInverted: null, direction: null, coef: null, n, n1, n0, warning: "fit_failed" };
  }

  const k = Math.min(folds, Math.min(n1, n0));
  if (k < 3) {
    const scores = data.map((p) => sigmoid(fit.b0 + fit.b1 * p.x));
    const auc = rocAuc(scores, data.map((p) => p.y));
    const direction = fit.b1 >= 0 ? "positive" : "negative";
    const aucReport = auc >= 0.5 ? auc : 1 - auc;
    return {
      auc: round4(aucReport),
      aucRaw: round4(auc),
      aucInverted: auc < 0.5,
      direction,
      coef: round4(fit.b1),
      n,
      n1,
      n0,
      warning: null,
      method: "logistic_univariate_holdout_in_sample",
    };
  }

  const foldsData = stratifiedFolds(data, k, seed);
  const aucs = [];
  for (let f = 0; f < k; f += 1) {
    const train = foldsData.filter((_, i) => i !== f).flat();
    const test = foldsData[f];
    const m = fitLogistic(train);
    if (!m) continue;
    const scores = test.map((p) => sigmoid(m.b0 + m.b1 * p.x));
    const auc = rocAuc(scores, test.map((p) => p.y));
    if (auc != null) aucs.push(auc);
  }
  if (!aucs.length) {
    return { auc: null, aucInverted: null, direction: null, coef: round4(fit.b1), n, n1, n0, warning: "cv_failed" };
  }
  const aucMean = mean(aucs);
  const inverted = aucMean < 0.5;
  return {
    auc: round4(inverted ? 1 - aucMean : aucMean),
    aucRaw: round4(aucMean),
    aucInverted: inverted,
    direction: fit.b1 >= 0 ? "positive" : "negative",
    coef: round4(fit.b1),
    n,
    n1,
    n0,
    cvFolds: k,
    warning: null,
    method: "logistic_univariate_stratified_cv",
  };
}

function sigmoid(z) {
  if (z >= 30) return 1;
  if (z <= -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

function fitLogistic(data, maxIter = 40) {
  let b0 = 0;
  let b1 = 0;
  for (let iter = 0; iter < maxIter; iter += 1) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (const p of data) {
      const pr = sigmoid(b0 + b1 * p.x);
      const w = pr * (1 - pr);
      const err = p.y - pr;
      g0 += err;
      g1 += err * p.x;
      h00 += w;
      h01 += w * p.x;
      h11 += w * p.x * p.x;
    }
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) return null;
    const db0 = (h11 * g0 - h01 * g1) / det;
    const db1 = (-h01 * g0 + h00 * g1) / det;
    b0 += db0;
    b1 += db1;
    if (Math.abs(db0) + Math.abs(db1) < 1e-8) break;
  }
  return { b0, b1 };
}

function stratifiedFolds(data, k, seed) {
  const rng = mulberry32(seed);
  const pos = data.filter((d) => d.y === 1);
  const neg = data.filter((d) => d.y === 0);
  shuffleInPlace(pos, rng);
  shuffleInPlace(neg, rng);
  const folds = Array.from({ length: k }, () => []);
  pos.forEach((p, i) => folds[i % k].push(p));
  neg.forEach((p, i) => folds[i % k].push(p));
  return folds;
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

export function rocAuc(scores, labels) {
  const pairs = scores.map((s, i) => ({ s, y: labels[i] }))
    .filter((p) => p.y === 0 || p.y === 1)
    .sort((a, b) => b.s - a.s);
  const n1 = pairs.filter((p) => p.y === 1).length;
  const n0 = pairs.length - n1;
  if (!n1 || !n0) return null;
  let tp = 0;
  let fp = 0;
  let prevS = null;
  let auc = 0;
  let prevTpr = 0;
  let prevFpr = 0;
  for (const p of pairs) {
    if (prevS != null && p.s !== prevS) {
      const tpr = tp / n1;
      const fpr = fp / n0;
      auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
      prevTpr = tpr;
      prevFpr = fpr;
    }
    if (p.y === 1) tp += 1;
    else fp += 1;
    prevS = p.s;
  }
  const tpr = tp / n1;
  const fpr = fp / n0;
  auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
  return auc;
}

/**
 * Kaplan–Meier estimator.
 * records: [{ time: number, event: 0|1 }] time>0, event=1 cancelled, 0 censored
 */
export function kaplanMeier(records) {
  const rows = (records || [])
    .filter((r) => r && Number.isFinite(r.time) && r.time >= 0)
    .map((r) => ({ time: r.time, event: r.event ? 1 : 0 }))
    .sort((a, b) => a.time - b.time || b.event - a.event);

  const nStart = rows.length;
  if (!nStart) {
    return {
      curve: [],
      medianSurvival: null,
      events: 0,
      censored: 0,
      nStart: 0,
      warning: "empty",
    };
  }

  let atRisk = nStart;
  let survival = 1;
  const curve = [{ time: 0, survival: 1, atRisk: nStart, events: 0, censored: 0 }];
  let i = 0;
  let totalEvents = 0;
  let totalCensored = 0;
  let medianSurvival = null;

  while (i < rows.length) {
    const t = rows[i].time;
    let deaths = 0;
    let cens = 0;
    while (i < rows.length && rows[i].time === t) {
      if (rows[i].event) deaths += 1;
      else cens += 1;
      i += 1;
    }
    if (deaths > 0 && atRisk > 0) {
      survival *= (atRisk - deaths) / atRisk;
      if (survival < 0) survival = 0;
      curve.push({
        time: t,
        survival: round4(survival),
        atRisk,
        events: deaths,
        censored: cens,
      });
      if (medianSurvival == null && survival <= 0.5) medianSurvival = t;
    } else if (cens > 0) {
      // censoring only — survival unchanged; still track at risk reduction after
      curve.push({
        time: t,
        survival: round4(survival),
        atRisk,
        events: 0,
        censored: cens,
      });
    }
    totalEvents += deaths;
    totalCensored += cens;
    atRisk -= deaths + cens;
  }

  // Ensure monotone non-increasing
  for (let k = 1; k < curve.length; k += 1) {
    if (curve[k].survival > curve[k - 1].survival) curve[k].survival = curve[k - 1].survival;
  }

  return {
    curve,
    medianSurvival,
    events: totalEvents,
    censored: totalCensored,
    nStart,
    warning: null,
  };
}

/** Log-rank test for two groups. */
export function logRank(groupA, groupB) {
  const a = (groupA || []).filter((r) => r && Number.isFinite(r.time) && r.time >= 0);
  const b = (groupB || []).filter((r) => r && Number.isFinite(r.time) && r.time >= 0);
  if (a.length < 10 || b.length < 10) {
    return { chi2: null, pValue: null, warning: "sample_too_small", nA: a.length, nB: b.length };
  }
  const times = [...new Set([...a, ...b].filter((r) => r.event).map((r) => r.time))].sort((x, y) => x - y);
  let num = 0;
  let den = 0;
  for (const t of times) {
    const r1 = a.filter((r) => r.time >= t).length;
    const r2 = b.filter((r) => r.time >= t).length;
    const d1 = a.filter((r) => r.time === t && r.event).length;
    const d2 = b.filter((r) => r.time === t && r.event).length;
    const r = r1 + r2;
    const d = d1 + d2;
    if (r <= 1 || d === 0) continue;
    const e1 = d * (r1 / r);
    num += d1 - e1;
    den += (r1 * r2 * d * (r - d)) / (r * r * (r - 1));
  }
  if (den <= 0) return { chi2: null, pValue: null, warning: "zero_variance", nA: a.length, nB: b.length };
  const chi2 = (num * num) / den;
  const pValue = chiSquareSf(chi2, 1);
  return { chi2: round4(chi2), pValue: round4(pValue), warning: null, nA: a.length, nB: b.length };
}

/** Association strength label (documented thresholds). */
export function associationStrength(absEffect, kind) {
  // Documented: |r| / V / |rank-biserial|
  const v = Math.abs(absEffect ?? 0);
  if (!Number.isFinite(v)) return "não calculável";
  if (kind === "cramers_v") {
    if (v < 0.1) return "muito fraca";
    if (v < 0.2) return "fraca";
    if (v < 0.3) return "moderada";
    return "forte";
  }
  // point-biserial / rank-biserial
  if (v < 0.1) return "muito fraca";
  if (v < 0.3) return "fraca";
  if (v < 0.5) return "moderada";
  return "forte";
}

export function buildContingencyFromGroups(activeLabels, cancelledLabels) {
  const labels = [...new Set([...activeLabels, ...cancelledLabels].filter((l) => l != null && l !== ""))];
  if (!labels.length) return { table: null, labels: [] };
  const table = [
    labels.map((lab) => activeLabels.filter((x) => x === lab).length),
    labels.map((lab) => cancelledLabels.filter((x) => x === lab).length),
  ];
  return { table, labels };
}
