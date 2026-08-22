/**
 * Constrói feature table live para snapshot (mesmos helpers oficiais).
 */
import { fetchAllRows } from "../data/supabase-rest.mjs";
import { runWithAnalyticsDataContext } from "./analytics-data-context.mjs";
import { computeGeneralDataPayload } from "./general-data.mjs";
import { computeMeetingsPayload } from "./meetings.mjs";
import { computeMechanismsPayload } from "./mechanisms.mjs";
import {
  buildAnalyticalPopulation,
  joinLatestNpsOntoClients,
} from "./statistical-crosses.mjs";
import {
  buildSnapshotRunMetadata,
  clientToSnapshotRow,
  makeSnapshotVersion,
  summarizeSourceFetchStats,
} from "./statistical-snapshot.mjs";

async function fetchNpsResponsesForCrosses() {
  return fetchAllRows({
    table: "nps_responses",
    select: "id,client_id,score,submitted_at,created_at,tipo_de_forms",
    order: "submitted_at.desc,created_at.desc",
  });
}

/**
 * @returns {Promise<{ clients: object[], warnings: object[], npsJoin: object, rows: object[], runMeta: object, sourceStats: object }>}
 */
export async function buildLiveStatisticalFeatureSnapshot(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const snapshotVersion = options.snapshotVersion || makeSnapshotVersion(now);
  const generatedAt = now.toISOString();

  return runWithAnalyticsDataContext(async () => {
    const fetchStarted = Date.now();
    const [general, meetings, mechanisms, npsRows] = await Promise.all([
      computeGeneralDataPayload(),
      computeMeetingsPayload({ includeMeetingTypes: false }),
      computeMechanismsPayload(),
      fetchNpsResponsesForCrosses().catch((error) => {
        console.warn("[StatSnapshot] NPS fetch failed:", error instanceof Error ? error.message : error);
        return [];
      }),
    ]);
    const fetchMs = Date.now() - fetchStarted;

    const built = buildAnalyticalPopulation(general, meetings, mechanisms, now);
    const clients = built.clients.map((c) => ({ ...c }));
    const npsJoin = joinLatestNpsOntoClients(clients, npsRows);
    const sourceStats = {
      ...summarizeSourceFetchStats(),
      fetch_ms: fetchMs,
    };

    const rows = clients.map((c) => clientToSnapshotRow(c, snapshotVersion, generatedAt));
    const runMeta = {
      ...buildSnapshotRunMetadata({
        snapshotVersion,
        clients,
        sourceStats,
        generatedAt,
        status: "complete",
      }),
      nps_join: npsJoin,
    };

    return {
      clients,
      warnings: built.warnings,
      npsJoin,
      rows,
      runMeta,
      sourceStats,
      snapshotVersion,
      generatedAt,
    };
  });
}

export async function loadStatisticalSnapshotForCompute(options = {}) {
  const { statisticalSnapshotStore } = await import("./statistical-snapshot-store.mjs");
  return statisticalSnapshotStore.loadActiveClientFeatures({
    accessToken: options.accessToken || null,
  });
}
