/**
 * Roteamento consolidado dos dashboards V2 (entrypoint api/dashboard.js).
 * Handlers reais permanecem em lib/analytics/*-handler.mjs.
 */
import { handleCancellationsRequest } from "../analytics/cancellations-handler.mjs";
import { handleFinancialUpdatesRequest } from "../analytics/financial-updates-handler.mjs";
import { handleGeneralDataRequest } from "../analytics/general-data-handler.mjs";
import { handleMechanismsRequest } from "../analytics/mechanisms-handler.mjs";
import { handleMeetingsRequest } from "../analytics/meetings-handler.mjs";
import { handleOnboardingRequest } from "../analytics/onboarding-handler.mjs";
import { handlePatrimonialPlanRequest } from "../analytics/patrimonial-plan-handler.mjs";
import { handleRenewalRequest } from "../analytics/renewal-handler.mjs";
import { handleEpPerformanceRequest } from "../analytics/ep-performance-handler.mjs";
import { handleEpPerformanceDetailsRequest } from "../analytics/ep-performance-details-handler.mjs";
import { handleTemporalIndicatorsRequest } from "../analytics/temporal-indicators-handler.mjs";
import { handleTemporalIndicatorsDetailsRequest } from "../analytics/temporal-indicators-details-handler.mjs";
import { handleInternalMechanismsSatisfactionRequest } from "../analytics/internal-mechanisms-satisfaction-handler.mjs";
import { handleStatisticalCrossesRequest } from "../analytics/statistical-crosses-handler.mjs";
import { handleQualityRequest } from "../analytics/quality-handler.mjs";
import { handleExecutiveSummaryRequest } from "../analytics/executive-summary-handler.mjs";
import { handleHealthScoreRequest } from "../analytics/health-score-handler.mjs";
import { handleSatisfactionRequest } from "../analytics/satisfaction-handler.mjs";
import { handlePlatformUsageRequest } from "../analytics/platform-usage-handler.mjs";
import { handleSupportRequest } from "../analytics/support-handler.mjs";
import { requirePageAccess } from "../access/require-page-access.mjs";
import { nodeToWebRequest, sendWebResponse } from "../http/node-fetch-bridge.mjs";

const DETAIL_PAGE_IDS = Object.freeze({
  "/api/ep-performance/details": "ep_performance",
  "/api/temporal-indicators/details": "temporal_indicators",
});

export const DASHBOARD_DETAIL_HANDLERS = Object.freeze({
  "/api/ep-performance/details": { handler: handleEpPerformanceDetailsRequest, logPrefix: "ep-performance-details" },
  "/api/temporal-indicators/details": { handler: handleTemporalIndicatorsDetailsRequest, logPrefix: "temporal-indicators-details" },
});

export const DASHBOARD_PAGE_HANDLERS = Object.freeze({
  executive_summary: { handler: handleExecutiveSummaryRequest, logPrefix: "executive-summary" },
  general: { handler: handleGeneralDataRequest, logPrefix: "general-data" },
  journey: { handler: handleOnboardingRequest, logPrefix: "onboarding" },
  meetings: { handler: handleMeetingsRequest, logPrefix: "meetings" },
  patrimonial_plan: { handler: handlePatrimonialPlanRequest, logPrefix: "patrimonial-plan" },
  mechanisms: { handler: handleMechanismsRequest, logPrefix: "mechanisms" },
  financial_updates: { handler: handleFinancialUpdatesRequest, logPrefix: "financial-updates" },
  satisfaction: { handler: handleSatisfactionRequest, logPrefix: "satisfaction" },
  cancellations: { handler: handleCancellationsRequest, logPrefix: "cancellations" },
  renewal: { handler: handleRenewalRequest, logPrefix: "renewal" },
  ep_performance: { handler: handleEpPerformanceRequest, logPrefix: "ep-performance" },
  temporal_indicators: { handler: handleTemporalIndicatorsRequest, logPrefix: "temporal-indicators" },
  statistical_crosses: { handler: handleStatisticalCrossesRequest, logPrefix: "statistical-crosses" },
  internal_mechanisms_satisfaction: {
    handler: handleInternalMechanismsSatisfactionRequest,
    logPrefix: "internal-mechanisms-satisfaction",
  },
  health_score: { handler: handleHealthScoreRequest, logPrefix: "health-score" },
  quality: { handler: handleQualityRequest, logPrefix: "quality" },
  platform_usage: { handler: handlePlatformUsageRequest, logPrefix: "platform-usage" },
  support: { handler: handleSupportRequest, logPrefix: "support" },
});

