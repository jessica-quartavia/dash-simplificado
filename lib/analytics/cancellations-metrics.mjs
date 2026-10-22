/**
 * Métricas — Cancelamento (V2). Recálculo sobre clientes filtrados.
 */
import { distributionFrom } from "./meeting-metrics.mjs";

export function topCancellationReasonsFromDistribution(categories = [], limit = 10) {
  return [...categories]
    .filter((item) => (item?.count || 0) > 0)
    .sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.label).localeCompare(String(b.label), "pt-BR"))
    .slice(0, limit);
}
import {
  cancellationEffectiveDate,
  filterCancellationClients,
  rowInCancellationPeriod,
} from "./cancellations-filters.mjs";
import { statusNameMatches } from "./or-evidence.mjs";
import { inPeriod, resolvePeriod } from "./filters/period.mjs";
import { buildAnalyticalChurnMonthSeries } from "./canonical-churn-series.mjs";
import { currentMonthKeyLocal, monthKey, shiftMonthKey } from "./general-metrics.mjs";

const SEGMENT_ORDER = ["APEX", "PRIVATE", "PRINCIPAL", "DEBTS", "OVER", "Dados insuficientes"];

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/** Chave canônica YYYY-MM (mesma janela das séries mensais do portal). */
export function normalizeMonthKey(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 7);
  const ym = text.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) return `${ym[1]}-${String(Number(ym[2])).padStart(2, "0")}`;
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  return monthKey(d);
}

function monthKeyFromCancellationDate(value) {
  if (value == null) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    return value.trim().slice(0, 7);
  }
  const d = parseRowDate(value);
  if (!d) return null;
  return monthKey(d);
}

export function rollingMonthKeys(monthsBack = 12, now = new Date()) {
  const nowKey = currentMonthKeyLocal(now);
  return Array.from({ length: monthsBack }, (_, i) => shiftMonthKey(nowKey, -(monthsBack - 1 - i)));
}

/** Preenche janela contínua (zeros) — corrige payload esparso ou chaves inconsistentes. */
export function normalizeCancellationIntentionMonthSeries(series, now = new Date(), monthsBack = 12) {
  const incoming = new Map();
  for (const row of series || []) {
    const key = normalizeMonthKey(row?.month ?? row?.label);
    if (!key) continue;
    incoming.set(key, {
      intentions: Number(row.intentions ?? 0) || 0,
      pedidos: Number(row.pedidos ?? 0) || 0,
      effective: Number(row.effective ?? row.effectiveCancellations ?? 0) || 0,
    });
  }
  return rollingMonthKeys(monthsBack, now).map((month) => {
    const hit = incoming.get(month);
    return {
      month,
      label: month,
      intentions: hit?.intentions ?? 0,
      pedidos: hit?.pedidos ?? 0,
      effective: hit?.effective ?? 0,
      effectiveCancellations: hit?.effective ?? 0,
      difference: (hit?.intentions ?? 0) - (hit?.effective ?? 0),
      note: "Intenção (intencao_registrada_at ou status Nova intenção), pedido (data_pedido) e churn efetivo (data efetiva) — séries independentes por mês.",
    };
  });
}

