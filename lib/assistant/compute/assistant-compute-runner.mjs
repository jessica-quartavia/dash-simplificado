/**
 * Executa compute oficial V2 por página com cache e timeout.
 */
import { computeGeneralDataPayload } from "../../analytics/general-data.mjs";
import { computeMeetingsPayload } from "../../analytics/meetings.mjs";
import { computeOnboardingPayload } from "../../analytics/onboarding.mjs";
import { computePatrimonialPlanPayload } from "../../analytics/patrimonial-plan.mjs";
import { computeMechanismsPayload } from "../../analytics/mechanisms.mjs";
import {
  buildGeneralSnapshotContext,
  buildMeetingsSnapshotContext,
  buildJourneySnapshotContext,
  buildPlanSnapshotContext,
  buildMechanismsSnapshotContext,
} from "../../analytics/snapshot/metric-snapshot-builder.mjs";
import { defaultGeneralFilters } from "../../analytics/general-filters.mjs";
import { defaultMeetingFilters } from "../../analytics/meeting-filters.mjs";
import { defaultOnboardingFilters } from "../../analytics/onboarding-filters.mjs";
import { defaultMechanismFilters } from "../../analytics/mechanism-filters.mjs";
import {
  PAGE_CACHE_TTL_MS,
  PAGE_TIMEOUT_MS,
  metricNeedsMeetingTypes,
} from "./assistant-compute-registry.mjs";

const computeCache = new Map();

function stableKey(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

export function clearAssistantComputeCache() {
  computeCache.clear();
}

function pageFilters(pageId, filters = {}) {
  if (pageId === "general") return { ...defaultGeneralFilters(), ...filters };
  if (pageId === "meetings") return { ...defaultMeetingFilters(), ...filters };
  if (pageId === "journey") return { ...defaultOnboardingFilters(), ...filters };
  if (pageId === "mechanisms") return { ...defaultMechanismFilters(), ...filters };
  if (pageId === "patrimonial_plan") return { ...filters };
  return { ...filters };
}

function buildContext(pageId, payload, filters) {
  const f = pageFilters(pageId, filters);
  switch (pageId) {
    case "general":
      return buildGeneralSnapshotContext(payload, f);
    case "meetings":
      return buildMeetingsSnapshotContext(payload, f);
    case "journey":
      return buildJourneySnapshotContext(payload, f);
    case "patrimonial_plan":
      return buildPlanSnapshotContext(payload);
    case "mechanisms":
      return buildMechanismsSnapshotContext(payload, f);
    default:
      return null;
  }
}

export function buildPageContextFromPayload(pageId, payload, filters = {}) {
  return buildContext(pageId, payload, filters);
}

async function fetchPagePayload(pageId, metricId, deps) {
  const includeMeetingTypes = metricNeedsMeetingTypes(metricId);
  switch (pageId) {
    case "general":
      return (deps.computeGeneralDataPayload || computeGeneralDataPayload)();
    case "meetings":
      return (deps.computeMeetingsPayload || computeMeetingsPayload)({ includeMeetingTypes });
    case "journey":
      return (deps.computeOnboardingPayload || computeOnboardingPayload)();
    case "patrimonial_plan":
      return (deps.computePatrimonialPlanPayload || computePatrimonialPlanPayload)();
    case "mechanisms":
      return (deps.computeMechanismsPayload || computeMechanismsPayload)();
    default:
      throw new Error(`Compute ausente para ${pageId}.`);
  }
}

function withTimeout(promise, timeoutMs, pageId) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Compute ${pageId} excedeu ${timeoutMs}ms.`);
        error.code = "compute_timeout";
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function runAssistantPageCompute({
  pageId,
  metricId,
  filters = {},
  deps = {},
} = {}) {
  const timeoutMs = PAGE_TIMEOUT_MS[pageId] || 15_000;
  const cacheTtl = PAGE_CACHE_TTL_MS[pageId] || 5 * 60_000;
  const cacheKey = `${pageId}:${stableKey(filters)}:${metricNeedsMeetingTypes(metricId) ? "types" : "core"}`;
  const now = Date.now();
  const cached = computeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {
      pageId,
      payload: cached.payload,
      context: cached.context,
      cacheHit: true,
      computeMs: 0,
      filters,
    };
  }

  const started = Date.now();
  try {
    const payload = await withTimeout(fetchPagePayload(pageId, metricId, deps), timeoutMs, pageId);
    const context = buildContext(pageId, payload, filters);
    computeCache.set(cacheKey, { payload, context, expiresAt: now + cacheTtl });
    return {
      pageId,
      payload,
      context,
      cacheHit: false,
      computeMs: Date.now() - started,
      filters,
    };
  } catch (error) {
    error.computeMs = Date.now() - started;
    throw error;
  }
}
