#!/usr/bin/env node
/**
 * Probe DEV — totais churn no payload Executive (sem HTTP cache).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function loadDotEnv() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    if (process.env[k] == null || process.env[k] === "") process.env[k] = t.slice(eq + 1).trim();
  }
}
loadDotEnv();

import { runWithAnalyticsDataContext } from "../lib/analytics/analytics-data-context.mjs";
import { defaultExecutiveSummaryFilters } from "../lib/analytics/executive-summary-filters.mjs";
import { computeExecutiveSummaryPayload, clearExecutiveSummaryCache } from "../lib/analytics/executive-summary.mjs";
import { CALCULATION_VERSION } from "../lib/cache/analytics-cache.mjs";

function summarizeBalance(series) {
  const list = Array.isArray(series) ? series : [];
  const totalChurn = list.reduce((s, r) => s + (r.churn ?? r.churnClients ?? 0), 0);
  return { totalChurn12m: totalChurn, byMonth: list.map((r) => ({ month: r.month, churn: r.churn ?? r.churnClients ?? 0 })) };
}

async function runOnce(force) {
  if (force) clearExecutiveSummaryCache();
  const filters = defaultExecutiveSummaryFilters();
  const payload = await computeExecutiveSummaryPayload(filters, {}, { force });
  const series = payload?.baseClients?.metrics?.acquisition_churn_balance_monthly?.value;
  return summarizeBalance(series);
}

async function main() {
  await runWithAnalyticsDataContext(async () => {
    const normal = await runOnce(false);
    const forced = await runOnce(true);
    console.log(
      JSON.stringify(
        {
          calculation_version: CALCULATION_VERSION,
          compute_normal: normal,
          compute_force: forced,
          match: normal.totalChurn12m === forced.totalChurn12m,
        },
        null,
        2,
      ),
    );
  }, { page: "probe-executive-churn" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
