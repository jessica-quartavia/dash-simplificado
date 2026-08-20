/**
 * Mapeia métricas validadas V2 para página/compute e dependências.
 */
import { listExtractorMetricIds } from "../../analytics/snapshot/metric-snapshot-registry.mjs";

export const VALIDATED_COMPUTE_METRICS = new Set(listExtractorMetricIds());

export const METRICS_NEEDING_MEETING_TYPES = new Set(["top_meeting_types"]);

export const PAGE_TIMEOUT_MS = {
  general: 10_000,
  journey: 15_000,
  mechanisms: 10_000,
  patrimonial_plan: 10_000,
  meetings: 20_000,
};

export const PAGE_CACHE_TTL_MS = {
  general: 5 * 60_000,
  journey: 5 * 60_000,
  mechanisms: 5 * 60_000,
  patrimonial_plan: 5 * 60_000,
  meetings: 10 * 60_000,
};

export function isComputeEligible(metric) {
  return Boolean(metric?.validated_for_v2 === true && metric?.metric_id);
}

export function getMetricPageId(metric) {
  return String(metric?.page_id || "").trim() || null;
}

export function metricNeedsMeetingTypes(metricId) {
  return METRICS_NEEDING_MEETING_TYPES.has(metricId);
}

export function listSupportedComputePages() {
  return ["general", "journey", "meetings", "patrimonial_plan", "mechanisms"];
}

export function assertMetricInRegistry(metricId) {
  if (!VALIDATED_COMPUTE_METRICS.has(metricId)) {
    const error = new Error(`Métrica ${metricId} não possui extractor oficial.`);
    error.code = "metric_not_supported";
    throw error;
  }
}
