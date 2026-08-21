/**
 * Matrizes de associação por eixo (cancelamento, NPS, renovação, permanência).
 * Não altera regras oficiais — reutiliza associações/correlações já calculadas.
 */
import { dataConfigurationError } from "../env.mjs";
import { associationStrength, coveragePct, median, pooledSd, round3, round4, spearman, standardizedDifference } from "./stats-tests.mjs";

const CANCEL_METRICS = [
  { id: "association", label: "Associação", signed: true },
  { id: "stdDiff", label: "Diferença padronizada", signed: true },
  { id: "aucAdjusted", label: "AUC ajustada", signed: false, sequential: true },
  { id: "coveragePercent", label: "Cobertura %", signed: false, sequential: true, scaleMax: 100 },
];

const RENEWAL_METRICS = [
  { id: "association", label: "Associação", signed: true },
  { id: "stdDiff", label: "Diferença padronizada", signed: true },
  { id: "aucAdjusted", label: "AUC ajustada", signed: false, sequential: true },
  { id: "coveragePercent", label: "Cobertura %", signed: false, sequential: true, scaleMax: 100 },
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function resolveStdDiff(target, reference, pooled, fallback) {
  if (fallback != null && Number.isFinite(Number(fallback))) return round4(Number(fallback));
  return standardizedDifference(target, reference, pooled);
}

function rowFromAssoc(a, extras = {}) {
  const association = num(a.association ?? a.rho ?? a.measure ?? a.v);
  const coverage = num(a.coveragePercent ?? a.coverage);
  return {
    id: a.id,
    label: a.label || a.id,
    type: a.type || "numeric",
    association,
    absAssociation: association == null ? null : Math.abs(association),
    direction: a.direction || (association == null ? null : association > 0 ? "positive" : association < 0 ? "negative" : "none"),
    strength: a.strength || associationStrength(association == null ? null : Math.abs(association), a.measure || a.type),
    coveragePercent: coverage,
    n: a.n ?? a.sample ?? null,
    pValue: a.pValue ?? a.p ?? null,
    measure: a.measure || a.method || null,
    status: a.status || (association == null ? "unavailable" : "available"),
    ...extras,
  };
}

/**
 * Heatmap variável × métricas para alvo binário (cancelamento).
 * stdDiff: (mediana cancelados − mediana ativos) / sd agrupado.
 * Positivo = maior entre cancelados.
 */
export function buildCancellationAxisMatrix({ associations = [], predictivePower = [], activeVsCancelled = [] } = {}) {
  const aucById = new Map((predictivePower || []).map((p) => [p.id, p]));
  const diffById = new Map((activeVsCancelled || []).map((d) => [d.id, d]));
  const flat = Array.isArray(associations)
    ? associations
    : [...(associations.numeric || []), ...(associations.categorical || [])];

  const rows = flat
    .filter((a) => a && a.id && a.id !== "isCancelled")
    .map((a) => {
      const auc = aucById.get(a.id);
      const diff = diffById.get(a.id);
      const medA = diff?.medianActive ?? diff?.activeMedian;
      const medC = diff?.medianCancelled ?? diff?.cancelledMedian;
      const sd = diff?.sdPooled ?? diff?.pooledSd;
      const association = num(a.association ?? a.rho ?? a.v ?? a.cramersV);
      const std = resolveStdDiff(medC, medA, sd, diff?.stdDiff ?? diff?.standardizedDifference);
      return rowFromAssoc(a, {
        association,
        stdDiff: std,
        aucAdjusted: num(auc?.aucAdjusted ?? auc?.aucInverted ?? auc?.auc),
        aucOriginal: num(auc?.aucOriginal ?? auc?.auc),
        coveragePercent: num(a.coveragePercent ?? a.coverage ?? auc?.coveragePercent ?? auc?.coverage),
        medianActive: medA ?? null,
        medianCancelled: medC ?? null,
        nActive: diff?.nActive ?? diff?.activeN ?? null,
        nCancelled: diff?.nCancelled ?? diff?.cancelledN ?? null,
        n: a.n ?? a.sample ?? ((diff?.nActive || 0) + (diff?.nCancelled || 0) || null),
      });
    })
    .filter((r) => r.association != null || r.aucAdjusted != null || r.stdDiff != null)
    .sort((a, b) => (b.absAssociation ?? 0) - (a.absAssociation ?? 0) || (b.aucAdjusted ?? 0) - (a.aucAdjusted ?? 0))
    .slice(0, 20);

  return {
    axis: "cancellation",
    title: "Matriz de associação com cancelamento",
    target: "isCancelled",
    note: "Mostra quais variáveis possuem maior relação observada com cancelamento. Valores maiores representam associações mais fortes, não causalidade. Diferença padronizada: (cancelados − ativos) / desvio agrupado — positivo = maior entre cancelados.",
    metrics: CANCEL_METRICS,
    rows,
    cells: rows.flatMap((r, i) => CANCEL_METRICS.map((m, j) => ({
      i,
      j,
      rowId: r.id,
      colId: m.id,
      labelRow: r.label,
      labelCol: m.label,
      value: r[m.id] ?? null,
      signed: m.signed,
      sequential: !!m.sequential,
      scaleMax: m.scaleMax || 1,
    }))),
  };
}

export function buildRenewalAxisMatrix({ renewalAssociations = {}, predictiveLike = [], renewedVsNotRenewed = [] } = {}) {
  const flat = [
    ...(renewalAssociations.numeric || []),
    ...(renewalAssociations.categorical || []),
  ].filter((a) => a && !["currentCycle", "renewalCount", "hasRenewed", "renewed"].includes(a.id));

  const aucById = new Map((predictiveLike || []).map((p) => [p.id, p]));
  const diffById = new Map((renewedVsNotRenewed || []).map((d) => [d.id, d]));
  const rows = flat
    .map((a) => {
      const auc = aucById.get(a.id);
      const diff = diffById.get(a.id);
      const association = num(a.association ?? a.rho ?? a.v ?? a.cramersV);
      const medR = diff?.medianRenewed;
      const medN = diff?.medianNotRenewed;
      const sd = diff?.sdPooled ?? diff?.pooledSd;
      const std = resolveStdDiff(medR, medN, sd, diff?.stdDiff ?? diff?.standardizedDifference);
      return rowFromAssoc(a, {
        association,
        stdDiff: std,
        aucAdjusted: num(auc?.aucAdjusted ?? auc?.auc),
        coveragePercent: num(a.coveragePercent ?? a.coverage ?? diff?.coveragePercent),
        medianRenewed: medR ?? null,
        medianNotRenewed: medN ?? null,
        nRenewed: diff?.nRenewed ?? a.nRenewed ?? null,
        nNotRenewed: diff?.nNotRenewed ?? a.nNotRenewed ?? null,
        n: a.n ?? ((diff?.nRenewed || 0) + (diff?.nNotRenewed || 0) || null),
      });
    })
    .filter((r) => r.association != null || r.aucAdjusted != null || r.stdDiff != null)
    .sort((a, b) => (b.absAssociation ?? 0) - (a.absAssociation ?? 0))
    .slice(0, 20);

  return {
    axis: "renewal",
    title: "Renovação — matriz de associação",
    target: "hasRenewed",
    note: "Associações com renovação (ciclo atual > 1). Diferença padronizada: (renovados − não renovados) / desvio agrupado. currentCycle e renewalCount não entram como explicativas.",
    metrics: RENEWAL_METRICS,
    rows,
    cells: rows.flatMap((r, i) => RENEWAL_METRICS.map((m, j) => ({
      i,
      j,
      rowId: r.id,
      colId: m.id,
      labelRow: r.label,
      labelCol: m.label,
      value: r[m.id] ?? null,
      signed: m.signed,
      sequential: !!m.sequential,
      scaleMax: m.scaleMax || 1,
    }))),
  };
}

/**
 * Correlação Spearman de cada preditor com um alvo numérico (NPS ou permanência).
 * stdDiffGroups opcional: comparação entre dois grupos (ex. Promotores vs Detratores) — não inventa stdDiff sem grupos.
 */
export function buildTargetCorrelationMatrix(clients, {
  targetField,
  targetLabel,
  predictors,
  axis,
  title,
  note,
  minN = 30,
  stdDiffGroups = null,
} = {}) {
  const total = clients.length;
  const groupA = stdDiffGroups?.groupA ? clients.filter(stdDiffGroups.groupA) : [];
  const groupB = stdDiffGroups?.groupB ? clients.filter(stdDiffGroups.groupB) : [];
  const groupMinN = stdDiffGroups?.minN ?? 10;
  const labelA = stdDiffGroups?.labelA || "Grupo A";
  const labelB = stdDiffGroups?.labelB || "Grupo B";
  const includeStd = Boolean(stdDiffGroups?.groupA && stdDiffGroups?.groupB);

  const rows = [];
  for (const pred of predictors || []) {
    if (pred.field === targetField || pred.id === targetField) continue;
    const field = pred.field || pred.id;
    const xs = [];
    const ys = [];
    for (const c of clients) {
      const x = num(c[field]);
      const y = num(c[targetField]);
      if (x == null || y == null) continue;
      xs.push(x);
      ys.push(y);
    }

    let stdDiff = null;
    let medianA = null;
    let medianB = null;
    let nA = 0;
    let nB = 0;
    let stdDiffNote = null;
    if (includeStd) {
      const valsA = groupA.map((c) => num(c[field])).filter((v) => v != null);
      const valsB = groupB.map((c) => num(c[field])).filter((v) => v != null);
      nA = valsA.length;
      nB = valsB.length;
      if (nA >= groupMinN && nB >= groupMinN) {
        medianA = median(valsA);
        medianB = median(valsB);
        const sd = pooledSd(valsA, valsB);
        stdDiff = resolveStdDiff(medianA, medianB, sd, null);
        stdDiffNote = `${labelA} vs ${labelB}`;
      } else {
        stdDiffNote = `Amostra insuficiente para ${labelA} vs ${labelB} (mín. ${groupMinN} por grupo)`;
      }
    }

    if (xs.length < minN) {
      rows.push({
        id: pred.id,
        label: pred.label || pred.id,
        association: null,
        stdDiff,
        medianGroupA: medianA,
        medianGroupB: medianB,
        nGroupA: nA || null,
        nGroupB: nB || null,
        stdDiffGroups: stdDiffNote,
        coveragePercent: coveragePct(xs.length, total),
        n: xs.length,
        status: "insufficient_sample",
        strength: null,
        direction: null,
        method: "spearman",
      });
      continue;
    }
    const sp = spearman(xs, ys);
    const association = sp?.rho != null ? round4(sp.rho) : null;
    rows.push({
      id: pred.id,
      label: pred.label || pred.id,
      association,
      absAssociation: association == null ? null : Math.abs(association),
      stdDiff,
      medianGroupA: medianA,
      medianGroupB: medianB,
      nGroupA: nA || null,
      nGroupB: nB || null,
      stdDiffGroups: stdDiffNote,
      coveragePercent: coveragePct(xs.length, total),
      n: xs.length,
      pValue: sp?.pValue ?? null,
      status: association == null ? "unavailable" : "available",
      strength: associationStrength(association == null ? null : Math.abs(association), "spearman"),
      direction: association == null ? null : association > 0 ? "positive" : association < 0 ? "negative" : "none",
      method: "spearman",
    });
  }
  rows.sort((a, b) => (b.absAssociation ?? -1) - (a.absAssociation ?? -1));
  const metrics = [
    { id: "association", label: `Correlação com ${targetLabel}`, signed: true },
    ...(includeStd ? [{ id: "stdDiff", label: "Diferença padronizada", signed: true }] : []),
    { id: "coveragePercent", label: "Cobertura %", signed: false, sequential: true, scaleMax: 100 },
  ];
  const visible = rows.filter((r) => r.association != null || (includeStd && r.stdDiff != null)).slice(0, 20);
  return {
    axis,
    title,
    target: targetField,
    note,
    metrics,
    rows: visible.length ? visible : rows.slice(0, 20),
    cells: (visible.length ? visible : rows.slice(0, 20)).flatMap((r, i) => metrics.map((m, j) => ({
      i,
      j,
      rowId: r.id,
      colId: m.id,
      labelRow: r.label,
      labelCol: m.label,
      value: r[m.id] ?? null,
      signed: m.signed,
      sequential: !!m.sequential,
      scaleMax: m.scaleMax || 1,
      stdDiffGroups: r.stdDiffGroups,
      nGroupA: r.nGroupA,
      nGroupB: r.nGroupB,
    }))),
  };
}

export const NPS_PREDICTORS = [
  { id: "meetingCount", label: "Total de reuniões", field: "meetingCount" },
  { id: "noShowCount", label: "No-shows", field: "noShowCount" },
  { id: "rescheduleCount", label: "Remarcações", field: "rescheduleCount" },
  { id: "attendanceRate", label: "Taxa de comparecimento", field: "attendanceRate" },
  { id: "stayDays", label: "Permanência", field: "stayDays" },
  { id: "monthlyIncome", label: "Renda mensal", field: "monthlyIncome" },
  { id: "paidPropertiesValue", label: "Patrimônio", field: "paidPropertiesValue" },
  { id: "liquidityReserve", label: "Reserva de liquidez", field: "liquidityReserve" },
  { id: "implementedMechanismCount", label: "Mecanismos implementados", field: "implementedMechanismCount" },
  { id: "currentCycle", label: "Ciclo atual", field: "currentCycle" },
  { id: "renewalCount", label: "Renovações", field: "renewalCount" },
  { id: "daysSinceFinancialUpdate", label: "Dias desde atualização financeira", field: "daysSinceFinancialUpdate" },
  { id: "daysSinceLastMeeting", label: "Dias desde última reunião", field: "daysSinceLastMeeting" },
];

export const TENURE_PREDICTORS = [
  { id: "meetingCount", label: "Total de reuniões", field: "meetingCount" },
  { id: "meetingsPerMonth", label: "Reuniões por mês de permanência", field: "meetingsPerMonth" },
  { id: "noShowCount", label: "No-shows", field: "noShowCount" },
  { id: "rescheduleCount", label: "Remarcações", field: "rescheduleCount" },
  { id: "attendanceRate", label: "Taxa de comparecimento", field: "attendanceRate" },
  { id: "daysSinceLastMeeting", label: "Dias desde última reunião", field: "daysSinceLastMeeting" },
  { id: "averageIntervalDays", label: "Intervalo médio entre reuniões", field: "averageIntervalDays" },
  { id: "daysToFirstMeeting", label: "Dias até primeira reunião", field: "daysToFirstMeeting" },
  { id: "npsScore", label: "Nota NPS", field: "npsScore" },
  { id: "mechanismCount", label: "Mecanismos", field: "mechanismCount" },
  { id: "implementedMechanismCount", label: "Mecanismos implementados", field: "implementedMechanismCount" },
  { id: "monthlyIncome", label: "Renda mensal", field: "monthlyIncome" },
  { id: "paidPropertiesValue", label: "Patrimônio", field: "paidPropertiesValue" },
  { id: "liquidityReserve", label: "Reserva", field: "liquidityReserve" },
  { id: "daysSinceFinancialUpdate", label: "Dias desde atualização financeira", field: "daysSinceFinancialUpdate" },
  { id: "currentCycle", label: "Ciclo atual", field: "currentCycle" },
  { id: "renewalCount", label: "Renovações", field: "renewalCount" },
];

export function buildAxisMatricesBundle(ctx) {
  const {
    clients,
    churnAssociations,
    associations,
    univariatePredictivePower,
    activeVsCancelled,
    renewalAssociations,
    renewedVsNotRenewed,
  } = ctx;

  const cancelAssocs = churnAssociations || {
    numeric: (associations || []).filter((a) => a.type === "numeric"),
    categorical: (associations || []).filter((a) => a.type === "categorical"),
  };

  const stayPool = (clients || []).filter((c) => c.stayDays != null && Number.isFinite(c.stayDays) && c.stayDays >= 0);
  const stayMed = stayPool.length ? median(stayPool.map((c) => c.stayDays)) : null;

  return {
    cancellation: buildCancellationAxisMatrix({
      associations: cancelAssocs,
      predictivePower: univariatePredictivePower,
      activeVsCancelled,
    }),
    nps: buildTargetCorrelationMatrix(clients, {
      targetField: "npsScore",
      targetLabel: "NPS",
      predictors: NPS_PREDICTORS,
      axis: "nps",
      title: "NPS — matriz de correlação",
      note: "Correlação com a nota NPS (Spearman) e diferença padronizada Promotores vs Detratores quando a amostra permite. Diferença padronizada: quanto mais longe de zero, maior a diferença entre os grupos. Positivo = maior entre Promotores.",
      stdDiffGroups: {
        groupA: (c) => c.npsClass === "promoter",
        groupB: (c) => c.npsClass === "detractor",
        labelA: "Promotores",
        labelB: "Detratores",
        minN: 10,
      },
    }),
    renewal: buildRenewalAxisMatrix({
      renewalAssociations,
      predictiveLike: univariatePredictivePower,
      renewedVsNotRenewed,
    }),
    tenure: buildTargetCorrelationMatrix(clients, {
      targetField: "stayDays",
      targetLabel: "Permanência",
      predictors: TENURE_PREDICTORS,
      axis: "tenure",
      title: "Permanência — matriz de correlação",
      note: "A correlação mostra como o indicador varia junto com a permanência. A diferença padronizada compara clientes de maior e menor permanência (alta ≥ mediana vs baixa < mediana).",
      stdDiffGroups: stayMed == null ? null : {
        groupA: (c) => c.stayDays != null && c.stayDays >= stayMed,
        groupB: (c) => c.stayDays != null && c.stayDays < stayMed,
        labelA: "Alta permanência",
        labelB: "Baixa permanência",
        minN: 10,
      },
    }),
  };
}
