import { bootAuth } from "./auth.mjs";
import { bootNavigation } from "./navigation.js";
import { bootGeneralData } from "./general-data.js";
import { bootMeetings } from "./meetings.js";
import { bootOnboarding } from "./onboarding.js";
import { bootPatrimonialPlan } from "./patrimonial-plan.js";
import { bootMechanisms } from "./mechanisms.js";
import { bootFinancialUpdates } from "./financial-updates.js";
import { bootSatisfaction } from "./satisfaction.js";
import { bootCancellations } from "./cancellations.js";
import { bootRenewal } from "./renewal.js";
import { bootEpPerformance } from "./ep-performance.js";
import { bootTemporalIndicators } from "./temporal-indicators.js";
import { bootReports } from "./reports.js";
import { bootStatisticalCrosses } from "./statistical-crosses.js";
import { bootQuality } from "./quality.js";
import { bootExecutiveSummary } from "./executive-summary.js";
import { bootPlatformUsage } from "./platform-usage.js";
import { bootSupport } from "./support.js";
import { bootScrollToTop } from "./components/scroll-to-top.js";

let navigationReady = false;

const isDevBootLog =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.search.includes("bootdebug=1"));

function bootLog(label) {
  if (isDevBootLog) console.info(`[Boot] ${label}`);
}

function safeBoot(label, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`[Boot] ${label} failed`, error);
  }
}

function bootAssistantNonBlocking() {
  void import("./assistant/assistant-ui.js")
    .then(({ bootAssistant }) => {
      bootLog("assistant start");
      bootAssistant();
      bootLog("assistant mounted");
    })
    .catch((error) => {
      console.error("[Assistant] initialization failed", error);
    });
}

function startPortal() {
  if (navigationReady) return;
  navigationReady = true;
  bootLog("shell mounting");
  safeBoot("navigation", bootNavigation);
  safeBoot("executive-summary", bootExecutiveSummary);
  safeBoot("general-data", bootGeneralData);
  safeBoot("meetings", bootMeetings);
  safeBoot("onboarding", bootOnboarding);
  safeBoot("patrimonial-plan", bootPatrimonialPlan);
  safeBoot("mechanisms", bootMechanisms);
  safeBoot("financial-updates", bootFinancialUpdates);
  safeBoot("satisfaction", bootSatisfaction);
  safeBoot("cancellations", bootCancellations);
  safeBoot("renewal", bootRenewal);
  safeBoot("ep-performance", bootEpPerformance);
  safeBoot("temporal-indicators", bootTemporalIndicators);
  safeBoot("reports", bootReports);
  safeBoot("statistical-crosses", bootStatisticalCrosses);
  safeBoot("quality", bootQuality);
  safeBoot("platform-usage", bootPlatformUsage);
  safeBoot("support", bootSupport);
  document.getElementById("app")?.setAttribute("data-ready", "true");
  bootLog("shell mounted");
  safeBoot("scroll-top", bootScrollToTop);
  bootAssistantNonBlocking();
}

document.addEventListener("DOMContentLoaded", () => {
  bootLog("auth start");
  void bootAuth({
    onAuthenticated: startPortal,
    onSignedOut: () => {
      navigationReady = false;
    },
  });
});
