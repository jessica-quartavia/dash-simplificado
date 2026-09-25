/**
 * Projeção de renovação até 31/12 — elegibilidade oficial + validação PROXY data_fim_ciclo.
 */
import { civilDateInSaoPaulo } from "./client-cycle-renewal.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { validateDataFimCicloProxy } from "./cycle-end-date-proxy-validation.mjs";
import {
  filterWideClientsForRenewalAnalysis,
} from "./internal-mechanisms-renewal-population.mjs";
import { buildExploratoryRenewalProjection } from "./internal-mechanisms-renewal-exploratory-projection.mjs";
import { CALCULATION_VERSION } from "../cache/analytics-cache.mjs";

export const IMS_RENEWAL_PROJECTION_VERSION = "2026-09-25-ims-renewal-population-v1";

const OFFICIAL_RENEWAL_INFERENCE =
  "Renovação no portal é inferida por clients.ciclo (ciclo > 1 ⇒ já renovou; renewalCount = max(ciclo−1, 0)). Não há evento formal nem data de renovação na BASE QV.";

export function yearEndHorizonDate(refDate = new Date()) {
  const today = civilDateInSaoPaulo(refDate);
  if (!today) return { today: null, horizonEnd: null, year: null };
  const year = today.slice(0, 4);
  return { today, horizonEnd: `${year}-12-31`, year };
}

function coveragePct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function horizonClientsFromPortfolio(activePortfolio, today, horizonEnd) {
  return activePortfolio.filter(
    (c) => c.cycleEndDate && today && horizonEnd && c.cycleEndDate >= today && c.cycleEndDate <= horizonEnd,
  );
}

/**
 * @param {object[]} npsPopulation — recorte NPS (página IMS)
 * @param {object} [options.portfolioClients] — carteira wide (preferência: todos ativos)
 * @param {object[]} [options.catalog]
 */
