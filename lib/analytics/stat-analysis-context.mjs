/**
 * Contexto analítico por request — índices e séries pré-calculadas (Cruzamentos Estatísticos).
 * Evita scans O(n²) repetidos sobre a mesma população filtrada.
 */
import { median, pooledSd, spearman, standardizedDifference, computeAverageRanks } from "./stats-tests.mjs";

function pct(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function missingRate(clients, field) {
  if (!clients.length) return 100;
  let miss = 0;
  for (const c of clients) {
    const v = c[field];
    if (typeof v === "boolean") continue;
    if (typeof v === "number" && Number.isFinite(v)) continue;
    if (v == null || v === "" || v === "Não informado" || v === "Dados insuficientes") miss += 1;
  }
  return pct(miss, clients.length);
}

function churnCategoricalLabel(def, c) {
  const v = c[def.field];
  if (def.binary) return v ? "Sim" : "Não";
  return v == null || v === "" ? "Não informado" : String(v);
}

function renewalCategoricalLabel(def, c) {
  const v = c[def.field];
  if (def.binary) return v ? "Sim" : "Não";
  if (def.id === "npsClass") {
    if (v === "promoter") return "Promotores";
    if (v === "passive") return "Neutros";
    if (v === "detractor") return "Detratores";
  }
  return v == null || v === "" ? "Não informado" : String(v);
}

function extractRenewalNumericSeries(eligible, field, requireNpsPredictive) {
  const xs = [];
  const ys = [];
  const rVals = [];
  const nVals = [];
  for (const c of eligible) {
    if (requireNpsPredictive && !c.npsPredictiveOk) continue;
    const v = c[field];
    if (v == null || !Number.isFinite(Number(v))) continue;
    const n = Number(v);
    xs.push(n);
    const renewed = c.hasRenewed ? 1 : 0;
    ys.push(renewed);
    if (renewed) rVals.push(n);
    else nVals.push(n);
  }
  return {
    xs,
    ys,
    rVals,
    nVals,
    miss: missingRate(eligible, field),
  };
}

function buildSurvivalBuckets(list) {
  const binary = {
    hasFinancialData: { true: [], false: [] },
    hasMeeting: { true: [], false: [] },
    hasMechanism: { true: [], false: [] },
    hasRenewed: { true: [], false: [] },
  };
  const byField = new Map([
    ["npsClass", new Map()],
    ["engineer", new Map()],
  ]);
  for (const c of list) {
    if (!c.survivalValid) continue;
    for (const field of Object.keys(binary)) {
      const level = c[field];
      binary[field][level === true].push(c);
    }
    for (const field of ["npsClass", "engineer"]) {
      const level = c[field];
      if (level == null || level === "") continue;
      const bucket = byField.get(field);
      if (!bucket.has(level)) bucket.set(level, []);
      bucket.get(level).push(c);
    }
  }
  return { binary, byField };
}

function buildCategoricalChurnLabels(active, cancelled, categoricalVars) {
  const out = {};
  for (const def of categoricalVars || []) {
    const aActive = def.requireNpsPredictive
      ? active.filter((c) => c.npsPredictiveOk && c.hasNps)
      : active;
    const aCancelled = def.requireNpsPredictive
      ? cancelled.filter((c) => c.npsPredictiveOk && c.hasNps)
      : cancelled;
    out[def.id] = {
      activeLabels: aActive.map((c) => churnCategoricalLabel(def, c)),
      cancelledLabels: aCancelled.map((c) => churnCategoricalLabel(def, c)),
      activeN: aActive.length,
      cancelledN: aCancelled.length,
      miss: missingRate([...aActive, ...aCancelled], def.field),
    };
  }
  return out;
}

function buildRenewalCategoricalLabels(eligible, categoricalVars) {
  const out = {};
  for (const def of categoricalVars || []) {
    const notRenewedLabels = [];
    const renewedLabels = [];
    for (const c of eligible) {
      if (def.requireNpsPredictive && !(c.npsPredictiveOk && c.hasNps)) continue;
      const lab = renewalCategoricalLabel(def, c);
      if (c.hasRenewed) renewedLabels.push(lab);
      else notRenewedLabels.push(lab);
    }
    out[def.id] = { notRenewedLabels, renewedLabels, poolN: notRenewedLabels.length + renewedLabels.length };
  }
  return out;
}

function extractChurnNumericSeries(active, cancelled, field, requireNpsPredictive) {
  const aVals = [];
  const cVals = [];
  const xs = [];
  const ys = [];
  for (const c of active) {
    if (requireNpsPredictive && !(c.npsPredictiveOk && c.hasNps)) continue;
    const v = c[field];
    if (v == null || !Number.isFinite(Number(v))) continue;
    const n = Number(v);
    aVals.push(n);
    xs.push(n);
    ys.push(0);
  }
  for (const c of cancelled) {
    if (requireNpsPredictive && !(c.npsPredictiveOk && c.hasNps)) continue;
    const v = c[field];
    if (v == null || !Number.isFinite(Number(v))) continue;
    const n = Number(v);
    cVals.push(n);
    xs.push(n);
    ys.push(1);
  }
  return {
    aVals,
    cVals,
    xs,
    ys,
    allForMissing: [...active, ...cancelled],
    miss: missingRate([...active, ...cancelled], field),
  };
}

/**
 * @param {object[]} clients — população filtrada final
 * @param {{ numericVars?: object[], categoricalVars?: object[] }} defs
 */
export function buildStatAnalysisContext(clients, defs = {}) {
  const list = Array.isArray(clients) ? clients : [];
  const active = [];
  const cancelled = [];
  const frozen = [];
  const withNps = [];
  const npsByClass = new Map([
    ["promoter", []],
    ["passive", []],
    ["detractor", []],
  ]);
  const eligibleRenewal = [];
  const renewed = [];
  const notRenewed = [];
  const tenurePool = [];
  const survivalRecords = [];
  const survivalBySegment = new Map();
  const byId = new Map();
  const npsActive = [];
  const npsCancelled = [];

  for (const c of list) {
    byId.set(String(c.clientId), c);
    if (c.isActive) {
      active.push(c);
      if (c.npsPredictiveOk && c.hasNps) npsActive.push(c);
    }
    if (c.isCancelled) {
      cancelled.push(c);
      if (c.npsPredictiveOk && c.hasNps) npsCancelled.push(c);
    }
    if (c.isFrozen) frozen.push(c);
    if (c.hasNps && c.npsClass) {
      withNps.push(c);
      const bucket = npsByClass.get(c.npsClass);
      if (bucket) bucket.push(c);
    }
    if (c.renewedValid) {
      eligibleRenewal.push(c);
      if (c.hasRenewed) renewed.push(c);
      else notRenewed.push(c);
    }
    if (c.stayDays != null && Number.isFinite(c.stayDays) && c.stayDays >= 0) {
      tenurePool.push(c);
    }
    if (c.survivalValid) {
      survivalRecords.push({ time: c.survivalTime, event: c.survivalEvent, segment: c.segment });
      const seg = c.segment || "Não informado";
      if (!survivalBySegment.has(seg)) survivalBySegment.set(seg, []);
      survivalBySegment.get(seg).push(c);
    }
  }

  const stayVals = tenurePool.map((c) => c.stayDays);
  const stayMedian = median(stayVals);
  const highStay = stayMedian == null ? [] : tenurePool.filter((c) => c.stayDays >= stayMedian);
  const lowStay = stayMedian == null ? [] : tenurePool.filter((c) => c.stayDays < stayMedian);

  const churnNumeric = {};
  for (const def of defs.numericVars || []) {
    churnNumeric[def.id] = extractChurnNumericSeries(
      active,
      cancelled,
      def.field,
      Boolean(def.requireNpsPredictive),
    );
  }

  const tenureNumeric = {};
  for (const def of defs.numericVars || []) {
    if (def.field === "stayDays" || def.id === "stayDays") continue;
    const xs = [];
    const ys = [];
    const valsHigh = [];
    const valsLow = [];
    for (const c of tenurePool) {
      if (def.requireNpsPredictive && !c.npsPredictiveOk) continue;
      const v = c[def.field];
      if (v == null || !Number.isFinite(Number(v))) continue;
      xs.push(c.stayDays);
      ys.push(Number(v));
      const n = numOrNull(v);
      if (n == null) continue;
      if (stayMedian != null && c.stayDays >= stayMedian) valsHigh.push(n);
      else if (stayMedian != null) valsLow.push(n);
    }
    tenureNumeric[def.id] = { xs, ys, valsHigh, valsLow };
  }

  const renewalNumeric = {};
  for (const def of defs.numericVars || []) {
    renewalNumeric[def.id] = extractRenewalNumericSeries(
      eligibleRenewal,
      def.field,
      Boolean(def.requireNpsPredictive),
    );
  }

  const categoricalChurn = buildCategoricalChurnLabels(active, cancelled, defs.categoricalVars);
  const categoricalRenewal = buildRenewalCategoricalLabels(eligibleRenewal, defs.categoricalVars);
  const survivalBuckets = buildSurvivalBuckets(list);

  const rankVectors = {};
  const validMasks = {};
  for (const def of defs.numericVars || []) {
    const series = churnNumeric[def.id];
    if (series?.xs?.length) {
      rankVectors[def.id] = computeAverageRanks(series.xs);
    }
    validMasks[def.id] = {
      churn: series?.xs?.length || 0,
      renewal: renewalNumeric[def.id]?.xs?.length || 0,
    };
  }

  const groups = {
    active,
    cancelled,
    frozen,
    withNps,
    renewed,
    notRenewed,
    eligibleRenewal,
    tenurePool,
    highStay,
    lowStay,
    promoter: npsByClass.get("promoter") || [],
    passive: npsByClass.get("passive") || [],
    detractor: npsByClass.get("detractor") || [],
  };

  return {
    clients: list,
    byId,
    active,
    cancelled,
    frozen,
    withNps,
    npsByClass,
    eligibleRenewal,
    renewed,
    notRenewed,
    tenurePool,
    stayMedian,
    highStay,
    lowStay,
    stayVals,
    churnNumeric,
    tenureNumeric,
    renewalNumeric,
    categoricalChurn,
    categoricalRenewal,
    survivalRecords,
    survivalBySegment,
    survivalBuckets,
    rankVectors,
    validMasks,
    npsActive,
    npsCancelled,
    groups,
  };
}

export function clientsForVarFromContext(ctx, def, subset = "all") {
  const base =
    subset === "active"
      ? ctx.active
      : subset === "cancelled"
        ? ctx.cancelled
        : ctx.clients;
  if (def.requireNpsPredictive) return base.filter((c) => c.npsPredictiveOk && c.hasNps);
  return base;
}

export function getChurnNumericSeries(ctx, def) {
  return ctx.churnNumeric[def.id] || extractChurnNumericSeries(
    ctx.active,
    ctx.cancelled,
    def.field,
    Boolean(def.requireNpsPredictive),
  );
}

export function getTenureNumericSeries(ctx, def) {
  return ctx.tenureNumeric[def.id] || { xs: [], ys: [], valsHigh: [], valsLow: [] };
}

export function getRenewalNumericSeries(ctx, def) {
  return ctx.renewalNumeric?.[def.id] || extractRenewalNumericSeries(
    ctx.eligibleRenewal,
    def.field,
    Boolean(def.requireNpsPredictive),
  );
}

export function getChurnCategoricalLabels(ctx, def) {
  return ctx.categoricalChurn?.[def.id] || { activeLabels: [], cancelledLabels: [], activeN: 0, cancelledN: 0 };
}

export function getRenewalCategoricalLabels(ctx, def) {
  return ctx.categoricalRenewal?.[def.id] || { notRenewedLabels: [], renewedLabels: [], poolN: 0 };
}

export { churnCategoricalLabel, renewalCategoricalLabel };

export function buildNpsClassOthers(withNps, excludeClass) {
  const result = [];
  for (const c of withNps) {
    if (c.npsClass !== excludeClass) result.push(c);
  }
  return result;
}
