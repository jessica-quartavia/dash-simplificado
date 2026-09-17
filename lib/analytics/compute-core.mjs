/**
 * Computes enxutos por domínio — Fase 1b Resumo Executivo core-only.
 *
 * Páginas completas = core + detalhes/gráficos/drawers (incremental).
 * Executive usa buildExecutiveDomainSources() com bundle pré-carregado.
 */
import { buildPayload as buildGeneralPayload } from "./general-data.mjs";
import { buildOnboardingPayload } from "./onboarding.mjs";
import { buildMeetingsPayload } from "./meetings.mjs";
import { buildMechanismsPayload } from "./mechanisms.mjs";
import { consolidateMechanismsPayload } from "./mechanisms/mechanisms-consolidation.mjs";
import { computeBaseQvMechanismAudit } from "./mechanism-metrics.mjs";
import { computePharusMechanismsPayload } from "./pharus-mechanisms.mjs";
import { pharusConfigurationError } from "../env.mjs";
import { buildSatisfactionPayload } from "./satisfaction.mjs";
import { buildCancellationsPayloadFromRaw } from "./cancellations.mjs";
import { buildRenewalPayload } from "./renewal.mjs";
import { buildFinancialUpdatesPayloadFromRaw } from "./financial-updates.mjs";
import { buildEpPerformanceFromPayloads } from "./ep-performance.mjs";
import { computeTemporalIndicatorsPayload } from "./temporal-indicators.mjs";

