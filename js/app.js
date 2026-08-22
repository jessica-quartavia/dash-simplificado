import { bootAuth } from "./auth.mjs";

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

async function safeBootAsync(label, fn) {
  try {
    await fn();
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

async function startPortal() {
  if (navigationReady) return;
  navigationReady = true;
  bootLog("mount shell");

  await import("./page-preloader.js").then(({ bootPagePreloader }) => bootPagePreloader());

  const { bootNavigation } = await import("./navigation.js");
  safeBoot("navigation", bootNavigation);

  const pageBoots = [
    ["executive-summary", () => import("./executive-summary.js").then((m) => m.bootExecutiveSummary())],
    ["general-data", () => import("./general-data.js").then((m) => m.bootGeneralData())],
    ["meetings", () => import("./meetings.js").then((m) => m.bootMeetings())],
    ["onboarding", () => import("./onboarding.js").then((m) => m.bootOnboarding())],
    ["patrimonial-plan", () => import("./patrimonial-plan.js").then((m) => m.bootPatrimonialPlan())],
    ["mechanisms", () => import("./mechanisms.js").then((m) => m.bootMechanisms())],
    ["financial-updates", () => import("./financial-updates.js").then((m) => m.bootFinancialUpdates())],
    ["satisfaction", () => import("./satisfaction.js").then((m) => m.bootSatisfaction())],
    ["cancellations", () => import("./cancellations.js").then((m) => m.bootCancellations())],
    ["renewal", () => import("./renewal.js").then((m) => m.bootRenewal())],
    ["ep-performance", () => import("./ep-performance.js").then((m) => m.bootEpPerformance())],
    ["temporal-indicators", () => import("./temporal-indicators.js").then((m) => m.bootTemporalIndicators())],
    ["reports", () => import("./reports.js").then((m) => m.bootReports())],
    ["statistical-crosses", () => import("./statistical-crosses.js").then((m) => m.bootStatisticalCrosses())],
    ["quality", () => import("./quality.js").then((m) => m.bootQuality())],
    ["platform-usage", () => import("./platform-usage.js").then((m) => m.bootPlatformUsage())],
    ["support", () => import("./support.js").then((m) => m.bootSupport())],
  ];

  await Promise.all(pageBoots.map(([label, boot]) => safeBootAsync(label, boot)));

  document.getElementById("app")?.setAttribute("data-ready", "true");
  bootLog("shell mounted");
  safeBoot("scroll-top", () => {
    void import("./components/scroll-to-top.js").then(({ bootScrollToTop }) => bootScrollToTop());
  });
  bootAssistantNonBlocking();
  bootLog("done");
}

document.addEventListener("DOMContentLoaded", () => {
  bootLog("start");
  void bootAuth({
    onAuthenticated: () => {
      bootLog("corporate check ok");
      void startPortal();
    },
    onSignedOut: () => {
      navigationReady = false;
      void import("./page-preloader.js").then(({ shutdownPagePreloader }) => shutdownPagePreloader());
    },
  });
});
