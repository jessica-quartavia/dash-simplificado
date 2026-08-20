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
import { handleSatisfactionRequest } from "../analytics/satisfaction-handler.mjs";
import { nodeToWebRequest, sendWebResponse } from "../http/node-fetch-bridge.mjs";

export const DASHBOARD_PAGE_HANDLERS = Object.freeze({
  general: { handler: handleGeneralDataRequest, logPrefix: "general-data" },
  journey: { handler: handleOnboardingRequest, logPrefix: "onboarding" },
  meetings: { handler: handleMeetingsRequest, logPrefix: "meetings" },
  patrimonial_plan: { handler: handlePatrimonialPlanRequest, logPrefix: "patrimonial-plan" },
  mechanisms: { handler: handleMechanismsRequest, logPrefix: "mechanisms" },
  financial_updates: { handler: handleFinancialUpdatesRequest, logPrefix: "financial-updates" },
  satisfaction: { handler: handleSatisfactionRequest, logPrefix: "satisfaction" },
  cancellations: { handler: handleCancellationsRequest, logPrefix: "cancellations" },
  renewal: { handler: handleRenewalRequest, logPrefix: "renewal" },
});

export const DASHBOARD_LEGACY_PATHS = Object.freeze({
  "/api/general-data": "general",
  "/api/onboarding": "journey",
  "/api/meetings": "meetings",
  "/api/patrimonial-plan": "patrimonial_plan",
  "/api/mechanisms": "mechanisms",
  "/api/financial-updates": "financial_updates",
  "/api/satisfaction": "satisfaction",
  "/api/cancellations": "cancellations",
  "/api/renewal": "renewal",
});

function normalizePath(pathname) {
  const base = String(pathname || "/");
  if (base.length > 1 && base.endsWith("/")) return base.slice(0, -1);
  return base;
}

export function resolveDashboardPage(pathname, searchParams = new URLSearchParams()) {
  const path = normalizePath(pathname);
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
