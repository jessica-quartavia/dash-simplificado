/**
 * Métricas — Cancelamento (V2). Recálculo sobre clientes filtrados.
 */
import { distributionFrom } from "./meeting-metrics.mjs";
import {
  cancellationEffectiveDate,
  filterCancellationClients,
  rowInCancellationPeriod,
} from "./cancellations-filters.mjs";
import { inPeriod, resolvePeriod } from "./filters/period.mjs";

const SEGMENT_ORDER = ["APEX", "PRIVATE", "PRINCIPAL", "DEBTS", "OVER", "Dados insuficientes"];

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function monthKeyFromIso(iso) {
  if (!iso) return null;
  const text = String(iso);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 7);
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildIntentionVsEffectiveMonthSeries(rows, period, now = new Date()) {
  const monthsBack = 12;
  const buckets = new Map();
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { intentions: new Set(), effective: new Set() });
  }
  const nowKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  for (const row of rows || []) {
    const clientId = String(row.clientId || "");
    if (!clientId) continue;
    const intencaoAt = row.intencaoAt || null;
    if (intencaoAt && (!period?.active || inPeriod(intencaoAt, period))) {
      const key = monthKeyFromIso(intencaoAt);
      if (key && key <= nowKey && buckets.has(key)) buckets.get(key).intentions.add(clientId);
    }
    const effective = cancellationEffectiveDate(row);
    if (effective && (!period?.active || inPeriod(effective, period))) {
      const key = monthKeyFromIso(effective);
      if (key && key <= nowKey && buckets.has(key)) buckets.get(key).effective.add(clientId);
    }
  }

  return [...buckets.entries()].map(([month, sets]) => ({
    month,
    label: month,
    intentions: sets.intentions.size,
    effective: sets.effective.size,
    effectiveCancellations: sets.effective.size,
    difference: sets.intentions.size - sets.effective.size,
    note: "Séries independentes por data; não é taxa de conversão do mesmo cliente.",
  }));
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
    byMonthIntentionVsEffective: period.active
      ? buildIntentionVsEffectiveMonthSeries(list, period, options.now || new Date())
      : (payloadDistributions.byMonthIntentionVsEffective || []),
    byEngineer: distributionFrom(
      efetivadosInPeriod,
      (r) => (r.engineer === "Não informado" ? null : r.engineer),
    ),
    bySegment: distributionFrom(efetivadosInPeriod, (r) => r.segment, SEGMENT_ORDER),
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
