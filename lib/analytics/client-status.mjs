/**
 * Status analítico e política de escopo (active-first).
 *
 * Fonte única para o portal. O frontend NÃO deve reclassificar cancelamento;
 * deve consumir `analyticalStatus` e flags já resolvidos neste kernel.
 *
 * Active-first ≠ active-only:
 * o default da interface é clientes ativos somente quando a métrica permitir.
 * Populações próprias (não forçar active):
 * - cancellations: processo/cancelados
 * - statistical_crosses: ativos + cancelados (população metodológica)
 * - satisfaction: respondentes
 * - support: tickets/acionamentos
 * - renewal: elegíveis (ciclo válido ≥ 1)
 * - quality: catálogo/cobertura das fontes
 */
import {
  ANALYTICAL_STATUS,
  classifyClientAnalyticalStatus,
  isConfirmedCancelledStatus,
  isEffectiveCancelledStatus,
  isEffectiveCancelledWithoutDateStatus,
  isMarkedCancelledNoEvidenceStatus,
  matchesAnalyticalStatusFilter,
  resolveAnalyticalStatus,
  resolveAnalyticalStatusFromMaps,
} from "./analytical-cancellation.mjs";

export const DEFAULT_ANALYTICAL_SCOPE = "active";

export const ANALYTICAL_SCOPES = Object.freeze({
  ACTIVE: "active",
  ALL: "all",
  METHODOLOGICAL: "methodological",
  CANCELLATION_PROCESS: "cancellation_process",
  RESPONDENTS: "respondents",
  TICKETS: "tickets",
  RENEWAL_ELIGIBLE: "renewal_eligible",
  CATALOG: "catalog",
});

/** Páginas em que o default da UI pode ser clientes ativos. */
export const PAGES_ALLOW_ACTIVE_DEFAULT = Object.freeze([
  "executive_summary",
  "general",
  "journey",
  "meetings",
  "patrimonial_plan",
  "mechanisms",
  "platform_usage",
  "financial_updates",
  "ep_performance",
  "temporal_indicators",
]);

/**
 * Páginas com universo próprio — active-first não se aplica.
 * statistical_crosses permanece ativos + cancelados, nunca active-only.
 */
export const ACTIVE_FIRST_EXCEPTIONS = Object.freeze({
  cancellations: {
    scope: ANALYTICAL_SCOPES.CANCELLATION_PROCESS,
    reason: "População de cancelados / processo de cancelamento.",
  },
  statistical_crosses: {
    scope: ANALYTICAL_SCOPES.METHODOLOGICAL,
    reason: "População metodológica oficial: ativos + cancelados.",
  },
  satisfaction: {
    scope: ANALYTICAL_SCOPES.RESPONDENTS,
    reason: "Universo de respondentes da pesquisa.",
  },
  support: {
    scope: ANALYTICAL_SCOPES.TICKETS,
    reason: "Universo de tickets/acionamentos.",
  },
  renewal: {
    scope: ANALYTICAL_SCOPES.RENEWAL_ELIGIBLE,
    reason: "Elegíveis à renovação (ciclo válido ≥ 1).",
  },
  quality: {
    scope: ANALYTICAL_SCOPES.CATALOG,
    reason: "Cobertura e qualidade das fontes/indicadores.",
  },
});

export function allowsActiveDefault(pageId) {
  return PAGES_ALLOW_ACTIVE_DEFAULT.includes(pageId);
}

export function defaultScopeForPage(pageId) {
  const exception = ACTIVE_FIRST_EXCEPTIONS[pageId];
  if (exception) return exception.scope;
  if (allowsActiveDefault(pageId)) return DEFAULT_ANALYTICAL_SCOPE;
  return ANALYTICAL_SCOPES.ALL;
}

function readAnalyticalStatus(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return (
    value.analyticalStatus
    || value.status
    || value.clientStatus
    || null
  );
}

/** Cliente ativo estrito: analyticalStatus === "Ativo". Congelado não conta. */
export function isActiveClient(statusOrRow) {
  return readAnalyticalStatus(statusOrRow) === ANALYTICAL_STATUS.ACTIVE;
}

export function isFrozenClient(statusOrRow) {
  return readAnalyticalStatus(statusOrRow) === ANALYTICAL_STATUS.FROZEN;
}

/** Cancelamento efetivado (com ou sem data confirmada). */
export function isCancelledClient(statusOrRow) {
  return isEffectiveCancelledStatus(readAnalyticalStatus(statusOrRow));
}

export function isMarkedCancelledClient(statusOrRow) {
  return isMarkedCancelledNoEvidenceStatus(readAnalyticalStatus(statusOrRow));
}

export function matchesScope(statusOrRow, scope = DEFAULT_ANALYTICAL_SCOPE) {
  if (!scope || scope === ANALYTICAL_SCOPES.ALL) return true;
  if (scope === ANALYTICAL_SCOPES.ACTIVE) return isActiveClient(statusOrRow);
  if (scope === "active_or_frozen") {
    return isActiveClient(statusOrRow) || isFrozenClient(statusOrRow);
  }
  if (scope === ANALYTICAL_SCOPES.METHODOLOGICAL) {
    return isActiveClient(statusOrRow) || isCancelledClient(statusOrRow);
  }
  return matchesAnalyticalStatusFilter(readAnalyticalStatus(statusOrRow), scope);
}

export {
  ANALYTICAL_STATUS,
  classifyClientAnalyticalStatus,
  isConfirmedCancelledStatus,
  isEffectiveCancelledStatus,
  isEffectiveCancelledWithoutDateStatus,
  isMarkedCancelledNoEvidenceStatus,
  matchesAnalyticalStatusFilter,
  resolveAnalyticalStatus,
  resolveAnalyticalStatusFromMaps,
};
