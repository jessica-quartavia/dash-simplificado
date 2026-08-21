/**
 * Métricas de Dados Gerais (env-free).
 * Permanência / liquidez / aporte / renda usam mediana como valor de exibição.
 */
import {
  analyticalStatusDisplayLabel,
  isConfirmedCancelledStatus,
  isEffectiveCancelledStatus,
  isEffectiveCancelledWithoutDateStatus,
  isMarkedCancelledNoEvidenceStatus,
} from "./analytical-cancellation.mjs";
import { hasValidFinancialValue } from "./client-segment.mjs";

export const STAY_RANGES = [
  "Até 3 meses",
  "De 4 a 6 meses",
  "De 7 a 12 meses",
  "De 13 a 24 meses",
  "Mais de 24 meses",
  "Sem dados suficientes",
];

export const INCOME_BANDS = [
  "Até R$ 5 mil",
  "5 a 10 mil",
  "10 a 20 mil",
  "20 a 50 mil",
  "Acima de 50 mil",
  "Não informado",
];

export const LIQUIDITY_BANDS = [
  "Até R$ 50 mil",
  "50 a 100 mil",
  "100 a 250 mil",
  "250 a 500 mil",
  "500 mil a 1 milhão",
  "Acima de 1 milhão",
  "Não informado",
];

export const STATUS_LABELS = [
  "Ativo",
  "Congelado",
  "Cancelado confirmado",
  "Cancelado efetivado sem data",
  "Marcado como cancelado sem confirmação",
  "Não informado",
];

export const SEGMENT_LABELS = ["APEX", "PRIVATE", "PRINCIPAL", "DEBTS", "OVER", "Dados insuficientes"];

export const MEASURE_CONFIG = {
  liquidityReserve: {
    displayMeasure: "median",
    trimPercent: 5,
    label: "Reserva de liquidez mediana",
    tooltip:
      "A mediana representa o valor central da distribuição e sofre menos influência de valores muito altos ou muito baixos.",
  },
  lastContribution: {
    displayMeasure: "median",
    trimPercent: 5,
    label: "Último aporte mediano",
    tooltip:
      "A mediana representa o valor central da distribuição e sofre menos influência de valores muito altos ou muito baixos.",
  },
  monthlyIncome: {
    displayMeasure: "median",
    trimPercent: 5,
    label: "Renda mensal mediana",
    tooltip:
      "A mediana representa o valor central da distribuição e sofre menos influência de valores muito altos ou muito baixos.",
  },
  stayDays: {
    displayMeasure: "median",
    trimPercent: 5,
    label: "Permanência mediana",
    tooltip:
      "Para clientes ativos e congelados, considera a data atual. Para encerrados, considera apenas registros com data de cancelamento preenchida. Clientes com ciclo ≥ 2 e permanência base < 365 dias recebem +365 no indicador analítico. A mediana sofre menos influência de valores extremos.",
  },
};