export function assessRenewalYearEndProjection(_npsPopulationUnused, options = {}) {
  const { today, horizonEnd, year } = yearEndHorizonDate(options.refDate || new Date());
  const portfolio =
    options.portfolioClients
    || filterWideClientsForRenewalAnalysis(options.wideClients || [], options.filters || []);
  const validation = validateDataFimCicloProxy(portfolio, options);

  const activePortfolio = portfolio.filter((c) =>
    matchesAnalyticalStatusFilter(c.analyticalStatus, "active"),
  );
  const horizonClients = horizonClientsFromPortfolio(activePortfolio, today, horizonEnd);

  const activeNps = (options.renewalPopulation || []).filter((c) =>
    matchesAnalyticalStatusFilter(c.analyticalStatus, "active"),
  );
  const withCycleEnd = activeNps.filter((c) => c.cycleEndDate);
  const inHorizonNps =
    today && horizonEnd
      ? withCycleEnd.filter((c) => c.cycleEndDate >= today && c.cycleEndDate <= horizonEnd)
      : [];

  const classProxy = validation.evidence.classification;
  const proxyOperational = classProxy === "A" || classProxy === "B";

  const proxy = {
    kind: "PROXY",
    label: "data_fim_ciclo → cycleEndDate",
    description: validation.proxyLabel,
    horizonEnd,
    validation: {
      classification: classProxy,
      classificationLabel: validation.evidence.labels[classProxy],
      hypothesisVerdict: validation.evidence.hypothesisVerdict,
      reasons: validation.evidence.reasons,
    },
    fieldDocumentation: validation.fieldDocumentation,
    metrics: validation.metrics,
    activeInPopulation: activeNps.length,
    withCycleEndDate: withCycleEnd.length,
    cycleEndCoveragePct: coveragePct(withCycleEnd.length, activeNps.length),
    inHorizonWindow: inHorizonNps.length,
    portfolioHorizonTotal: validation.metrics.horizon.total,
  };

  let exploratory = null;
  let exploratoryError = null;
  if (proxyOperational) {
    try {
      exploratory = buildExploratoryRenewalProjection(
        activePortfolio,
        horizonClients,
        options.catalog || [],
        { horizonEnd, minMechanismSample: options.minMechanismSample || 10 },
      );
    } catch (exploratoryBuildError) {
      exploratoryError =
        exploratoryBuildError instanceof Error ? exploratoryBuildError.message : String(exploratoryBuildError);
    }
  }

  const modelPublished = Boolean(exploratory?.available);
  const horizonTotal = validation.metrics?.horizon?.total ?? 0;
  const officialEligibilityAvailable = false;
  const proxyAvailable = proxyOperational && horizonTotal > 0;
  const projectionAvailable = proxyAvailable && (modelPublished || horizonTotal > 0);

  const base = {
    schemaVersion: IMS_RENEWAL_PROJECTION_VERSION,
    calculationVersion: CALCULATION_VERSION,
    officialEligibleAvailable: officialEligibilityAvailable,
    officialEligibilityAvailable,
    proxyOperational,
    proxyAvailable,
    projectionAvailable,
    proxyClassification: classProxy,
    proxyClassificationLabel: validation.evidence.labels[classProxy],
    metrics: validation.metrics,
    available: proxyOperational,
    modelProjectionPublished: modelPublished,
    exploratoryError,
    modelProjectionNote: modelPublished
      ? null
      : "Expectativa numérica depende de calibração do modelo exploratório.",
    title: proxyOperational
      ? "Projeção exploratória — usando data_fim_ciclo como proxy"
      : "Projeção de renovação até o final do ano",
    uiMode: proxyOperational ? (modelPublished ? "exploratory_full" : "exploratory_proxy") : "unavailable",
    headline: proxyOperational ? null : "Indisponível.",
    validationMessage: proxyOperational
      ? null
      : "Não foi possível validar data_fim_ciclo como uma janela confiável de renovação.",
    validationSummary: proxyOperational ? null : (validation.evidence.reasons || []).slice(0, 4).join(" "),
    badge: proxyOperational ? "PROXY" : null,
    horizonEnd,
    today,
    year,
    officialRenewalInference: OFFICIAL_RENEWAL_INFERENCE,
    eligibilityRuleUsed: null,
    dateFieldUsed: proxyOperational ? "clients.data_fim_ciclo (PROXY operacional)" : null,
    horizonPopulationLabel: "Clientes com fim de ciclo até 31/12",
    horizonClientCount: validation.metrics.horizon.total,
    fieldsPresent: [
      {
        field: "clients.ciclo",
        role: "Retrospectivo — quem já renovou (não agenda próxima renovação).",
      },
      {
        field: "clients.data_inicio_ciclo",
        role: "Início do ciclo corrente.",
      },
      {
        field: "clients.data_fim_ciclo",
        role: validation.fieldDocumentation.meaningFound,
      },
    ],
    fieldsMissing: [
      "renewal_date / data oficial da próxima renovação",
      "Data do evento de renovação",
      "Histórico de ciclos anteriores (fim ciclo n−1)",
    ],
    proxyCycleEndDate: proxy,
    exploratory,
    permanenceBiasNote:
      "Clientes mais antigos tiveram mais tempo para implementar mecanismos e também para renovar. Associações não significam causalidade.",
    causalNote: "Associações observadas não significam que o mecanismo causou renovação.",
    uiWarnings: [
      "Esta projeção é exploratória.",
      "data_fim_ciclo é utilizada como proxy da janela de renovação.",
      "Associações com mecanismos não implicam causalidade.",
    ],
    whatWouldBeNeeded: [
      "Campo ou evento oficial de próxima renovação com cobertura documentada.",
      "Validação de negócio ligando data_fim_ciclo a decisão de renovação.",
    ],
  };

  if (proxyOperational) {
    base.disclaimer =
      "Usamos a data_fim_ciclo como aproximação da próxima janela de renovação. Este não é um campo oficial de renovação.";
  }

  return base;
}

export function safeAssessRenewalYearEndProjection(npsPopulation, options = {}) {
  try {
    return assessRenewalYearEndProjection(npsPopulation, options);
  } catch (error) {
    return {
      schemaVersion: IMS_RENEWAL_PROJECTION_VERSION,
      calculationVersion: CALCULATION_VERSION,
      officialEligibleAvailable: false,
      officialEligibilityAvailable: false,
      proxyAvailable: false,
      projectionAvailable: false,
      available: false,
      proxyOperational: false,
      uiMode: "error",
      headline: "Indisponível.",
      validationMessage: "Não foi possível calcular a validação do proxy neste carregamento.",
      validationSummary: error instanceof Error ? error.message : String(error),
      proxyCycleEndDate: null,
      metrics: null,
      exploratory: null,
      error: true,
    };
  }
}
