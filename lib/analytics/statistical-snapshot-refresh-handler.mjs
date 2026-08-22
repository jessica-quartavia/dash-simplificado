/**
 * POST /api/analytics?action=refresh-statistical-snapshot
 * Refresh autenticado — anon key + JWT + RLS (sem service role).
 */
import { getRequestAccessToken, redactSecrets, requireCorporateAuth } from "../auth.mjs";
import { analyticsCatalogConfigurationError } from "../env.mjs";
import { buildLiveStatisticalFeatureSnapshot } from "./statistical-snapshot-builder.mjs";
import {
  compareLiveAndSnapshotClients,
  roundTripSnapshotClients,
} from "./statistical-snapshot.mjs";
import { statisticalSnapshotStore } from "./statistical-snapshot-store.mjs";

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handleStatisticalSnapshotRefreshRequest(request, deps = {}) {
  const startedAt = Date.now();
  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  if (denied) return denied;

  const method = request?.method || "GET";
  if (method !== "POST") {
    return json(405, { error: "Use POST para atualizar o snapshot estatístico.", code: "METHOD_NOT_ALLOWED" });
  }

  const configError = (deps.analyticsCatalogConfigurationError || analyticsCatalogConfigurationError)();
  if (configError) return json(503, { error: configError, code: "config" });

  const accessToken = getRequestAccessToken(request);
  if (!accessToken) {
    return json(401, { error: "Não autenticado.", code: "unauthenticated" });
  }

  console.info("[stat-snapshot-refresh] auth_url=configured anon=configured jwt=present role=authenticated");

  const store = deps.store || statisticalSnapshotStore;
  try {
    const tableExists = await store.tableExists({ accessToken });
    if (!tableExists) {
      return json(503, {
        error: "Tabelas analytics.statistical_client_features ainda não estão disponíveis no Business Data.",
        code: "snapshot_table_missing",
        hint: "Execute manualmente sql/analytics/011_statistical_client_features.sql no Business Data.",
      });
    }

    const build = deps.buildLiveStatisticalFeatureSnapshot || buildLiveStatisticalFeatureSnapshot;
    const buildStarted = Date.now();
    const built = await build();
    const buildMs = Date.now() - buildStarted;

    const roundTrip = roundTripSnapshotClients(
      built.clients,
      built.snapshotVersion,
      built.generatedAt,
    );
    const golden = compareLiveAndSnapshotClients(built.clients, roundTrip);
    if (!golden.pass) {
      return json(422, {
        error: "Golden in-memory falhou — snapshot não persistido.",
        code: "golden_failed",
        liveCount: golden.liveCount,
        snapshotCount: golden.snapshotCount,
        mismatchClients: golden.mismatches.length,
      });
    }

    const publishStarted = Date.now();
    const published = await store.publishSnapshot({
      rows: built.rows,
      runMeta: built.runMeta,
      accessToken,
    });
    const publishMs = Date.now() - publishStarted;

    return json(200, {
      snapshot_version: published.snapshot_version,
      client_count: built.clients.length,
      feature_count: built.runMeta.feature_count,
      calculation_version: built.runMeta.calculation_version,
      golden: { pass: true, liveCount: golden.liveCount },
      source_stats: built.sourceStats,
      timings: {
        build_ms: buildMs,
        publish_ms: publishMs,
        total_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    if (error?.code === "snapshot_table_missing") {
      return json(503, {
        error: "Tabelas de snapshot estatístico indisponíveis.",
        code: "snapshot_table_missing",
        detail: redactSecrets(error.message),
      });
    }
    if (error?.code === "snapshot_write_failed" && error.status === 401) {
      return json(401, { error: "Sessão inválida para escrita no Business Data.", code: "unauthenticated" });
    }
    if (error?.code === "snapshot_write_failed" && error.status === 403) {
      return json(403, { error: "Sem permissão RLS para refresh de snapshot.", code: "forbidden" });
    }
    console.error("[stat-snapshot-refresh] failed:", redactSecrets(error instanceof Error ? error.message : error));
    return json(500, {
      error: "Não foi possível atualizar o snapshot estatístico.",
      code: error?.code || "stat_snapshot_refresh_failed",
      detail: redactSecrets(error instanceof Error ? error.message : String(error)),
    });
  }
}