function blankClientId(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

function timedSync(label, fn, timings) {
  const started = Date.now();
  const value = fn();
  timings[`${label}_ms`] = Date.now() - started;
  return value;
}

async function timedAsync(label, fn, timings) {
  const started = Date.now();
  const value = await fn();
  timings[`${label}_ms`] = Date.now() - started;
  return value;
}

export function computeGeneralCore(bundle, timings = {}) {
  return timedSync("general_core", () => {
    const signatureMeta = {
      skippedDueToViewTimeout: true,
      note: "Executive core — mesma regra de fallback da página Dados Gerais.",
    };
    return buildGeneralPayload(
      bundle.clients,
      bundle.cancellations,
      bundle.financialRows,
      new Map(),
      signatureMeta,
    );
  }, timings);
}

export function computeJourneyCore(bundle, timings = {}) {
  return timedSync("journey_core", () => {
    return buildOnboardingPayload({
      clients: bundle.clients,
      calendlyRows: bundle.calendlyRows,
      manualRows: bundle.manualRows,
      attendanceRows: bundle.attendanceRows,
      implRows: bundle.implRows,
      cancellations: bundle.cancellations,
      journeys: bundle.journeys,
      financialRows: bundle.financialRows,
      mechanisms: bundle.mechanismsRaw,
      airtableIndex: bundle.airtableIndex,
    });
  }, timings);
}

export function computeMeetingsCore(bundle, timings = {}) {
  return timedSync("meetings_core", () => {
    return buildMeetingsPayload({
      clients: bundle.clients,
      calendlyRows: bundle.calendlyRows,
      manualRows: bundle.manualRows,
      attendanceRows: bundle.attendanceRows,
      implRows: bundle.implRows,
      cancellations: bundle.cancellations,
      airtableIndex: bundle.airtableIndex,
      meetingTypes: null,
    });
  }, timings);
}

export function computeFinancialUpdatesCore(bundle, timings = {}) {
  return timedSync("financial_core", () => {
    return buildFinancialUpdatesPayloadFromRaw(
      bundle.clients,
      bundle.financialRows,
      bundle.cancellations,
      bundle.calendlyRows,
    );
  }, timings);
}

export async function computeMechanismsCore(bundle, timings = {}) {
  return timedAsync("mechanisms_core", async () => {
    const cmRows = (bundle.mechanismsRaw || []).filter((row) => blankClientId(row.client_id));
    const basePayload = buildMechanismsPayload({
      clients: bundle.clients,
      cmRows,
      mechanisms: bundle.catalog || [],
      cancellations: bundle.cancellations,
      financialRows: bundle.financialRows,
    });
    basePayload.metadata = {
      ...(basePayload.metadata || {}),
      baseQvAudit: computeBaseQvMechanismAudit(cmRows),
    };

    let pharusPayload = null;
    if (!pharusConfigurationError()) {
      try {
        pharusPayload = await computePharusMechanismsPayload();
        if (!pharusPayload?.success) pharusPayload = null;
      } catch {
        pharusPayload = null;
      }
    }

    return consolidateMechanismsPayload({
      baseQvPayload: basePayload,
      pharusPayload,
      clientsRaw: bundle.clients,
    });
  }, timings);
}

export function computeSatisfactionCore(bundle, timings = {}) {
  return timedSync("satisfaction_core", () => {
    const clientMap = new Map(bundle.clients.map((c) => [String(c.id), c]));
    return buildSatisfactionPayload({
      clients: bundle.clients,
      clientMap,
      npsRowsRaw: bundle.npsRows,
      csatRowsRaw: bundle.csatRows,
      npsSends: bundle.npsSends,
    });
  }, timings);
}

export function computeCancellationCore(bundle, timings = {}) {
  return timedSync("cancellations_core", () => {
    return buildCancellationsPayloadFromRaw(
      bundle.clients,
      bundle.cancellations,
      bundle.financialRows,
      bundle.calendlyRows,
      bundle.manualRows,
      bundle.attendanceRows,
      bundle.statusRows,
    );
  }, timings);
}

export function computeRenewalCore(bundle, timings = {}) {
  return timedSync("renewal_core", () => {
    return buildRenewalPayload({
      clients: bundle.clients,
      cancellations: bundle.cancellations,
      financialRows: bundle.financialRows,
    });
  }, timings);
}

export function computeEpCore({ general, meetings, mechanisms, bundle }, timings = {}) {
  return timedSync("ep_core", () => {
    const payload = buildEpPerformanceFromPayloads(general, meetings, {
      npsRows: bundle.npsRows,
      csatRows: bundle.csatRows,
      mechanismsPayload: mechanisms,
    });
    return { engineers: payload.engineers || [] };
  }, timings);
}

export async function computeTemporalCore(bundle, timings = {}) {
  return timedAsync("temporal_core", async () => {
    return computeTemporalIndicatorsPayload({
      reuseContext: true,
      sharedBundle: bundle,
      executiveSlim: true,
    });
  }, timings);
}

function executiveDomainLog(step) {
  if (typeof process === "undefined") return;
  if (process.env.NODE_ENV === "production" && process.env.EXECUTIVE_DEBUG !== "1") return;
  console.info(`[Executive] ${step}`);
}

function isolateDomain(name, fn, errors) {
  try {
    executiveDomainLog(`${name} start`);
    const value = fn();
    executiveDomainLog(`${name} end`);
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors[name] = message;
    console.error(`[Executive] ${name} error`, message);
    return null;
  }
}

async function isolateDomainAsync(name, fn, errors) {
  try {
    executiveDomainLog(`${name} start`);
    const value = await fn();
    executiveDomainLog(`${name} end`);
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors[name] = message;
    console.error(`[Executive] ${name} error`, message);
    return null;
  }
}

/** Monta fontes Executive a partir do bundle — compatível com buildExecutiveContexts. */
export async function buildExecutiveDomainSources(bundle, { deps = {} } = {}) {
  const domainMs = {};
  const timings = {};
  const errors = {};

  const general = isolateDomain("clients", () => computeGeneralCore(bundle, timings), errors);
  const journey = isolateDomain("journey", () => computeJourneyCore(bundle, timings), errors);
  const meetings = isolateDomain("meetings", () => computeMeetingsCore(bundle, timings), errors);
  const financial_updates = isolateDomain("financial", () => computeFinancialUpdatesCore(bundle, timings), errors);
  const satisfaction = isolateDomain("satisfaction", () => computeSatisfactionCore(bundle, timings), errors);
  const cancellations = isolateDomain("cancellations", () => computeCancellationCore(bundle, timings), errors);
  const renewal = isolateDomain("renewal", () => computeRenewalCore(bundle, timings), errors);
  const mechanisms = await isolateDomainAsync("mechanisms", () => computeMechanismsCore(bundle, timings), errors);

  const temporal_indicators = await isolateDomainAsync("temporal", () => (
    deps.temporal_indicators ? deps.temporal_indicators() : computeTemporalCore(bundle, timings)
  ), errors);

  const ep_performance = await isolateDomainAsync("ep", async () => (
    deps.ep_performance
      ? deps.ep_performance({ general, meetings, mechanisms, bundle })
      : computeEpCore({ general, meetings, mechanisms, bundle }, timings)
  ), errors);

  Object.assign(domainMs, timings, { domainErrors: Object.keys(errors).length });

  return {
    sources: {
      general,
      journey,
      meetings,
      financial_updates,
      mechanisms,
      satisfaction,
      cancellations,
      renewal,
      ep_performance,
      temporal_indicators,
    },
    domainMs,
    domainErrors: errors,
  };
}

export const DOMAIN_CORE_LOADERS = {
  general: computeGeneralCore,
  journey: computeJourneyCore,
  meetings: computeMeetingsCore,
  financial_updates: computeFinancialUpdatesCore,
  mechanisms: computeMechanismsCore,
  satisfaction: computeSatisfactionCore,
  cancellations: computeCancellationCore,
  renewal: computeRenewalCore,
};
