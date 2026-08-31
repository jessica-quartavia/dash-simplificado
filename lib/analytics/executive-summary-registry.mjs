/**
 * Escopo fechado do Resumo Executivo — métrica → página fonte → extractor.
 * Não descobrir automaticamente; esta lista é a fonte da verdade.
 */
import { foldToken } from "./mechanism-metrics.mjs";
import { sortUnknownLast } from "./filters/sort-categories.mjs";

export const RENEWAL_ELIGIBLE_RULE_STATUS = Object.freeze({
  found: false,
  metricId: "renewal_eligible_clients",
  label: "Clientes aptos para renovação",
  message: "NOT FOUND: precisa definição de negócio. renewal_eligible (ciclo válido) mede elegibilidade analítica, não aptidão para renovação.",
});

export const EXECUTIVE_SECTIONS = Object.freeze([
  "baseClients",
  "onboarding",
  "engagement",
  "valueDelivery",
  "clientHealth",
  "ep",
  "temporal",
]);

const FILTER_STOCK = Object.freeze({ program: true, engineer: true, segment: true, status: true });
const FILTER_PROGRAM_ONLY = Object.freeze({ program: true, engineer: false, segment: false, status: false });

export const EXECUTIVE_METRIC_REGISTRY = Object.freeze([
  { id: "active_clients", label: "Clientes ativos", section: "baseClients", sourcePage: "general", sourceMetricId: "active_clients", visualization: "kpi", filters: FILTER_STOCK, limitations: "Status analítico Ativo na população filtrada." },
  { id: "frozen_clients", label: "Clientes congelados", section: "baseClients", sourcePage: "general", sourceMetricId: "frozen_clients", visualization: "kpi", scope: "all_clients", filters: FILTER_STOCK, limitations: "Status analítico Congelado na carteira total (programa/EP/segmento aplicados; sem filtro active-first)." },
  { id: "median_stay_days", label: "Permanência mediana", section: "baseClients", sourcePage: "general", sourceMetricId: "median_stay_days", visualization: "kpi", filters: FILTER_STOCK, limitations: "Mediana oficial (typicalStayDays), não média aritmética." },
  { id: "active_segment_distribution", label: "Base ativa por segmento", section: "baseClients", sourcePage: "general", sourceMetricId: "clients_by_segment", visualization: "hbar", filters: FILTER_STOCK, limitations: "Somente clientes analiticamente ativos no recorte." },
  { id: "median_monthly_income", label: "Renda mediana", section: "baseClients", sourcePage: "general", sourceMetricId: "median_monthly_income", visualization: "kpi", filters: FILTER_STOCK, limitations: "Mediana de ultima_renda_mensal preenchida." },
  { id: "median_last_contribution", label: "Aporte mediano", section: "baseClients", sourcePage: "general", sourceMetricId: "median_last_contribution", visualization: "kpi", filters: FILTER_STOCK, limitations: "Mediana de ultimo_aporte preenchido." },
  { id: "median_liquidity_reserve", label: "Reserva mediana", section: "baseClients", sourcePage: "general", sourceMetricId: "median_liquidity_reserve", visualization: "kpi", filters: FILTER_STOCK, limitations: "Mediana de reserva_liquidez preenchida." },
  { id: "acquisition_last_3_months", label: "Aquisição últimos 3 meses", section: "baseClients", sourcePage: "general", sourceMetricId: "client_acquisition_monthly", visualization: "mini-chart", filters: { program: true, engineer: true, segment: true, status: false }, limitations: "Ignora filtro de status (evento histórico). Exatamente 3 meses." },

  { id: "onboarding_completion_rate", label: "Onboarding concluído", section: "onboarding", sourcePage: "journey", sourceMetricId: "onboarding_completion_chart", visualization: "kpi", filters: FILTER_STOCK, limitations: "% sobre população avaliável (completedPercent)." },
  { id: "median_first_meeting_days", label: "Mediana até primeira reunião", section: "onboarding", sourcePage: "journey", sourceMetricId: "total_onboarding_time_chart", visualization: "kpi", filters: FILTER_STOCK, limitations: "Coorte comparável; primeira reunião válida (não futura/pre-entry)." },

  { id: "clients_without_meeting", label: "Clientes sem reunião", section: "engagement", sourcePage: "meetings", sourceMetricId: "clients_without_meeting", visualization: "kpi", filters: FILTER_STOCK, limitations: "População filtrada sem reunião válida." },
  { id: "average_interval_between_meetings", label: "Intervalo entre reuniões", section: "engagement", sourcePage: "meetings", sourceMetricId: "average_interval_between_meetings", visualization: "kpi", filters: FILTER_STOCK, limitations: "Média de averageIntervalDays (mesma regra da página Reuniões)." },
  { id: "days_to_first_meeting", label: "Dias até primeira reunião", section: "engagement", sourcePage: "journey", sourceMetricId: "median_first_meeting_days", visualization: "kpi", filters: FILTER_STOCK, limitations: "Mediana oficial da Jornada (coorte comparável)." },
  { id: "days_financial_to_activation", label: "Tempo até ativação das engrenagens", section: "engagement", sourcePage: "financial_updates", sourceMetricId: "financial_to_activation", visualization: "kpi", filters: FILTER_STOCK, limitations: "Mediana medianDaysFinancialToActivation." },
  { id: "days_to_central_intelligence", label: "Dias até Central de Inteligência", section: "engagement", sourcePage: "journey", sourceMetricId: "plan_days_to_approval", visualization: "kpi", filters: FILTER_STOCK, limitations: "Mediana daysToPlanDelivery (reunião Central de Inteligência)." },
  { id: "clients_without_financial_diagnosis", label: "Clientes sem diagnóstico financeiro", section: "engagement", sourcePage: "general", sourceMetricId: "clients_with_financial_data", visualization: "kpi", filters: FILTER_STOCK, limitations: "Complemento: total filtrado − clientsWithFinancialProfile." },

  { id: "clients_with_implemented_mechanisms", label: "Clientes com mecanismos implantados", section: "valueDelivery", sourcePage: "mechanisms", sourceMetricId: "clients_with_mechanisms", visualization: "kpi", filters: FILTER_STOCK, limitations: "Clientes únicos com ≥1 vínculo implementado (row.implemented > 0)." },
  { id: "clients_implementation_rate", label: "% com mecanismo implantado", section: "valueDelivery", sourcePage: "mechanisms", sourceMetricId: "implementation_rate_clients", visualization: "kpi", filters: FILTER_STOCK, limitations: "Derivado: clientes c/ implementado ÷ população do recorte. Não confundir com % de vínculos." },
  { id: "mechanism_type_distribution", label: "Distribuição dos mecanismos", section: "valueDelivery", sourcePage: "mechanisms", sourceMetricId: "mechanism_type_usage_chart", visualization: "hbar", filters: FILTER_STOCK, limitations: "Top 5 + Outros; detalhe completo disponível." },

  { id: "nps", label: "NPS", section: "clientHealth", sourcePage: "satisfaction", sourceMetricId: "nps", visualization: "kpi", filters: { program: true, engineer: true, segment: false, status: false }, limitations: "Última resposta válida por cliente." },
  { id: "promoters_detractors_share", label: "Promotores × detratores", section: "clientHealth", sourcePage: "satisfaction", sourceMetricId: "nps_classification", visualization: "split-bar", filters: { program: true, engineer: true, segment: false, status: false }, limitations: "Mesma população NPS; neutros no universo." },
  { id: "csat_average", label: "CSAT", section: "clientHealth", sourcePage: "satisfaction", sourceMetricId: "csat_average", visualization: "kpi", filters: { program: true, engineer: true, segment: false, status: false }, limitations: "CSAT médio oficial." },
  { id: "cancellation_intention_vs_effective", label: "Cancelamentos × intenções por mês", section: "clientHealth", sourcePage: "cancellations", sourceMetricId: "cancellation_monthly_series", visualization: "dual-series-chart", filters: FILTER_STOCK, limitations: "Datas oficiais por série; séries independentes." },
  { id: "top_cancellation_reasons", label: "Principais motivos de cancelamento", section: "clientHealth", sourcePage: "cancellations", sourceMetricId: "cancellation_reasons", visualization: "rank-list", filters: FILTER_STOCK, limitations: "Top 10 de dist.byCategory (count > 0) — mesmo compute da página Cancelamento." },
  { id: "intention_destination_branches", label: "Destino das intenções e pedidos", section: "clientHealth", sourcePage: "cancellations", sourceMetricId: "intention_destination_chart", visualization: "branch-cards", filters: FILTER_STOCK, limitations: "Universo hasIntentionOrPedido; ramificação exclusiva por desfecho oficial." },
  { id: "renewed_active_clients_rate", label: "Renovações por clientes ativos", section: "clientHealth", sourcePage: "renewal", sourceMetricId: "renewed_active_rate", visualization: "kpi", filters: { program: true, engineer: true, segment: true, status: false }, limitations: "Clientes ativos com ciclo ≥ 2 ÷ clientes analiticamente ativos (%)." },

  { id: "top_ep_renewed_share", label: "Renovação por EP (maior e menor)", section: "ep", sourcePage: "ep_performance", sourceMetricId: "renewed_portfolio_percentage", visualization: "ep-rank", filters: { program: true, engineer: true, segment: true, status: false }, limitations: "renewedPortfolioPercentage por EP; mín. 10 clientes." },
  { id: "top_ep_implementation_share", label: "Implementação por EP (maior e menor)", section: "ep", sourcePage: "ep_performance", sourceMetricId: "implemented_share_by_ep", visualization: "ep-rank", filters: { program: true, engineer: true, segment: true, status: false }, limitations: "clientsWithImplementedMechanisms ÷ totalClients do EP; mín. 10 clientes." },

  { id: "temporal_top_signals", label: "Sinais de atrito na jornada do cliente", section: "temporal", sourcePage: "temporal_indicators", sourceMetricId: "pre_cancellation_signals", visualization: "signal-list", filters: FILTER_PROGRAM_ONLY, limitations: "Sinais determinísticos; associação descritiva, sem causalidade." },
  { id: "temporal_signal_distribution", label: "Clientes por quantidade de sinais de atrito", section: "temporal", sourcePage: "temporal_indicators", sourceMetricId: "signal_count_distribution", visualization: "hbar", filters: FILTER_PROGRAM_ONLY, limitations: "Faixas 1/2/3/4+ sinais em clientes ativos com sinal (activeRisk.clients) — regra V1." },
]);

