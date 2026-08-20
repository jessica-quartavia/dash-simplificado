/**
 * Payload de Dados Gerais — BASE QV somente leitura.
 *
 * Status analítico e permanência vêm do kernel. Segmento segue a regra V1.
 * Aquisição histórica: ver buildAcquisitionsByMonth / general-metrics.
 */
import { dataConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  analyticalStatusDisplayLabel,
  buildAnalyticalCancellationMap,
  normalizeClientStatus,
  resolveAnalyticalStatusFromMaps,
} from "./analytical-cancellation.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import { resolveAnalyticalStayPeriod, stayRangeFromMonths } from "./client-tenure.mjs";
import { calculateClientSegment } from "./client-segment.mjs";
import {
  INCOME_BANDS,
  LIQUIDITY_BANDS,
  MEASURE_CONFIG,
  SEGMENT_LABELS,
  STATUS_LABELS,
  STAY_RANGES,
  buildAcquisitionsByMonth,
  distributionFrom,
  summarizeGeneralRows,
} from "./general-metrics.mjs";

const CLIENT_SELECT =
  "id,codigo,name,data_inicio_ciclo,data_fim_ciclo,created_at,status,segmentacao,engenheiro_patrimonial,data_churn,ciclo,programa,valor_total_pago,contrato_assinado,davos_contrato_assinado";
const FINANCIAL_SELECT =
  "id,client_id,reserva_liquidez,ultimo_aporte,ultima_renda_mensal,valor_imoveis_quitados,possui_imovel,possui_carro,possui_consorcio,cheque_especial,parcelamento_cartao,credito_pessoal,credito_consignado,updated_at";

const INSUFFICIENT_STAY_RANGE = "Sem dados suficientes";

const USED_FIELDS = [
  { table: "clients", column: "id", role: "clientId" },
  { table: "clients", column: "codigo", role: "clientCode" },
  { table: "clients", column: "name", role: "clientName" },
  { table: "clients", column: "data_inicio_ciclo", role: "contractDateCycleStart" },
  { table: "clients", column: "data_fim_ciclo", role: "cycleEndDate" },
  { table: "clients", column: "created_at", role: "acquisitionFallbackCreated" },
  { table: "clients", column: "ciclo", role: "currentCycle" },
  { table: "clients", column: "valor_total_pago", role: "totalPaidValue" },
  { table: "clients", column: "contrato_assinado", role: "contractSignedFlag" },
  { table: "clients", column: "davos_contrato_assinado", role: "davosContractSignedFlag" },
  { table: "clients", column: "status", role: "rawStatus" },
  { table: "clients", column: "segmentacao", role: "segment" },
  { table: "clients", column: "engenheiro_patrimonial", role: "engineer" },
  { table: "clients", column: "data_churn", role: "cancellationDatePriority3" },
  { table: "cancellations", column: "client_id", role: "cancellationJoin" },
  { table: "cancellations", column: "churn_efetivado_at", role: "cancellationDatePriority1" },
  { table: "cancellations", column: "distrato_assinado_at", role: "cancellationDatePriority2" },
  { table: "cancellations", column: "archived_at", role: "cancellationSoftDelete" },
  { table: "vw_info_cliente", column: "id_cliente", role: "acquisitionJoin" },
  { table: "vw_info_cliente", column: "data_assinatura_contrato", role: "acquisitionDatePrimary" },
  { table: "client_financial_data", column: "client_id", role: "financialJoin" },
  { table: "client_financial_data", column: "reserva_liquidez", role: "liquidityReserve" },
  { table: "client_financial_data", column: "ultimo_aporte", role: "lastContribution" },
  { table: "client_financial_data", column: "ultima_renda_mensal", role: "monthlyIncome" },
];

function blankToNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

function toNumber(value) {
  const raw = blankToNull(value);
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toBool(value) {
  const raw = blankToNull(value);
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw).trim().toLowerCase();
  if (["true", "t", "1", "sim", "yes", "y"].includes(s)) return true;
  if (["false", "f", "0", "nao", "não", "no", "n"].includes(s)) return false;
  return null;
}

