/**
 * Filter Contract do Assistente — reutiliza page-contracts.mjs.
 */
import { getPageFilterContract } from "../analytics/filters/page-contracts.mjs";
import { foldSearchText } from "../analytics/filters/search.mjs";

const METRIC_COMPONENT_ID = {
  onboarding_completion_chart: "completion_chart",
  total_onboarding_time_chart: "total_onboarding_chart",
  median_stay_days: "typical_stay",
  clients_with_financial_data: "financial_profile",
  monthly_income_distribution: "income_chart",
  liquidity_reserve_distribution: "income_chart",
  financial_profile_distribution: "financial_profile",
  stay_duration_distribution: "stay_chart",
  client_acquisition_monthly: "acquisition_chart",
  meeting_interval_chart: "frequency_chart",
  meeting_status_chart: "status_chart",
  meetings_by_engineer_chart: "meetings_ep_chart",
  meetings_by_month_chart: "meetings_month_chart",
  top_meeting_types: "types_chart",
  mechanism_status_chart: "status_chart",
  mechanisms_per_client_chart: "count_chart",
  catalog_coverage_chart: "catalog_chart",
  mechanism_type_usage_chart: "types_chart",
  implementations_by_month_chart: "months_chart",
  implemented_by_segment_chart: "segment_chart",
  implemented_by_engineer_chart: "ep_chart",
  most_used_mechanism: "top_mechanism",
  in_progress_mechanisms: "in_progress",
  implementation_rate: "implementation_percent",
  clients_with_recent_implementation: "recent_clients",
  plan_days_to_approval: "plan_days_to_approval",
};

export function componentIdForMetric(metricId) {
  return METRIC_COMPONENT_ID[metricId] || metricId;
}

export function metricPeriodSensitive(metric) {
  const pageId = metric?.page_id;
  const componentId = componentIdForMetric(metric?.metric_id);
  const contract = getPageFilterContract(pageId);
  const component = (contract?.components || []).find((item) => item.id === componentId);
  return component?.periodSensitive === true;
}

export function metricFilterContract(metric) {
  const pageId = metric?.page_id;
  const componentId = componentIdForMetric(metric?.metric_id);
  const contract = getPageFilterContract(pageId);
  const component = (contract?.components || []).find((item) => item.id === componentId);
  return {
    pageId,
    componentId,
    periodSensitive: component?.periodSensitive === true,
    filters: component?.filters || null,
    acceptedFilters: Array.isArray(metric?.accepted_filters) ? metric.accepted_filters : [],
  };
}

export function validateAssistantFilters(metric, filters = {}) {
  const warnings = [];
  const contract = metricFilterContract(metric);
  const periodActive = Boolean(filters?.period && filters.period !== "all");

  if (periodActive && !contract.periodSensitive) {
    warnings.push(
      `O indicador "${metric.label}" é fotografia atual (periodSensitive=false) e não deve ser recortado pelo período global. O período informado não foi aplicado ao cálculo.`,
    );
  }

  if (filters.engineer && filters.engineer !== "all" && !contract.acceptedFilters.includes("engineer") && contract.filters && !contract.filters.engineer) {
    warnings.push(`Filtro de EP não se aplica a "${metric.label}" nesta página.`);
  }

  if (filters.segment && filters.segment !== "all" && !contract.acceptedFilters.includes("segment") && contract.filters && !contract.filters.segment) {
    warnings.push(`Filtro de segmento não se aplica a "${metric.label}" nesta página.`);
  }

  return { warnings, appliedFilters: sanitizeAppliedFilters(metric, filters, contract) };
}

function sanitizeAppliedFilters(metric, filters, contract) {
  const applied = {};
  if (filters.engineer && filters.engineer !== "all" && (contract.acceptedFilters.includes("engineer") || contract.filters?.engineer)) {
    applied.engineer = filters.engineer;
  }
  if (filters.segment && filters.segment !== "all" && (contract.acceptedFilters.includes("segment") || contract.filters?.segment)) {
    applied.segment = filters.segment;
  }
  if (filters.period && filters.period !== "all" && contract.periodSensitive) {
    applied.period = filters.period;
    if (filters.from) applied.from = filters.from;
    if (filters.to) applied.to = filters.to;
  }
  if (filters.status && filters.status !== "all") applied.status = filters.status;
  return applied;
}

export function collectEngineerOptions(payload, pageId) {
  const clients = payload?.clients || [];
  const values = new Set();
  for (const row of clients) {
    if (row?.engineer) values.add(String(row.engineer).trim());
  }
  return [...values].filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function collectSegmentOptions(payload) {
  const clients = payload?.clients || [];
  const values = new Set();
  for (const row of clients) {
    const label = row?.segmentLabel || row?.segment;
    if (label) values.add(String(label).trim());
  }
  return [...values].filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function resolveEngineerName(query, options = []) {
  const needle = foldSearchText(query);
  if (!needle) return { value: null, ambiguous: false };
  const exact = options.filter((name) => foldSearchText(name) === needle);
  if (exact.length === 1) return { value: exact[0], ambiguous: false };
  if (exact.length > 1) return { value: null, ambiguous: true, candidates: exact };
  const partial = options.filter((name) => foldSearchText(name).includes(needle) || needle.includes(foldSearchText(name)));
  if (partial.length === 1) return { value: partial[0], ambiguous: false };
  if (partial.length > 1) return { value: null, ambiguous: true, candidates: partial.slice(0, 5) };
  return { value: null, ambiguous: false };
}
