/**
 * Payload de Implementação de Mecanismos — visão consolidada BASE QV + App Pharus (read-only).
 */
import { dataConfigurationError, pharusConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatusFromMaps,
} from "./analytical-cancellation.mjs";
import { calculateClientSegment } from "./client-segment.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import { blankToNull, parseDate } from "./meeting-metrics.mjs";
import {
  computeBaseQvMechanismAudit,
  dedupeClientMechanisms,
  pctBand,
  recommendationsPerClientBand,
} from "./mechanism-metrics.mjs";
import { normalizeBaseQvMechanismStatus } from "./mechanisms/mechanism-status.mjs";
import { resolveClientProgram } from "./filters/program.mjs";
import { computePharusMechanismsPayload } from "./pharus-mechanisms.mjs";
import { consolidateMechanismsPayload } from "./mechanisms/mechanisms-consolidation.mjs";

const CLIENT_SELECT =
  "id,codigo,name,status,engenheiro_patrimonial,data_inicio_ciclo,created_at,data_churn,email,phone,cpf_digits,phone_digits,linked_user_id,programa,davos_contrato_assinado";
const CM_SELECT =
  "id,client_id,mecanismo_id,status,implemented_at,created_at,no_plano,sequence,valor_aplicado,source";
const MEC_SELECT = "id,name,categoria,mercado,programa,status,codigo";
const FINANCIAL_SELECT =
  "id,client_id,reserva_liquidez,ultimo_aporte,ultima_renda_mensal,valor_imoveis_quitados,cheque_especial,parcelamento_cartao,credito_pessoal,credito_consignado,updated_at";

