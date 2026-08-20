/**
 * Extrai valor oficial via metric-snapshot-registry (mesma camada do snapshot builder).
 */
import { extractSnapshot } from "../../analytics/snapshot/metric-snapshot-registry.mjs";
import { formatMetricValue, summarizeChartValue } from "../value-formatter.mjs";
import { runAssistantPageCompute, buildPageContextFromPayload } from "./assistant-compute-runner.mjs";
import {
  getMetricPageId,
  isComputeEligible,
} from "./assistant-compute-registry.mjs";

function stableFiltersKey(filters = {}) {
  return JSON.stringify(filters, Object.keys(filters).sort());
}

export function isSnapshotUsable(row) {
  if (!row) return false;
  const status = String(row.calculation_status || "").toLowerCase();
  if (status === "error") return false;
  if (row.expires_at) {
    const expires = Date.parse(row.expires_at);
    if (Number.isFinite(expires) && expires <= Date.now()) return false;
  }
  const hasValue = row.value != null || row.numerator != null || row.denominator != null;
  return hasValue;
}

export function snapshotToValueResult(row, metric) {
  if (!isSnapshotUsable(row)) return { available: false, source: "snapshot", reason: "snapshot_empty" };
  const formatted = formatMetricValue(row, metric);
  return {
    available: true,
    source: "snapshot",
    data: compactValuePayload(row, metric),
    formatted: formatted.formatted,
    coverage: row.coverage,
    sample_size: row.sample_size,
    numerator: row.numerator,
    denominator: row.denominator,
    warning: row.warning || null,
    calculation_status: row.calculation_status || null,
    generated_at: row.generated_at || null,
  };
}

function compactValuePayload(snapshotRow, metric) {
  const valueObj = snapshotRow?.value;
  if (valueObj?.categories || valueObj?.series) {
    return summarizeChartValue(valueObj);
  }
  if (valueObj && typeof valueObj === "object" && "value" in valueObj) {
    return {
      value: valueObj.value,
      unit: valueObj.unit || metric?.unit || null,
      calculation: valueObj.calculation || null,
      label: valueObj.label || null,
      clients: valueObj.clients ?? null,
    };
  }
  return valueObj ?? null;
}

export async function resolveMetricValue({
  metric,
  snapshotRow = null,
  filters = {},
  deps = {},
  prefetched = null,
} = {}) {
  if (!metric) return { available: false, source: null, reason: "no_metric" };

  if (isSnapshotUsable(snapshotRow)) {
    return snapshotToValueResult(snapshotRow, metric);
  }

  if (!isComputeEligible(metric)) {
    return { available: false, source: null, reason: "not_validated_v2" };
  }

  const pageId = getMetricPageId(metric);
  if (!pageId) return { available: false, source: null, reason: "missing_page" };

  try {
    let compute;
    if (
      prefetched?.payload
      && prefetched.pageId === pageId
      && stableFiltersKey(prefetched.filters) === stableFiltersKey(filters)
    ) {
      compute = {
        pageId,
        payload: prefetched.payload,
        context: buildPageContextFromPayload(pageId, prefetched.payload, filters),
        cacheHit: prefetched.cacheHit,
        computeMs: prefetched.computeMs || 0,
      };
    } else if (prefetched?.payload && prefetched.pageId === pageId) {
      compute = {
        pageId,
        payload: prefetched.payload,
        context: buildPageContextFromPayload(pageId, prefetched.payload, filters),
        cacheHit: true,
        computeMs: 0,
      };
    } else {
      const runCompute = deps.runAssistantPageCompute || runAssistantPageCompute;
      compute = await runCompute({
        pageId,
        metricId: metric.metric_id,
        filters,
        deps,
      });
    }
    const extracted = extractSnapshot(metric, compute.context);
    if (!extracted) {
      return {
        available: false,
        source: "compute",
        reason: "extractor_missing",
        compute_page: pageId,
        compute_cache_hit: compute.cacheHit,
        compute_ms: compute.computeMs,
      };
    }
    const formatted = formatMetricValue(extracted, metric);
    return {
      available: extracted.calculation_status !== "unavailable" && extracted.value != null,
      source: "compute",
      data: compactValuePayload(extracted, metric),
      formatted: formatted.formatted,
      coverage: extracted.coverage,
      sample_size: extracted.sample_size,
      numerator: extracted.numerator,
      denominator: extracted.denominator,
      warning: extracted.warning || null,
      calculation_status: extracted.calculation_status || null,
      compute_page: pageId,
      compute_cache_hit: compute.cacheHit,
      compute_ms: compute.computeMs,
      reason: extracted.calculation_status === "unavailable" ? "compute_unavailable" : null,
    };
  } catch (error) {
    return {
      available: false,
      source: "compute",
      reason: error?.code || "compute_failed",
      compute_page: pageId,
      compute_ms: error?.computeMs ?? null,
    };
  }
}