function parseRowDate(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Data mensal de intenção: intencao_registrada_at ou status «Nova intenção» (processEntryAt). */
export function resolveIntentionSeriesDate(row) {
  const intencaoAt = parseRowDate(row?.intencaoAt);
  if (intencaoAt) return intencaoAt;
  const status = row?.processStatusName || "";
  if (statusNameMatches(status, ["nova intencao", "nova intenção"])) {
    return parseRowDate(row?.processEntryAt) || parseRowDate(row?.pedidoAt);
  }
  return null;
}

export function buildIntentionVsEffectiveMonthSeries(rows, period, now = new Date()) {
  const monthsBack = 12;
  const buckets = new Map();
  for (const key of rollingMonthKeys(monthsBack, now)) {
    buckets.set(key, { intentions: new Set(), pedidos: new Set() });
  }
  const nowKey = currentMonthKeyLocal(now);
  const list = Array.isArray(rows) ? rows : [];

  for (const row of list) {
    const clientId = String(row.clientId || "");
    if (!clientId) continue;
    const intencaoAt = resolveIntentionSeriesDate(row);
    if (intencaoAt && (!period?.active || inPeriod(intencaoAt, period))) {
      const key = monthKeyFromCancellationDate(row.intencaoAt ?? intencaoAt);
      if (key && key <= nowKey && buckets.has(key)) buckets.get(key).intentions.add(clientId);
    }
    const pedidoAt = row.pedidoAt || null;
    if (pedidoAt && (!period?.active || inPeriod(pedidoAt, period))) {
      const key = monthKeyFromCancellationDate(pedidoAt);
      if (key && key <= nowKey && buckets.has(key)) buckets.get(key).pedidos.add(clientId);
    }
  }

  let effectiveRows = list;
  if (period?.active) {
    effectiveRows = list.filter((r) => {
      const effective = cancellationEffectiveDate(r);
      return effective && inPeriod(effective, period);
    });
  }
  const effectiveByMonth = new Map(
    buildAnalyticalChurnMonthSeries(effectiveRows, monthsBack, now).map((r) => [r.month, r.churnClients]),
  );

  const built = [...buckets.entries()].map(([month, sets]) => ({
    month,
    label: month,
    intentions: sets.intentions.size,
    pedidos: sets.pedidos.size,
    effective: effectiveByMonth.get(month) || 0,
    effectiveCancellations: effectiveByMonth.get(month) || 0,
    difference: sets.intentions.size - (effectiveByMonth.get(month) || 0),
    note: "Intenção (intencao_registrada_at ou status Nova intenção), pedido (data_pedido) e churn efetivo (data efetiva) — séries independentes por mês.",
  }));
  return normalizeCancellationIntentionMonthSeries(built, now, monthsBack);
}

export function summarizeCancellationRows(rows, payloadSummary = {}, options = {}) {
  const list = clientsOrRows(rows);
  const period = resolvePeriod(options.filters || {}, options.now || new Date());
  const baseRows = options.allRows ? clientsOrRows(options.allRows) : list;
  const efetivados = list.filter((r) => r.hasEfetivado);
  const efetivadosInPeriod = period.active
    ? efetivados.filter((r) => {
      const effective = cancellationEffectiveDate(r);
      return effective && inPeriod(effective, period);
    })
    : efetivados;
  const inProcess = baseRows.filter((r) => r.inProcessCurrently);
  const intentionsInPeriod = period.active
    ? baseRows.filter((r) => r.hasIntentionOrPedido && rowInCancellationPeriod(r, period, { includeInProcess: false }))
    : baseRows.filter((r) => r.hasIntentionOrPedido);
  const comparableCycle = efetivadosInPeriod.filter(
    (r) => r.cancellationTiming === "Antes do fim do ciclo" || r.cancellationTiming === "Não renovação",
  );
  const operations = payloadSummary.operations || {};

  return {
    totalDistinctClients: list.length,
    effectiveCancellations: efetivadosInPeriod.length,
    effectiveWithoutConfirmedDate: efetivadosInPeriod.filter((r) => r.effectiveWithoutConfirmedDate).length,
    intentionsOrOrdersRegistered: intentionsInPeriod.length,
    clientsInCancellationProcess: inProcess.length,
    criticalCount: list.filter((r) => r.isCritical).length,
    withoutResponsibleCount: list.filter(
      (r) => !r.responsavel || r.responsavel === "Não informado",
    ).length,
    archivedRecords: operations.archivedRecords ?? payloadSummary.archivedRecords ?? 0,
    nonRenewals: comparableCycle.filter((r) => r.cancellationTiming === "Não renovação").length,
    beforeCycleEnd: comparableCycle.filter((r) => r.cancellationTiming === "Antes do fim do ciclo").length,
    comparableCycleCount: comparableCycle.length,
    exclusiveStages: distributionFrom(list, (r) => r.exclusiveStage),
    topReasonCategory: payloadSummary.topReasonCategory || null,
    secondReasonCategory: payloadSummary.secondReasonCategory || null,
  };
}

function clientsOrRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

export function distributionsFromCancellationRows(rows, payloadDistributions = {}, payloadSummary = {}, options = {}) {
  const list = clientsOrRows(rows);
  const period = resolvePeriod(options.filters || {}, options.now || new Date());
  const efetivados = list.filter((r) => r.hasEfetivado);
  const efetivadosInPeriod = period.active
    ? efetivados.filter((r) => {
      const effective = cancellationEffectiveDate(r);
      return effective && inPeriod(effective, period);
    })
    : efetivados;
  const inProcess = list.filter((r) => r.inProcessCurrently);
  const statusOrder = (payloadSummary.processStatusDimension?.statuses || []).map((s) => s.name);

  return {
    byProcessStatus: distributionFrom(
      inProcess,
      (r) => r.processStatusName || "Status não informado",
      statusOrder.length ? statusOrder : undefined,
    ),
    byExclusiveStage: payloadSummary.exclusiveStages
      || payloadDistributions.byExclusiveStage
      || distributionFrom(list, (r) => r.exclusiveStage),
    byEstagioCliente: distributionFrom(list, (r) => r.estagioCliente),
    byCategory: distributionFrom(efetivadosInPeriod, (r) => r.reasonCategory || r.category),
    byReasonSemester: payloadDistributions.byReasonSemester || [],
    byMonthIntentionVsEffective: buildIntentionVsEffectiveMonthSeries(
      list,
      period,
      options.now || new Date(),
    ),
    byEngineer: distributionFrom(
      efetivadosInPeriod,
      (r) => (r.engineer === "Não informado" ? null : r.engineer),
    ),
    bySegment: distributionFrom(efetivadosInPeriod, (r) => r.segment, SEGMENT_ORDER),
  };
}

/**
 * Destino das intenções e pedidos — ramificação exclusiva por desfecho.
 * Universo: clientes com hasIntentionOrPedido (flags oficiais do processo).
 * Prioridade exclusiva: cancelado > arquivado > retido > em processo.
 */
export function buildIntentionDestinationBranches(rows) {
  const list = clientsOrRows(rows);
  const universe = list.filter((r) => r.hasIntentionOrPedido);
  const total = universe.length;
  const counts = { em_processo: 0, retido: 0, arquivado: 0, cancelado: 0 };

  for (const row of universe) {
    if (row.hasEfetivado) counts.cancelado += 1;
    else if (row.isArchived || row.hasArchivedRecord) counts.arquivado += 1;
    else if (row.isRetido) counts.retido += 1;
    else counts.em_processo += 1;
  }

  const branchDefs = [
    { key: "em_processo", label: "Em processo", subtitle: "Sem desfecho posterior" },
    { key: "retido", label: "Retido", subtitle: "Desfecho de retenção" },
    { key: "arquivado", label: "Arquivado", subtitle: "Possui registro arquivado" },
    { key: "cancelado", label: "Cancelado", subtitle: "Cancelamento efetivado" },
  ];

  const branchSum = counts.em_processo + counts.retido + counts.arquivado + counts.cancelado;

  return {
    total,
    rule:
      "Universo: intencao_registrada_at OR data_pedido OR status de intenção/pedido (OR). Prioridade exclusiva: cancelado > arquivado > retido > em processo.",
    closure: {
      branchSum,
      matchesUniverse: branchSum === total,
    },
    branches: branchDefs.map((def) => ({
      ...def,
      count: counts[def.key],
      percent: pct(counts[def.key], total),
    })),
  };
}

export function branchFunnelCounts(rows, options = {}) {
  const list = clientsOrRows(rows);
  const period = resolvePeriod(options.filters || {}, options.now || new Date());
  const intentions = period.active
    ? list.filter((r) => r.hasIntentionOrPedido && rowInCancellationPeriod(r, period, { includeInProcess: false })).length
    : list.filter((r) => r.hasIntentionOrPedido).length;
  const inProcess = list.filter((r) => r.inProcessCurrently).length;
  const effective = period.active
    ? list.filter((r) => {
      if (!r.hasEfetivado) return false;
      const effectiveDate = cancellationEffectiveDate(r);
      return effectiveDate && inPeriod(effectiveDate, period);
    }).length
    : list.filter((r) => r.hasEfetivado).length;
  return { intentions, inProcess, effective, total: list.length };
}
