/**
 * Cruzamentos Estatísticos — BASE QV (Fase 1) + NPS com ressalvas.
 * App Pharus: variáveis explicativas só após vínculo; sem churn próprio → sem “poder preditivo Pharus”.
 * Renovação: indisponível sem elegíveis.
 */
import { dataConfigurationError } from "../env.mjs";
import {
  classifyNpsScore,
  computeNpsBreakdown,
  latestNpsByClient,
  NPS_MIN_COVERAGE_PCT,
} from "./nps-metrics.mjs";
import { computeGeneralDataPayload } from "./general-data.mjs";
import { computeMeetingsPayload } from "./meetings.mjs";
import { computeMechanismsPayload } from "./mechanisms.mjs";
import {
  isEffectiveCancelledStatus,
  isConfirmedCancelledStatus,
} from "./analytical-cancellation.mjs";
import {
  applyRenewalTenureAdjustment,
  calculateAnalyticalTenure,
} from "./client-tenure.mjs";
import {
  associationStrength,
  buildContingencyFromGroups,
  chiSquareIndependence,
  coveragePct,
  fisherExact2x2,
  kaplanMeier,
  logisticUnivariateAuc,
  logRank,
  mannWhitney,
  mean,
  median,
  pearson,
  pointBiserial,
  pooledSd,
  round3,
  round4,
  sampleSd,
  spearman,
  standardizedDifference,
} from "./stats-tests.mjs";
import {
  parseCurrentCycle,
  renewalFromCycle,
  civilDateInSaoPaulo,
  calendarDateFromValue,
  PORTAL_TZ,
} from "./client-cycle-renewal.mjs";
import {
  buildCorrelationMatrix,
  DEFAULT_MATRIX_VARIABLES,
} from "./correlation-matrix.mjs";
import { buildCohortRetention } from "./cohort-retention.mjs";
import { buildStatisticalDiscoveries } from "./statistical-discoveries.mjs";
import { buildAxisMatricesBundle } from "./sc-axis-matrices.mjs";
import { buildExploratoryBundle } from "./sc-exploratory-ext.mjs";
import { buildClientInsightsBundle } from "./sc-client-insights.mjs";

export {
  buildCorrelationMatrix,
  buildCohortRetention,
  buildStatisticalDiscoveries,
  pearson,
  spearman,
  DEFAULT_MATRIX_VARIABLES,
};

const MIN_GROUP = 30;
const MIN_AUC = 30;
const MIN_KM_GROUP = 20;
const MIN_CHURN_EVENTS = 20;
/** Limiar descritivo (medianas / diferenças) — não bloquear bloco com ~53 cancelamentos */
const MIN_DESCRIPTIVE = 5;

const PENDING = {
  nps: {
    status: "available_with_caveats",
    available: true,
    sourceFound: true,
    tables: ["nps_responses"],
    note:
      "NPS oficial 0–10 em nps_responses. Cruzamentos preditivos excluem respostas posteriores ao cancelamento. EP atual no join. CSAT Pharus ≠ NPS.",
  },
  renewal: {
    status: "available",
    available: true,
    sourceFound: true,
    tables: ["clients.ciclo"],
    note:
      "Renovação via clients.ciclo (general-data): currentCycle > 1 ⇒ renovado; renewalCount = max(ciclo−1, 0); ciclo ≥ 1 válido para análise.",
  },
  pharusPredictive: {
    status: "unavailable",
    available: false,
    sourceFound: false,
    note:
      "App Pharus sem desfecho de churn próprio confiável. Pode fornecer variáveis após vínculo; alvo permanece BASE QV.",
  },
  pharusSurvival: {
    status: "unavailable",
    available: false,
    sourceFound: false,
    note: "Sem evento de abandono/desativação no App Pharus; não usar último acesso como churn.",
  },
};

/** Exclusões metodológicas estáticas (vazamento / definem o desfecho). */
const METHODOLOGY_EXCLUDED = [
  { id: "motivo_cancelamento", label: "Motivo de cancelamento", reason: "Vazamento — informação tipicamente disponível no/após o evento" },
  { id: "offboarding", label: "Offboarding / processo de saída", reason: "Vazamento — processo concomitante ou posterior ao churn" },
  { id: "cancellationDate", label: "Data de cancelamento", reason: "Define o desfecho — não é preditor" },
  { id: "cancellationStage", label: "Estágio de cancelamento", reason: "Vazamento processual" },
  { id: "hasCancellationProcess", label: "Possui processo de cancelamento", reason: "Vazamento — correlato direto do evento" },
  { id: "cancellationSource", label: "Fonte da data de cancelamento", reason: "Metadado do desfecho" },
  { id: "analyticalStatus", label: "Status analítico", reason: "Contém o rótulo de cancelamento (desfecho)" },
];

function blankToNull(v) {
  if (v == null) return null;
  if (typeof v === "string" && !v.trim()) return null;
  return v;
}

function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.floor(ms / 86400000);
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function pct(n, d) {
  if (d == null || d <= 0 || n == null) return null;
  return Math.round((n / d) * 1000) / 10;
}

/** Faixa SP inclusiva no início, exclusiva no fim: [from, toExclusive). */
function inDateRange(iso, from, toExclusive) {
  if (!from && !toExclusive) return true;
  const d = parseDate(iso);
  if (!d) return false;
  if (from && d < from) return false;
  if (toExclusive && d >= toExclusive) return false;
  return true;
}

