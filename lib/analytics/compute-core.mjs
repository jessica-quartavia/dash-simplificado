/**
 * Computes enxutos por domínio — expõem somente agregados analíticos fundamentais.
 * Páginas completas = core + detalhes/gráficos/drawers.
 *
 * Fase 1: wrappers sobre summarize* existentes; payloads completos continuam disponíveis.
 */
import { computeGeneralDataPayload } from "./general-data.mjs";
import { summarizeGeneralRows } from "./general-metrics.mjs";
import { computeMeetingsPayload } from "./meetings.mjs";
import { summarizeMeetingRows } from "./meeting-metrics.mjs";
import { computeMechanismsPayload } from "./mechanisms.mjs";
import { summarizeMechanismRows } from "./mechanism-metrics.mjs";
import { computeSatisfactionPayload } from "./satisfaction.mjs";
import { summarizeSatisfactionRows } from "./satisfaction-metrics.mjs";
import { computeCancellationsPayload } from "./cancellations.mjs";
import { summarizeCancellationRows } from "./cancellations-metrics.mjs";
import { computeRenewalPayload } from "./renewal.mjs";
import { summarizeRenewalRows } from "./renewal-metrics.mjs";
import { computeOnboardingPayload } from "./onboarding.mjs";
import { summarizeOnboardingRows } from "./onboarding-metrics.mjs";
import { computeFinancialUpdatesPayload } from "./financial-updates.mjs";
import { summarizeFinancialUpdateRows } from "./financial-updates-metrics.mjs";

export async function computeGeneralCore() {
  const payload = await computeGeneralDataPayload();
  return {
    summary: summarizeGeneralRows(payload.clients || []),
    acquisition: payload.acquisitionsByMonth || [],
    clientCount: (payload.clients || []).length,
  };
}

export async function computeMeetingsCore(options = {}) {
  const payload = await computeMeetingsPayload(options);
  return {
    summary: summarizeMeetingRows(payload.clients || [], {
      periodActive: Boolean(payload.period?.active),
      periodDivisor: payload.period?.divisorMonths ?? null,
    }),
    clientCount: (payload.clients || []).length,
  };
}

export async function computeMechanismsCore() {
  const payload = await computeMechanismsPayload();
  return {
    summary: summarizeMechanismRows(payload.clients || [], {
      catalog: payload.catalog || [],
      portfolioCount: payload.portfolio?.length || (payload.clients || []).length,
    }),
    metadata: payload.metadata || null,
  };
}

export async function computeSatisfactionCore() {
  const payload = await computeSatisfactionPayload();
  return {
    summary: summarizeSatisfactionRows(payload.clients || []),
    nps: payload.summary || null,
  };
}

export async function computeCancellationCore() {
  const payload = await computeCancellationsPayload();
  return {
    summary: summarizeCancellationRows(payload.clients || []),
    population: payload.population || null,
  };
}

export async function computeRenewalCore() {
  const payload = await computeRenewalPayload();
  return {
    summary: summarizeRenewalRows(payload.clients || []),
    population: payload.population || null,
  };
}

export async function computeJourneyCore() {
  const payload = await computeOnboardingPayload();
  return {
    summary: summarizeOnboardingRows(payload.clients || []),
    completedOnboarding: payload.summary?.completedOnboarding ?? null,
  };
}

export async function computeFinancialUpdatesCore() {
  const payload = await computeFinancialUpdatesPayload();
  return {
    summary: summarizeFinancialUpdateRows(payload.clients || []),
  };
}

/** Mapa de loaders core para Resumo Executivo (fase incremental). */
export const DOMAIN_CORE_LOADERS = {
  general: computeGeneralCore,
  journey: computeJourneyCore,
  meetings: () => computeMeetingsCore({ includeMeetingTypes: false }),
  financial_updates: computeFinancialUpdatesCore,
  mechanisms: computeMechanismsCore,
  satisfaction: computeSatisfactionCore,
  cancellations: computeCancellationCore,
  renewal: computeRenewalCore,
};