function toNumber(value) {
  const raw = blankToNull(value);
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function labelOrUnknown(value) {
  return blankToNull(value) ?? "Não informado";
}

function buildFinancialLookup(financialRows) {
  const map = new Map();
  for (const row of financialRows || []) {
    const clientId = blankToNull(row.client_id);
    if (!clientId) continue;
    const updated = parseDate(row.updated_at) || new Date(0);
    const current = map.get(String(clientId));
    if (current && current.updated >= updated) continue;
    map.set(String(clientId), {
      updated,
      monthlyIncome: toNumber(row.ultima_renda_mensal),
      lastContribution: toNumber(row.ultimo_aporte),
      liquidityReserve: toNumber(row.reserva_liquidez),
      paidPropertiesValue: toNumber(row.valor_imoveis_quitados),
      debt: {
        cheque_especial: row.cheque_especial,
        parcelamento_cartao: row.parcelamento_cartao,
        credito_pessoal: row.credito_pessoal,
        credito_consignado: row.credito_consignado,
      },
    });
  }
  return map;
}

export function buildMechanismsPayload({
  clients,
  cmRows,
  mechanisms,
  cancellations,
  financialRows,
  now = new Date(),
} = {}) {
  const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations || [], clients || []);
  const financialMap = buildFinancialLookup(financialRows);
  const mechMap = new Map((mechanisms || []).map((m) => [String(m.id), m]));
  const clientMap = new Map((clients || []).map((c) => [String(c.id), c]));
  const categoriaFilled = [...mechMap.values()].filter((m) => blankToNull(m.categoria)).length;
  const mercadoFilled = [...mechMap.values()].filter((m) => blankToNull(m.mercado)).length;
  const useMarketDimension = categoriaFilled < mechMap.size * 0.5 && mercadoFilled > categoriaFilled;
  const { rows: deduped } = dedupeClientMechanisms(cmRows);
  const byClient = new Map();
  for (const row of deduped) {
    const clientId = String(row.client_id);
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId).push(row);
  }

  const recentCutoff = new Date(now.getTime() - 30 * 86400000);
  const clientRows = [];
  for (const [clientId, rows] of byClient.entries()) {
    const client = clientMap.get(clientId);
    const cancelInfo = cancelMap.get(clientId) || null;
    const analyticalStatus = resolveAnalyticalStatusFromMaps(client?.status, cancelInfo);
    const fin = financialMap.get(clientId) || null;
    const segmentInfo = calculateClientSegment(
      fin
        ? {
          monthlyIncome: fin.monthlyIncome,
          liquidityReserve: fin.liquidityReserve,
          lastContribution: fin.lastContribution,
          paidPropertiesValue: fin.paidPropertiesValue,
        }
        : null,
      fin?.debt || null,
    );
    const mechanismsOut = [];
    let eligible = 0;
    let inProgress = 0;
    let implemented = 0;
    let recentImpls = 0;
    for (const row of rows) {
      const mech = mechMap.get(String(row.mecanismo_id));
      const statusInfo = normalizeBaseQvMechanismStatus(row.status);
      if (statusInfo.label === "Apto") eligible += 1;
      if (statusInfo.label === "Em andamento") inProgress += 1;
      if (statusInfo.label === "Implementado") implemented += 1;
      const implementedAt = parseDate(row.implemented_at);
      if (statusInfo.label === "Implementado" && implementedAt && implementedAt >= recentCutoff && implementedAt <= now) {
        recentImpls += 1;
      }
      const dimension = useMarketDimension
        ? (blankToNull(mech?.mercado) || "Não informado")
        : (blankToNull(mech?.categoria) || "Não informado");
      mechanismsOut.push({
        mechanismId: String(row.mecanismo_id || ""),
        name: blankToNull(mech?.name) || "Mecanismo sem nome",
        status: statusInfo.label,
        dimension,
        implementedMonth: implementedAt && implementedAt <= now ? monthKey(implementedAt) : null,
        implementedAt: implementedAt && implementedAt <= now ? implementedAt.toISOString() : null,
      });
    }
    const available = mechanismsOut.length;
    const implementationPercent = available > 0
      ? Math.min(100, Math.round((implemented / available) * 1000) / 10)
      : null;
    clientRows.push({
      clientId,
      clientCode: blankToNull(client?.codigo),
      clientName: blankToNull(client?.name) || "Não informado",
      engineer: labelOrUnknown(client?.engenheiro_patrimonial),
      program: blankToNull(client?.programa),
      davosContractSigned: client?.davos_contrato_assinado === true,
      clientProgram: resolveClientProgram({
        program: client?.programa,
        davosContractSigned: client?.davos_contrato_assinado === true,
      }),
      segment: segmentInfo.segment || "Dados insuficientes",
      analyticalStatus,
      available,
      eligible,
      inProgress,
      implemented,
      implementationPercent,
      hasImplementationLast30Days: recentImpls > 0,
      mechanismsCountBand: recommendationsPerClientBand(available),
      percentRange: pctBand(implementationPercent, available),
      mechanisms: mechanismsOut,
    });
  }

  const portfolioMap = new Map();
  for (const client of clients || []) {
    const cancelInfo = cancelMap.get(String(client.id)) || null;
    const fin = financialMap.get(String(client.id)) || null;
    const segmentInfo = calculateClientSegment(
      fin
        ? {
          monthlyIncome: fin.monthlyIncome,
          liquidityReserve: fin.liquidityReserve,
          lastContribution: fin.lastContribution,
          paidPropertiesValue: fin.paidPropertiesValue,
        }
        : null,
      fin?.debt || null,
    );
    const engineer = labelOrUnknown(client.engenheiro_patrimonial);
    const segment = segmentInfo.segment || "Dados insuficientes";
    const analyticalStatus = resolveAnalyticalStatusFromMaps(client?.status, cancelInfo);
    const key = `${analyticalStatus}\0${engineer}\0${segment}`;
    const current = portfolioMap.get(key) || { engineer, segment, analyticalStatus, count: 0 };
    current.count += 1;
    portfolioMap.set(key, current);
  }
  const portfolio = [...portfolioMap.values()];

  const catalog = (mechanisms || []).map((m) => ({
    id: String(m.id),
    name: blankToNull(m.name) || "Não informado",
    dimension: useMarketDimension
      ? (blankToNull(m.mercado) || "Não informado")
      : (blankToNull(m.categoria) || "Não informado"),
  }));

  return {
    generatedAt: new Date().toISOString(),
    defaultStatusFilter: "active",
    catalog,
    portfolio,
    clients: clientRows,
    metadata: {
      dimension: useMarketDimension ? "mercado" : "categoria",
      hiddenMetrics: [
        "Tempo médio até a primeira implementação",
        "Tempo até a primeira implementação",
        "Dias desde a última implementação",
      ],
      retroactiveNote: "Datas de implementação podem ter preenchimento retroativo.",
      sources: ["BASE QV"],
      pharusConsulted: false,
      pharusNote: null,
    },
  };
}

export function toPublicMechanismsPayload(payload) {
  const quality = payload?.metadata?.consolidationQuality || null;
  return {
    generatedAt: payload?.generatedAt || new Date().toISOString(),
    defaultStatusFilter: "active",
    metadata: {
      ...(payload?.metadata || {}),
      consolidationQuality: quality
        ? {
            clients: quality.clients,
            links: quality.links,
            mechanisms: quality.mechanisms,
            totals: quality.totals,
            mechanismCrosswalk: {
              confirmed: quality.mechanismCrosswalk?.confirmed || [],
              probable: quality.mechanismCrosswalk?.probable || [],
              exclusiveBaseQv: quality.mechanismCrosswalk?.exclusiveBaseQv || [],
              exclusivePharus: quality.mechanismCrosswalk?.exclusivePharus || [],
            },
            ambiguousClientMatches: quality.ambiguousClientMatches || 0,
            implementationPercentScope: quality.implementationPercentScope || null,
          }
        : null,
    },
    catalog: payload?.catalog || [],
    portfolio: payload?.portfolio || [],
    timing: payload?.timing || null,
    clients: (payload?.clients || []).map((row) => ({
      clientId: row.clientId,
      clientCode: row.clientCode,
      clientName: row.clientName,
      engineer: row.engineer,
      segment: row.segment,
      program: row.program,
      davosContractSigned: row.davosContractSigned === true,
      analyticalStatus: row.analyticalStatus,
      available: row.available,
      eligible: row.eligible,
      inProgress: row.inProgress,
      implemented: row.implemented,
      implementationPercent: row.implementationPercent,
      hasImplementationLast30Days: row.hasImplementationLast30Days,
      mechanismsCountBand: row.mechanismsCountBand,
      percentRange: row.percentRange,
      clientSources: row.clientSources || [],
      hasQvProfile: row.hasQvProfile !== false,
      mechanisms: (row.mechanisms || []).map((m) => ({
        mechanismId: m.mechanismId,
        name: m.name,
        status: m.status,
        dimension: m.dimension,
        implementedMonth: m.implementedMonth || null,
        implementedAt: m.implementedAt || null,
        sources: m.sources || [],
        pharusUserId: m.pharusUserId || null,
      })),
    })),
  };
}

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