/** Início do dia civil em America/Sao_Paulo: YYYY-MM-DDT00:00:00-03:00 */
function spDayStart(ymd) {
  if (!ymd) return null;
  const day = String(ymd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return parseDate(ymd);
  return parseDate(`${day}T00:00:00-03:00`);
}

/** Próximo dia civil SP (fim exclusivo do dia ymd). */
function spNextDayStart(ymd) {
  if (!ymd) return null;
  const day = String(ymd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const ny = dt.getUTCFullYear();
  const nm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(dt.getUTCDate()).padStart(2, "0");
  return parseDate(`${ny}-${nm}-${nd}T00:00:00-03:00`);
}

function parseCycleNumber(raw) {
  return parseCurrentCycle(raw != null && typeof raw === "object" ? raw : { currentCycle: raw });
}

function renewalFromCycleLocal(cycle) {
  const r = renewalFromCycle(cycle);
  return {
    renewalCount: r.renewalCount,
    hasRenewed: r.hasRenewed,
    renewedValid: r.renewedValid,
  };
}

function incomeBand(v) {
  if (v == null || !Number.isFinite(v)) return "Não informado";
  if (v < 10000) return "Até 10 mil";
  if (v < 20000) return "10 a 20 mil";
  if (v < 50000) return "20 a 50 mil";
  return "Acima de 50 mil";
}

function liquidityBand(v) {
  if (v == null || !Number.isFinite(v)) return "Não informado";
  if (v < 50000) return "Até 50 mil";
  if (v < 200000) return "50 a 200 mil";
  if (v < 500000) return "200 a 500 mil";
  return "Acima de 500 mil";
}

function stayBand(days) {
  if (days == null || !Number.isFinite(days) || days < 0) return "Dados insuficientes";
  const months = Math.floor(days / 30);
  if (months <= 3) return "Até 3 meses";
  if (months <= 6) return "De 4 a 6 meses";
  if (months <= 12) return "De 7 a 12 meses";
  if (months <= 24) return "De 13 a 24 meses";
  return "Mais de 24 meses";
}

/** Join único por cliente — regras alinhadas às páginas existentes. */
export function buildAnalyticalPopulation(generalPayload, meetingsPayload, mechanismsPayload, now = new Date()) {
  const generalClients = Array.isArray(generalPayload?.clients) ? generalPayload.clients : [];
  const meetingById = new Map(
    (Array.isArray(meetingsPayload?.clients) ? meetingsPayload.clients : []).map((c) => [String(c.clientId), c]),
  );
  const mechById = new Map(
    (Array.isArray(mechanismsPayload?.clients) ? mechanismsPayload.clients : []).map((c) => [String(c.clientId), c]),
  );

  const rows = [];
  const warningsAgg = new Map();
  const bump = (code, message) => {
    if (!warningsAgg.has(code)) warningsAgg.set(code, { code, message, count: 0 });
    warningsAgg.get(code).count += 1;
  };

  for (const g of generalClients) {
    const id = String(g.clientId || g.id || "");
    if (!id) continue;
    const m = meetingById.get(id) || null;
    const k = mechById.get(id) || null;
    const status = g.analyticalStatus || g.status || "Não informado";
    const isCancelled = isEffectiveCancelledStatus(status);
    const cancellationDate = parseDate(g.cancellationDate);
    const isCancelledWithDate = isConfirmedCancelledStatus(status) && Boolean(cancellationDate);
    const hasConfirmedDate = isCancelled && Boolean(cancellationDate);
    const cancelledWithoutDate = isCancelled && !cancellationDate;
    const isActive = status === "Ativo";
    const isFrozen = status === "Congelado";

    const contractDate = parseDate(g.contractDate);
    const createdAt = parseDate(g.createdAt);
    const hireDate = contractDate || createdAt;
    const currentCycle = parseCycleNumber(g.currentCycle ?? g.ciclo);
    const renewal = renewalFromCycleLocal(currentCycle);

    // Permanência analítica (oficial): base cronológica + ajuste +365 se ciclo≥2 e base<365.
    // Preferir campos já calculados em Dados Gerais para paridade; senão recalcular via helper.
    let stayDaysChronological = g.stayDaysChronological ?? g.stayDaysBase ?? null;
    let stayDays = g.stayDays ?? null;
    let stayAdjusted = g.stayAdjusted === true;
    if (stayDaysChronological == null || stayDays == null) {
      const tenure = calculateAnalyticalTenure({
        hireDate,
        cancellationDate,
        isCancelledWithDate,
        isCancelled,
        now,
        currentCycle,
      });
      if (tenure.warning) {
        const code = tenure.status === "missing_hire" ? "missing_hire_for_stay"
          : tenure.status === "future_hire" ? "future_hire_for_stay"
          : tenure.status === "negative_stay" ? "negative_stay"
          : tenure.status === "missing_cancellation_date" ? "cancelled_without_date_stay"
          : "invalid_stay";
        bump(code, tenure.warning);
      }
      stayDaysChronological = tenure.stayDaysChronological;
      stayDays = tenure.stayDays;
      stayAdjusted = tenure.adjusted === true;
    } else {
      // Garantir ajuste único mesmo se a base veio sem ajuste aplicado.
      const adjusted = applyRenewalTenureAdjustment(stayDaysChronological, currentCycle);
      if (adjusted != null) {
        stayDays = adjusted;
        stayAdjusted = adjusted !== stayDaysChronological;
      }
    }
    const engineer = blankToNull(g.engineer) || "Não informado";
    const segment = blankToNull(g.segmentLabel) || blankToNull(g.segment) || "Dados insuficientes";
    const paidPropertiesValue = g.paidPropertiesValue ?? g.patrimony ?? null;

    const meetingCount = m?.totalMeetings ?? null;
    const journeyCount = m?.journeyMeetingsCount ?? null;
    const noShowCount = m?.absences ?? null;
    const rescheduleCount = m?.reschedules ?? null;
    let attendanceRate = null;
    if (journeyCount != null && journeyCount > 0 && noShowCount != null) {
      const attendedProxy = journeyCount - noShowCount;
      if (attendedProxy >= 0) attendanceRate = round4(attendedProxy / journeyCount);
    }
    /** Reuniões por mês de permanência (normaliza tempo de exposição). Null se meetingCount ou stayDays ausentes. */
    let meetingsPerMonth = null;
    if (meetingCount != null && Number.isFinite(Number(meetingCount)) && stayDays != null && Number.isFinite(stayDays) && stayDays >= 0) {
      const months = Math.max(stayDays / 30.4375, 1);
      meetingsPerMonth = round4(Number(meetingCount) / months);
    }

    const available = k?.available ?? null;
    const implemented = k?.implemented ?? null;
    const implementationRate = k?.implementationPercent != null
      ? round4(Number(k.implementationPercent) / 100)
      : (available > 0 && implemented != null ? round4(implemented / available) : null);

    // Survival record
    let survivalTime = null;
    let survivalEvent = 0;
    let survivalValid = false;
    if (hireDate) {
      if (isCancelledWithDate) {
        const t = daysBetween(hireDate, cancellationDate);
        if (t != null && t >= 0) {
          survivalTime = t;
          survivalEvent = 1;
          survivalValid = true;
        } else if (t != null && t < 0) {
          bump("cancel_before_hire", "Cancelamento anterior à contratação — excluído da sobrevivência");
        }
      } else if (!isCancelled) {
        const t = daysBetween(hireDate, now);
        if (t != null && t >= 0) {
          survivalTime = t;
          survivalEvent = 0;
          survivalValid = true;
        }
      } else {
        bump("cancelled_without_confirmed_date", "Cancelado efetivado sem data confirmada — excluído da sobrevivência");
      }
    } else {
      bump("missing_hire_date", "Sem data de contratação — excluído da sobrevivência");
    }

    rows.push({
      clientId: id,
      clientCode: blankToNull(g.clientCode) || blankToNull(g.codigo) || null,
      clientName: blankToNull(g.clientName) || blankToNull(g.name) || "Não informado",
      statusAnalytic: status,
      analyticalStatus: status,
      isCancelled,
      isActive,
      isFrozen,
      hasConfirmedDate,
      cancelledWithoutDate,
      cancellationSource: blankToNull(g.cancellationSource) || blankToNull(g.cancellationDateSource) || null,
      cancellationDateSource: blankToNull(g.cancellationDateSource) || blankToNull(g.cancellationSource) || null,
      contractDate: contractDate ? contractDate.toISOString() : null,
      hireDate: hireDate ? hireDate.toISOString() : null,
      acquisitionDate: g.acquisitionDate || (hireDate ? hireDate.toISOString() : null),
      cancellationDate: cancellationDate ? cancellationDate.toISOString() : null,
      observedEndDate: (isCancelledWithDate ? cancellationDate : now).toISOString(),
      stayDays,
      stayDaysBase: stayDaysChronological,
      stayDaysChronological,
      stayAdjusted,
      stayBand: stayBand(stayDays),
      segment,
      engineer,
      advisor: engineer,
      program: blankToNull(g.program) || blankToNull(g.programa) || null,
      davosContractSigned: g.davosContractSigned === true,
      currentCycle,
      renewalCount: renewal.renewalCount,
      hasRenewed: renewal.hasRenewed,
      renewed: renewal.hasRenewed,
      renewedValid: renewal.renewedValid,
      monthlyIncome: g.monthlyIncome ?? null,
      liquidityReserve: g.liquidityReserve ?? null,
      lastContribution: g.lastContribution ?? null,
      paidPropertiesValue,
      patrimony: paidPropertiesValue,
      daysSinceFinancialUpdate: g.daysSinceFinancialUpdate ?? null,
      financialUpdateCount: g.financialUpdateCount ?? null,
      hasFinancialData: Boolean(g.hasFinancialProfile),
      incomeBand: g.incomeBand || incomeBand(g.monthlyIncome),
      liquidityBand: g.liquidityBand || liquidityBand(g.liquidityReserve),
      meetingCount,
      meetingsPerMonth,
      journeyMeetingCount: journeyCount,
      noShowCount,
      rescheduleCount,
      attendanceRate,
      daysSinceLastMeeting: m?.daysSinceLastMeeting ?? null,
      averageIntervalDays: m?.averageIntervalDays ?? null,
      typicalIntervalDays: m?.typicalIntervalDays ?? null,
      daysToFirstMeeting: m?.daysFromEntryToFirstMeeting ?? null,
      hasMeeting: (meetingCount ?? 0) > 0,
      firstMeetingCompleted: m?.firstMeetingCompleted === true,
      mechanismCount: available,
      implementedMechanismCount: implemented,
      inProgressMechanismCount: k?.inProgress ?? null,
      eligibleMechanismCount: k?.eligible ?? null,
      implementationRate,
      implementationPercent: k?.implementationPercent ?? null,
      daysToFirstImplementation: k?.daysToFirstImplementation ?? null,
      hasMechanism: (available ?? 0) > 0,
      hasFirstImplementation: (implemented ?? 0) > 0 || Boolean(k?.firstImplementationDate),
      npsScore: null,
      npsClass: null,
      npsSubmittedAt: null,
      hasNps: false,
      npsPredictiveOk: false,
      survivalTime,
      survivalEvent,
      survivalValid,
    });
  }

  return {
    clients: rows,
    warnings: [...warningsAgg.values()].sort((a, b) => b.count - a.count),
  };
}

function applyPopulationFilters(clients, filters = {}, now = new Date()) {
  const hireFrom = filters.hireFrom ? spDayStart(filters.hireFrom) : null;
  const hireTo = filters.hireTo ? spNextDayStart(filters.hireTo) : null;
  const cancelFrom = filters.cancelFrom ? spDayStart(filters.cancelFrom) : null;
  const cancelTo = filters.cancelTo ? spNextDayStart(filters.cancelTo) : null;
  const cycleFilter = filters.currentCycle != null && filters.currentCycle !== "" && filters.currentCycle !== "all"
    ? parseCycleNumber(filters.currentCycle)
    : null;
  const programs = new Set((Array.isArray(filters.programs) ? filters.programs : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean));

  return clients.filter((c) => {
    if (programs.size && !programs.has(String(c.program || "").trim().toLowerCase())) return false;
    if (filters.status && filters.status !== "all") {
      if (filters.status === "active" && !c.isActive) return false;
      if (filters.status === "cancelled" && !c.isCancelled) return false;
      if (filters.status === "frozen" && !c.isFrozen) return false;
      if (filters.status === "active_cancelled" && !(c.isActive || c.isCancelled)) return false;
    }
    if (filters.segment && filters.segment !== "all" && c.segment !== filters.segment) return false;
    if (filters.engineer && filters.engineer !== "all" && c.engineer !== filters.engineer) return false;
    if (filters.advisor && filters.advisor !== "all" && c.advisor !== filters.advisor) return false;
    if (filters.hasFinancial === "yes" && !c.hasFinancialData) return false;
    if (filters.hasFinancial === "no" && c.hasFinancialData) return false;
    if (filters.hasMeeting === "yes" && !c.hasMeeting) return false;
    if (filters.hasMeeting === "no" && c.hasMeeting) return false;
    if (filters.hasMechanism === "yes" && !c.hasMechanism) return false;
    if (filters.hasMechanism === "no" && c.hasMechanism) return false;
    if (filters.hasNps === "yes" && !c.hasNps) return false;
    if (filters.hasNps === "no" && c.hasNps) return false;
    if (filters.renewed === "yes" && !c.hasRenewed) return false;
    if (filters.renewed === "no" && c.hasRenewed) return false;
    if (cycleFilter != null && c.currentCycle !== cycleFilter) return false;
    if (filters.npsClass && filters.npsClass !== "all") {
      const want = String(filters.npsClass).toLowerCase();
      const map = { promoters: "promoter", promoter: "promoter", neutros: "passive", passive: "passive", neutrals: "passive", detratores: "detractor", detractor: "detractor" };
      const cls = map[want] || want;
      if (c.npsClass !== cls) return false;
    }
    if (filters.incomeBand && filters.incomeBand !== "all" && c.incomeBand !== filters.incomeBand) return false;
    if (filters.liquidityBand && filters.liquidityBand !== "all" && c.liquidityBand !== filters.liquidityBand) return false;
    if (filters.stayBand && filters.stayBand !== "all" && c.stayBand !== filters.stayBand) return false;
    if (!inDateRange(c.contractDate || c.hireDate, hireFrom, hireTo)) return false;
    if (cancelFrom || cancelTo) {
      if (!c.cancellationDate) return false;
      if (!inDateRange(c.cancellationDate, cancelFrom, cancelTo)) return false;
    }
    return true;
  });
}

const NUMERIC_VARS = [
  { id: "monthlyIncome", label: "Renda mensal", field: "monthlyIncome", predictive: true, source: "client_financial_data.ultima_renda_mensal" },
  { id: "liquidityReserve", label: "Reserva de liquidez", field: "liquidityReserve", predictive: true, source: "client_financial_data.reserva_liquidez" },
  { id: "lastContribution", label: "Último aporte", field: "lastContribution", predictive: true, source: "client_financial_data.ultimo_aporte" },
  { id: "paidPropertiesValue", label: "Patrimônio (imóveis quitados)", field: "paidPropertiesValue", predictive: true, source: "client_financial_data.valor_imoveis_quitados" },
  { id: "meetingCount", label: "Total de reuniões", field: "meetingCount", predictive: true, source: "client_meetings + manual_meetings (dashboard Reuniões)" },
  { id: "meetingsPerMonth", label: "Reuniões por mês de permanência", field: "meetingsPerMonth", predictive: true, source: "meetingCount / max(stayDays/30.4375, 1)", note: "Normaliza exposição temporal; não substitui o total de reuniões." },
  { id: "noShowCount", label: "No-shows", field: "noShowCount", predictive: true, source: "meeting_attendance" },
  { id: "rescheduleCount", label: "Remarcações", field: "rescheduleCount", predictive: true, source: "meeting_attendance.remarcado" },
  { id: "attendanceRate", label: "Taxa de presença (proxy)", field: "attendanceRate", predictive: true, source: "journeyMeetings − absences" },
  { id: "daysSinceLastMeeting", label: "Dias desde última reunião", field: "daysSinceLastMeeting", predictive: true, source: "dashboard Reuniões" },
  { id: "averageIntervalDays", label: "Intervalo médio entre reuniões", field: "averageIntervalDays", predictive: true, source: "dashboard Reuniões" },
  { id: "daysToFirstMeeting", label: "Dias até primeira reunião", field: "daysToFirstMeeting", predictive: true, source: "dashboard Reuniões" },
  { id: "mechanismCount", label: "Quantidade de mecanismos", field: "mechanismCount", predictive: true, source: "client_mecanismos" },
  { id: "implementedMechanismCount", label: "Mecanismos implementados", field: "implementedMechanismCount", predictive: true, source: "client_mecanismos status concluído" },
  { id: "implementationPercent", label: "Percentual implementado", field: "implementationPercent", predictive: true, source: "dashboard Mecanismos" },
  { id: "daysToFirstImplementation", label: "Dias até primeira implementação", field: "daysToFirstImplementation", predictive: true, source: "dashboard Mecanismos" },
  { id: "daysSinceFinancialUpdate", label: "Dias desde atualização financeira", field: "daysSinceFinancialUpdate", predictive: true, source: "general-data / financial updates (quando presente)" },
  { id: "financialUpdateCount", label: "Qtd. atualizações financeiras", field: "financialUpdateCount", predictive: true, source: "general-data (quando presente)" },
  { id: "renewalCount", label: "Qtd. renovações (ciclo−1)", field: "renewalCount", predictive: true, source: "clients.ciclo" },
  { id: "currentCycle", label: "Ciclo atual", field: "currentCycle", predictive: true, source: "clients.ciclo" },
  { id: "npsScore", label: "Nota NPS (0–10)", field: "npsScore", predictive: true, requireNpsPredictive: true, source: "nps_responses (última válida; preditivo exclui pós-cancelamento)" },
  { id: "stayDays", label: "Permanência (dias)", field: "stayDays", predictive: false, source: "contratação → cancelamento ou hoje (+365 se ciclo≥2 e base<365)", note: "Indicador analítico. Para cancelados = tempo até evento; para ativos = hoje − contratação. Renovados (ciclo≥2) com base < 365 recebem +365. Sobrevivência/cohort usam duração cronológica (sem +365). Excluída do AUC." },
];

const CATEGORICAL_VARS = [
  { id: "segment", label: "Segmento", field: "segment", predictive: true, source: "regra Dados Gerais" },
  { id: "engineer", label: "Engenheiro Patrimonial", field: "engineer", predictive: true, source: "clients.engenheiro_patrimonial", caution: "Muitos níveis — amostra por EP pode ser pequena" },
  { id: "hasFinancialData", label: "Possui diagnóstico financeiro", field: "hasFinancialData", predictive: true, source: "existência em client_financial_data", binary: true },
  { id: "hasMeeting", label: "Possui reunião", field: "hasMeeting", predictive: true, source: "dashboard Reuniões", binary: true },
  { id: "hasMechanism", label: "Possui mecanismo", field: "hasMechanism", predictive: true, source: "dashboard Mecanismos", binary: true },
  { id: "hasFirstImplementation", label: "Possui implementação", field: "hasFirstImplementation", predictive: true, source: "dashboard Mecanismos", binary: true },
  { id: "hasRenewed", label: "Já renovou (ciclo > 1)", field: "hasRenewed", predictive: true, source: "clients.ciclo", binary: true },
  { id: "npsClass", label: "Classe NPS", field: "npsClass", predictive: true, requireNpsPredictive: true, source: "nps_responses" },
  { id: "incomeBand", label: "Faixa de renda", field: "incomeBand", predictive: true, source: "derivado de renda" },
  { id: "liquidityBand", label: "Faixa de reserva", field: "liquidityBand", predictive: true, source: "derivado de reserva" },
];

/** Filtra clientes elegíveis a uma variável (ex.: NPS preditivo). */
function clientsForVar(def, list) {
  if (def.requireNpsPredictive) return list.filter((c) => c.npsPredictiveOk && c.hasNps);
  return list;
}

function missingRate(clients, field) {
  if (!clients.length) return 100;
  const miss = clients.filter((c) => {
    const v = c[field];
    if (typeof v === "boolean") return false; // false é valor válido
    if (typeof v === "number" && Number.isFinite(v)) return false; // 0 é válido
    return v == null || v === "" || v === "Não informado" || v === "Dados insuficientes";
  }).length;
  return pct(miss, clients.length);
}

function analyzeNumericVariable(def, active, cancelled, minSample) {
  const aVals = active.map((c) => c[def.field]).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  const cVals = cancelled.map((c) => c[def.field]).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  const allForMissing = [...active, ...cancelled];
  const miss = missingRate(allForMissing, def.field);
  const coveragePercent = Math.round((100 - miss) * 10) / 10;
  const nA = aVals.length;
  const nC = cVals.length;
  const warnings = [];
  const descriptiveOk = nA >= MIN_DESCRIPTIVE && nC >= MIN_DESCRIPTIVE;
  const inferenceOk = nA >= minSample && nC >= minSample;
  if (!inferenceOk) warnings.push("baixa amostra");
  if (miss >= 40) warnings.push("alta ausência");

  const medA = median(aVals);
  const medC = median(cVals);
  const meanA = mean(aVals);
  const meanC = mean(cVals);
  const sdA = sampleSd(aVals);
  const sdC = sampleSd(cVals);
  const sdPool = pooledSd(aVals, cVals);
  const stdDiff = standardizedDifference(medC, medA, sdPool);
  let diffAbs = null;
  let diffPct = null;
  if (medA != null && medC != null) {
    diffAbs = round3(medC - medA);
    if (medA !== 0) diffPct = pct(medC - medA, Math.abs(medA));
  }

  const mw = mannWhitney(aVals, cVals);
  if (mw.warning) warnings.push(mw.warning);

  // Association with cancel (y=1 cancelled): point-biserial on combined — preserve zero
  const xs = [];
  const ys = [];
  for (const c of active) {
    const v = c[def.field];
    if (v != null && Number.isFinite(Number(v))) {
      xs.push(Number(v));
      ys.push(0);
    }
  }
  for (const c of cancelled) {
    const v = c[def.field];
    if (v != null && Number.isFinite(Number(v))) {
      xs.push(Number(v));
      ys.push(1);
    }
  }
  const pb = pointBiserial(xs, ys);
  if (pb.warning) warnings.push(pb.warning);

  let aucResult = { auc: null, warning: "excluded" };
  if (def.predictive) {
    aucResult = logisticUnivariateAuc(xs, ys);
    if (aucResult.warning) warnings.push(aucResult.warning);
  } else {
    warnings.push("excluída do AUC (vazamento/censura)");
  }

  const effect = pb.r != null ? Math.abs(pb.r) : (mw.rankBiserial != null ? Math.abs(mw.rankBiserial) : null);
  const direction = pb.r == null ? null : (pb.r > 0 ? "maior nos cancelados" : pb.r < 0 ? "maior nos ativos" : "neutra");

  let status = "available";
  let reason = null;
  if (!descriptiveOk) {
    status = nA === 0 || nC === 0 ? "insufficient_groups" : "small_sample";
    reason = !descriptiveOk
      ? `Amostra descritiva insuficiente (ativos=${nA}, cancelados=${nC}; mín=${MIN_DESCRIPTIVE})`
      : null;
  } else if (pb.warning === "zero_variance" || (aVals.length && cVals.length && new Set([...aVals, ...cVals]).size <= 1)) {
    status = "constant";
    reason = "Variável constante no recorte";
  } else if (!inferenceOk) {
    status = "small_sample";
    reason = "Amostra pequena para inferência — medianas descritivas disponíveis";
  } else if (pb.r == null && descriptiveOk) {
    status = "small_sample";
    reason = pb.warning || "Associação não calculável; medianas disponíveis";
  }

  return {
    id: def.id,
    label: def.label,
    type: "numeric",
    source: def.source,
    predictiveEligible: Boolean(def.predictive),
    note: def.note || null,
    status,
    reason,
    activeMedian: round3(medA),
    cancelledMedian: round3(medC),
    /** aliases FE */
    medianActive: round3(medA),
    medianCancelled: round3(medC),
    medianNonCancelled: round3(medA),
    activeMean: round3(meanA),
    cancelledMean: round3(meanC),
    sdActive: round3(sdA),
    sdCancelled: round3(sdC),
    sdPooled: round3(sdPool),
    pooledSd: round3(sdPool),
    stdDiff,
    standardizedDifference: stdDiff,
    differenceAbs: diffAbs,
    differencePct: diffPct,
    diff: diffAbs,
    diffAbs: diffAbs,
    activeN: nA,
    cancelledN: nC,
    nActive: nA,
    nCancelled: nC,
    n: nA + nC,
    sampleSize: nA + nC,
    missingPercent: miss,
    coveragePercent,
    coverage: coveragePercent,
    associationMeasure: "point_biserial",
    association: pb.r,
    associationAbs: effect,
    absMeasure: effect,
    abs: effect,
    value: pb.r,
    measure: "point-biserial",
    strength: associationStrength(effect, "r"),
    associationStrength: associationStrength(effect, "r"),
    associationLabel: "Associação com cancelamento",
    effectSize: mw.rankBiserial,
    effectSizeMeasure: "rank_biserial",
    pValue: mw.pValue,
    test: "Mann–Whitney U",
    auc: aucResult.auc,
    aucRaw: aucResult.aucRaw ?? null,
    aucInverted: aucResult.aucInverted ?? false,
    aucDirection: aucResult.direction ?? null,
    sampleSmall: !inferenceOk,
    methodology: {
      comparison: "mediana prioritária; Mann–Whitney U (p bilateral, aprox. normal)",
      association: "point-biserial (numérico × cancelado)",
      auc: def.predictive ? "regressão logística univariada + AUC com CV estratificada" : "não aplicável",
    },
    warnings: [...new Set(warnings)],
  };
}

function analyzeCategoricalVariable(def, active, cancelled, minSample) {
  const toLabel = (c) => {
    const v = c[def.field];
    if (def.binary) return v ? "Sim" : "Não";
    return v == null || v === "" ? "Não informado" : String(v);
  };
  const aLabs = active.map(toLabel);
  const cLabs = cancelled.map(toLabel);
  const miss = missingRate([...active, ...cancelled], def.field);
  const warnings = [];
  if (active.length < minSample || cancelled.length < minSample) warnings.push("baixa amostra");
  if (miss >= 40) warnings.push("alta ausência");
  if (def.caution) warnings.push(def.caution);

  const { table, labels } = buildContingencyFromGroups(aLabs, cLabs);
  let chi = { chi2: null, pValue: null, cramersV: null, warning: "empty" };
  let fisher = null;
  if (table) {
    chi = chiSquareIndependence(table);
    if (chi.warning) warnings.push(chi.warning);
    if (labels.length === 2) {
      fisher = fisherExact2x2(table[0][0], table[0][1], table[1][0], table[1][1]);
    }
  }

  // Distribution diffs (pp)
  const dist = labels.map((lab) => {
    const aN = aLabs.filter((x) => x === lab).length;
    const cN = cLabs.filter((x) => x === lab).length;
    const aP = pct(aN, active.length || 1);
    const cP = pct(cN, cancelled.length || 1);
    return {
      label: lab,
      activeCount: aN,
      cancelledCount: cN,
      activePercent: aP,
      cancelledPercent: cP,
      diffPp: round3((cP ?? 0) - (aP ?? 0)),
    };
  }).sort((a, b) => Math.abs(b.diffPp) - Math.abs(a.diffPp));

  // AUC: for binary use 0/1; for multi use crude one-vs-rest on most different level — skip multi for AUC if many levels
  let aucResult = { auc: null, warning: "not_applicable" };
  if (def.predictive && labels.length === 2) {
    const posLabel = labels[0];
    const xs = [];
    const ys = [];
    for (const c of active) {
      xs.push(toLabel(c) === posLabel ? 1 : 0);
      ys.push(0);
    }
    for (const c of cancelled) {
      xs.push(toLabel(c) === posLabel ? 1 : 0);
      ys.push(1);
    }
    aucResult = logisticUnivariateAuc(xs, ys);
    if (aucResult.warning) warnings.push(aucResult.warning);
  } else if (def.predictive && labels.length > 2) {
    // Encode as proportion risk: use numeric risk score = cancelled rate of category (in-sample leakage for encoding!)
    // Avoid target leakage: use leave-one-out style is heavy; instead skip AUC for high-cardinality and note.
    if (labels.length > 8 || def.id === "engineer") {
      warnings.push("AUC não calculado (muitos níveis / risco de vazamento de encoding)");
      aucResult = { auc: null, warning: "high_cardinality" };
    } else {
      const rate = new Map();
      for (const lab of labels) {
        const n = cLabs.filter((x) => x === lab).length + aLabs.filter((x) => x === lab).length;
        const e = cLabs.filter((x) => x === lab).length;
        rate.set(lab, n ? e / n : 0);
      }
      const xs = [];
      const ys = [];
      for (const c of active) {
        xs.push(rate.get(toLabel(c)) ?? 0);
        ys.push(0);
      }
      for (const c of cancelled) {
        xs.push(rate.get(toLabel(c)) ?? 0);
        ys.push(1);
      }
      // Note: encoding uses full-sample rates — mild leakage; documented.
      aucResult = logisticUnivariateAuc(xs, ys);
      warnings.push("encoding categórico com taxa amostral (vazamento leve) — interpretar com cautela");
      if (aucResult.warning) warnings.push(aucResult.warning);
    }
  }

  const effect = chi.cramersV;
  const coveragePercent = Math.round((100 - miss) * 10) / 10;
  const nA = active.length;
  const nC = cancelled.length;
  const descriptiveOk = nA >= MIN_DESCRIPTIVE && nC >= MIN_DESCRIPTIVE;
  const inferenceOk = nA >= minSample && nC >= minSample;
  let status = "available";
  let reason = null;
  if (!descriptiveOk) {
    status = "insufficient_groups";
    reason = `Grupos insuficientes (ativos=${nA}, cancelados=${nC})`;
  } else if (effect == null) {
    status = "small_sample";
    reason = chi.warning || "Cramér V não calculável";
  } else if (!inferenceOk) {
    status = "small_sample";
    reason = "Amostra pequena para inferência — contingência descritiva disponível";
  }

  return {
    id: def.id,
    label: def.label,
    type: "categorical",
    source: def.source,
    predictiveEligible: Boolean(def.predictive),
    status,
    reason,
    activeN: nA,
    cancelledN: nC,
    nActive: nA,
    nCancelled: nC,
    n: nA + nC,
    sampleSize: nA + nC,
    missingPercent: miss,
    coveragePercent,
    coverage: coveragePercent,
    distribution: dist,
    associationMeasure: "cramers_v",
    association: chi.cramersV,
    associationAbs: effect,
    absMeasure: effect,
    abs: effect,
    value: chi.cramersV,
    measure: "cramers-v",
    strength: associationStrength(effect, "cramers_v"),
    associationStrength: associationStrength(effect, "cramers_v"),
    associationLabel: "Associação com cancelamento",
    effectSize: chi.cramersV,
    effectSizeMeasure: "cramers_v",
    pValue: fisher?.pValue ?? chi.pValue,
    test: fisher ? "Fisher exact (2×2) / qui-quadrado" : "Qui-quadrado",
    chi2: chi.chi2,
    auc: aucResult.auc,
    aucRaw: aucResult.aucRaw ?? null,
    aucInverted: aucResult.aucInverted ?? false,
    aucDirection: aucResult.direction ?? null,
    sampleSmall: !inferenceOk,
    // FE aliases for table (categoricals don't have medians)
    medianActive: null,
    medianCancelled: null,
    activeMedian: null,
    cancelledMedian: null,
    diff: dist[0]?.diffPp ?? null,
    differenceAbs: dist[0]?.diffPp ?? null,
    methodology: {
      comparison: "diferença em pontos percentuais por categoria",
      association: "Cramér’s V (+ Fisher se 2×2)",
      auc: def.predictive ? "logística univariada + AUC CV" : "não aplicável",
    },
    warnings: [...new Set(warnings)],
  };
}

export function analyzePopulation(clients, { minSample = MIN_GROUP, includeFrozenSeparate = false, minCoverage = null } = {}) {
  const active = clients.filter((c) => c.isActive);
  const cancelled = clients.filter((c) => c.isCancelled);
  const frozen = clients.filter((c) => c.isFrozen);

  const comparisons = [];
  const associations = [];
  const predictivePower = [];
  const quality = [];
  const excluded = METHODOLOGY_EXCLUDED.map((e) => ({ ...e }));

  for (const def of NUMERIC_VARS) {
    const a = clientsForVar(def, active);
    const c = clientsForVar(def, cancelled);
    const row = analyzeNumericVariable(def, a, c, minSample);
    if (minCoverage != null && Number.isFinite(minCoverage) && (row.coveragePercent ?? 0) < minCoverage) {
      row.status = "low_coverage";
      row.reason = `Cobertura ${row.coveragePercent}% abaixo do mínimo ${minCoverage}%`;
      row.warnings = [...new Set([...(row.warnings || []), "baixa cobertura"])];
    }
    comparisons.push(row);
    associations.push({
      id: row.id,
      label: row.label,
      type: row.type,
      status: row.status,
      reason: row.reason || null,
      association: row.association,
      associationAbs: row.associationAbs,
      absMeasure: row.associationAbs,
      abs: row.associationAbs,
      value: row.association,
      strength: row.associationStrength,
      direction: row.association != null && row.association > 0 ? "positiva_com_cancelamento" : row.association < 0 ? "negativa_com_cancelamento" : null,
      sample: row.activeN + row.cancelledN,
      n: row.activeN + row.cancelledN,
      activeN: row.activeN,
      cancelledN: row.cancelledN,
      nActive: row.activeN,
      nCancelled: row.cancelledN,
      missingPercent: row.missingPercent,
      coveragePercent: row.coveragePercent,
      coverage: row.coveragePercent,
      measure: row.associationMeasure,
      sampleSmall: row.sampleSmall,
    });
    if (def.predictive) {
      predictivePower.push({
        id: row.id,
        label: row.label,
        type: row.type,
        auc: row.auc,
        aucRaw: row.aucRaw ?? null,
        aucAdjusted: null,
        aucInverted: row.aucInverted,
        direction: row.aucDirection,
        status: row.status,
        coverage: row.coveragePercent,
        coveragePercent: row.coveragePercent,
        sample: (row.activeN || 0) + (row.cancelledN || 0),
        missingPercent: row.missingPercent,
        warnings: row.warnings,
      });
    } else {
      excluded.push({ id: def.id, label: def.label, reason: def.note || "Não elegível a AUC" });
    }
    quality.push({
      id: def.id,
      label: def.label,
      type: "numeric",
      missingPercent: row.missingPercent,
      coveragePercent: row.coveragePercent,
      activeN: row.activeN,
      cancelledN: row.cancelledN,
      sufficient: row.activeN >= minSample && row.cancelledN >= minSample,
    });
  }

  for (const def of CATEGORICAL_VARS) {
    const a = clientsForVar(def, active);
    const c = clientsForVar(def, cancelled);
    const row = analyzeCategoricalVariable(def, a, c, minSample);
    if (minCoverage != null && Number.isFinite(minCoverage) && (row.coveragePercent ?? 0) < minCoverage) {
      row.status = "low_coverage";
      row.reason = `Cobertura ${row.coveragePercent}% abaixo do mínimo ${minCoverage}%`;
      row.warnings = [...new Set([...(row.warnings || []), "baixa cobertura"])];
    }
    comparisons.push(row);
    associations.push({
      id: row.id,
      label: row.label,
      type: row.type,
      status: row.status,
      reason: row.reason || null,
      association: row.association,
      associationAbs: row.associationAbs,
      absMeasure: row.associationAbs,
      abs: row.associationAbs,
      value: row.association,
      strength: row.associationStrength,
      direction: null,
      sample: row.activeN + row.cancelledN,
      n: row.activeN + row.cancelledN,
      activeN: row.activeN,
      cancelledN: row.cancelledN,
      nActive: row.activeN,
      nCancelled: row.cancelledN,
      missingPercent: row.missingPercent,
      coveragePercent: row.coveragePercent,
      coverage: row.coveragePercent,
      measure: row.associationMeasure,
      sampleSmall: row.sampleSmall,
    });
    if (def.predictive) {
      predictivePower.push({
        id: row.id,
        label: row.label,
        type: row.type,
        auc: row.auc,
        aucRaw: row.aucRaw ?? null,
        aucAdjusted: null,
        aucInverted: row.aucInverted,
        direction: row.aucDirection,
        status: row.status,
        coverage: row.coveragePercent,
        coveragePercent: row.coveragePercent,
        sample: (row.activeN || 0) + (row.cancelledN || 0),
        missingPercent: row.missingPercent,
        warnings: row.warnings,
      });
    }
    quality.push({
      id: def.id,
      label: def.label,
      type: "categorical",
      missingPercent: row.missingPercent,
      coveragePercent: row.coveragePercent,
      activeN: row.activeN,
      cancelledN: row.cancelledN,
      sufficient: row.activeN >= minSample && row.cancelledN >= minSample,
    });
  }

  // Fix aucAdjusted properly: max(aucRaw, 1-aucRaw) when aucRaw present, else auc (already adjusted)
  for (const p of predictivePower) {
    if (p.auc == null) {
      p.aucAdjusted = null;
    } else if (p.aucRaw != null && Number.isFinite(p.aucRaw)) {
      p.aucAdjusted = round4(Math.max(p.aucRaw, 1 - p.aucRaw));
    } else {
      p.aucAdjusted = round4(Math.max(p.auc, 1 - p.auc));
    }
  }

  associations.sort((a, b) => (b.associationAbs || 0) - (a.associationAbs || 0));
  predictivePower.sort((a, b) => (b.aucAdjusted || b.auc || 0) - (a.aucAdjusted || a.auc || 0));

  // Survival overall
  const survRecords = clients
    .filter((c) => c.survivalValid)
    .map((c) => ({ time: c.survivalTime, event: c.survivalEvent }));
  const overall = kaplanMeier(survRecords);

  // Survival by segment (top groups with enough sample)
  const groupField = "segment";
  const groupLevels = [...new Set(clients.map((c) => c[groupField]).filter(Boolean))];
  const groups = [];
  for (const level of groupLevels) {
    const subset = clients.filter((c) => c[groupField] === level && c.survivalValid);
    if (subset.length < MIN_KM_GROUP) continue;
    const km = kaplanMeier(subset.map((c) => ({ time: c.survivalTime, event: c.survivalEvent })));
    groups.push({
      field: groupField,
      level,
      n: subset.length,
      events: km.events,
      censored: km.censored,
      medianSurvival: km.medianSurvival,
      curve: downsampleCurve(km.curve, 40),
    });
  }
  groups.sort((a, b) => b.n - a.n);

  let logRankResult = null;
  if (groups.length >= 2) {
    const g0 = clients.filter((c) => c[groupField] === groups[0].level && c.survivalValid);
    const g1 = clients.filter((c) => c[groupField] === groups[1].level && c.survivalValid);
    logRankResult = {
      groupA: groups[0].level,
      groupB: groups[1].level,
      ...logRank(
        g0.map((c) => ({ time: c.survivalTime, event: c.survivalEvent })),
        g1.map((c) => ({ time: c.survivalTime, event: c.survivalEvent })),
      ),
      note: "Comparação log-rank entre os dois maiores segmentos; múltiplas comparações não corrigidas.",
    };
  }

  // Binary survival splits
  for (const field of ["hasFinancialData", "hasMeeting", "hasMechanism", "hasRenewed"]) {
    for (const level of [true, false]) {
      const subset = clients.filter((c) => c[field] === level && c.survivalValid);
      if (subset.length < MIN_KM_GROUP) continue;
      const km = kaplanMeier(subset.map((c) => ({ time: c.survivalTime, event: c.survivalEvent })));
      groups.push({
        field,
        level: level ? "Sim" : "Não",
        n: subset.length,
        events: km.events,
        censored: km.censored,
        medianSurvival: km.medianSurvival,
        curve: downsampleCurve(km.curve, 40),
      });
    }
  }

  // NPS class + EP (same KM rules; hide insufficient samples)
  for (const field of ["npsClass", "engineer"]) {
    const levels = [...new Set(clients.map((c) => c[field]).filter((v) => v != null && v !== ""))];
    for (const level of levels) {
      const subset = clients.filter((c) => c[field] === level && c.survivalValid);
      if (subset.length < MIN_KM_GROUP) continue;
      const km = kaplanMeier(subset.map((c) => ({ time: c.survivalTime, event: c.survivalEvent })));
      groups.push({
        field,
        level: String(level),
        n: subset.length,
        events: km.events,
        censored: km.censored,
        medianSurvival: km.medianSurvival,
        curve: downsampleCurve(km.curve, 40),
      });
    }
  }

  const events = survRecords.filter((r) => r.event === 1).length;
  const censored = survRecords.filter((r) => r.event === 0).length;
  const cancelledWithDate = clients.filter((c) => c.isCancelled && c.hasConfirmedDate).length;
  const cancelledWithoutDate = clients.filter((c) => c.isCancelled && c.cancelledWithoutDate).length;

  const numericAssociations = associations.filter((a) => a.type === "numeric");
  const categoricalAssociations = associations.filter((a) => a.type === "categorical");

  return {
    population: {
      total: clients.length,
      totalClients: clients.length,
      active: active.length,
      activeClients: active.length,
      cancelled: cancelled.length,
      confirmedCancelledClients: cancelled.length,
      cancelledWithDate,
      cancelledWithoutDate,
      frozen: frozen.length,
      frozenClients: frozen.length,
      unknown: clients.filter((c) => !c.isActive && !c.isCancelled && !c.isFrozen).length,
      unknownClients: clients.filter((c) => !c.isActive && !c.isCancelled && !c.isFrozen).length,
      excluded: 0,
      activeUsedInComparison: active.length,
      cancelledUsedInComparison: cancelled.length,
      events,
      censored,
      survivalEligible: survRecords.length,
      includeFrozenSeparate,
    },
    comparisons,
    activeVsCancelled: comparisons.filter((r) => r.type === "numeric"),
    associations,
    churnAssociations: { numeric: numericAssociations, categorical: categoricalAssociations },
    predictivePower,
    univariatePredictivePower: predictivePower,
    survival: {
      overall: {
        ...overall,
        curve: downsampleCurve(overall.curve, 60),
        excluded: cancelledWithoutDate,
        excludedNoDate: cancelledWithoutDate,
        definition: {
          start: "data de contratação (data_inicio_ciclo ou created_at)",
          event: "cancelamento analítico com data consolidada",
          censor: "clientes sem cancelamento — tempo até a data de geração",
        },
      },
      groups,
      atRisk: survRecords.length,
      logRank: logRankResult,
      cutoffDate: civilDateInSaoPaulo(new Date()) || null,
    },
    quality,
    excludedVariables: excluded,
  };
}

function downsampleCurve(curve, maxPoints) {
  if (!curve?.length || curve.length <= maxPoints) return curve || [];
  const out = [curve[0]];
  const step = (curve.length - 2) / (maxPoints - 2);
  for (let i = 1; i < maxPoints - 1; i += 1) {
    out.push(curve[Math.round(i * step)]);
  }
  out.push(curve[curve.length - 1]);
  return out;
}

const RENEWAL_EXCLUDE_FIELDS = new Set(["renewalCount", "currentCycle", "hasRenewed", "renewed"]);

/** Associações com renovação (hasRenewed) entre clientes com ciclo ≥ 1. */
export function analyzeRenewalAssociations(clients, minSample = MIN_GROUP) {
  const eligible = (clients || []).filter((c) => c.renewedValid);
  const renewed = eligible.filter((c) => c.hasRenewed);
  const notRenewed = eligible.filter((c) => !c.hasRenewed);
  const numeric = [];
  const categorical = [];

  for (const def of NUMERIC_VARS) {
    if (RENEWAL_EXCLUDE_FIELDS.has(def.field) || RENEWAL_EXCLUDE_FIELDS.has(def.id)) continue;
    if (def.field === "stayDays") continue;
    const xs = [];
    const ys = [];
    for (const c of eligible) {
      const v = c[def.field];
      if (v == null || !Number.isFinite(Number(v))) continue;
      if (def.requireNpsPredictive && !c.npsPredictiveOk) continue;
      xs.push(Number(v));
      ys.push(c.hasRenewed ? 1 : 0);
    }
    const pb = pointBiserial(xs, ys);
    const n1 = ys.filter((y) => y === 1).length;
    const n0 = ys.length - n1;
    const descriptiveOk = n1 >= MIN_DESCRIPTIVE && n0 >= MIN_DESCRIPTIVE;
    numeric.push({
      id: def.id,
      label: def.label,
      type: "numeric",
      measure: "point_biserial",
      association: pb.r,
      associationAbs: pb.r != null ? Math.abs(pb.r) : null,
      strength: associationStrength(pb.r, "r"),
      n: pb.n,
      nRenewed: n1,
      nNotRenewed: n0,
      meanRenewed: pb.mean1 ?? null,
      meanNotRenewed: pb.mean0 ?? null,
      status: !descriptiveOk ? "small_sample" : (pb.warning || "available"),
      warning: pb.warning,
      coverage: coveragePct(xs.length, eligible.length),
    });
  }

  for (const def of CATEGORICAL_VARS) {
    if (RENEWAL_EXCLUDE_FIELDS.has(def.field) || RENEWAL_EXCLUDE_FIELDS.has(def.id)) continue;
    const toLabel = (c) => {
      const v = c[def.field];
      if (def.binary) return v ? "Sim" : "Não";
      if (def.id === "npsClass") {
        if (v === "promoter") return "Promotores";
        if (v === "passive") return "Neutros";
        if (v === "detractor") return "Detratores";
      }
      return v == null || v === "" ? "Não informado" : String(v);
    };
    const pool = def.requireNpsPredictive
      ? eligible.filter((c) => c.npsPredictiveOk && c.hasNps)
      : eligible;
    const aLabs = pool.filter((c) => !c.hasRenewed).map(toLabel);
    const rLabs = pool.filter((c) => c.hasRenewed).map(toLabel);
    const { table, labels } = buildContingencyFromGroups(aLabs, rLabs);
    let chi = { cramersV: null, pValue: null, warning: "empty" };
    if (table) chi = chiSquareIndependence(table);
    categorical.push({
      id: def.id,
      label: def.label,
      type: "categorical",
      measure: "cramers_v",
      association: chi.cramersV,
      associationAbs: chi.cramersV,
      strength: associationStrength(chi.cramersV, "cramers_v"),
      pValue: chi.pValue,
      labels,
      n: chi.n ?? pool.length,
      nRenewed: rLabs.length,
      nNotRenewed: aLabs.length,
      status: aLabs.length < MIN_DESCRIPTIVE || rLabs.length < MIN_DESCRIPTIVE
        ? "small_sample"
        : (chi.warning || "available"),
      warning: chi.warning,
      coverage: coveragePct(pool.length, eligible.length),
    });
  }

  numeric.sort((a, b) => (b.associationAbs || 0) - (a.associationAbs || 0));
  categorical.sort((a, b) => (b.associationAbs || 0) - (a.associationAbs || 0));
  return {
    eligible: eligible.length,
    renewed: renewed.length,
    notRenewed: notRenewed.length,
    sampleSmall: renewed.length < minSample || notRenewed.length < minSample,
    numeric,
    categorical,
  };
}

/** Medianas renovados vs não renovados (ciclo ≥ 1). */
export function compareRenewedVsNot(clients, minSample = MIN_GROUP) {
  const eligible = (clients || []).filter((c) => c.renewedValid);
  const renewed = eligible.filter((c) => c.hasRenewed);
  const notRenewed = eligible.filter((c) => !c.hasRenewed);
  const rows = [];

  for (const def of NUMERIC_VARS) {
    if (RENEWAL_EXCLUDE_FIELDS.has(def.field) || RENEWAL_EXCLUDE_FIELDS.has(def.id)) continue;
    const rVals = renewed
      .filter((c) => !def.requireNpsPredictive || c.npsPredictiveOk)
      .map((c) => c[def.field])
      .filter((v) => v != null && Number.isFinite(Number(v)))
      .map(Number);
    const nVals = notRenewed
      .filter((c) => !def.requireNpsPredictive || c.npsPredictiveOk)
      .map((c) => c[def.field])
      .filter((v) => v != null && Number.isFinite(Number(v)))
      .map(Number);
    const medR = median(rVals);
    const medN = median(nVals);
    const sdPool = pooledSd(rVals, nVals);
    // Positivo = maior entre renovados
    const stdDiff = standardizedDifference(medR, medN, sdPool);
    const descriptiveOk = rVals.length >= MIN_DESCRIPTIVE && nVals.length >= MIN_DESCRIPTIVE;
    const mw = mannWhitney(nVals, rVals);
    let diffAbs = null;
    if (medR != null && medN != null) diffAbs = round3(medR - medN);
    rows.push({
      id: def.id,
      label: def.label,
      medianRenewed: round3(medR),
      medianNotRenewed: round3(medN),
      differenceAbs: diffAbs,
      sdPooled: round3(sdPool),
      pooledSd: round3(sdPool),
      stdDiff,
      standardizedDifference: stdDiff,
      nRenewed: rVals.length,
      nNotRenewed: nVals.length,
      coveragePercent: coveragePct(rVals.length + nVals.length, eligible.length),
      pValue: mw.pValue,
      rankBiserial: mw.rankBiserial,
      status: descriptiveOk ? "available" : "small_sample",
      sampleSmall: rVals.length < minSample || nVals.length < minSample,
    });
  }
  return rows;
}

/** Grupos NPS: promotores / neutros / detratores. */
export function buildNpsGroupsComparison(clients) {
  const withNps = (clients || []).filter((c) => c.hasNps && c.npsClass);
  const keys = [
    { key: "promoter", label: "Promotores" },
    { key: "passive", label: "Neutros" },
    { key: "detractor", label: "Detratores" },
  ];
  return keys.map(({ key, label }) => {
    const g = withNps.filter((c) => c.npsClass === key);
    const cancelled = g.filter((c) => c.isCancelled).length;
    const renewed = g.filter((c) => c.hasRenewed).length;
    const others = withNps.filter((c) => c.npsClass !== key);
    const othersCancelled = others.filter((c) => c.isCancelled).length;
    const rate = g.length ? (cancelled / g.length) * 100 : null;
    const othersRate = others.length ? (othersCancelled / others.length) * 100 : null;
    // Diferença de proporções em pontos percentuais / escala 100 (simples e legível)
    const cancelStdDiff = rate != null && othersRate != null
      ? round4((rate - othersRate) / 100)
      : null;
    const numericMedians = {};
    for (const def of [
      { id: "stayDays", field: "stayDays" },
      { id: "meetingCount", field: "meetingCount" },
      { id: "mechanismCount", field: "mechanismCount" },
      { id: "monthlyIncome", field: "monthlyIncome" },
      { id: "implementationPercent", field: "implementationPercent" },
      { id: "npsScore", field: "npsScore" },
    ]) {
      numericMedians[def.id] = round3(
        median(g.map((c) => c[def.field]).filter((v) => v != null && Number.isFinite(Number(v))).map(Number)),
      );
    }
    return {
      class: key,
      label,
      n: g.length,
      nOthers: others.length,
      cancelled,
      cancelledPct: pct(cancelled, g.length),
      cancelledPctOthers: othersRate != null ? round3(othersRate) : null,
      /** Diferença padronizada do % cancelado vs demais classes (em escala de proporção) */
      stdDiffCancelledVsOthers: cancelStdDiff,
      renewed,
      renewedPct: pct(renewed, g.length),
      medians: numericMedians,
      meanStayDays: round3(mean(g.map((c) => c.stayDays).filter((n) => n != null && Number.isFinite(n)))),
      meanMeetings: round3(mean(g.map((c) => c.meetingCount).filter((n) => n != null && Number.isFinite(n)))),
      sampleSmall: g.length < MIN_DESCRIPTIVE,
    };
  });
}

/** Spearman: permanência × preditores numéricos (não-cancelados = tempo até hoje; cancelados só com data). */
export function analyzeTenureCorrelations(clients) {
  const pool = (clients || []).filter((c) => c.stayDays != null && Number.isFinite(c.stayDays) && c.stayDays >= 0);
  const eventCount = pool.filter((c) => c.isCancelled && c.hasConfirmedDate).length;
  const censoredCount = pool.length - eventCount;
  const stayVals = pool.map((c) => c.stayDays);
  const stayMedian = median(stayVals);
  const highStay = pool.filter((c) => c.stayDays >= stayMedian);
  const lowStay = pool.filter((c) => c.stayDays < stayMedian);
  const rows = [];

  const INTERPRET = {
    meetingCount: {
      positive: "Clientes que permanecem por mais tempo acumulam mais reuniões ao longo da jornada.",
      negative: "Neste recorte, maior permanência aparece com menos reuniões totais — auditar cobertura e janela de observação.",
    },
    meetingsPerMonth: {
      positive: "Clientes com maior permanência apresentam maior frequência mensal de reuniões.",
      negative: "Clientes mais antigos apresentam menor frequência mensal de reuniões, mesmo que acumulem mais reuniões no total.",
    },
    daysSinceLastMeeting: {
      positive: "Clientes com maior permanência tendem a estar há mais dias sem reunião.",
      negative: "Clientes com maior permanência tendem a apresentar menor distância desde a última reunião, indicando contato mais recente.",
    },
    daysToFirstMeeting: {
      positive: "Clientes com maior permanência tiveram, em mediana, mais dias até a primeira reunião.",
      negative: "Clientes com maior permanência chegaram à primeira reunião mais cedo.",
    },
    averageIntervalDays: {
      positive: "Maior permanência aparece com intervalos médios maiores entre reuniões.",
      negative: "Maior permanência aparece com intervalos médios menores entre reuniões.",
    },
  };

  for (const def of NUMERIC_VARS) {
    if (def.field === "stayDays" || def.id === "stayDays") continue;
    const xs = [];
    const ys = [];
    for (const c of pool) {
      const v = c[def.field];
      if (v == null || !Number.isFinite(Number(v))) continue;
      if (def.requireNpsPredictive && !c.npsPredictiveOk) continue;
      xs.push(c.stayDays);
      ys.push(Number(v));
    }
    const sp = spearman(xs, ys);
    const absRho = sp.rho == null ? null : Math.abs(sp.rho);
    const nearPerfect = absRho != null && absRho >= 0.95;
    const derivedRisk = nearPerfect && /cycle|renova|stay|perman|tenure/i.test(`${def.id} ${def.label}`);

    const valsHigh = highStay.map((c) => numOrNull(c[def.field])).filter((v) => v != null);
    const valsLow = lowStay.map((c) => numOrNull(c[def.field])).filter((v) => v != null);
    let stdDiff = null;
    if (valsHigh.length >= 10 && valsLow.length >= 10) {
      stdDiff = standardizedDifference(median(valsHigh), median(valsLow), pooledSd(valsHigh, valsLow));
    }
    const interp = INTERPRET[def.id];
    let interpretation = null;
    if (sp.rho != null && interp) {
      interpretation = sp.rho >= 0 ? interp.positive : interp.negative;
    } else if (sp.rho != null) {
      interpretation = sp.rho >= 0
        ? `Correlação positiva: o indicador tende a crescer junto com a permanência.`
        : `Correlação negativa: o indicador tende a diminuir enquanto a permanência aumenta.`;
    }

    rows.push({
      id: def.id,
      label: def.label,
      rho: sp.rho,
      association: sp.rho,
      n: sp.n,
      warning: sp.warning || (nearPerfect ? "near_perfect_correlation" : null),
      auditNote: nearPerfect
        ? (derivedRisk
          ? "Correlação muito alta — verificar se a variável deriva da permanência ou do ciclo (possível leakage)."
          : "Correlação muito alta — revisar outliers e definição da variável antes de tratar como descoberta.")
        : null,
      interpretation,
      stdDiff,
      stdDiffGroups: "Alta permanência (≥ mediana) vs baixa permanência (< mediana)",
      medianHighStay: valsHigh.length ? median(valsHigh) : null,
      medianLowStay: valsLow.length ? median(valsLow) : null,
      nHighStay: valsHigh.length,
      nLowStay: valsLow.length,
      stayMedian,
      strength: associationStrength(sp.rho, "r"),
      eventCount,
      censoredCount,
      censored: true,
      stayPoolN: stayVals.length,
      stayMin: stayVals.length ? Math.min(...stayVals) : null,
      stayMax: stayVals.length ? Math.max(...stayVals) : null,
      yMin: ys.length ? Math.min(...ys) : null,
      yMax: ys.length ? Math.max(...ys) : null,
      yZeros: ys.filter((v) => v === 0).length,
      note: "Permanência: cancelados com data = cancel−contratação; ativos = hoje−contratação (SP). Spearman descritivo.",
      coverage: coveragePct(xs.length, pool.length),
      coveragePercent: coveragePct(xs.length, pool.length),
      eligiblePopulation: pool.length,
      missing: Math.max(0, pool.length - xs.length),
      pValue: sp.pValue ?? null,
    });
  }
  rows.sort((a, b) => Math.abs(b.rho || 0) - Math.abs(a.rho || 0));
  return rows;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Buckets de permanência. */
export function buildTenureBuckets(clients) {
  const defs = [
    { id: "le90", label: "≤ 90 dias", min: 0, max: 90 },
    { id: "91_180", label: "91–180 dias", min: 91, max: 180 },
    { id: "181_365", label: "181–365 dias", min: 181, max: 365 },
    { id: "366_730", label: "366–730 dias", min: 366, max: 730 },
    { id: "gt730", label: "> 730 dias", min: 731, max: Infinity },
  ];
  return defs.map((b) => {
    const g = (clients || []).filter((c) => {
      const d = c.stayDays;
      return d != null && Number.isFinite(d) && d >= b.min && d <= b.max;
    });
    const cancelled = g.filter((c) => c.isCancelled).length;
    const renewed = g.filter((c) => c.hasRenewed).length;
    const withMeeting = g.filter((c) => c.hasMeeting).length;
    const npsScores = g
      .filter((c) => c.hasNps && c.npsScore != null && Number.isFinite(c.npsScore))
      .map((c) => c.npsScore);
    return {
      id: b.id,
      label: b.label,
      n: g.length,
      cancelled,
      cancelledPct: pct(cancelled, g.length),
      renewed,
      renewedPct: pct(renewed, g.length),
      meanNps: round3(mean(npsScores)),
      hasMeetingPct: pct(withMeeting, g.length),
    };
  });
}

/** Correlações NPS (score) × variáveis numéricas — só npsPredictiveOk. */
export function buildNpsCorrelations(clients) {
  const pool = (clients || []).filter((c) => c.npsPredictiveOk && c.hasNps && c.npsScore != null);
  const rows = [];
  for (const def of NUMERIC_VARS) {
    if (def.field === "npsScore" || def.id === "npsScore") continue;
    const xs = [];
    const ys = [];
    for (const c of pool) {
      const v = c[def.field];
      if (v == null || !Number.isFinite(Number(v))) continue;
      xs.push(c.npsScore);
      ys.push(Number(v));
    }
    const sp = spearman(xs, ys);
    rows.push({
      id: def.id,
      label: def.label,
      rho: sp.rho,
      n: sp.n,
      warning: sp.warning,
      strength: associationStrength(sp.rho, "r"),
      coverage: coveragePct(xs.length, pool.length),
    });
  }
  rows.sort((a, b) => Math.abs(b.rho || 0) - Math.abs(a.rho || 0));
  return rows;
}

/**
 * Junta NPS mais recente em TODOS os clientes da população.
 * npsPredictiveOk = false quando resposta é posterior à data de cancelamento.
 */
export function joinLatestNpsOntoClients(clients, npsRows) {
  const latest = latestNpsByClient(npsRows);
  const byClient = new Map(latest.map((r) => [String(r.clientId), r]));
  let excludedPostCancel = 0;
  let joined = 0;
  for (const c of clients || []) {
    const nps = byClient.get(String(c.clientId));
    if (!nps) {
      c.npsScore = null;
      c.npsClass = null;
      c.npsSubmittedAt = null;
      c.hasNps = false;
      c.npsPredictiveOk = false;
      continue;
    }
    joined += 1;
    const cancelAt = parseDate(c.cancellationDate);
    const submitted = parseDate(nps.submittedAt);
    let predictiveOk = true;
    if (c.isCancelled && cancelAt && submitted && submitted > cancelAt) {
      predictiveOk = false;
      excludedPostCancel += 1;
    }
    c.npsScore = nps.score;
    c.npsClass = classifyNpsScore(nps.score);
    c.npsSubmittedAt = nps.submittedAt;
    c.hasNps = true;
    c.npsPredictiveOk = predictiveOk;
  }
  return { joined, excludedPostCancel, uniqueNpsClients: latest.length };
}

async function fetchNpsResponsesForCrosses() {
  const pageSize = 1000;
  let offset = 0;
  const rows = [];
  const key = process.env.DATA_SUPABASE_SERVICE_ROLE_KEY;
  const base = process.env.DATA_SUPABASE_URL;
  while (true) {
    const url = new URL("/rest/v1/nps_responses", base);
    url.searchParams.set("select", "id,client_id,score,submitted_at,created_at,tipo_de_forms");
    url.searchParams.set("order", "submitted_at.desc,created_at.desc");
    const response = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": "public",
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) throw new Error(`nps_responses: HTTP ${response.status}`);
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (offset > 200000) break;
  }
  return rows;
}

/**
 * NPS cruzamentos — exclui respostas após cancelamento para análises preditivas.
 * Espera clientes já enriquecidos por joinLatestNpsOntoClients (ou faz join se npsRows passado).
 */
export function buildNpsAnalysis(clients, npsRows, { minSample = MIN_GROUP } = {}) {
  let working = clients || [];
  let excludedPostCancel = 0;
  if (npsRows) {
    const joinMeta = joinLatestNpsOntoClients(working, npsRows);
    excludedPostCancel = joinMeta.excludedPostCancel;
  } else {
    excludedPostCancel = working.filter((c) => c.hasNps && !c.npsPredictiveOk).length;
  }

  const enriched = working.filter((c) => c.hasNps);
  const predictive = enriched.filter((c) => c.npsPredictiveOk);
  const scoresPred = predictive.map((c) => c.npsScore);
  const labelsPred = predictive.map((c) => (c.isCancelled ? 1 : 0));
  const pb = pointBiserial(scoresPred, labelsPred);
  const auc = scoresPred.length >= MIN_AUC
    ? logisticUnivariateAuc(scoresPred, labelsPred)
    : { auc: null, adjustedAuc: null, note: "amostra insuficiente" };

  const activeScores = predictive.filter((c) => c.isActive).map((c) => c.npsScore);
  const cancelledScores = predictive.filter((c) => c.isCancelled).map((c) => c.npsScore);
  const mw = mannWhitney(activeScores, cancelledScores);

  const classComparison = buildNpsGroupsComparison(predictive);

  const promo = predictive.filter((c) => c.npsClass === "promoter");
  const detr = predictive.filter((c) => c.npsClass === "detractor");
  const table = [
    [promo.filter((c) => !c.isCancelled).length, promo.filter((c) => c.isCancelled).length],
    [detr.filter((c) => !c.isCancelled).length, detr.filter((c) => c.isCancelled).length],
  ];
  const fisher = fisherExact2x2(table[0][0], table[0][1], table[1][0], table[1][1]);
  const chi = chiSquareIndependence(table);

  const breakdown = computeNpsBreakdown(predictive.map((c) => c.npsScore));
  const coverage = coveragePct(predictive.length, (clients || []).length);

  const stayVals = predictive.map((c) => c.stayDays).filter((n) => n != null && Number.isFinite(n));
  const stayMedian = median(stayVals);
  let stayPb = null;
  if (stayVals.length >= minSample && stayMedian != null) {
    const xs = [];
    const ys = [];
    for (const c of predictive) {
      if (c.stayDays == null || !Number.isFinite(c.stayDays)) continue;
      xs.push(c.npsScore);
      ys.push(c.stayDays >= stayMedian ? 1 : 0);
    }
    const r = pointBiserial(xs, ys);
    stayPb = r.r != null ? round3(r.r) : null;
  }

  return {
    available: predictive.length > 0 || enriched.length > 0,
    source: "BASE QV · nps_responses",
    definition: "NPS = % Promotores (9–10) − % Detratores (0–6); não usar média da nota como NPS",
    attribution: "EP atualmente vinculado ao cliente (quando agregado por EP)",
    responsesJoined: enriched.length,
    responsesPredictive: predictive.length,
    excludedPostCancel,
    missingClient: 0,
    portfolioCoverage: coverage,
    insufficientCoverage: (coverage || 0) < NPS_MIN_COVERAGE_PCT,
    overall: breakdown,
    churnAssociation: {
      pointBiserial: pb.r != null ? round3(pb.r) : null,
      strength: associationStrength(Math.abs(pb.r || 0), "r"),
      mannWhitney: {
        medianActive: median(activeScores),
        medianCancelled: median(cancelledScores),
        p: mw.pValue != null ? round4(mw.pValue) : null,
        rankBiserial: mw.rankBiserial != null ? round3(mw.rankBiserial) : null,
      },
      auc: auc.auc ?? null,
      nActive: activeScores.length,
      nCancelled: cancelledScores.length,
      sampleSmall: activeScores.length < minSample || cancelledScores.length < Math.min(minSample, MIN_CHURN_EVENTS),
      note: "Respostas após cancelamento excluídas desta associação preditiva.",
    },
    classComparison,
    promotersVsDetractors: {
      contingency: table,
      fisherP: fisher.pValue != null ? round4(fisher.pValue) : null,
      cramersV: chi.cramersV != null ? round3(chi.cramersV) : null,
      strength: associationStrength(chi.cramersV || 0, "cramers_v"),
    },
    stayAssociation: {
      pointBiserial: stayPb,
    },
    meetingsNote: "Associação NPS×reuniões é descritiva; temporalidade da resposta vs reunião não garantida.",
    warnings: [
      excludedPostCancel
        ? `${excludedPostCancel} resposta(s) NPS após cancelamento excluída(s) da análise preditiva.`
        : null,
      (coverage || 0) < NPS_MIN_COVERAGE_PCT
        ? `Cobertura NPS ${coverage}% abaixo de ${NPS_MIN_COVERAGE_PCT}%.`
        : null,
      cancelledScores.length < MIN_CHURN_EVENTS
        ? "Poucos cancelamentos com NPS prévio — baixa potência."
        : null,
    ].filter(Boolean),
  };
}

function parseMatrixVars(raw) {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  return String(raw)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function buildRiskRulesPreview(clients) {
  const pool = (clients || []).filter((c) => typeof c.isCancelled === "boolean");
  const cancelled = pool.filter((c) => c.isCancelled).length;
  const baseline = pool.length ? cancelled / pool.length : 0;
  const signals = [
    { label: "Sem reunião", test: (c) => Number(c.meetingCount || 0) === 0 },
    { label: "Sem mecanismo registrado", test: (c) => Number(c.mechanismCount || 0) === 0 },
    { label: "Sem implementação registrada", test: (c) => Number(c.implementedMechanismCount || 0) === 0 },
    { label: "Sem diagnóstico financeiro", test: (c) => !c.hasFinancialData },
    { label: "Ciclo 1", test: (c) => Number(c.currentCycle) === 1 },
    { label: "NPS detrator", test: (c) => c.npsClass === "detractor" },
  ];
  const combos = [];
  for (let i = 0; i < signals.length; i += 1) {
    for (let j = i + 1; j < signals.length; j += 1) {
      combos.push([signals[i], signals[j]]);
    }
  }
  return combos
    .map((parts) => {
      const selected = pool.filter((c) => parts.every((p) => p.test(c)));
      const positives = selected.filter((c) => c.isCancelled).length;
      const rate = selected.length ? positives / selected.length : 0;
      return {
        label: parts.map((p) => p.label).join(" + "),
        clients: selected.length,
        cancelled: positives,
        ratePct: round3(rate * 100),
        lift: baseline ? round4(rate / baseline) : null,
        caveat: "Padrão exploratório.",
      };
    })
    .filter((r) => r.clients >= 30 && r.lift > 1)
    .sort((a, b) => b.lift - a.lift || b.clients - a.clients)
    .slice(0, 8);
}

function parseFiltersFromRequest(request) {
  try {
    const url = new URL(request.url);
    const get = (k) => url.searchParams.get(k);
    const cohortGranularity = (get("cohortGranularity") || "month").toLowerCase();
    return {
      status: get("status") || "active_cancelled",
      segment: get("segment") || "all",
      engineer: get("engineer") || "all",
      advisor: get("advisor") || "all",
      hasFinancial: get("hasFinancial") || "all",
      hasMeeting: get("hasMeeting") || "all",
      hasMechanism: get("hasMechanism") || "all",
      hasNps: get("hasNps") || "all",
      renewed: get("renewed") || "all",
      currentCycle: get("currentCycle") || "all",
      npsClass: get("npsClass") || "all",
      incomeBand: get("incomeBand") || "all",
      liquidityBand: get("liquidityBand") || "all",
      stayBand: get("stayBand") || "all",
      hireFrom: get("hireFrom") || null,
      hireTo: get("hireTo") || null,
      cancelFrom: get("cancelFrom") || null,
      cancelTo: get("cancelTo") || null,
      minSample: Number(get("minSample") || MIN_GROUP) || MIN_GROUP,
      minCoverage: get("minCoverage") != null ? Number(get("minCoverage")) : null,
      includeFrozenSeparate: get("includeFrozenSeparate") === "1",
      correlationMethod: "spearman",
      matrixVars: parseMatrixVars(get("matrixVars")),
      cohortGranularity: cohortGranularity === "quarter" ? "quarter" : "month",
      cohortPeriod: (get("cohortPeriod") || "since_2025_01").toLowerCase(),
      cohortHireFrom: get("cohortHireFrom") || null,
      cohortHireTo: get("cohortHireTo") || null,
      programs: (get("programs") || "").split(",").map((value) => value.trim()).filter(Boolean),
    };
  } catch {
    return { status: "active_cancelled", minSample: MIN_GROUP };
  }
}

export async function computeStatisticalCrossesPayload(options = {}) {
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }

  const filters = options.filters || {};
  const now = new Date();
  const [general, meetings, mechanisms, npsRows] = await Promise.all([
    computeGeneralDataPayload(),
    computeMeetingsPayload({ includeMeetingTypes: false }),
    computeMechanismsPayload(),
    fetchNpsResponsesForCrosses().catch((error) => {
      console.warn("[Statistical Crosses] NPS fetch failed:", error instanceof Error ? error.message : error);
      return [];
    }),
  ]);

  const built = buildAnalyticalPopulation(general, meetings, mechanisms, now);
  let clients = built.clients;

  // Join latest NPS onto ALL clients before filters that depend on NPS
  const npsJoin = joinLatestNpsOntoClients(clients, npsRows);

  // Universo do card de renovação (= dashboard Renovações): não aplicar o filtro
  // padrão active_cancelled. Congelados e “marcados sem confirmação” entram no card.
  const renewalStatus =
    !filters.status || filters.status === "active_cancelled" ? "all" : filters.status;
  const renewalUniverse = applyPopulationFilters(built.clients, {
    ...filters,
    status: renewalStatus,
  }, now);

  // Universo analítico (churn / sobrevivência / ativos vs cancelados)
  const includeFrozen = Boolean(filters.includeFrozenSeparate);
  if (!filters.status || filters.status === "active_cancelled") {
    clients = clients.filter((c) => c.isActive || c.isCancelled || (includeFrozen && c.isFrozen));
  }

  clients = applyPopulationFilters(clients, {
    ...filters,
    status: filters.status === "active_cancelled" ? "all" : filters.status,
  }, now);

  if (!filters.status || filters.status === "active_cancelled") {
    clients = clients.filter((c) => c.isActive || c.isCancelled || (includeFrozen && c.isFrozen));
  }

  const minCoverageFilter = filters.minCoverage != null && Number.isFinite(Number(filters.minCoverage))
    ? Number(filters.minCoverage)
    : null;

  const analysis = analyzePopulation(clients, {
    minSample: Number(filters.minSample) || MIN_GROUP,
    includeFrozenSeparate: includeFrozen,
    minCoverage: minCoverageFilter,
  });

  const renewalAssociations = analyzeRenewalAssociations(renewalUniverse, Number(filters.minSample) || MIN_GROUP);
  const renewedVsNotRenewed = compareRenewedVsNot(renewalUniverse, Number(filters.minSample) || MIN_GROUP);
  const npsGroups = buildNpsGroupsComparison(clients);
  const tenureCorrelations = analyzeTenureCorrelations(clients);
  const tenureBuckets = buildTenureBuckets(clients);
  const npsCorrelations = buildNpsCorrelations(clients);

  const warnings = [
    {
      code: "methodology",
      severity: "info",
      message:
        "Associações estatísticas descrevem coocorrência no recorte; amostras pequenas e dados ausentes afetam a estabilidade.",
    },
    ...built.warnings.map((w) => ({ ...w, severity: "warning" })),
  ];
  if ((analysis.population.cancelled || 0) < MIN_GROUP || (analysis.population.active || 0) < MIN_GROUP) {
    warnings.push({
      code: "small_comparison_groups",
      severity: "warning",
      message: "Grupos ativos/cancelados abaixo da amostra mínima recomendada — resultados instáveis.",
    });
  }
  const highMissing = analysis.quality.filter((q) => (q.missingPercent || 0) >= 40);
  if (highMissing.length) {
    warnings.push({
      code: "high_missing_vars",
      severity: "warning",
      message: `${highMissing.length} variável(eis) com ≥40% de ausência.`,
      count: highMissing.length,
    });
  }

  const cancelled = analysis.population?.cancelled || 0;
  const cancelledWithDate = analysis.population?.cancelledWithDate || 0;
  const cancelledWithoutDate = analysis.population?.cancelledWithoutDate || 0;
  const censored = (analysis.population?.active || 0) + (analysis.population?.frozen || 0);
  const renewedClients = renewalUniverse.filter((c) => c.hasRenewed).length;
  const cycle1Clients = renewalUniverse.filter((c) => c.currentCycle === 1).length;
  const totalRenewals = renewalUniverse.reduce((a, c) => a + (c.renewalCount || 0), 0);
  const validNpsResponses = clients.filter((c) => c.npsPredictiveOk).length;
  const evaluatedVars = analysis.associations?.length || 0;
  const coverages = (analysis.quality || [])
    .map((q) => (q.coveragePercent != null ? q.coveragePercent : (100 - (q.missingPercent || 0))))
    .filter((n) => Number.isFinite(n));
  const averageCoverage = coverages.length
    ? Math.round((coverages.reduce((a, b) => a + b, 0) / coverages.length) * 10) / 10
    : null;

  // Auditoria: renovados no universo do card vs excluídos pelo recorte ativo/cancelado
  const statsRenewedIds = new Set(clients.filter((c) => c.hasRenewed).map((c) => String(c.clientId)));
  const renewalExcludedFromStats = renewalUniverse
    .filter((c) => c.hasRenewed && !statsRenewedIds.has(String(c.clientId)))
    .map((c) => ({
      clientId: c.clientId,
      clientCode: c.clientCode,
      clientName: c.clientName,
      currentCycle: c.currentCycle,
      analyticalStatus: c.analyticalStatus || c.status,
      reason: c.isFrozen
        ? "Congelado (fora do filtro padrão ativos+cancelados)"
        : "Status fora de ativos/cancelados efetivados (ex.: marcado sem confirmação)",
    }));
  const exclusionReasons = {};
  for (const row of renewalExcludedFromStats) {
    const key = row.reason;
    exclusionReasons[key] = (exclusionReasons[key] || 0) + 1;
  }

  if (cancelled < 30) {
    warnings.push({
      code: "low_confirmed_cancellations",
      severity: "warning",
      message:
        "A análise utiliza somente cancelamentos confirmados por churn efetivado ou distrato assinado. Resultados podem ter baixa potência estatística devido ao número reduzido de eventos.",
      count: cancelled,
    });
  }

  // Already joined — pass null to avoid double-join
  const npsAnalysis = buildNpsAnalysis(clients, null, {
    minSample: Number(filters.minSample) || MIN_GROUP,
  });
  if (npsJoin.excludedPostCancel) {
    warnings.push({
      code: "nps_post_cancel",
      severity: "info",
      message: `${npsJoin.excludedPostCancel} NPS pós-cancelamento marcado(s) como não preditivo(s).`,
      count: npsJoin.excludedPostCancel,
    });
  }
  if (npsAnalysis.warnings?.length) {
    for (const msg of npsAnalysis.warnings) {
      warnings.push({ code: "nps_caveat", severity: "warning", message: msg });
    }
  }

  const metricAvailability = [
    {
      id: "churn_association",
      label: "Associação com churn",
      status: "available",
      available: true,
      source: "BASE QV",
      coverage: averageCoverage,
      reason: "Cancelamento analítico oficial (isEffectiveCancelledStatus / isConfirmedCancelledStatus).",
    },
    {
      id: "active_vs_cancelled",
      label: "Ativos versus cancelados",
      status: cancelled < MIN_CHURN_EVENTS ? "partial" : "available",
      available: true,
      source: "BASE QV",
      reason: cancelled < MIN_CHURN_EVENTS ? "Baixa potência — poucos eventos confirmados." : "Comparação analítica oficial.",
    },
    {
      id: "predictive_qv",
      label: "Poder preditivo BASE QV",
      status: "available",
      available: true,
      source: "BASE QV",
      reason: "AUC univariada com alvo = cancelamento confirmado.",
    },
    {
      id: "predictive_pharus",
      label: "Poder preditivo App Pharus",
      status: "unavailable",
      available: false,
      source: "App Pharus",
      reason: "Sem variável-alvo de churn própria.",
    },
    {
      id: "nps",
      label: "Associação com NPS",
      status: npsAnalysis.available ? (npsAnalysis.insufficientCoverage ? "partial" : "available") : "unavailable",
      available: Boolean(npsAnalysis.available),
      source: "BASE QV · nps_responses",
      coverage: npsAnalysis.portfolioCoverage,
      reason: npsAnalysis.available
        ? "NPS 0–10; respostas pós-cancelamento excluídas do cruzamento preditivo."
        : "Sem respostas NPS no recorte.",
    },
    {
      id: "renewal",
      label: "Associação com renovação",
      status: renewalAssociations.eligible > 0 ? "available" : "unavailable",
      available: renewalAssociations.eligible > 0,
      source: "BASE QV · clients.ciclo",
      reason: "Renovação: currentCycle > 1; renewalCount = max(ciclo−1, 0).",
    },
    {
      id: "stay_qv",
      label: "Permanência contratual — BASE QV",
      status: "available",
      available: true,
      source: "BASE QV",
      reason: "Tempo desde contratação até cancelamento ou censura.",
    },
    {
      id: "usage_pharus",
      label: "Tempo de uso da plataforma — App Pharus",
      status: "unavailable",
      available: false,
      source: "App Pharus",
      reason: "Não confundir com permanência contratual; seção não liberada sem definição clara nesta fase.",
    },
    {
      id: "survival_qv",
      label: "Curva de sobrevivência — BASE QV",
      status: "available",
      available: true,
      source: "BASE QV",
      reason: "Kaplan–Meier; evento = cancelamento confirmado.",
    },
    {
      id: "survival_pharus",
      label: "Sobrevivência App Pharus",
      status: "unavailable",
      available: false,
      source: "App Pharus",
      reason: "Sem evento de abandono; não usar último acesso.",
    },
  ];

  const cutoffDate = civilDateInSaoPaulo(now);
  const observationStart = clients.reduce((min, c) => {
    const day = calendarDateFromValue(c.acquisitionDate || c.hireDate || c.contractDate);
    if (!day) return min;
    return !min || day < min ? day : min;
  }, null);
  const observationEnd = cutoffDate;

  const univariatePredictivePower = analysis.univariatePredictivePower || analysis.predictivePower || [];
  const predictivePowerLegacy = univariatePredictivePower.filter((p) => p.auc != null);

  const matrixVars = parseMatrixVars(filters.matrixVars);
  const correlationMatrix = buildCorrelationMatrix(clients, {
    method: "spearman",
    variableIds: matrixVars || undefined,
  });

  const cohortGranularity =
    String(filters.cohortGranularity || "month").toLowerCase() === "quarter" ? "quarter" : "month";
  const cohortPeriod = String(filters.cohortPeriod || "since_2025_01").toLowerCase();
  let cohortHireFrom = null;
  if (cohortPeriod === "since_2025_01") cohortHireFrom = "2025-01-01";
  else if (cohortPeriod === "since_2026_01") cohortHireFrom = "2026-01-01";
  else if (cohortPeriod === "last_12_months") {
    const [y, m] = cutoffDate.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, 1));
    dt.setUTCMonth(dt.getUTCMonth() - 11);
    cohortHireFrom = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-01`;
  } else if (filters.cohortHireFrom) {
    cohortHireFrom = String(filters.cohortHireFrom).slice(0, 10);
  }
  const cohort = buildCohortRetention(clients, {
    granularity: cohortGranularity,
    cutoffDate: cutoffDate,
    hireFrom: cohortHireFrom,
    hireTo: filters.cohortHireTo ? String(filters.cohortHireTo).slice(0, 10) : null,
  });
  cohort.periodMode = cohortPeriod;

  const { discoveries, report } = buildStatisticalDiscoveries({
    activeVsCancelled: analysis.activeVsCancelled || analysis.comparisons?.filter((r) => r.type === "numeric") || [],
    churnAssociations: analysis.churnAssociations || {
      numeric: (analysis.associations || []).filter((a) => a.type === "numeric"),
      categorical: (analysis.associations || []).filter((a) => a.type === "categorical"),
    },
    renewalAssociations,
    npsGroups,
    survival: analysis.survival,
    cohort,
    summary: {
      analyzedClients: analysis.population?.total || clients.length,
      activeClients: analysis.population?.active || 0,
      confirmedCancellations: cancelled,
      averageCoverage,
      renewedClients,
    },
    correlationMatrix,
    tenureCorrelations,
  });

  const churnAssocsForAxis = analysis.churnAssociations || {
    numeric: (analysis.associations || []).filter((a) => a.type === "numeric"),
    categorical: (analysis.associations || []).filter((a) => a.type === "categorical"),
  };
  const axisMatrices = buildAxisMatricesBundle({
    clients,
    churnAssociations: churnAssocsForAxis,
    associations: analysis.associations || [],
    univariatePredictivePower,
    activeVsCancelled: analysis.activeVsCancelled || analysis.comparisons?.filter((r) => r.type === "numeric") || [],
    renewalAssociations,
    renewedVsNotRenewed,
  });
  const exploratory = buildExploratoryBundle({
    clients,
    associations: analysis.associations || [],
    univariatePredictivePower,
    npsCorrelations,
    renewalAssociations,
  });

  // Prévia de regras de risco (mesma lógica da UI) para insights/PDF
  const riskRulesPreview = buildRiskRulesPreview(clients);
  const clientInsights = buildClientInsightsBundle({
    clients,
    associations: analysis.associations || [],
    activeVsCancelled: analysis.activeVsCancelled || [],
    npsGroups,
    renewedVsNotRenewed,
    survival: analysis.survival,
    summary: {
      analyzedClients: analysis.population?.total || clients.length,
      validNpsResponses,
      npsPortfolioCoverage: npsAnalysis.portfolioCoverage ?? null,
    },
    highPerformance: exploratory.highPerformance,
    riskRulesPreview,
  });
  // Preferir insights didáticos na seção "Principais descobertas"
  const discoveriesSimple = (clientInsights.simpleInsights || []).map((d, i) => ({
    id: d.id || `insight_${i}`,
    title: d.title,
    text: d.text,
    category: d.category,
    primaryValue: d.primaryValue,
    sample: d.sample,
    coverage: d.coverage,
    strength: d.strength,
    caveat: d.caveat,
    technical: d.technical,
    lowConfidence: !!d.lowConfidence,
    section: d.category || "geral",
    priority: 100 - i,
  }));
  if (discoveriesSimple.length) {
    discoveries.length = 0;
    discoveries.push(...discoveriesSimple.slice(0, 10));
  } else {
    while (discoveries.length > 10) discoveries.pop();
  }

  return {
    generatedAt: now.toISOString(),
    source: "BASE QV (general-data + meetings + mechanisms + nps_responses)",
    phase: 1,
    pending: PENDING,
    filters,
    summary: {
      analyzedClients: analysis.population?.total || clients.length,
      activeClients: analysis.population?.active || 0,
      confirmedCancellations: cancelled,
      cancelledWithDate,
      cancelledWithoutDate,
      renewedClients,
      cycle1Clients,
      totalRenewals,
      validNpsResponses,
      censoredClients: censored,
      evaluatedVariables: evaluatedVars,
      averageCoverage,
      observationPeriod: {
        from: observationStart,
        to: observationEnd,
        timezone: PORTAL_TZ,
      },
      cutoffDate,
      timezone: PORTAL_TZ,
      topAssociationLabel: analysis.associations?.[0]?.label || null,
      topAssociationAbs: analysis.associations?.[0]?.absMeasure ?? analysis.associations?.[0]?.abs ?? null,
      topAssociationStrength: analysis.associations?.[0]?.strength || null,
      topAssociationMeasure: analysis.associations?.[0]?.measure || null,
      npsResponses: npsAnalysis.responsesPredictive || 0,
      npsIndex: npsAnalysis.overall?.nps ?? null,
      npsPortfolioCoverage: npsAnalysis.portfolioCoverage ?? null,
    },
    population: {
      ...analysis.population,
      renewalUniverse: renewalUniverse.length,
      renewedInCard: renewedClients,
      renewedInStatsRecorte: clients.filter((c) => c.hasRenewed).length,
    },
    sampleMeta: {
      churnComparison: {
        eligibleClients: clients.length,
        validClients: (analysis.population?.active || 0) + (analysis.population?.cancelled || 0),
        excludedClients: Math.max(0, built.clients.length - clients.length),
        coverage: clients.length ? round3((clients.length / Math.max(built.clients.length, 1)) * 100) : null,
      },
      renewalCard: {
        eligibleClients: renewalUniverse.length,
        validClients: renewedClients + cycle1Clients,
        excludedClients: Math.max(0, built.clients.length - renewalUniverse.length),
        coverage: renewalUniverse.length
          ? round3(((renewedClients + cycle1Clients) / Math.max(renewalUniverse.length, 1)) * 100)
          : null,
        renewedClients,
        cycle1Clients,
        totalRenewals,
      },
      renewalAnalysis: {
        eligibleClients: renewalAssociations.eligible,
        renewed: renewalAssociations.renewed,
        notRenewed: renewalAssociations.notRenewed,
        excludedClients: Math.max(0, renewalUniverse.length - (renewalAssociations.eligible || 0)),
        coverage: renewalUniverse.length
          ? round3(((renewalAssociations.eligible || 0) / Math.max(renewalUniverse.length, 1)) * 100)
          : null,
      },
    },
    renewalParityAudit: {
      renewedInRenewalsUniverse: renewedClients,
      renewedInActiveCancelledRecorte: clients.filter((c) => c.hasRenewed).length,
      excludedCount: renewalExcludedFromStats.length,
      exclusionReasons,
      excludedClients: renewalExcludedFromStats,
      note: "Card de renovados usa o mesmo universo do dashboard Renovações (ciclo>1). O recorte ativo/cancelados exclui congelados e marcados sem confirmação das análises de churn.",
    },
    activeVsCancelled: analysis.activeVsCancelled || analysis.comparisons?.filter((r) => r.type === "numeric") || [],
    churnAssociations: analysis.churnAssociations || {
      numeric: (analysis.associations || []).filter((a) => a.type === "numeric"),
      categorical: (analysis.associations || []).filter((a) => a.type === "categorical"),
    },
    univariatePredictivePower,
    npsCorrelations,
    npsGroups,
    renewalAssociations: {
      numeric: renewalAssociations.numeric,
      categorical: renewalAssociations.categorical,
      eligible: renewalAssociations.eligible,
      renewed: renewalAssociations.renewed,
      notRenewed: renewalAssociations.notRenewed,
      sampleSmall: renewalAssociations.sampleSmall,
    },
    renewedVsNotRenewed,
    tenureCorrelations,
    tenureBuckets,
    survival: analysis.survival,
    correlationMatrix,
    axisMatrices,
    exploratory,
    predictiveModel: exploratory.predictive,
    discoveryRankings: exploratory.discoveryRankings,
    highPerformance: clientInsights.highPerformance || exploratory.highPerformance,
    groupComparative: exploratory.groupComparative,
    healthScoreCandidates: exploratory.healthScoreCandidates,
    simpleInsights: clientInsights.simpleInsights,
    activeRiskSignals: clientInsights.activeRiskSignals,
    topClients: clientInsights.topClients,
    npsComparative: clientInsights.npsComparative,
    challengeCohort: clientInsights.challengeCohort,
    riskRules: riskRulesPreview,
    cohort,
    discoveries,
    report,
    excludedVariables: analysis.excludedVariables,
    qualityWarnings: warnings,
    // LEGACY aliases for existing UI/chatbot:
    associations: analysis.associations,
    comparisons: analysis.comparisons,
    predictivePower: predictivePowerLegacy,
    npsAnalysis: npsAnalysis.available ? npsAnalysis : null,
    filterOptions: {
      segments: [...new Set(built.clients.map((c) => c.segment).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
      engineers: [...new Set(built.clients.map((c) => c.engineer).filter((e) => e && e !== "Não informado"))].sort((a, b) => a.localeCompare(b, "pt-BR")),
      advisors: [...new Set(built.clients.map((c) => c.advisor).filter((e) => e && e !== "Não informado"))].sort((a, b) => a.localeCompare(b, "pt-BR")),
      incomeBands: [...new Set(built.clients.map((c) => c.incomeBand).filter(Boolean))],
      liquidityBands: [...new Set(built.clients.map((c) => c.liquidityBand).filter(Boolean))],
      stayBands: [...new Set(built.clients.map((c) => c.stayBand).filter(Boolean))],
      npsClasses: ["promoter", "passive", "detractor"],
      cycles: [...new Set(built.clients.map((c) => c.currentCycle).filter((n) => n != null && Number.isFinite(n)))].sort((a, b) => a - b),
    },
    metadata: {
      source: "BASE QV",
      cancellationRule: "isEffectiveCancelledStatus / isConfirmedCancelledStatus (analytical-cancellation via general-data)",
      renewalRule: "currentCycle > 1 ⇒ renovado; renewalCount = max(ciclo−1, 0); ciclo ≥ 1 válido",
      renewalHelper: "netlify/functions/_shared/client-cycle-renewal.mjs",
      npsRule: "última resposta válida por cliente; preditivo exclui NPS após cancellationDate",
      cutoffDate,
      timezone: PORTAL_TZ,
      filtersApplied: filters,
      minSample: Number(filters.minSample) || MIN_GROUP,
      minCoverage: minCoverageFilter ?? 20,
      minDescriptive: MIN_DESCRIPTIVE,
      minInference: MIN_GROUP,
      population: analysis.population,
    },
    metricAvailability,
    groupDifferences: analysis.comparisons || [],
    numericAssociations: (analysis.associations || []).filter((a) => a.type === "numeric" || a.measure === "point-biserial" || a.measure === "point_biserial"),
    categoricalAssociations: (analysis.associations || []).filter((a) => a.type === "categorical" || a.measure === "cramers-v" || a.measure === "cramers_v"),
    univariateAuc: predictivePowerLegacy,
    segmentAnalysis: (analysis.comparisons || []).filter((c) => /segment/i.test(c.id || c.label || "")),
    meetingAnalysis: (analysis.comparisons || []).filter((c) => /meeting|reuniao|reunião|noshow|no-show|remarc/i.test(`${c.id} ${c.label}`)),
    financialUpdateAnalysis: (analysis.comparisons || []).filter((c) => /financ|diagnost|renda|aporte|liquidez|patrimon/i.test(`${c.id} ${c.label}`)),
    quality: analysis.quality,
    variables: [...NUMERIC_VARS, ...CATEGORICAL_VARS].map((v) => ({
      id: v.id,
      label: v.label,
      type: NUMERIC_VARS.includes(v) ? "numeric" : "categorical",
      source: v.source,
      predictiveEligible: Boolean(v.predictive),
    })),
    // Amostra leve para drawer / auditoria
    clients: clients.map((c) => ({
      clientId: c.clientId,
      clientName: c.clientName,
      clientCode: c.clientCode,
      statusAnalytic: c.statusAnalytic,
      analyticalStatus: c.analyticalStatus,
      isCancelled: c.isCancelled,
      isActive: c.isActive,
      segment: c.segment,
      engineer: c.engineer,
      advisor: c.advisor,
      program: c.program,
      davosContractSigned: c.davosContractSigned,
      currentCycle: c.currentCycle,
      renewalCount: c.renewalCount,
      hasRenewed: c.hasRenewed,
      stayDays: c.stayDays,
      stayDaysBase: c.stayDaysBase ?? c.stayDaysChronological ?? null,
      stayDaysChronological: c.stayDaysChronological ?? c.stayDaysBase ?? null,
      stayAdjusted: c.stayAdjusted === true,
      meetingCount: c.meetingCount,
      daysSinceLastMeeting: c.daysSinceLastMeeting,
      noShowCount: c.noShowCount,
      attendanceRate: c.attendanceRate,
      averageIntervalDays: c.averageIntervalDays,
      mechanismCount: c.mechanismCount,
      implementedMechanismCount: c.implementedMechanismCount,
      monthlyIncome: c.monthlyIncome,
      lastContribution: c.lastContribution,
      liquidityReserve: c.liquidityReserve,
      paidPropertiesValue: c.paidPropertiesValue,
      hasFinancialData: c.hasFinancialData,
      hasMeeting: c.hasMeeting,
      hasMechanism: c.hasMechanism,
      npsScore: c.npsScore,
      npsClass: c.npsClass,
      hasNps: c.hasNps,
      npsPredictiveOk: c.npsPredictiveOk,
      survivalTime: c.survivalTime,
      survivalEvent: c.survivalEvent,
      survivalValid: c.survivalValid,
    })),
    warnings,
    methodology: {
      churn: "analyticalStatus cancelado via isEffectiveCancelledStatus (mesma regra Dados Gerais)",
      comparison: "Ativos vs Cancelados; congelados fora da comparação principal por padrão",
      associationNumeric: "point-biserial",
      associationCategorical: "Cramér’s V (+ Fisher 2×2 quando aplicável)",
      comparisonTestNumeric: "Mann–Whitney U + rank-biserial",
      auc: "logística univariada + AUC com validação cruzada estratificada",
      renewal: "clients.ciclo; renovado se ciclo > 1; exclui renewalCount/currentCycle como explicativas de hasRenewed",
      tenure: "Spearman stayDays × preditores; não-cancelados censurados",
      leakage:
        "Permanência, motivo, offboarding e metadados de cancelamento excluídos do AUC. Encoding categórico multi-nível documentado quando usado.",
      survival: "Kaplan–Meier; evento=cancelamento; ativos/congelados censurados na data de geração",
      correlationMatrix: "Spearman (padrão) ou Pearson; pares completos; diagonal=1; n mínimo 20",
      cohortRetention: "Coorte = mês/trimestre de contratação; retenção por meses completos; idades futuras = null",
      discoveries: "Narrativas determinísticas (sem LLM) a partir de limiares de cobertura/amostra",
      associationStrengthBands: {
        r: "|r|<0.1 muito fraca; <0.3 fraca; <0.5 moderada; ≥0.5 forte",
        cramers_v: "V<0.1 muito fraca; <0.2 fraca; <0.3 moderada; ≥0.3 forte",
      },
      note: "Associações descrevem coocorrência no recorte analítico; não substituem desenho experimental.",
    },
  };
}

/** Parse filtros a partir de URLSearchParams (V2 dashboard). */
export function parseStatisticalCrossesFilters(searchParams) {
  try {
    const get = (k) => searchParams.get(k);
    const cohortGranularity = (get("cohortGranularity") || "month").toLowerCase();
    return {
      status: get("status") || "active_cancelled",
      segment: get("segment") || "all",
      engineer: get("engineer") || "all",
      advisor: get("advisor") || "all",
      hasFinancial: get("hasFinancial") || "all",
      hasMeeting: get("hasMeeting") || "all",
      hasMechanism: get("hasMechanism") || "all",
      hasNps: get("hasNps") || "all",
      renewed: get("renewed") || "all",
      currentCycle: get("currentCycle") || "all",
      npsClass: get("npsClass") || "all",
      incomeBand: get("incomeBand") || "all",
      liquidityBand: get("liquidityBand") || "all",
      stayBand: get("stayBand") || "all",
      hireFrom: get("hireFrom") || null,
      hireTo: get("hireTo") || null,
      cancelFrom: get("cancelFrom") || null,
      cancelTo: get("cancelTo") || null,
      minSample: Number(get("minSample") || MIN_GROUP) || MIN_GROUP,
      minCoverage: get("minCoverage") != null ? Number(get("minCoverage")) : null,
      includeFrozenSeparate: get("includeFrozenSeparate") === "1",
      correlationMethod: "spearman",
      matrixVars: parseMatrixVars(get("matrixVars")),
      cohortGranularity: cohortGranularity === "quarter" ? "quarter" : "month",
      cohortPeriod: (get("cohortPeriod") || "since_2025_01").toLowerCase(),
      cohortHireFrom: get("cohortHireFrom") || null,
      cohortHireTo: get("cohortHireTo") || null,
      programs: (get("programs") || "").split(",").map((value) => value.trim()).filter(Boolean),
      program: get("program") || "all",
    };
  } catch {
    return { status: "active_cancelled", minSample: MIN_GROUP };
  }
}

export function toPublicStatisticalCrossesPayload(payload) {
  return payload;
}