export function average(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

export function round2(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export function robustStats(values, options = {}) {
  const trimPercent = options.trimPercent ?? 5;
  const filled = values.filter((v) => v != null && Number.isFinite(v));
  const valid = filled.filter((v) => options.allowNegative || v >= 0);
  const sorted = [...valid].sort((a, b) => a - b);
  const count = filled.length;
  const validCount = sorted.length;
  if (!validCount) {
    return {
      count,
      filledCount: count,
      validCount: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      p5: null,
      p25: null,
      p75: null,
      p95: null,
      trimmedMean: null,
      trimmedExcludedCount: 0,
      extremeImpact: false,
    };
  }
  const mean = average(sorted);
  const median = round2(percentile(sorted, 50));
  const p5 = round2(percentile(sorted, 5));
  const p25 = round2(percentile(sorted, 25));
  const p75 = round2(percentile(sorted, 75));
  const p95 = round2(percentile(sorted, 95));
  let trimmed = sorted;
  let trimmedExcludedCount = 0;
  if (validCount >= 20 && trimPercent > 0) {
    const low = percentile(sorted, trimPercent);
    const high = percentile(sorted, 100 - trimPercent);
    trimmed = sorted.filter((v) => v >= low && v <= high);
    trimmedExcludedCount = validCount - trimmed.length;
  }
  const trimmedMean = average(trimmed);
  const extremeImpact =
    median != null &&
    median !== 0 &&
    mean != null &&
    Math.abs(mean - median) / Math.abs(median) >= 0.3;
  return {
    count,
    filledCount: count,
    validCount,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median,
    p5,
    p25,
    p75,
    p95,
    trimmedMean,
    trimmedExcludedCount,
    extremeImpact,
  };
}

export function measureBundle(key, values) {
  const cfg = MEASURE_CONFIG[key] || {
    displayMeasure: "median",
    trimPercent: 5,
    label: key,
    tooltip: "Medida robusta diante de valores extremos.",
  };
  const stats = robustStats(values, {
    trimPercent: cfg.trimPercent,
    allowNegative: key === "lastContribution",
  });
  const displayMap = {
    mean: stats.mean,
    median: stats.median,
    trimmedMean: stats.trimmedMean,
  };
  return {
    ...stats,
    displayMeasure: cfg.displayMeasure,
    displayValue: displayMap[cfg.displayMeasure] ?? stats.median,
    label: cfg.label,
    tooltip: cfg.tooltip,
    trimmedMeanNote: "Média sem extremos considera apenas valores entre os percentis 5 e 95.",
  };
}

export function monthKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function currentMonthKey(now = new Date()) {
  return monthKey(now);
}

export function shiftMonthKey(ym, delta) {
  const [y, m] = String(ym).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function distributionFrom(items, keyFn, orderedLabels) {
  const counts = new Map();
  if (orderedLabels) orderedLabels.forEach((label) => counts.set(label, 0));
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = items.length || 1;
  const entries = orderedLabels
    ? orderedLabels.map((label) => [label, counts.get(label) || 0])
    : [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  return entries.map(([label, count]) => ({
    label,
    count,
    percent: Math.round((count / total) * 1000) / 10,
  }));
}

export function summarizeGeneralRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length || 1;
  const liquidityValues = list.map((r) => r.liquidityReserve).filter((v) => v != null);
  const contributionValues = list.map((r) => r.lastContribution).filter((v) => v != null);
  const incomeValues = list.map((r) => r.monthlyIncome).filter((v) => v != null);
  const stayValues = list
    .map((r) => r.stayDays)
    .filter((v) => v != null && Number.isFinite(v) && v >= 0);
  const stayCalculatedClients = stayValues.length;
  const stayExcludedClients = list.length - stayCalculatedClients;
  const stayCoveragePercent = list.length
    ? Math.round((stayCalculatedClients / list.length) * 1000) / 10
    : 0;
  const closedWithoutCancellationDate = list.filter(
    (r) =>
      isMarkedCancelledNoEvidenceStatus(r.analyticalStatus)
      || isEffectiveCancelledWithoutDateStatus(r.analyticalStatus),
  ).length;
  const withFinancial = list.filter((r) => r.hasFinancialProfile).length;

  const classifiableClients = list.filter((r) => r.segmentStatus === "classified").length;
  const insufficientDataClients = list.filter((r) => r.segmentStatus === "insufficient_data").length;
  const withValidIncome = list.filter(
    (r) =>
      r.segmentInputs
      && hasValidFinancialValue(r.segmentInputs.monthlyIncome)
      && r.segmentInputs.monthlyIncome >= 0,
  ).length;
  const withDebtInfo = list.filter((r) => r.segmentInputs && r.segmentInputs.debtDataAvailable).length;
  const withApexCriterion = list.filter((r) => r.segment === "APEX").length;
  const pctOf = (n) => Math.round((n / total) * 1000) / 10;

  const activeClients = list.filter((r) => r.analyticalStatus === "Ativo").length;
  const cancelledClients = list.filter((r) => isEffectiveCancelledStatus(r.analyticalStatus)).length;
  const cancelledWithConfirmedDate = list.filter((r) => isConfirmedCancelledStatus(r.analyticalStatus)).length;
  const cancelledEffectiveWithoutDate = list.filter((r) =>
    isEffectiveCancelledWithoutDateStatus(r.analyticalStatus),
  ).length;
  const frozenClients = list.filter((r) => r.analyticalStatus === "Congelado").length;
  const cancelledWithoutConfirmedDate = list.filter((r) =>
    isMarkedCancelledNoEvidenceStatus(r.analyticalStatus),
  ).length;
  const unknownClients = list.filter((r) => r.analyticalStatus === "Não informado").length;
  const knownStatuses = new Set([
    "Ativo",
    "Congelado",
    "Cancelado",
    "Cancelado efetivado sem data",
    "Marcado como cancelado sem confirmação",
    "Cancelado sem data confirmada",
    "Não informado",
  ]);
  const otherNonActiveClients = list.filter(
    (r) =>
      !knownStatuses.has(r.analyticalStatus)
      && r.analyticalStatus !== "Ativo"
      && !isEffectiveCancelledStatus(r.analyticalStatus)
      && r.analyticalStatus !== "Congelado"
      && !isMarkedCancelledNoEvidenceStatus(r.analyticalStatus)
      && r.analyticalStatus !== "Não informado",
  ).length;
  const nonActiveClients = frozenClients + cancelledWithoutConfirmedDate + otherNonActiveClients;
  const nonActiveComposition = {
    frozenClients,
    cancelledWithoutConfirmedDate,
    cancelledEffectiveWithoutDate,
    otherNonActiveClients,
    total: nonActiveClients,
    note:
      "Agregação de categorias fora da carteira ativa (congelados + marcados sem confirmação + outros). Não inclui cancelados confirmados. Não somar ingenuamente com subconjuntos nem com Ativos.",
  };
  const statusAuditSum =
    activeClients
    + frozenClients
    + cancelledWithConfirmedDate
    + cancelledEffectiveWithoutDate
    + cancelledWithoutConfirmedDate
    + unknownClients
    + otherNonActiveClients;

  const liquidityStats = measureBundle("liquidityReserve", liquidityValues);
  const contributionStats = measureBundle("lastContribution", contributionValues);
  const incomeStats = measureBundle("monthlyIncome", incomeValues);
  const stayStats = measureBundle("stayDays", stayValues);

  return {
    totalClients: list.length,
    activeClients,
    cancelledClients,
    cancelledWithConfirmedDate,
    cancelledEffectiveWithoutDate,
    frozenClients,
    cancelledWithoutConfirmedDate,
    markedCancelledWithoutEvidence: cancelledWithoutConfirmedDate,
    unknownClients,
    otherNonActiveClients,
    nonActiveClients,
    nonActiveComposition,
    statusAuditSum,
    averageStayDays: stayStats.mean,
    typicalStayDays: stayStats.displayValue,
    stayDaysStats: stayStats,
    stayCalculatedClients,
    stayExcludedClients,
    stayCoveragePercent,
    closedWithoutCancellationDate,
    averageLiquidityReserve: liquidityStats.mean,
    typicalLiquidityReserve: liquidityStats.displayValue,
    liquidityReserveStats: liquidityStats,
    liquidityReserveFilledCount: liquidityValues.length,
    averageLastContribution: contributionStats.mean,
    typicalLastContribution: contributionStats.displayValue,
    lastContributionStats: contributionStats,
    lastContributionFilledCount: contributionValues.length,
    averageMonthlyIncome: incomeStats.mean,
    typicalMonthlyIncome: incomeStats.displayValue,
    monthlyIncomeStats: incomeStats,
    monthlyIncomeFilledCount: incomeValues.length,
    clientsWithFinancialProfile: withFinancial,
    financialProfilePercent: Math.round((withFinancial / total) * 1000) / 10,
    segmentation: {
      classifiableClients,
      insufficientDataClients,
      incomeFilledPercent: pctOf(withValidIncome),
      debtInfoPercent: pctOf(withDebtInfo),
      apexCriterionPercent: pctOf(withApexCriterion),
    },
  };
}

export function distributionsFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length || 1;
  return {
    status: distributionFrom(
      list,
      (r) => analyticalStatusDisplayLabel(r.analyticalStatus),
      STATUS_LABELS,
    ).filter((item) => item.count > 0),
    segments: distributionFrom(list, (r) => r.segmentLabel, SEGMENT_LABELS),
    engineers: distributionFrom(list, (r) => r.engineer),
    stayRanges: distributionFrom(list, (r) => r.stayRange, STAY_RANGES),
    financialProfile: [
      { label: "Imóvel", count: list.filter((r) => r.hasProperty === true).length },
      { label: "Carro", count: list.filter((r) => r.hasCar === true).length },
      { label: "Consórcio", count: list.filter((r) => r.hasConsortium === true).length },
      { label: "Reserva de liquidez", count: list.filter((r) => r.liquidityReserve != null).length },
    ].map((item) => ({
      ...item,
      percent: Math.round((item.count / total) * 1000) / 10,
    })),
    monthlyIncome: distributionFrom(list, (r) => r.incomeBand, INCOME_BANDS),
    liquidityReserve: distributionFrom(list, (r) => r.liquidityBand, LIQUIDITY_BANDS),
  };
}

/**
 * EXCEÇÃO METODOLÓGICA — aquisição mensal é histórica.
 * Conta clientes adquiridos em cada mês independentemente do status analítico
 * atual. O default active-first da página NÃO deve ser aplicado a esta série,
 * senão a leitura histórica desaparece (cancelados deixariam de aparecer no
 * mês em que foram contratados). Sem meses futuros.
 *
 * A série contínua preenche meses vazios entre o mais antigo da janela e hoje.
 */
export function buildAcquisitionMonthSeries(rows, limit = 6, now = new Date()) {
  const nowKey = currentMonthKey(now);
  const byMonth = new Map();
  for (const row of rows) {
    const raw = row.acquisitionDate || row.contractDate;
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const key = monthKey(d);
    if (key > nowKey) continue;
    if (!byMonth.has(key)) {
      byMonth.set(key, {
        month: key,
        acquiredClients: 0,
        contractSignatureCount: 0,
        cycleStartFallbackCount: 0,
        createdAtFallbackCount: 0,
      });
    }
    const bucket = byMonth.get(key);
    bucket.acquiredClients += 1;
    const src = row.acquisitionDateSource;
    if (src === "contract_signature") bucket.contractSignatureCount += 1;
    else if (src === "cycle_start") bucket.cycleStartFallbackCount += 1;
    else if (src === "client_created") bucket.createdAtFallbackCount += 1;
  }

  const series = [];
  const window = Number(limit) === 24 ? 24 : Number(limit) === 12 ? 12 : 6;
  for (let i = window - 1; i >= 0; i -= 1) {
    const key = shiftMonthKey(nowKey, -i);
    if (key > nowKey) continue;
    const current = byMonth.get(key) || {
      month: key,
      acquiredClients: 0,
      contractSignatureCount: 0,
      cycleStartFallbackCount: 0,
      createdAtFallbackCount: 0,
    };
    const prevKey = shiftMonthKey(key, -1);
    const prev = byMonth.get(prevKey);
    let change = null;
    if (prev && prev.acquiredClients > 0) {
      change = Math.round(((current.acquiredClients - prev.acquiredClients) / prev.acquiredClients) * 1000) / 10;
    }
    series.push({ ...current, previousMonthChangePercent: change });
  }
  return series;
}

export function acquisitionSummaryFromSeries(series) {
  const counts = series.map((v) => v.acquiredClients);
  const latest = series[series.length - 1] || null;
  const avg = counts.length ? round2(average(counts)) : null;
  const medSorted = [...counts].sort((a, b) => a - b);
  const median = medSorted.length ? round2(percentile(medSorted, 50)) : null;
  return {
    latestMonthAcquisitions: latest?.acquiredClients ?? 0,
    averageMonthlyAcquisitions: avg,
    medianMonthlyAcquisitions: median,
    latestMonthChangePercent: latest?.previousMonthChangePercent ?? null,
  };
}

export function buildAcquisitionsByMonth(rows, now = new Date()) {
  const nowKey = currentMonthKey(now);
  const byMonth = new Map();
  for (const row of rows) {
    if (!row.acquisitionDate) continue;
    const d = new Date(row.acquisitionDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = monthKey(d);
    if (key > nowKey) continue;
    if (!byMonth.has(key)) {
      byMonth.set(key, {
        month: key,
        acquiredClients: 0,
        contractSignatureCount: 0,
        cycleStartFallbackCount: 0,
        createdAtFallbackCount: 0,
      });
    }
    const bucket = byMonth.get(key);
    bucket.acquiredClients += 1;
    if (row.acquisitionDateSource === "contract_signature") bucket.contractSignatureCount += 1;
    else if (row.acquisitionDateSource === "cycle_start") bucket.cycleStartFallbackCount += 1;
    else if (row.acquisitionDateSource === "client_created") bucket.createdAtFallbackCount += 1;
  }

  const months = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));
  const result = [];
  for (let i = 0; i < months.length; i += 1) {
    const current = byMonth.get(months[i]);
    const prevKey = months[i + 1];
    const prev = prevKey ? byMonth.get(prevKey) : null;
    let change = null;
    if (prev && prev.acquiredClients > 0) {
      change = Math.round(((current.acquiredClients - prev.acquiredClients) / prev.acquiredClients) * 1000) / 10;
    }
    const dominant =
      [
        ["contract_signature", current.contractSignatureCount],
        ["cycle_start", current.cycleStartFallbackCount],
        ["client_created", current.createdAtFallbackCount],
      ].sort((a, b) => b[1] - a[1])[0]?.[0] || "unavailable";
    result.push({
      ...current,
      previousMonthChangePercent: change,
      predominantSource: dominant,
      fallbackCount: current.cycleStartFallbackCount + current.createdAtFallbackCount,
    });
  }

  const counts = result.map((r) => r.acquiredClients);
  const latest = result[0] || null;
  return {
    acquisitionsByMonth: result,
    summary: {
      latestMonthAcquisitions: latest?.acquiredClients ?? 0,
      averageMonthlyAcquisitions: average(counts),
      medianMonthlyAcquisitions: counts.length ? round2(percentile([...counts].sort((a, b) => a - b), 50)) : null,
      latestMonthChangePercent: latest?.previousMonthChangePercent ?? null,
    },
  };
}
