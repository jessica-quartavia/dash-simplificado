/**
 * Renovação — inferência por clients.ciclo (sem evento formal de renovação).
 */
import { dataConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import { runWithAnalyticsDataContext } from "./analytics-data-context.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatusFromMaps,
} from "./analytical-cancellation.mjs";
import {
  countRenewedClients,
  renewalFromClient,
  sumRenewalCounts,
} from "./client-cycle-renewal.mjs";
import { summarizeRenewalActiveClients } from "./renewal-metrics.mjs";
import { calculateClientSegment } from "./client-segment.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import { blankToNull, parseDate } from "./meeting-metrics.mjs";

const CLIENT_SELECT =
  "id,codigo,name,status,engenheiro_patrimonial,programa,data_inicio_ciclo,data_fim_ciclo,ciclo";
const FINANCIAL_SELECT =
  "id,client_id,ultima_renda_mensal,reserva_liquidez,ultimo_aporte,valor_imoveis_quitados,cheque_especial,parcelamento_cartao,credito_pessoal,credito_consignado,updated_at";

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function labelOrUnknown(value) {
  return blankToNull(value) ?? "Não informado";
}

function renewalCountBand(count) {
  if (count == null || !Number.isFinite(count) || count < 0) return "0";
  if (count >= 4) return "4+";
  return String(Math.trunc(count));
}

function buildFinancialLookup(financialRows) {
  const map = new Map();
  for (const row of financialRows || []) {
    const clientId = blankToNull(row.client_id);
    if (!clientId) continue;
    const updated = parseDate(row.updated_at) || new Date(0);
    const current = map.get(String(clientId));
    if (current && current.updated >= updated) continue;
    map.set(String(clientId), { row, updated });
  }
  return map;
}