export const DASHBOARD_LEGACY_PATHS = Object.freeze({
  "/api/executive-summary": "executive_summary",
  "/api/general-data": "general",
  "/api/onboarding": "journey",
  "/api/meetings": "meetings",
  "/api/patrimonial-plan": "patrimonial_plan",
  "/api/mechanisms": "mechanisms",
  "/api/financial-updates": "financial_updates",
  "/api/satisfaction": "satisfaction",
  "/api/cancellations": "cancellations",
  "/api/renewal": "renewal",
  "/api/ep-performance": "ep_performance",
  "/api/temporal-indicators": "temporal_indicators",
  "/api/statistical-crosses": "statistical_crosses",
  "/api/internal-mechanisms-satisfaction": "internal_mechanisms_satisfaction",
  "/api/health-score": "health_score",
  "/api/quality": "quality",
  "/api/platform-usage": "platform_usage",
  "/api/support": "support",
});

function normalizePath(pathname) {
  const base = String(pathname || "/");
  if (base.length > 1 && base.endsWith("/")) return base.slice(0, -1);
  return base;
}

export function resolveDashboardPage(pathname, searchParams = new URLSearchParams()) {
  const path = normalizePath(pathname);
  const detailEntry = DASHBOARD_DETAIL_HANDLERS[path];
  if (detailEntry) {
    return { page: path, ...detailEntry };
  }
  const pageFromQuery = String(searchParams.get("page") || "").trim();
  if (pageFromQuery && DASHBOARD_PAGE_HANDLERS[pageFromQuery]) {
    return { page: pageFromQuery, ...DASHBOARD_PAGE_HANDLERS[pageFromQuery] };
  }
  const legacyPage = DASHBOARD_LEGACY_PATHS[path];
  if (legacyPage && DASHBOARD_PAGE_HANDLERS[legacyPage]) {
    return { page: legacyPage, ...DASHBOARD_PAGE_HANDLERS[legacyPage] };
  }
  return null;
}

export function dashboardNotFoundResponse(pathname) {
  return Response.json(
    {
      error: "Dashboard não encontrado.",
      code: "DASHBOARD_NOT_FOUND",
      path: normalizePath(pathname),
    },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function runDashboardHandler(req, res, entry) {
  const request = await nodeToWebRequest(req);
  const hasAuth = Boolean(request.headers.get("authorization"));
  console.info(`[${entry.logPrefix}] incoming ${req.method || "GET"} authorization=${hasAuth ? "sim" : "não"}`);
  const pageId = DETAIL_PAGE_IDS[entry.page] || entry.page;
  const denied = await requirePageAccess(request, pageId);
  if (denied) {
    await sendWebResponse(res, denied, { logPrefix: entry.logPrefix });
    return;
  }
  const response = await entry.handler(request);
  await sendWebResponse(res, response, { logPrefix: entry.logPrefix });
}

export async function handleDashboardApi(req, res) {
  const host = req.headers?.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  const entry = resolveDashboardPage(url.pathname, url.searchParams);
  if (!entry) {
    const response = dashboardNotFoundResponse(url.pathname);
    await sendWebResponse(res, response, { logPrefix: "dashboard" });
    return;
  }
  await runDashboardHandler(req, res, entry);
}
