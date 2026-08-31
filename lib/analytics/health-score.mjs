/**
 * Health Score — payload BASE QV (Reuniões + Possui mecanismo).
 */
import { dataConfigurationError } from "../env.mjs";
import {
  getAnalyticsDataContext,
  perfDebugFromOptions,
  runWithAnalyticsDataContext,
} from "./analytics-data-context.mjs";
import { buildAnalyticalPopulation } from "./statistical-crosses.mjs";
import {
  computeGeneralCore,
  computeMeetingsCore,
  computeMechanismsCore,
} from "./compute-core.mjs";
import { preloadExecutiveSharedBundle } from "./executive-shared-bundle.mjs";
import { HEALTH_SCORE_METHODOLOGY } from "./health-score-metrics.mjs";
import { uniqueFilterOptions } from "./health-score-filters.mjs";

function mapHealthScoreClient(row = {}) {
  return {
    clientId: String(row.clientId),
    clientCode: row.clientCode ?? null,
    clientName: row.clientName ?? "Não informado",
    engineer: row.engineer ?? "Não informado",
    program: row.program ?? null,
    analyticalStatus: row.analyticalStatus ?? row.statusAnalytic ?? null,
    meetingCount: row.meetingCount ?? null,
    hasMechanism: row.hasMechanism === true,
  };
}

export function buildHealthScorePayload({ general, meetings, mechanisms } = {}) {
  const { clients } = buildAnalyticalPopulation(general, meetings, mechanisms, new Date());
  const rows = clients.map(mapHealthScoreClient);
  return {
    generatedAt: new Date().toISOString(),
    methodology: HEALTH_SCORE_METHODOLOGY,
    clients: rows,
    filterOptions: uniqueFilterOptions(rows),
    population: {
      totalClients: rows.length,
    },
  };
}

export async function computeHealthScorePayload(options = {}) {
  return runWithAnalyticsDataContext(async () => {
    const configError = dataConfigurationError();
    if (configError) {
      const err = new Error(configError);
      err.code = "config";
      throw err;
    }

    const startedAt = Date.now();
    const timings = {};
    const bundle = await preloadExecutiveSharedBundle({ force: Boolean(options.force) });
    const general = computeGeneralCore(bundle, timings);
    const meetings = computeMeetingsCore(bundle, timings);
    const mechanisms = await computeMechanismsCore(bundle, timings);
    const payload = buildHealthScorePayload({ general, meetings, mechanisms });

    const ctx = getAnalyticsDataContext();
    ctx?.logPerf({
      total_ms: Date.now() - startedAt,
      compute_ms: Object.values(timings).reduce((a, b) => a + b, 0),
      payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
    });

    return payload;
  }, { perfDebug: perfDebugFromOptions(options), page: "health_score" });
}

export function toPublicHealthScorePayload(payload) {
  if (!payload) return payload;
  return payload;
}