export function buildRenewalPayload({ clients = [], cancellations = [], financialRows = [] } = {}) {
  const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations || [], clients || []);
  const financialMap = buildFinancialLookup(financialRows);
  const rows = [];
  const renewalCountBuckets = new Map([
    ["0", 0],
    ["1", 0],
    ["2", 0],
    ["3", 0],
    ["4+", 0],
  ]);
  const renewedDistribution = { renewed: 0, firstCycle: 0, invalid: 0 };
  const byEngineer = new Map();
  let maxCycle = 0;
  let eligibleCount = 0;

  for (const client of clients || []) {
    const clientId = String(client.id);
    const cancelInfo = cancelMap.get(clientId) || null;
    const analyticalStatus = resolveAnalyticalStatusFromMaps(client?.status, cancelInfo);
    const renewal = renewalFromClient(client);
    const fin = financialMap.get(clientId)?.row || null;
    const segmentInfo = calculateClientSegment(
      fin
        ? {
          monthlyIncome: fin.ultima_renda_mensal,
          liquidityReserve: fin.reserva_liquidez,
          lastContribution: fin.ultimo_aporte,
          paidPropertiesValue: fin.valor_imoveis_quitados,
        }
        : null,
      fin
        ? {
          cheque_especial: fin.cheque_especial,
          parcelamento_cartao: fin.parcelamento_cartao,
          credito_pessoal: fin.credito_pessoal,
          credito_consignado: fin.credito_consignado,
        }
        : null,
    );

    if (renewal.valid) eligibleCount += 1;
    if (renewal.currentCycle != null && renewal.currentCycle > maxCycle) maxCycle = renewal.currentCycle;

    if (renewal.valid && renewal.hasRenewed) renewedDistribution.renewed += 1;
    else if (renewal.valid) renewedDistribution.firstCycle += 1;
    else renewedDistribution.invalid += 1;

    const bucket = renewal.valid ? renewalCountBand(renewal.renewalCount) : "0";
    renewalCountBuckets.set(bucket, (renewalCountBuckets.get(bucket) || 0) + 1);

    const engineer = labelOrUnknown(client.engenheiro_patrimonial);
    if (!byEngineer.has(engineer)) {
      byEngineer.set(engineer, { engineer, total: 0, renewed: 0 });
    }
    const eng = byEngineer.get(engineer);
    eng.total += renewal.valid ? 1 : 0;
    if (renewal.valid && renewal.hasRenewed) eng.renewed += 1;

    rows.push({
      clientId,
      clientCode: blankToNull(client.codigo),
      clientName: blankToNull(client.name) || "Não informado",
      engineer,
      segment: segmentInfo.segment || "Dados insuficientes",
      program: blankToNull(client.programa),
      analyticalStatus,
      currentCycle: renewal.currentCycle,
      renewalCount: renewal.renewalCount,
      renewed: renewal.hasRenewed,
      cycleValid: renewal.valid,
      contractDate: parseDate(client.data_inicio_ciclo)?.toISOString() ?? null,
      cycleEndDate: parseDate(client.data_fim_ciclo)?.toISOString() ?? null,
    });
  }

  const renewedClients = countRenewedClients(rows);
  const totalRenewals = sumRenewalCounts(rows);
  const totalPopulation = rows.length;
  const activeRenewal = summarizeRenewalActiveClients(rows);

  return {
    generatedAt: new Date().toISOString(),
    methodology: {
      renewalInference:
        "Renovação é inferida pelo ciclo atual do cliente (clients.ciclo > 1). Não há evento formal, data ou valor de renovação nesta base.",
      rules: {
        renewed: "ciclo > 1",
        renewalCount: "max(ciclo - 1, 0)",
        maxCycle: "max(ciclo válido)",
      },
    },
    population: {
      totalClients: totalPopulation,
      eligibleClients: eligibleCount,
      eligibleCoveragePercent: pct(eligibleCount, totalPopulation),
    },
    summary: {
      renewedClients,
      renewedClientsPercent: pct(renewedClients, eligibleCount),
      totalRenewals,
      maxCurrentCycle: maxCycle || null,
      ...activeRenewal,
    },
    distributions: {
      renewedYesNo: [
        { label: "Renovou (ciclo > 1)", count: renewedDistribution.renewed, percent: pct(renewedDistribution.renewed, eligibleCount) },
        { label: "Ainda no 1º ciclo", count: renewedDistribution.firstCycle, percent: pct(renewedDistribution.firstCycle, eligibleCount) },
        { label: "Ciclo inválido", count: renewedDistribution.invalid, percent: pct(renewedDistribution.invalid, totalPopulation) },
      ],
      renewalCountBands: [...renewalCountBuckets.entries()].map(([label, count]) => ({
        label,
        count,
        percent: pct(count, eligibleCount),
      })),
      renewedByEngineer: [...byEngineer.values()]
        .filter((row) => row.total > 0)
        .map((row) => ({
          label: row.engineer,
          engineer: row.engineer,
          renewed: row.renewed,
          eligible: row.total,
          percent: pct(row.renewed, row.total),
          count: row.renewed,
        }))
        .sort((a, b) => b.percent - a.percent || b.renewed - a.renewed || a.label.localeCompare(b.label, "pt-BR")),
    },
    clients: rows,
  };
}

export async function computeRenewalPayload(options = {}) {
  return runWithAnalyticsDataContext(async () => {
    const configError = dataConfigurationError();
    if (configError) {
      const err = new Error(configError);
      err.code = "config";
      throw err;
    }
    const [clientsRaw, cancellations, financialRows] = await Promise.all([
      fetchAllRows({ table: "clients", select: CLIENT_SELECT }),
      fetchAllRows({ table: "cancellations", select: ANALYTICAL_CANCEL_SELECT }),
      fetchAllRows({ table: "client_financial_data", select: FINANCIAL_SELECT }),
    ]);
    const removedIds = excludedClientIds(clientsRaw);
    const clients = filterExcludedClients(clientsRaw);
    const filteredCancellations = (cancellations || []).filter(
      (row) => !removedIds.has(String(row.client_id || "")),
    );
    const financial = financialRows.filter((row) => !removedIds.has(String(row.client_id || "")));
    return buildRenewalPayload({
      clients,
      cancellations: filteredCancellations,
      financialRows: financial,
    });
  }, { page: "renewal", perfDebug: Boolean(options.perfDebug) });
}

export function toPublicRenewalPayload(payload) {
  return payload;
}
