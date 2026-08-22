#!/usr/bin/env node
/**
 * Fidelity check: feature table live (BASE QV) × snapshot persistido (Business Data).
 *
 * node scripts/compare-statistical-live-vs-snapshot.mjs --memory-only
 * ANALYTICS_ACCESS_TOKEN=<JWT> node scripts/compare-statistical-live-vs-snapshot.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuditEnv } from "../lib/analytics/fidelity-audit.mjs";
import { buildLiveStatisticalFeatureSnapshot } from "../lib/analytics/statistical-snapshot-builder.mjs";
import {
  compareLiveAndSnapshotClients,
  roundTripSnapshotClients,
} from "../lib/analytics/statistical-snapshot.mjs";
import { statisticalSnapshotStore } from "../lib/analytics/statistical-snapshot-store.mjs";
import { assertAuthenticatedAnalyticsAccess } from "../lib/data/business-data-service-rest.mjs";
import { CALCULATION_VERSION } from "../lib/cache/analytics-cache.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const memoryOnly = process.argv.includes("--memory-only");

function accessTokenFromArgs(argv) {
  const envToken = String(process.env.ANALYTICS_ACCESS_TOKEN || "").trim();
  if (envToken) return envToken;
  const eq = argv.find((arg) => arg.startsWith("--access-token="));
  if (eq) return eq.slice("--access-token=".length).trim();
  return "";
}

function summarizeMismatches(report, limit = 5) {
  return (report.mismatches || []).slice(0, limit).map((m) => ({
    clientId: m.clientId,
    diffCount: m.diffs.length,
    fields: m.diffs.map((d) => d.field),
  }));
}

async function main() {
  loadAuditEnv();
  const accessToken = accessTokenFromArgs(process.argv);

  console.log("[StatSnapshot] Building live feature table...");
  const liveBuilt = await buildLiveStatisticalFeatureSnapshot();
  const liveClients = liveBuilt.clients;

  let snapshotClients;
  let snapshotMeta = null;
  let mode = "memory_roundtrip";

  if (!memoryOnly) {
    const configError = assertAuthenticatedAnalyticsAccess(accessToken);
    if (configError) {
      console.warn("[StatSnapshot] JWT ausente — memory round-trip only.");
      console.warn(configError);
    } else {
      const tableExists = await statisticalSnapshotStore.tableExists({ accessToken });
      if (!tableExists) {
        console.warn("[StatSnapshot] Tabelas ausentes — memory round-trip only.");
        console.warn("Execute manualmente: sql/analytics/011_statistical_client_features.sql");
      } else {
        try {
          const loaded = await statisticalSnapshotStore.loadActiveClientFeatures({ accessToken });
          snapshotClients = loaded.clients;
          snapshotMeta = loaded.meta;
          mode = "business_data";
        } catch (error) {
          console.warn("[StatSnapshot] load failed:", error instanceof Error ? error.message : error);
        }
      }
    }
  }

  if (!snapshotClients) {
    snapshotClients = roundTripSnapshotClients(
      liveClients,
      liveBuilt.snapshotVersion,
      liveBuilt.generatedAt,
    );
  }

  const report = compareLiveAndSnapshotClients(liveClients, snapshotClients);
  const output = {
    generatedAt: new Date().toISOString(),
    calculationVersion: CALCULATION_VERSION,
    mode,
    pass: report.pass,
    liveCount: report.liveCount,
    snapshotCount: report.snapshotCount,
    onlyLive: report.onlyLive.length,
    onlySnapshot: report.onlySnapshot.length,
    mismatchClients: report.mismatches.length,
    sampleMismatches: summarizeMismatches(report),
    snapshotMeta: snapshotMeta
      ? {
          version: snapshotMeta.snapshot_version,
          generated_at: snapshotMeta.snapshot_generated_at || snapshotMeta.generated_at,
          client_count: snapshotMeta.client_count,
        }
      : null,
  };

  const jsonPath = join(ROOT, "docs/statistical-snapshot-fidelity.json");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(output, null, 2));

  console.log(`Mode: ${mode}`);
  console.log(`Fidelity: ${report.pass ? "PASS" : "FAIL"}`);
  console.log(`  live=${report.liveCount} snapshot=${report.snapshotCount}`);
  console.log("Written:", jsonPath);

  if (!report.pass) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