export async function computeMechanismsPayload() {
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }
  const totalStarted = Date.now();
  const [clientsTimed, cmTimed, mechTimed, cancelTimed, financialTimed] = await Promise.all([
    timed(() => fetchAllRows({ table: "clients", select: CLIENT_SELECT })),
    timed(() => fetchAllRows({ table: "client_mecanismos", select: CM_SELECT })),
    timed(() => fetchAllRows({ table: "mecanismos", select: MEC_SELECT })),
    timed(() => fetchAllRows({ table: "cancellations", select: ANALYTICAL_CANCEL_SELECT })),
    timed(() => fetchAllRows({ table: "client_financial_data", select: FINANCIAL_SELECT })),
  ]);
  const clientsRaw = clientsTimed.value || [];
  const clients = filterExcludedClients(clientsRaw);
  const removedIds = excludedClientIds(clientsRaw);
  const cmRowsAll = (cmTimed.value || []).filter((row) => blankToNull(row.client_id));
  const cmRows = cmRowsAll.filter((row) => !removedIds.has(String(row.client_id || "")));
  const baseQvAudit = computeBaseQvMechanismAudit(cmRows);
  const transformStarted = Date.now();
  let pharusPayload = null;
  let pharusFailureNote = null;
  let pharusMs = 0;
  if (!pharusConfigurationError()) {
    const pharusStarted = Date.now();
    try {
      pharusPayload = await computePharusMechanismsPayload();
      if (!pharusPayload?.success) {
        pharusFailureNote =
          pharusPayload?.source?.message
          || pharusPayload?.warnings?.find((w) => w.code === "pharus_empty_visible")?.message
          || "App Pharus indisponível para leitura consolidada.";
        pharusPayload = null;
      }
    } catch (error) {
      pharusFailureNote = error?.message || "App Pharus indisponível para leitura consolidada.";
      pharusPayload = null;
    }
    pharusMs = Date.now() - pharusStarted;
  } else {
    pharusFailureNote = pharusConfigurationError();
  }

  const basePayload = buildMechanismsPayload({
    clients,
    cmRows,
    mechanisms: mechTimed.value || [],
    cancellations: (cancelTimed.value || []).filter((row) => !removedIds.has(String(row.client_id || ""))),
    financialRows: (financialTimed.value || []).filter((row) => !removedIds.has(String(row.client_id || ""))),
  });
  basePayload.metadata = {
    ...(basePayload.metadata || {}),
    baseQvAudit,
  };

  const payload = consolidateMechanismsPayload({
    baseQvPayload: basePayload,
    pharusPayload,
    clientsRaw: clients,
  });

  if (!pharusPayload && pharusFailureNote) {
    payload.metadata = {
      ...(payload.metadata || {}),
      status: "partial",
      pharusConsulted: false,
      pharusNote: pharusFailureNote,
      pharus: { status: "unavailable", total: null },
      sources: ["BASE QV"],
    };
  } else if (pharusPayload) {
    payload.metadata = {
      ...(payload.metadata || {}),
      status: "ok",
      pharusConsulted: true,
      pharus: {
        status: "ok",
        total: pharusPayload?.summary?.usersWithMechanisms ?? null,
      },
    };
  }

  payload.timing = {
    baseQvMs: Math.max(clientsTimed.ms, cmTimed.ms, mechTimed.ms, cancelTimed.ms, financialTimed.ms),
    clientsMs: clientsTimed.ms,
    linksMs: cmTimed.ms,
    catalogMs: mechTimed.ms,
    cancellationsMs: cancelTimed.ms,
    financialMs: financialTimed.ms,
    pharusMs,
    pharusConsulted: Boolean(pharusPayload),
    transformMs: Date.now() - transformStarted,
    totalMs: Date.now() - totalStarted,
  };
  return payload;
}
