#!/usr/bin/env node
/**
 * Refresh manual do snapshot statistical_client_features.
 *
 * Persistência exige JWT autenticado (anon + Bearer). Sem service role.
 * Preferir: POST /api/analytics?action=refresh-statistical-snapshot (browser autenticado).
 *
 * node scripts/refresh-statistical-snapshot.mjs --dry-run
 * node scripts/refresh-statistical-snapshot.mjs --access-token=<JWT>
 * ANALYTICS_ACCESS_TOKEN=<JWT> npm run analytics:refresh-statistical-snapshot
 */
import { loadAuditEnv } from "../lib/analytics/fidelity-audit.mjs";
import { buildLiveStatisticalFeatureSnapshot } from "../lib/analytics/statistical-snapshot-builder.mjs";
import {
  compareLiveAndSnapshotClients,
  roundTripSnapshotClients,
} from "../lib/analytics/statistical-snapshot.mjs";
import { statisticalSnapshotStore } from "../lib/analytics/statistical-snapshot-store.mjs";
import { assertAuthenticatedAnalyticsAccess } from "../lib/data/business-data-service-rest.mjs";
import { CALCULATION_VERSION } from "../lib/cache/analytics-cache.mjs";

const dryRun = process.argv.includes("--dry-run");
const skipGolden = process.argv.includes("--skip-golden");

function accessTokenFromArgs(argv) {
  const envToken = String(process.env.ANALYTICS_ACCESS_TOKEN || "").trim();
  if (envToken) return envToken;
  const eq = argv.find((arg) => arg.startsWith("--access-token="));
  if (eq) return eq.slice("--access-token=".length).trim();
  const idx = argv.indexOf("--access-token");
  if (idx >= 0) return String(argv[idx + 1] || "").trim();
  return "";
}

function printGoldenReport(report) {
  console.log(`Golden in-memory: ${report.pass ? "PASS" : "FAIL"}`);
  console.log(`  live=${report.liveCount} snapshot=${report.snapshotCount}`);
  if (report.onlyLive.length) console.log(`  onlyLive: ${report.onlyLive.length}`);
  if (report.mismatches.length) console.log(`  mismatches: ${report.mismatches.length}`);
}

async function main() {
  loadAuditEnv();
  const accessToken = accessTokenFromArgs(process.argv);
  const persist = !dryRun;

  if (persist) {
    const configError = assertAuthenticatedAnalyticsAccess(accessToken);
    if (configError) {
      console.error("[StatSnapshot]", configError);
      console.error("Use POST /api/analytics?action=refresh-statistical-snapshot com authenticatedFetch.");
      process.exit(1);
    }
  }

  console.log("[StatSnapshot] Building live feature table (BASE QV read-only)...");
  const started = Date.now();
  const built = await buildLiveStatisticalFeatureSnapshot();
  const buildMs = Date.now() - started;

  console.log(`  clients=${built.clients.length} features=${built.runMeta.feature_count}`);
  console.log(`  calculation_version=${CALCULATION_VERSION}`);
  console.log(`  rest_requests=${built.sourceStats.rest_requests} rest_rows=${built.sourceStats.rest_rows}`);
  console.log(`  build_ms=${buildMs}`);

  if (!skipGolden) {
    const roundTrip = roundTripSnapshotClients(
      built.clients,
      built.snapshotVersion,
      built.generatedAt,
    );
    const golden = compareLiveAndSnapshotClients(built.clients, roundTrip);
    printGoldenReport(golden);
    if (!golden.pass) {
      console.error("[StatSnapshot] Golden in-memory FAIL — abortando persistência.");
      process.exit(1);
    }
  }

  if (dryRun) {
    console.log("[StatSnapshot] --dry-run: persistência ignorada.");
    return;
  }

  const tableExists = await statisticalSnapshotStore.tableExists({ accessToken });
  if (!tableExists) {
    console.error("[StatSnapshot] Tabelas ausentes no Business Data.");
    console.error("Execute manualmente: sql/analytics/011_statistical_client_features.sql");
    process.exit(1);
  }

  console.log("[StatSnapshot] Publishing (anon + JWT, role authenticated)...");
  const publishStarted = Date.now();
  const result = await statisticalSnapshotStore.publishSnapshot({
    rows: built.rows,
    runMeta: built.runMeta,
    accessToken,
  });
  console.log(`[StatSnapshot] OK version=${result.snapshot_version} rows=${result.persisted} publish_ms=${Date.now() - publishStarted}`);
}

main().catch((error) => {
  console.error("[StatSnapshot] refresh failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
