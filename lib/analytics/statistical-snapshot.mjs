/**
 * Snapshot derivado — features por cliente (Análises Estatísticas).
 * Source of truth: buildAnalyticalPopulation + joinLatestNpsOntoClients.
 */
import { randomUUID } from "node:crypto";
import { CALCULATION_VERSION } from "../cache/analytics-cache.mjs";
import { getAnalyticsDataContext } from "./analytics-data-context.mjs";
import { numbersClose } from "./fidelity-audit.mjs";
import {
  pickStatisticalClientFeatures,
  restoreStatisticalClientRecord,
  STATISTICAL_FEATURE_REGISTRY,
  STATISTICAL_SNAPSHOT_CLIENT_FIELDS,
} from "./statistical-feature-registry.mjs";

export const STATISTICAL_SNAPSHOT_TTL_MS = 15 * 60 * 1000;

export function isStatisticalSnapshotEnabled(env = process.env) {
  return String(env.STATISTICAL_SNAPSHOT_ENABLED || "").trim().toLowerCase() === "true";
}

export function makeSnapshotVersion(now = new Date()) {
  return `sc-${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

export function isSnapshotFresh(meta, ttlMs = STATISTICAL_SNAPSHOT_TTL_MS, now = Date.now()) {
  if (!meta?.generated_at && !meta?.snapshot_generated_at) return false;
  const ts = Date.parse(meta.generated_at || meta.snapshot_generated_at);
  if (!Number.isFinite(ts)) return false;
  return now - ts <= ttlMs;
}

export function clientToSnapshotRow(client, snapshotVersion, generatedAt) {
  const features = pickStatisticalClientFeatures(client);
  const regByField = new Map(STATISTICAL_FEATURE_REGISTRY.map((r) => [r.clientField, r]));
  const row = {
    snapshot_version: snapshotVersion,
    client_id: String(client.clientId),
    features,
    generated_at: generatedAt,
  };
  for (const field of STATISTICAL_SNAPSHOT_CLIENT_FIELDS) {
    const def = regByField.get(field);
    if (!def?.column || def.column === "client_id") continue;
    row[def.column] = features[field];
  }
  return row;
}

export function snapshotRowToClient(row) {
  const base = row?.features && typeof row.features === "object"
    ? restoreStatisticalClientRecord(row.features)
    : {};
  if (!base.clientId && row?.client_id) base.clientId = String(row.client_id);
  return base;
}

export function compareClientFeatureRecords(live, snapshot, { floatTolerance = 0.0001 } = {}) {
  const diffs = [];
  for (const field of STATISTICAL_SNAPSHOT_CLIENT_FIELDS) {
    const a = live?.[field];
    const b = snapshot?.[field];
    if (typeof a === "number" || typeof b === "number") {
      if (!numbersClose(a, b, floatTolerance)) {
        diffs.push({ field, live: a, snapshot: b, kind: "number" });
      }
      continue;
    }
    if (typeof a === "boolean" || typeof b === "boolean") {
      if (Boolean(a) !== Boolean(b)) diffs.push({ field, live: a, snapshot: b, kind: "boolean" });
      continue;
    }
    const sa = a == null ? null : String(a);
    const sb = b == null ? null : String(b);
    if (sa !== sb) diffs.push({ field, live: a, snapshot: b, kind: "scalar" });
  }
  return diffs;
}

export function compareLiveAndSnapshotClients(liveClients, snapshotClients, options = {}) {
  const liveById = new Map((liveClients || []).map((c) => [String(c.clientId), c]));
  const snapById = new Map((snapshotClients || []).map((c) => [String(c.clientId), c]));
  const onlyLive = [];
  const onlySnapshot = [];
  const mismatches = [];

  for (const id of liveById.keys()) {
    if (!snapById.has(id)) onlyLive.push(id);
  }
  for (const id of snapById.keys()) {
    if (!liveById.has(id)) onlySnapshot.push(id);
  }
  for (const [id, live] of liveById.entries()) {
    const snap = snapById.get(id);
    if (!snap) continue;
    const diffs = compareClientFeatureRecords(live, snap, options);
    if (diffs.length) mismatches.push({ clientId: id, diffs });
  }

  return {
    pass: !onlyLive.length && !onlySnapshot.length && !mismatches.length,
    liveCount: liveById.size,
    snapshotCount: snapById.size,
    onlyLive,
    onlySnapshot,
    mismatches,
  };
}

export function roundTripSnapshotClients(clients, snapshotVersion, generatedAt) {
  return (clients || []).map((c) =>
    snapshotRowToClient(clientToSnapshotRow(c, snapshotVersion, generatedAt)),
  );
}

export function summarizeSourceFetchStats() {
  const ctx = getAnalyticsDataContext();
  const sources = ctx?.sources || [];
  const counts = {};
  let requests = 0;
  let rows = 0;
  for (const s of sources) {
    counts[s.source] = s.total_rows || 0;
    requests += s.request_count || 0;
    rows += s.total_rows || 0;
  }
  return { source_row_counts: counts, rest_requests: requests, rest_rows: rows };
}

export function buildSnapshotRunMetadata({
  snapshotVersion,
  clients,
  sourceStats,
  generatedAt = new Date().toISOString(),
  status = "complete",
}) {
  return {
    snapshot_version: snapshotVersion,
    calculation_version: CALCULATION_VERSION,
    client_count: clients?.length || 0,
    feature_count: STATISTICAL_SNAPSHOT_CLIENT_FIELDS.length,
    source_row_counts: sourceStats?.source_row_counts || {},
    rest_requests: sourceStats?.rest_requests || null,
    rest_rows: sourceStats?.rest_rows || null,
    snapshot_generated_at: generatedAt,
    status,
    is_active: status === "complete",
  };
}