function parseDate(value) {
  const raw = blankToNull(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
    const [y, m, d] = String(raw).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapStayRange(range) {
  return range === "Dados insuficientes" ? INSUFFICIENT_STAY_RANGE : range;
}

function incomeBand(value) {
  if (value == null) return "Não informado";
  if (value <= 5000) return "Até R$ 5 mil";
  if (value <= 10000) return "5 a 10 mil";
  if (value <= 20000) return "10 a 20 mil";
  if (value <= 50000) return "20 a 50 mil";
  return "Acima de 50 mil";
}

function liquidityBand(value) {
  if (value == null) return "Não informado";
  if (value <= 50000) return "Até R$ 50 mil";
  if (value <= 100000) return "50 a 100 mil";
  if (value <= 250000) return "100 a 250 mil";
  if (value <= 500000) return "250 a 500 mil";
  if (value <= 1000000) return "500 mil a 1 milhão";
  return "Acima de 1 milhão";
}

function labelOrUnknown(value) {
  return blankToNull(value) ?? "Não informado";
}

function buildFinancialMap(financialRows) {
  const map = new Map();
  const counts = new Map();
  for (const row of financialRows) {
    const clientId = blankToNull(row.client_id);
    if (!clientId) continue;
    counts.set(clientId, (counts.get(clientId) || 0) + 1);
    const updated = parseDate(row.updated_at) || new Date(0);
    const current = map.get(clientId);
    if (!current || updated > current.updated) {
      map.set(clientId, {
        updated,
        monthlyIncome: toNumber(row.ultima_renda_mensal),
        lastContribution: toNumber(row.ultimo_aporte),
        liquidityReserve: toNumber(row.reserva_liquidez),
        paidPropertiesValue: toNumber(row.valor_imoveis_quitados),
        hasProperty: toBool(row.possui_imovel),
        hasCar: toBool(row.possui_carro),
        hasConsortium: toBool(row.possui_consorcio),
        debt: {
          cheque_especial: row.cheque_especial,
          parcelamento_cartao: row.parcelamento_cartao,
          credito_pessoal: row.credito_pessoal,
          credito_consignado: row.credito_consignado,
        },
      });
    }
  }
  const duplicates = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  return { map, duplicates };
}

function resolveAcquisition(client, signatureMap) {
  const signature = signatureMap.get(client.id) || null;
  const cycleStart = parseDate(client.data_inicio_ciclo);
  const createdAt = parseDate(client.created_at);
  if (signature) return { date: signature, source: "contract_signature" };
  if (cycleStart) return { date: cycleStart, source: "cycle_start" };
  if (createdAt) return { date: createdAt, source: "client_created" };
  return { date: null, source: "unavailable" };
}

/**
 * Prioridade oficial de aquisição:
 * 1) vw_info_cliente.data_assinatura_contrato
 * 2) clients.data_inicio_ciclo
 * 3) clients.created_at
 *
 * A view estoura statement timeout em leitura completa (mesmo paginada).
 * Não usamos amostra parcial. Enquanto não houver materialização, usa fallbacks.
 */
async function fetchSignatureMap() {
  return {
    map: new Map(),
    error: null,
    fetched: 0,
    withSignature: 0,
    skippedDueToViewTimeout: true,
    note:
      "data_assinatura_contrato confirmada em vw_info_cliente, mas a view estoura timeout em leitura completa; aquisição usa data_inicio_ciclo → created_at.",
  };
}

function resolveStayForGeneralData({ stayStartDate, analyticalStatus, cancellationDate, now, currentCycle }) {
  const stay = resolveAnalyticalStayPeriod({
    stayStartDate,
    analyticalStatus,
    cancellationDate,
    now,
    currentCycle,
  });
  return {
    ...stay,
    stayRange: mapStayRange(stay.stayRange || stayRangeFromMonths(stay.stayMonths)),
  };
}

export function buildPayload(clients, cancellations, financialRows, signatureMap, signatureMeta = {}) {
  const { map: cancelMap, multiples, audit: cancelAudit } = buildAnalyticalCancellationMap(
    cancellations,
    clients,
  );
  const { map: financialMap, duplicates: financialDuplicates } = buildFinancialMap(financialRows);
  const now = new Date();
  const rows = [];
  let rawActiveCount = 0;
  let activeWithCancelDate = 0;
  let frozenWithCancelDate = 0;
  const stageCounts = {
    "Churn efetivado": 0,
    "Distrato assinado": 0,
    "Distrato assinado (texto)": 0,
    "Data churn (clients)": 0,
  };
  const acquisitionSources = {
    contract_signature: 0,
    cycle_start: 0,
    client_created: 0,
    unavailable: 0,
  };

  for (const client of clients) {
    const dataWarnings = [];
    const contractDate = parseDate(client.data_inicio_ciclo);
    const createdAt = parseDate(client.created_at);
    const stayStartDate = contractDate || createdAt;
    const usedCreatedFallback = !contractDate && Boolean(createdAt);

    const cancelInfo = cancelMap.get(String(client.id)) || null;
    const cancellationDate = cancelInfo?.date || null;
    const cancellationStage = cancelInfo?.stage || null;
    const hasCancellationProcess = Boolean(cancelInfo?.isCancelled);
    const rawStatus = blankToNull(client.status);
    const normalizedRaw = normalizeClientStatus(rawStatus);
    if (normalizedRaw === "Ativo") rawActiveCount += 1;
    const analyticalStatus = resolveAnalyticalStatusFromMaps(rawStatus, cancelInfo);
    if (normalizedRaw === "Ativo" && cancelInfo?.isCancelled) {
      activeWithCancelDate += 1;
      dataWarnings.push("Status bruto ativo com cancelamento efetivado consolidado");
    }
    if (normalizedRaw === "Congelado" && cancelInfo?.isCancelled) {
      frozenWithCancelDate += 1;
      dataWarnings.push("Status bruto congelado com cancelamento efetivado consolidado");
    }
    if (cancelInfo?.stage) stageCounts[cancelInfo.stage] = (stageCounts[cancelInfo.stage] || 0) + 1;

    const acquisition = resolveAcquisition(client, signatureMap);
    acquisitionSources[acquisition.source] = (acquisitionSources[acquisition.source] || 0) + 1;

    const financial = financialMap.get(client.id) || null;

    if (!contractDate) dataWarnings.push("Sem data de contratação");
    if (usedCreatedFallback) {
      dataWarnings.push(
        "Permanência calculada com data de criação do cliente por ausência de data de contratação.",
      );
    }
    if (acquisition.source === "client_created") {
      dataWarnings.push("Aquisição calculada com created_at por ausência de datas de contratação.");
    }
    if (acquisition.source === "unavailable") dataWarnings.push("Sem data de aquisição");
    if (!rawStatus) dataWarnings.push("Cliente sem status");
    if (normalizedRaw === "Cancelado" && !cancelInfo?.isCancelled) {
      dataWarnings.push(
        "Status bruto cancelado sem evidência da regra consolidada (churn/distrato/data_churn)",
      );
    }
    if (!blankToNull(client.segmentacao)) dataWarnings.push("Cliente sem segmento");
    if (!blankToNull(client.engenheiro_patrimonial)) dataWarnings.push("Cliente sem engenheiro responsável");
    if (!financial) dataWarnings.push("Sem diagnóstico financeiro");
    else {
      if (financial.monthlyIncome == null) dataWarnings.push("Renda mensal ausente");
      if (financial.lastContribution == null) dataWarnings.push("Último aporte ausente");
      if (financial.liquidityReserve == null) dataWarnings.push("Reserva de liquidez ausente");
    }
    if (financialDuplicates.has(client.id)) {
      dataWarnings.push("Múltiplos registros financeiros para o mesmo cliente; usado o mais recente");
    }

    const segmentInfo = calculateClientSegment(
      {
        monthlyIncome: financial?.monthlyIncome ?? null,
        liquidityReserve: financial?.liquidityReserve ?? null,
        lastContribution: financial?.lastContribution ?? null,
        paidPropertiesValue: financial?.paidPropertiesValue ?? null,
      },
      financial?.debt || {},
    );
    if (segmentInfo.segmentWarnings.length) dataWarnings.push(...segmentInfo.segmentWarnings);
    if (multiples.has(String(client.id))) {
      dataWarnings.push("Múltiplos processos ativos de cancelamento para o mesmo cliente");
    }
    if (cancelInfo?.warnings?.length) dataWarnings.push(...cancelInfo.warnings);

    const currentCycleRaw = client.ciclo;
    const currentCycleNum =
      currentCycleRaw == null || currentCycleRaw === "" ? null : Number(currentCycleRaw);
    const currentCycle = Number.isFinite(currentCycleNum) ? currentCycleNum : null;

    const stay = resolveStayForGeneralData({
      stayStartDate,
      analyticalStatus,
      cancellationDate,
      now,
      currentCycle,
    });
    if (stay.warning) dataWarnings.push(stay.warning);
    if (stay.stayCalculationStatus === "missing_cancellation_date") {
      dataWarnings.push("Cliente encerrado sem data de cancelamento");
    }

    const cycleEndDate = parseDate(client.data_fim_ciclo);
    const renewalCount = currentCycle != null && currentCycle > 0 ? Math.max(currentCycle - 1, 0) : 0;
    const renewed = currentCycle != null && currentCycle > 1;

    rows.push({
      clientId: String(client.id),
      clientCode: blankToNull(client.codigo),
      clientName: blankToNull(client.name) || "Não informado",
      contractDate: contractDate ? contractDate.toISOString() : null,
      cycleStartDate: parseDate(client.data_inicio_ciclo)?.toISOString() ?? null,
      cycleEndDate: parseDate(client.data_fim_ciclo)?.toISOString() ?? null,
      currentCycle,
      renewalCount,
      renewed,
      renewalValue: toNumber(client.valor_total_pago),
      contractSigned: toBool(client.contrato_assinado),
      davosContractSigned: toBool(client.davos_contrato_assinado),
      acquisitionDate: acquisition.date ? acquisition.date.toISOString() : null,
      acquisitionDateSource: acquisition.source,
      cancellationDate: cancellationDate ? cancellationDate.toISOString() : null,
      cancellationStage,
      hasCancellationProcess,
      stayDaysBase: stay.stayDaysBase,
      stayDays: stay.stayDays,
      stayDaysChronological: stay.stayDaysChronological,
      stayAdjusted: stay.stayAdjusted,
      stayMonths: stay.stayMonths,
      stayRange: stay.stayRange,
      stayCalculationStatus: stay.stayCalculationStatus,
      stayUsedCurrentDate: stay.stayUsedCurrentDate,
      stayUsedCreatedAtFallback: usedCreatedFallback,
      status: analyticalStatus,
      analyticalStatus,
      rawStatus,
      cycleStart: contractDate ? contractDate.toISOString() : null,
      cycleEnd: cycleEndDate ? cycleEndDate.toISOString() : null,
      program: blankToNull(client.programa),
      segment: segmentInfo.segment,
      segmentLabel: segmentInfo.segmentLabel,
      segmentStatus: segmentInfo.segmentStatus,
      segmentConfidence: segmentInfo.segmentConfidence,
      segmentReason: segmentInfo.segmentReason,
      segmentReasons: segmentInfo.segmentReasons,
      segmentInputs: segmentInfo.segmentInputs,
      missingFinancialData: segmentInfo.missingFinancialData,
      segmentWarnings: segmentInfo.segmentWarnings,
      originalSegment: labelOrUnknown(client.segmentacao),
      engineer: labelOrUnknown(client.engenheiro_patrimonial),
      hasFinancialProfile: Boolean(financial),
      monthlyIncome: financial?.monthlyIncome ?? null,
      lastContribution: financial?.lastContribution ?? null,
      liquidityReserve: financial?.liquidityReserve ?? null,
      paidPropertiesValue: financial?.paidPropertiesValue ?? null,
      hasProperty: financial?.hasProperty ?? null,
      hasCar: financial?.hasCar ?? null,
      hasConsortium: financial?.hasConsortium ?? null,
      hasDebt: segmentInfo.segmentInputs.hasDebt,
      incomeBand: incomeBand(financial?.monthlyIncome ?? null),
      liquidityBand: liquidityBand(financial?.liquidityReserve ?? null),
      dataWarnings: [...new Set(dataWarnings)],
    });
  }

  const summaryBase = summarizeGeneralRows(rows);
  const acquisitionBundle = buildAcquisitionsByMonth(rows);
  const total = rows.length || 1;

  const rawByNormalized = new Map();
  for (const row of rows) {
    const key = row.analyticalStatus;
    if (!rawByNormalized.has(key)) rawByNormalized.set(key, new Set());
    if (row.rawStatus) rawByNormalized.get(key).add(String(row.rawStatus));
  }
  const statusConsistencyNotes = [...rawByNormalized.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([label, set]) => `${set.size} variações de escrita encontradas para o status ${label}.`);
  const distinctRawStatuses = [...new Set(rows.map((r) => r.rawStatus).filter(Boolean))];

  const summary = {
    ...summaryBase,
    latestMonthAcquisitions: acquisitionBundle.summary.latestMonthAcquisitions,
    averageMonthlyAcquisitions: acquisitionBundle.summary.averageMonthlyAcquisitions,
    medianMonthlyAcquisitions: acquisitionBundle.summary.medianMonthlyAcquisitions,
    latestMonthChangePercent: acquisitionBundle.summary.latestMonthChangePercent,
  };

  const distributions = {
    status: distributionFrom(
      rows,
      (r) => analyticalStatusDisplayLabel(r.analyticalStatus),
      STATUS_LABELS,
    ).filter((item) => item.count > 0),
    segments: distributionFrom(rows, (r) => r.segmentLabel, SEGMENT_LABELS),
    engineers: distributionFrom(rows, (r) => r.engineer),
    stayRanges: distributionFrom(rows, (r) => r.stayRange, STAY_RANGES),
    financialProfile: [
      { label: "Imóvel", count: rows.filter((r) => r.hasProperty === true).length },
      { label: "Carro", count: rows.filter((r) => r.hasCar === true).length },
      { label: "Consórcio", count: rows.filter((r) => r.hasConsortium === true).length },
      { label: "Reserva de liquidez", count: rows.filter((r) => r.liquidityReserve != null).length },
    ].map((item) => ({
      ...item,
      percent: Math.round((item.count / total) * 1000) / 10,
    })),
    monthlyIncome: distributionFrom(rows, (r) => r.incomeBand, INCOME_BANDS),
    liquidityReserve: distributionFrom(rows, (r) => r.liquidityBand, LIQUIDITY_BANDS),
    acquisitionsByMonth: acquisitionBundle.acquisitionsByMonth,
  };

  return {
    generatedAt: new Date().toISOString(),
    defaultStatusFilter: "active",
    summary,
    distributions,
    clients: rows,
    quality: {
      usedFields: USED_FIELDS,
      statusConsistency: {
        distinctRawValues: distinctRawStatuses.sort((a, b) => a.localeCompare(b, "pt-BR")),
        distinctRawCount: distinctRawStatuses.length,
        notes: statusConsistencyNotes,
      },
      cancellationAudit: {
        rawActiveCount,
        activeWithConsolidatedCancelDate: activeWithCancelDate,
        removedFromActiveByCancelDate: activeWithCancelDate,
        frozenWithConsolidatedCancelDate: frozenWithCancelDate,
        analyticalActive: summary.activeClients,
        analyticalCancelled: summary.cancelledClients,
        stages: stageCounts,
        rule:
          "Efetivado = churn_efetivado_at OR distrato_assinado_at OR distrato='Assinado' OR clients.data_churn; união distinta por client_id; data: churn > distrato_at > data_churn; texto Assinado sem data = efetivado sem data confirmada; data_pedido/intencao não efetivam",
        sourceAudit: cancelAudit || null,
      },
      stayAudit: {
        calculatedClients: summary.stayCalculatedClients,
        excludedClients: summary.stayExcludedClients,
        coveragePercent: summary.stayCoveragePercent,
        closedWithoutCancellationDate: summary.closedWithoutCancellationDate,
        rule:
          "Kernel: Ativo/Congelado → hoje; cancelado com data analítica válida → data de cancelamento; ajuste +365 se ciclo ≥ 2 e base < 365. Dados Gerais usa stayDays analítico, não a duração cronológica.",
      },
      acquisitionAudit: {
        sources: acquisitionSources,
        signatureFetch: signatureMeta,
        primaryField: "vw_info_cliente.data_assinatura_contrato",
        fallbacks: ["clients.data_inicio_ciclo", "clients.created_at"],
        historicalException:
          "Aquisição mensal é métrica histórica: conta contratados por mês independentemente do status atual. O default active-first da página não se aplica a este gráfico.",
      },
      measureConfig: MEASURE_CONFIG,
      warnings:
        signatureMeta.skippedDueToViewTimeout || signatureMeta.error
          ? [
              signatureMeta.note
              || `Falha ao carregar assinaturas de contrato: ${signatureMeta.error || "timeout da view"}`,
            ]
          : [],
    },
  };
}

async function timedRead(label, promise) {
  const startedAt = Date.now();
  const value = await promise;
  return { label, ms: Date.now() - startedAt, value };
}

export async function computeGeneralDataPayload() {
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }
  const startedAt = Date.now();
  const [clientsTimed, cancellationsTimed, financialTimed] = await Promise.all([
    timedRead("clients", fetchAllRows({ table: "clients", select: CLIENT_SELECT })),
    timedRead("cancellations", fetchAllRows({ table: "cancellations", select: ANALYTICAL_CANCEL_SELECT })),
    timedRead("financial", fetchAllRows({ table: "client_financial_data", select: FINANCIAL_SELECT })),
  ]);
  const signatureResult = await fetchSignatureMap();
  const transformStartedAt = Date.now();
  const clientsRaw = clientsTimed.value;
  const cancellations = cancellationsTimed.value;
  const financialRowsRaw = financialTimed.value;
  const removedIds = excludedClientIds(clientsRaw);
  const clients = filterExcludedClients(clientsRaw);
  const financialRows = financialRowsRaw.filter((row) => !removedIds.has(String(row.client_id || "")));
  const filteredCancellations = cancellations.filter((row) => !removedIds.has(String(row.client_id || "")));
  const payload = buildPayload(
    clients,
    filteredCancellations,
    financialRows,
    signatureResult.map,
    {
      error: signatureResult.error,
      fetched: signatureResult.fetched,
      withSignature: signatureResult.withSignature,
      skippedDueToViewTimeout: signatureResult.skippedDueToViewTimeout,
      note: signatureResult.note,
    },
  );
  console.info(
    `[general-data] clients=${clientsTimed.ms}ms cancellations=${cancellationsTimed.ms}ms financial=${financialTimed.ms}ms transform=${Date.now() - transformStartedAt}ms total=${Date.now() - startedAt}ms rows=${payload.clients.length}`,
  );
  return payload;
}

export { calculateClientSegment, USED_FIELDS };