const UNCATEGORIZED_REASON_TOKENS = new Set([
  "outros motivos",
  "outros",
  "nao informado",
  "sem categoria",
  "nao categorizado",
  "cancelamento sem detalhamento",
]);

export function isCategorizedCancellationReason(category) {
  const token = foldToken(category);
  if (!token) return false;
  return !UNCATEGORIZED_REASON_TOKENS.has(token);
}

export function topCategorizedCancellationReasons(categories = [], limit = 5) {
  return [...categories]
    .filter((item) => isCategorizedCancellationReason(item?.label || item?.category))
    .sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.label).localeCompare(String(b.label), "pt-BR"))
    .slice(0, limit);
}

export function topMechanismDistribution(items = [], limit = 5) {
  const sorted = sortUnknownLast(items, (item) => item.label, (a, b) => (b.count || b.clients || 0) - (a.count || a.clients || 0));
  const total = sorted.reduce((sum, item) => sum + (item.count || item.clients || 0), 0) || 1;
  const top = sorted.slice(0, limit).map((item) => ({
    ...item,
    count: item.count || item.clients || 0,
    percent: item.percent ?? Math.round(((item.count || item.clients || 0) / total) * 1000) / 10,
  }));
  const rest = sorted.slice(limit);
  const othersCount = rest.reduce((sum, item) => sum + (item.count || item.clients || 0), 0);
  if (othersCount > 0) {
    top.push({
      label: "Outros",
      count: othersCount,
      percent: Math.round((othersCount / total) * 1000) / 10,
      groupedCount: rest.length,
      detail: rest,
    });
  }
  return { top, full: sorted };
}

export function registryBySection(section) {
  return EXECUTIVE_METRIC_REGISTRY.filter((item) => item.section === section);
}

export function registryMetric(id) {
  return EXECUTIVE_METRIC_REGISTRY.find((item) => item.id === id) || null;
}
